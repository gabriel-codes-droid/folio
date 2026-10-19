import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { reportBoot } from './bootProgress';

export { reportBoot };

export function AssetProgress() {
  // Byte progress is reported by sceneDownloads; this only surfaces failures.
  const { errors } = useProgress();
  useEffect(() => {
    if (errors.length) reportBoot('error', 0, 'An asset could not load. Reload to retry.');
  }, [errors]);
  return null;
}

const WARM_LAYER = 31;
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
// The page is already open while this runs, so wait for a quiet moment.
const idle = () => new Promise(resolve => (window.requestIdleCallback
  ? window.requestIdleCallback(() => resolve(), { timeout: 400 })
  : requestAnimationFrame(() => resolve())));

// Draw one representative mesh per material into an offscreen target, one
// per idle moment. On Direct3D (most Windows laptops) a shader finishes
// compiling at its first draw and blocks the page, so one big warm-up froze
// it for ~7s; one program at a time keeps each pause short. Every light stays
// in the scene (light count is part of each shader), and the offscreen target
// matches the bloom composer's linear buffer so programs are reused later.
async function warm(gl, scene, camera, root, isCancelled) {
  const textures = new Set();
  const representatives = new Map();
  root.traverse(object => {
    const materials = [].concat(object.material ?? []);
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      const key = `${material.uuid}:${object.isSkinnedMesh ? 'skin' : ''}`;
      if (object.isMesh && !representatives.has(key)) representatives.set(key, object);
    }
  });
  let sliceStarted = performance.now();
  for (const texture of textures) {
    if (isCancelled()) return false;
    gl.initTexture(texture);
    if (performance.now() - sliceStarted >= 8) { await idle(); sliceStarted = performance.now(); }
  }
  const lights = [];
  scene.traverse(object => { if (object.isLight) lights.push(object); });
  const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
  const cameraLayers = camera.layers.mask;
  try {
    for (const mesh of representatives.values()) {
      await idle();
      if (isCancelled()) return false;
      // Make the mesh and its ancestors drawable, render only the warm layer.
      const restore = [];
      for (let node = mesh; node; node = node.parent) restore.push([node, node.visible, node.frustumCulled]);
      for (const [node] of restore) { node.visible = true; node.frustumCulled = false; }
      for (const object of [mesh, ...lights]) object.layers.enable(WARM_LAYER);
      const previous = gl.getRenderTarget();
      try {
        camera.layers.set(WARM_LAYER);
        gl.setRenderTarget(target);
        gl.render(scene, camera);
      } finally {
        gl.setRenderTarget(previous);
        camera.layers.mask = cameraLayers;
        for (const object of [mesh, ...lights]) object.layers.disable(WARM_LAYER);
        for (const [node, visible, culled] of restore) { node.visible = visible; node.frustumCulled = culled; }
      }
    }
  } finally {
    target.dispose();
  }
  return true;
}

// Each stage has its own Suspense boundary. Warm only its new resources;
// preparing a later stage must not recompile the entire opening again.
export default function SceneReady({ onReady, onError, rootRef }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      await frame(); // let the environment and bone attachments commit
      if (cancelled) return;
      if (!await warm(gl, scene, camera, rootRef?.current || scene, () => cancelled)) return;
      // Suspense resolved this stage's assets; also wait for the loader queue.
      while (!cancelled) {
        const loading = useProgress.getState();
        if (loading.errors.length) throw new Error('An asset could not load.');
        if (!loading.active && loading.loaded >= loading.total) break;
        await frame();
      }
      if (!cancelled) onReady();
    }
    prepare().catch(error => {
      if (cancelled) return;
      console.error('Scene preparation failed', error);
      if (onError) onError(error);
      else reportBoot('error', 0, 'Scene preparation failed. Reload to retry.');
    });
    return () => { cancelled = true; };
  }, [gl, scene, camera]);
  return null;
}
