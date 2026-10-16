import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationMixer, Quaternion, Vector3, Euler } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { sampleCharacterPose } from '../src/components/characterPose.js';

test('real FBX poses hold when stopped and retrace on reverse scroll', () => {
  const load = name => {
    const file = readFileSync(new URL(`../public/models/${name}.fbx`, import.meta.url));
    return new FBXLoader().parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  };
  const rig = load('idle');
  const hips = rig.getObjectByName('mixamorigHips');
  const restHips = hips.getWorldQuaternion(new Quaternion());
  const mixer = new AnimationMixer(rig);
  const flight = load('flying').animations[0];
  const actions = { hovering: mixer.clipAction(flight.clone()), presenting: mixer.clipAction(rig.animations[0]), flying: mixer.clipAction(flight), landing: mixer.clipAction(load('landing').animations[0]), seated: mixer.clipAction(load('sitting').animations[0]) };
  const bones = [];
  rig.traverse(object => { if (object.isBone) bones.push(object); });
  const sample = progress => {
    sampleCharacterPose(actions, progress); mixer.update(1 / 60);
    return bones.map(bone => bone.quaternion.clone().normalize());
  };
  const timeline = [0, 0.52, 0.58, 0.68, 0.72, 0.80, 0.84, 1];
  const forward = timeline.map(sample);
  for (let i = 0; i < 5; i++) sample(1).forEach((q, j) => assert.ok(q.angleTo(forward.at(-1)[j]) < 1e-6));
  for (let i = timeline.length - 1; i >= 0; i--) sample(timeline[i]).forEach((q, j) => assert.ok(q.angleTo(forward[i][j]) < 1e-6));
  sampleCharacterPose(actions, 0, 0.1); mixer.update(1 / 60);
  const early = bones.map(bone => bone.quaternion.clone().normalize());
  sampleCharacterPose(actions, 0, 0.6); mixer.update(1 / 60);
  assert.ok(bones.some((bone, i) => bone.quaternion.clone().normalize().angleTo(early[i]) > 0.005), 'The upright guide must remain animated');
  const correctedUp = new Vector3(0, 1, 0)
    .applyQuaternion(hips.getWorldQuaternion(new Quaternion()).multiply(restHips.invert()))
    .applyQuaternion(new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)));
  assert.ok(correctedUp.y > 0.98, 'The flying guide must be vertical, not prone');
  mixer.stopAllAction(); mixer.uncacheRoot(rig);
});
