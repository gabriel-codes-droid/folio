import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_ASSETS, STAGE_ORDER, availableProgress, advanceProgress } from '../src/components/sceneStages.js';
import { SCENE_ASSETS } from '../src/data/sceneAssets.js';
import { readFileSync } from 'node:fs';

test('every unchanged asset belongs to exactly one loading stage', () => {
  const assets = STAGE_ORDER.flatMap(stage => STAGE_ASSETS[stage]);
  assert.equal(new Set(assets.map(asset => asset.url)).size, SCENE_ASSETS.length);
  assert.deepEqual(assets.map(asset => asset.url).sort(), SCENE_ASSETS.map(asset => asset.url).sort());
});
test('opening budget stays under 30 MB; large wreckage cannot block it', () => {
  assert.ok(STAGE_ASSETS.opening.reduce((sum, asset) => sum + asset.bytes, 0) < 30_000_000);
  assert.equal(STAGE_ASSETS.debris.length, 1);
  assert.equal(STAGE_ASSETS.route.length, 2);
  assert.equal(STAGE_ASSETS.moon.length, 5);
});
test('fast scrolling waits before wake and before launch', () => {
  assert.equal(availableProgress(1, {}), 0.079);
  assert.equal(availableProgress(1, { route: true }), 0.459);
  assert.equal(availableProgress(1, { route: true, moon: true }), 1);
  assert.equal(availableProgress(0, {}), 0);
});
test('readiness releases smoothly without teleporting, including background-tab deltas', () => {
  const ready = { route: true, moon: true };
  assert.ok(advanceProgress(0.079, 1, ready, 10) < 0.1);
  assert.ok(advanceProgress(1, 0, ready, 1 / 60) > 0.99);
  assert.equal(advanceProgress(0.4, 0.4, ready, 1 / 60), 0.4);
});

test('project details stay inside space, and small text uses local monospace', () => {
  const intro = readFileSync(new URL('../src/components/PortfolioIntro.astro', import.meta.url), 'utf8');
  const fonts = readFileSync(new URL('../src/styles/fonts.css', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/SpaceCanvas.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(intro, /quick-projects|PROJECTS\.map/);
  assert.match(fonts, /--font-body: 'Geist Mono'/);
  assert.match(canvas, /href=\{selectedProject.url\}/);
  assert.match(canvas, /!ready \|\| inView \|\| warmingStage/);
});
