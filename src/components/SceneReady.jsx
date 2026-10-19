import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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

// Each stage has its own Suspense boundary. Warm only its new resources;
// preparing a later stage must not recompile the entire opening again.
export default function SceneReady({ onReady, quiet = false, onError, rootRef }) {
  const { gl, scene, camera } = useThree();
  const prepared = useRef(false);
  const frames = useRef(0);
  // A few normal frames initialize post-processing. The GPU fence below,
  // rather than a long frame-count delay, determines actual readiness.
  const STABILIZATION_FRAMES = 3;
  const fence = useRef(null);
  const finished = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    async function prepare() {
      // CSS backgrounds are outside Three's loading manager.
      const background = new Image();
      background.src = '/images/stars-clean.png';
      await background.decode();
      await frame(); // allow the environment and bone attachments to commit
      if (cancelled) return;
      const root = rootRef?.current || scene;
      const textures = new Set();
      root.traverse(object => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      let batchStarted = performance.now();
      for (const texture of textures) {
        if (cancelled) return;
        gl.initTexture(texture);
        // Upload small textures together instead of paying a full rendered
        // frame per texture. Yield after a bounded CPU slice for the loader.
        if (performance.now() - batchStarted >= 4) {
          await frame();
          batchStarted = performance.now();
        }
      }
      // Include hidden moon/planets/cubes/boot thrusters in compilation. Restore
      // visibility before yielding so none can flash into another scene.
      const objects = [];
      root.traverse(object => {
        objects.push([object, object.visible, object.frustumCulled]);
        object.visible = true;
        object.frustumCulled = false;
      });
      // Compile against an offscreen target: the bloom composer renders the
      // scene into a linear buffer, and program keys include the output colour
      // space. Compiling for the sRGB screen built variants that were never
      // used, then the real ones compiled synchronously (~25s on Iris Xe).
      const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
      const previous = gl.getRenderTarget();
      let compilation;
      try {
        gl.setRenderTarget(target);
        compilation = gl.compileAsync(root, camera, scene);
      } finally {
        gl.setRenderTarget(previous);
        for (const [object, visible, culled] of objects) {
          object.visible = visible;
          object.frustumCulled = culled;
        }
      }
      try { await compilation; } catch (error) { target.dispose(); throw error; }
      if (cancelled) { target.dispose(); return; }
      // Submit all geometry once offscreen, including meshes outside the
      // opening camera. This pays first-use buffer uploads during loading.
      try {
        for (const [object] of objects) { object.visible = true; object.frustumCulled = false; }
        gl.setRenderTarget(target);
        gl.render(scene, camera);
      } finally {
        gl.setRenderTarget(previous);
        for (const [object, visible, culled] of objects) {
          object.visible = visible;
          object.frustumCulled = culled;
        }
        target.dispose();
      }
      prepared.current = true;
    }
    prepare().catch(error => {
      if (!cancelled) {
        console.error('Scene preparation failed', error);
        if (onError) onError(error);
        else reportBoot('error', 0, 'Scene preparation failed. Reload to retry.');
      }
    });
    return () => {
      cancelled = true;
      if (fence.current) gl.getContext().deleteSync(fence.current);
    };
  }, [gl, scene, camera]);

  useFrame(() => {
    if (!prepared.current || finished.current) return;
    // Suspense resolves the scene assets; also require the loading manager
    // to be idle before the settled-frame/GPU gate can release the curtain.
    const loading = useProgress.getState();
    if (!quiet && loading.errors.length) {
      finished.current = true;
      reportBoot('error', 0, 'An asset could not load. Reload to retry.');
      return;
    }
    if (loading.active || loading.loaded < loading.total) {
      frames.current = 0;
      if (fence.current) {
        gl.getContext().deleteSync(fence.current);
        fence.current = null;
      }
      return;
    }
    // Normal frames also initialize the full-resolution bloom composer.
    if (++frames.current < STABILIZATION_FRAMES) return;
    const context = gl.getContext();
    if (!fence.current) {
      fence.current = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
      context.flush();
      return;
    }
    const status = context.clientWaitSync(fence.current, 0, 0);
    if (status === context.TIMEOUT_EXPIRED) return;
    if (status === context.WAIT_FAILED) {
      finished.current = true;
      if (onError) onError(new Error('GPU preparation failed'));
      else reportBoot('error', 0, 'Graphics preparation failed. Reload to retry.');
      return;
    }
    context.deleteSync(fence.current);
    fence.current = null;
    finished.current = true;
    onReady();
  });
  return null;
}
