import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useFBX, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { sampleJourney, sampleArrival, clamp, smooth } from './journey';
import { sampleCharacterPose } from './characterPose';
import { PRESENTATION_CHAINS, presentationDirection } from './presentation';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  MOON_SEAT_POSITION,
} from './sceneConstants';

const ASTRONAUT_MODEL = '/models/bot_mecha_warrior.glb';
const CHARACTER_SCALE = 0.68;

useGLTF.preload(ASTRONAUT_MODEL);
useFBX.preload('/models/idle.fbx');
useFBX.preload('/models/flying.fbx');
useFBX.preload('/models/landing.fbx');
useFBX.preload('/models/sitting.fbx');

// Source FBX bones -> the mecha's separated limb chains. The mecha has extra
// twist bones and five spine segments; we deliberately target the main
// deforming bones only so the FBX never collapses the legs into one chain.
const BONE_MAP = {
  mixamorigHips: 'root_x_03',
  mixamorigLeftUpLeg: 'thigh_stretch_l_057', mixamorigLeftLeg: 'leg_stretch_l_058',
  mixamorigLeftFoot: 'foot_l_059', mixamorigLeftToeBase: 'toes_01_l_060',
  mixamorigRightUpLeg: 'thigh_stretch_r_065', mixamorigRightLeg: 'leg_stretch_r_066',
  mixamorigRightFoot: 'foot_r_067', mixamorigRightToeBase: 'toes_01_r_068',
  mixamorigSpine: 'spine_01_x_04', mixamorigSpine1: 'spine_03_x_06', mixamorigSpine2: 'spine_05_x_08',
  mixamorigLeftShoulder: 'shoulder_l_012', mixamorigLeftArm: 'arm_stretch_l_013',
  mixamorigLeftForeArm: 'forearm_stretch_l_016', mixamorigLeftHand: 'hand_l_019',
  mixamorigRightShoulder: 'shoulder_r_035', mixamorigRightArm: 'arm_stretch_r_036',
  mixamorigRightForeArm: 'forearm_stretch_r_038', mixamorigRightHand: 'hand_r_041',
  mixamorigNeck: 'neck_x_010', mixamorigHead: 'head_x_011',
};

const BONE_ENTRIES = Object.entries(BONE_MAP);

