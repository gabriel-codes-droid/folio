import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { sampleJourney, sampleArrival, sampleGuide, phaseForProgress, pacedJourneyProgress, spaceJourneyProgress } from '../src/components/journey.js';
import { MOON_SEAT_POSITION, PLANET_ROW_Z } from '../src/components/sceneConstants.js';

test('flight begins when the star field enters and completes at the same exit', () => {
  assert.equal(spaceJourneyProgress(900, 4000, 1000), 0);
  assert.equal(spaceJourneyProgress(850, 4000, 1000), 0);
  assert.ok(spaceJourneyProgress(800, 4000, 1000) > 0);
  assert.ok(spaceJourneyProgress(400, 4000, 1000) > 0.06);
  assert.equal(spaceJourneyProgress(-3000, 4000, 1000), 1);
});

test('guide glides between section anchors continuously and settles at each stop', () => {
  const stops = [0, 200, 1000, 1400, 2200, 2600];
  assert.deepEqual(sampleGuide(0, stops), [0.34, 0.80]);
  assert.deepEqual(sampleGuide(2600, stops), [0.24, 0.72]);
  assert.ok(sampleGuide(1400, stops)[0] > sampleGuide(1000, stops)[0]);
  assert.ok(sampleGuide(2200, stops)[0] < sampleGuide(1400, stops)[0]);
  for (const boundary of stops.slice(1)) {
    const before = sampleGuide(boundary - 0.001, stops), after = sampleGuide(boundary + 0.001, stops);
    assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1]) < 0.00001);
  }
});

test('travel, touchdown and sitting are continuous and reverse exactly', () => {
  const forward = [];
  for (let i = 0; i <= 1000; i++) {
    const position = new Vector3(); sampleJourney(i / 1000, position); forward.push(position);
    if (i) assert.ok(position.distanceTo(forward[i - 1]) < 0.06);
  }
  for (let i = 1000; i >= 0; i--) {
    const position = new Vector3(); sampleJourney(i / 1000, position);
    assert.deepEqual(position.toArray(), forward[i].toArray());
  }
  const position = new Vector3();
  const yaw = sampleJourney(1, position);
  assert.deepEqual(position.toArray(), MOON_SEAT_POSITION);
  const direction = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  assert.ok(direction.dot(new Vector3(-position.x, 0, PLANET_ROW_Z - position.z).normalize()) > 0.9999);
});

test('touchdown precedes sitting, with normalized pose weights at every scroll position', () => {
  assert.equal(sampleArrival(0.52).flightWeight, 1);
  assert.ok(Math.abs(sampleArrival(0.68).touchdown - 1) < 1e-12);
  assert.equal(sampleArrival(0.68).seatedWeight, 0);
  assert.ok(Math.abs(sampleArrival(0.84).seatedWeight - 1) < 1e-12);
  for (let i = 0; i <= 1000; i++) {
    const a = sampleArrival(i / 1000);
    assert.ok(Math.abs(a.flightWeight + a.landingWeight + a.seatedWeight - 1) < 1e-9);
  }
});

test('gallery reserves the final 35 percent of the scroll track for projects', () => {
  assert.equal(pacedJourneyProgress(0), 0);
  assert.equal(pacedJourneyProgress(1), 1);
  assert.equal(phaseForProgress(pacedJourneyProgress(0.65)), 'seated');
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const p = pacedJourneyProgress(i / 1000);
    assert.ok(p >= previous && p - previous < 0.002);
    previous = p;
  }
});
