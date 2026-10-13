import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationMixer } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { sampleCharacterPose } from '../src/components/characterPose.js';

test('real FBX poses hold when stopped and retrace on reverse scroll', () => {
  const load = name => {
    const file = readFileSync(new URL(`../public/models/${name}.fbx`, import.meta.url));
    return new FBXLoader().parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  };
  const rig = load('idle');
  const mixer = new AnimationMixer(rig);
  const actions = { hovering: mixer.clipAction(rig.animations[0]), landing: mixer.clipAction(load('landing').animations[0]), seated: mixer.clipAction(load('sitting').animations[0]) };
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
  mixer.stopAllAction(); mixer.uncacheRoot(rig);
});