// A lightweight but layered boot-thruster effect. It uses no texture fetches
// or particle simulation: a white-hot core, cyan combustion shell, blue plume
// and a pulsing point light make the exhaust feel physical while it remains
// cheap enough to keep the cinematic scroll smooth. The assembly is parented
// directly to each foot bone, so it follows the supplied FBX animation.
function createBootFlame() {
  const group = new THREE.Group();

  const nozzle = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.014, 6, 12),
    new THREE.MeshBasicMaterial({
      color: '#42cfff', transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
    }),
  );
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.y = -0.025;

  const plume = new THREE.Mesh(
    new THREE.ConeGeometry(0.125, 0.72, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#176dff', transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  plume.rotation.x = Math.PI;
  plume.position.y = -0.37;

  const shell = new THREE.Mesh(
    new THREE.ConeGeometry(0.086, 0.52, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#19d7ff', transparent: true, opacity: 0.54,
      blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shell.rotation.x = Math.PI;
  shell.position.y = -0.27;

  const core = new THREE.Mesh(
    new THREE.ConeGeometry(0.043, 0.36, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#f6fdff', transparent: true, opacity: 0.96,
      blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  core.rotation.x = Math.PI;
  core.position.y = -0.20;

  const heatGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.095, 10, 8),
    new THREE.MeshBasicMaterial({
      color: '#bdf7ff', transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
    }),
  );
  heatGlow.position.y = -0.055;
  heatGlow.scale.set(1, 0.62, 1);

  const light = new THREE.PointLight('#4acfff', 0, 2.8, 2);
  light.position.set(0, -0.18, 0);
  light.castShadow = false;

  group.add(nozzle, plume, shell, core, heatGlow, light);
  group.name = 'bootFlame';
  group.visible = false;
  group.userData = { nozzle, plume, shell, core, heatGlow, light };
  return group;
}

export default function TacticalAstronaut({ phase, position = [0, 0, 0], scale = 1, journeyProgress = 0, journeyProgressRef, worldPositionRef, controlledYawRef, presentationRef }) {
  const group = useRef(null);
  const { scene } = useGLTF(ASTRONAUT_MODEL);
  const astronaut = useMemo(() => {
    const clone = cloneSkinnedScene(scene);
    // Lock every sub-material to real opaque front-face PBR so the mech reads
    // as a physical solid the camera and other objects can't phase through,
    // regardless of whatever the source GLB authored for transparency.
    clone.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of materials) {
        mat.transparent = false;
        mat.opacity = 1;
        mat.depthWrite = true;
        mat.depthTest = true;
        mat.side = THREE.FrontSide;
        if (mat.clearcoat !== undefined) { mat.clearcoat = 0; mat.clearcoatRoughness = 1; }
        if (mat.clearcoatMap) { mat.clearcoatMap = undefined; }
        if (mat.transmission !== undefined) { mat.transmission = 0; }
        if (mat.transmissionMap) { mat.transmissionMap = undefined; }
        if (mat.ior !== undefined) { mat.ior = 1; }
        if (mat.thickness !== undefined) { mat.thickness = 0; }
      }
    });
    clone.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const tunedMaterials = materials.map((material) => {
        const tuned = material.clone();
        const isVisor = tuned.name === 'HEAD_1032';
        tuned.roughness = isVisor ? 0.38 : 0.95;
        tuned.metalness = isVisor ? 0.1 : 0.2;
        tuned.envMapIntensity = isVisor ? 0.35 : 0.1;
        if (tuned.emissive) {
          tuned.emissiveIntensity = 0;
        }
        return tuned;
      });
      object.material = Array.isArray(object.material) ? tunedMaterials : tunedMaterials[0];
    });
    return clone;
  }, [scene]);

  // Keep the original flight FBX for the guide and descent. Idle supplies
  // the same bind rig as the old route, without downloading its jump model.
  const idleAsset = useFBX('/models/idle.fbx');
  const flyAsset = useFBX('/models/flying.fbx');
  const landAsset = useFBX('/models/landing.fbx');
  const sitAsset = useFBX('/models/sitting.fbx');

  const sourceRig = useMemo(() => cloneSkinnedScene(idleAsset), [idleAsset]);
  const sourceBones = useMemo(() => {
    const result = {};
    sourceRig.traverse((object) => { if (object.isBone) result[object.name] = object; });
    return result;
  }, [sourceRig]);
  const targetBones = useMemo(() => {
    const result = {};
    astronaut.traverse((object) => { if (object.isBone) result[object.name] = object; });
    return result;
  }, [astronaut]);

  const sourceRestWorld = useMemo(() => {
    sourceRig.updateMatrixWorld(true);
    return Object.fromEntries(Object.entries(sourceBones).map(([name, bone]) => {
      const quaternion = new THREE.Quaternion();
      bone.getWorldQuaternion(quaternion);
      return [name, quaternion];
    }));
  }, [sourceRig, sourceBones]);
  const targetRestWorld = useMemo(() => {
    astronaut.updateMatrixWorld(true);
    return Object.fromEntries(BONE_ENTRIES.map(([, targetName]) => {
      const bone = targetBones[targetName];
      if (!bone) return [targetName, null];
      const quaternion = new THREE.Quaternion();
      bone.getWorldQuaternion(quaternion);
      return [targetName, quaternion];
    }));
  }, [astronaut, targetBones]);
  const poseScratch = useMemo(() => ({
    sourceWorld: new THREE.Quaternion(),
    sourceRestWorldInverse: new THREE.Quaternion(),
    sourceDeltaWorld: new THREE.Quaternion(),
    desiredTargetWorld: new THREE.Quaternion(),
    parentWorld: new THREE.Quaternion(),
    inverseParentWorld: new THREE.Quaternion(),
    wrapperWorld: new THREE.Quaternion(),
    floorLeg: new THREE.Quaternion(),
    presentation: new THREE.Quaternion(),
    presentationYaw: new THREE.Quaternion(),
    guideRotation: new THREE.Quaternion(),
    guidePitch: new THREE.Quaternion(),
    rotationEuler: new THREE.Euler(),
  }), []);
  const presentationPoses = useMemo(() => {
    astronaut.updateMatrixWorld(true);
    const poses = { 1: {}, '-1': {} };
    const start = new THREE.Vector3(), end = new THREE.Vector3();
    for (const [name, childName] of Object.entries(PRESENTATION_CHAINS)) {
      const bone = targetBones[name], child = targetBones[childName];
      if (!bone || !child) continue;
      const direction = child.getWorldPosition(end).sub(bone.getWorldPosition(start)).normalize().clone();
      for (const side of [1, -1]) {
        poses[side][name] = new THREE.Quaternion()
          .setFromUnitVectors(direction, new THREE.Vector3(...presentationDirection(name, side)).normalize())
          .multiply(targetRestWorld[name]);
      }
    }
    return poses;
  }, [astronaut, targetBones, targetRestWorld]);
  const targetPoseWorld = useRef({});
  const sourceMixer = useMemo(() => new THREE.AnimationMixer(sourceRig), [sourceRig]);
  const actions = useMemo(() => ({
    hovering: sourceMixer.clipAction(flyAsset.animations[0].clone(), sourceRig),
    presenting: sourceMixer.clipAction(idleAsset.animations[0], sourceRig),
    flying: sourceMixer.clipAction(flyAsset.animations[0], sourceRig),
    landing: sourceMixer.clipAction(landAsset.animations[0], sourceRig),
    seated: sourceMixer.clipAction(sitAsset.animations[0], sourceRig),
  }), [sourceMixer, sourceRig, idleAsset, flyAsset, landAsset, sitAsset]);

  const movementScratch = useMemo(() => ({
    leftToe: new THREE.Vector3(),
    rightToe: new THREE.Vector3(),
  }), []);
  const seatedHipBend = useMemo(
    () => new THREE.Quaternion().setFromEuler(new THREE.Euler(-2.1, 0, 0)),
    [],
  );
  const seatedKneeBend = useMemo(
    () => new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.05, 0, 0)),
    [],
  );

  useFrame((state, delta) => {
    if (!group.current) return;
    const t = state.clock.getElapsedTime();
    const progress = journeyProgressRef?.current ?? journeyProgress;
    const arrival = sampleArrival(progress);

    // Boot thrusters are only active for launch/flight. The independent
    // pulses stop the exhaust looking like a static cone while the attached
    // point lights give the boots and nearby leg armour a cyan lift.
    const thrust = (1 - arrival.touchdown) * (phase === 'hovering' ? 0.55 : 0.9);
    const thrustActive = thrust > 0.001;
    const leftFoot = targetBones['foot_l_059'];
    const rightFoot = targetBones['foot_r_067'];
    [leftFoot, rightFoot].forEach((foot, index) => {
      const flame = foot?.getObjectByName('bootFlame');
      if (!flame) return;
      flame.visible = thrustActive;
      if (thrustActive) {
        const pulse = 0.9 + Math.sin(t * 27 + index * 1.9) * 0.065
          + Math.sin(t * 53 + index * 0.7) * 0.035;
        const surge = 1 + Math.sin(t * 17 + index) * 0.09;
        flame.scale.set(pulse * 0.8, surge * thrust, pulse * 0.8);
        flame.userData.plume.scale.set(1 + (surge - 1) * 1.8, 1 + (surge - 1) * 2.4, 1 + (surge - 1) * 1.8);
        flame.userData.shell.material.opacity = 0.48 + pulse * 0.08;
        flame.userData.plume.material.opacity = 0.2 + pulse * 0.09;
        flame.userData.heatGlow.material.opacity = 0.28 + pulse * 0.16;
        flame.userData.light.intensity = (1.25 + pulse * 0.85) * thrust;
      } else {
        flame.userData.light.intensity = 0;
      }
    });

    let yaw;
    if (worldPositionRef) {
      group.current.position.copy(worldPositionRef.current);
      yaw = controlledYawRef.current;
    } else yaw = sampleJourney(progress, group.current.position);
    const seatedWeight = arrival.seatedWeight;
    const flightLean = phase === 'flying'
      ? Math.sin(clamp(progress / 0.52) * Math.PI) * 0.38 : 0;
    // Give the introductory guide a gentle, continuous float even when
    // visitors stop scrolling. Fade it out before the authored descent.
    const hoverWeight = 1 - smooth(progress / 0.06);
    const presentationWeight = (presentationRef?.current.weight || 0) * hoverWeight;
    const presentationSide = presentationRef?.current.side || 1;
    poseScratch.presentationYaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    group.current.position.x += Math.sin(t * 0.9) * 0.065 * hoverWeight;
    group.current.position.y += Math.sin(t * 1.55) * 0.18 * hoverWeight;
    // Turn around WORLD up before applying the flight clip's pitch correction.
    // Euler XYZ applied yaw in the pitched frame, rolling the entire mech.
    group.current.quaternion.setFromEuler(poseScratch.rotationEuler.set(flightLean, yaw, 0));
    poseScratch.guidePitch.setFromEuler(poseScratch.rotationEuler.set(
      -Math.PI / 2 * (1 - presentationWeight) + Math.sin(t * 1.55 + 0.7) * 0.018,
      0, Math.sin(t * 0.9 + 0.5) * 0.018,
    ));
    poseScratch.guideRotation.copy(poseScratch.presentationYaw).multiply(poseScratch.guidePitch);
    group.current.quaternion.slerp(poseScratch.guideRotation, hoverWeight);
    group.current.updateMatrixWorld(true);

    group.current.getWorldQuaternion(poseScratch.wrapperWorld);

    // Let AnimationMixer own the source pose. Resetting bones each frame
    // breaks frozen scroll samples: unchanged mixer values are not rewritten,
    // so a settled seated pose would revert to the bind pose.
    const hoverTime = (t * 0.48 / actions.hovering.getClip().duration) % 1;
    sampleCharacterPose(actions, progress, hoverTime, presentationWeight);
    sourceMixer.update(delta);


    // Convert each FBX world-pose delta into the bot's own bind pose. This
    // keeps the bot's left/right limb axes and separated leg chains intact;
    // only rotations are copied, never the FBX mesh or hip position track.
    const nextTargetPoseWorld = targetPoseWorld.current;
    BONE_ENTRIES.forEach(([sourceName, targetName]) => {
      const sourceBone = sourceBones[sourceName];
      const targetBone = targetBones[targetName];
      const sourceBaseWorld = sourceRestWorld[sourceName];
      const targetBaseWorld = targetRestWorld[targetName];
      if (!sourceBone || !targetBone || !sourceBaseWorld || !targetBaseWorld) return;

      sourceBone.getWorldQuaternion(poseScratch.sourceWorld);
      poseScratch.sourceDeltaWorld
        .copy(poseScratch.sourceWorld)
        .multiply(poseScratch.sourceRestWorldInverse.copy(sourceBaseWorld).invert());
      poseScratch.desiredTargetWorld
        .copy(poseScratch.sourceDeltaWorld)
        .multiply(targetBaseWorld)
        .premultiply(poseScratch.wrapperWorld);

      const presenting = presentationPoses[presentationSide][targetName];
      const armWeight = smooth((presentationWeight - 0.35) / 0.65);
      if (presenting && armWeight > 0) {
        poseScratch.presentation.copy(presenting).premultiply(poseScratch.presentationYaw);
        poseScratch.desiredTargetWorld.slerp(poseScratch.presentation, armWeight);
      }

      // The supplied sit clip assumes a chair. Fold both legs in the SAME
      // character-space plane for the moon floor; local bone axes differ
      // left/right, so applying identical local bends caused crossed legs.
      if (seatedWeight > 0 && /^(thigh_stretch|leg_stretch|foot_|toes_01)/.test(targetName)) {
        poseScratch.floorLeg.copy(targetBaseWorld);
        if (targetName.startsWith('thigh_stretch')) poseScratch.floorLeg.premultiply(seatedHipBend);
        if (targetName.startsWith('leg_stretch')) poseScratch.floorLeg.premultiply(seatedKneeBend);
        poseScratch.floorLeg.premultiply(poseScratch.wrapperWorld);
        poseScratch.desiredTargetWorld.slerp(poseScratch.floorLeg, seatedWeight);
      }

      const parent = targetBone.parent;
      const mappedParentWorld = parent && nextTargetPoseWorld[parent.name];
      if (mappedParentWorld) {
        poseScratch.parentWorld.copy(mappedParentWorld);
      } else if (parent) {
        parent.getWorldQuaternion(poseScratch.parentWorld);
      } else {
        poseScratch.parentWorld.identity();
      }
      poseScratch.inverseParentWorld.copy(poseScratch.parentWorld).invert();
      targetBone.quaternion
        .copy(poseScratch.inverseParentWorld)
        .multiply(poseScratch.desiredTargetWorld)
        .normalize();
      // Include the character wrapper in the target pose. Otherwise solving
      // world-space bone rotations cancels the wrapper's turn toward planets.
      (nextTargetPoseWorld[targetName] ??= new THREE.Quaternion()).copy(poseScratch.desiredTargetWorld);

    });

    group.current.updateMatrixWorld(true);
    if (phase === 'landing') {
      const left = targetBones['toes_01_l_060'];
      const right = targetBones['toes_01_r_068'];
      if (left && right) {
        left.getWorldPosition(movementScratch.leftToe);
        right.getWorldPosition(movementScratch.rightToe);
        const lowest = Math.min(movementScratch.leftToe.y, movementScratch.rightToe.y);
        const contactWeight = phase === 'landing' ? (1 - arrival.flightWeight) * (1 - seatedWeight) : 1;
        group.current.position.y += (group.current.position.y + 0.07 - lowest) * contactWeight;
        group.current.updateMatrixWorld(true);
      }
    }
    // Settle the pelvis onto the moon while the legs fold in parallel.
    if (seatedWeight > 0) {
      const contactNames = ['root_x_03'];
      let lowest = Infinity;
      for (const name of contactNames) {
        const bone = targetBones[name];
        if (bone) {
          bone.getWorldPosition(movementScratch.leftToe);
          lowest = Math.min(lowest, movementScratch.leftToe.y);
        }
      }
      if (Number.isFinite(lowest)) {
        const surface = MOON_SEAT_POSITION[1];
        const clearance = 0.20;
        group.current.position.y += (surface + clearance - lowest) * seatedWeight;
        group.current.updateMatrixWorld(true);
      }
    }

  }, -2);

  useEffect(() => {
    const leftFoot = astronaut.getObjectByName('foot_l_059');
    const rightFoot = astronaut.getObjectByName('foot_r_067');
    [leftFoot, rightFoot].forEach((foot) => {
      if (!foot || foot.getObjectByName('bootFlame')) return;
      foot.add(createBootFlame());
    });
  }, [astronaut]);

  return (
    <group ref={group} position={position} scale={scale * CHARACTER_SCALE}>
      <primitive object={astronaut} />
      <pointLight position={[0, 1.25, 0.2]} color="#b9d7ff" intensity={0.6} distance={3} decay={2} />
    </group>
  );
}
