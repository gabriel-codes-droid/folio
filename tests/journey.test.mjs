import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { sampleJourney, sampleArrival, phaseForProgress, pacedJourneyProgress } from '../src/components/journey.js';
import { HOP_WAYPOINTS, MOON_SEAT_POSITION, PLANET_ROW_Z } from '../src/components/sceneConstants.js';

test('slower hopping keeps the scroll playhead continuous, monotonic and complete', () => {
  assert.equal(pacedJourneyProgress(0), 0);
  assert.equal(pacedJourneyProgress(1), 1);
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const current = pacedJourneyProgress(i / 1000);
    assert.ok(current >= previous && current <= 1);
    assert.ok(current - previous < 0.002);
    previous = current;
  }
  const hopStart = 0.30 / 1.08;
  const hopEnd = 0.54 / 1.08;
  assert.ok(hopEnd - hopStart > 0.16);
  assert.ok(Math.abs(pacedJourneyProgress(hopStart) - 0.30) < 1e-9);
  assert.ok(Math.abs(pacedJourneyProgress(hopEnd) - 0.46) < 1e-9);
});

test('the shuttle exits onto three cubes in right-left-right descending order', () => {
  assert.equal(HOP_WAYPOINTS.length, 4);
  const [, first, second, third] = HOP_WAYPOINTS;
  assert.ok(first[0] > second[0] && third[0] > second[0]);
  assert.ok(first[1] > second[1] && second[1] > third[1]);
  for (let i = 0; i <= 3; i++) {
    const position = new Vector3();
    sampleJourney(0.30 + 0.16 * i / 3, position);
    assert.ok(position.distanceTo(new Vector3(...HOP_WAYPOINTS[i])) < 1e-6);
  }
});

test('hop, launch, flight and landing boundaries have no position jumps', () => {
  for (const boundary of [0.30, 0.30 + 0.16 / 3, 0.30 + 0.32 / 3, 0.46, 0.54, 0.78, 0.88]) {
    const before = new Vector3(), after = new Vector3();
    sampleJourney(boundary - 1e-7, before);
    sampleJourney(boundary + 1e-7, after);
    assert.ok(before.distanceTo(after) < 0.001, `discontinuity at ${boundary}`);
  }
});

test('reverse scrolling is deterministic and the final pose faces the planets', () => {
  const forward = Array.from({ length: 101 }, (_, i) => {
    const p = new Vector3(); sampleJourney(i / 100, p); return p;
  });
  for (let i = 100; i >= 0; i--) {
    const p = new Vector3(); sampleJourney(i / 100, p);
    assert.deepEqual(p.toArray(), forward[i].toArray());
  }
  const position = new Vector3();
  const yaw = sampleJourney(1, position);
  assert.deepEqual(position.toArray(), MOON_SEAT_POSITION);
  const direction = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const planets = new Vector3(-position.x, 0, PLANET_ROW_Z - position.z).normalize();
  assert.ok(direction.dot(planets) > 0.9999);
  assert.equal(phaseForProgress(1), 'seated');
});

test('touchdown completes before sitting and arrival blend remains continuous', () => {
  assert.equal(sampleArrival(0.78).flightWeight, 1);
  const touchdown = sampleArrival(0.835);
  assert.ok(Math.abs(touchdown.touchdown - 1) < 1e-12);
  assert.equal(touchdown.seatedWeight, 0);
  assert.ok(Math.abs(sampleArrival(0.88).seatedWeight - 1) < 1e-12);
  for (let i = 0; i <= 100; i++) {
    const p = 0.78 + i * 0.001;
    const a = sampleArrival(p), b = sampleArrival(p + 0.000001);
    assert.ok(Math.abs(a.flightWeight + a.landingWeight + a.seatedWeight - 1) < 1e-9);
    assert.ok(Math.abs(b.cameraBlend - a.cameraBlend) < 0.0001);
    assert.ok(Math.abs(b.seatedWeight - a.seatedWeight) < 0.0001);
  }
});

test('arrival pose sampling retraces exactly when scrolling backward', () => {
  const forward = Array.from({length: 101}, (_, i) => sampleArrival(0.78 + i * 0.001));
  for (let i = 100; i >= 0; i--) assert.deepEqual(sampleArrival(0.78 + i * 0.001), forward[i]);
  const position = new Vector3();
  sampleJourney(0.835, position);
  assert.ok(position.distanceTo(new Vector3(...MOON_SEAT_POSITION)) < 1e-9);
});
