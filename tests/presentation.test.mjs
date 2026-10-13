import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationNearDescription, presentationDirection } from '../src/components/presentation.js';

test('presenting points toward nearby copy, never through an occupied card', () => {
  const copy = [{ left: 600, right: 900, top: 300, bottom: 700 }];
  assert.ok(presentationNearDescription([0.4, 0.65], copy, 1000, 1000).weight > 0.5);
  assert.equal(presentationNearDescription([0.4, 0.65], copy, 1000, 1000).side, 1);
  assert.equal(presentationNearDescription([0.95, 0.65], copy, 1000, 1000).side, -1);
  assert.equal(presentationNearDescription([0.7, 0.65], copy, 1000, 1000).weight, 0);
  assert.equal(presentationNearDescription([0.4, 0.65], [{ ...copy[0], top: 1100, bottom: 1400 }], 1000, 1000).weight, 0);
});

test('gesture mirrors the raised and supporting arms correctly', () => {
  assert.ok(presentationDirection('forearm_stretch_l_016', 1)[1] > 0.6);
  assert.ok(presentationDirection('forearm_stretch_r_038', -1)[1] > 0.6);
  assert.deepEqual(presentationDirection('forearm_stretch_l_016', 1), presentationDirection('forearm_stretch_r_038', -1).map((value, axis) => axis === 0 ? -value : value));
});
