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
  // The raised forearm angles up and outward toward the description, between
  // about 30 and 60 degrees: never straight up (that read as an Egyptian pose).
  for (const [forearm, hand, side] of [['forearm_stretch_l_016', 'hand_l_019', 1], ['forearm_stretch_r_038', 'hand_r_041', -1]]) {
    const [x, y] = presentationDirection(forearm, side);
    const elevation = Math.atan2(y, Math.abs(x)) * 180 / Math.PI;
    assert.ok(elevation > 30 && elevation < 60, `forearm elevation ${elevation.toFixed(0)}deg`);
    assert.equal(Math.sign(x), side);
    // The hand tips back into an open palm instead of continuing the arm's
    // line, which read as pointing.
    assert.ok(presentationDirection(hand, side)[1] > y);
  }
  assert.deepEqual(presentationDirection('forearm_stretch_l_016', 1), presentationDirection('forearm_stretch_r_038', -1).map((value, axis) => axis === 0 ? -value : value));
});
