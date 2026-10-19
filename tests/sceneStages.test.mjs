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
test('hover guide stays under 19 MB and retired route assets are absent', () => {
  assert.ok(STAGE_ASSETS.opening.reduce((sum, asset) => sum + asset.bytes, 0) < 19_000_000);
  assert.equal(STAGE_ORDER.length, 2);
  assert.ok(!SCENE_ASSETS.some(asset => /cube|wreckage|station|jump|waking|shaking/.test(asset.url)));
  assert.ok(SCENE_ASSETS.some(asset => asset.url.endsWith('/flying.fbx')));
  assert.equal(STAGE_ASSETS.moon.length, 5);
});
test('fast scrolling holds the guide until its moon destination is ready', () => {
  assert.equal(availableProgress(1, {}), 0);
  assert.equal(availableProgress(1, { moon: true }), 1);
  assert.equal(availableProgress(0, {}), 0);
});
test('readiness releases smoothly without teleporting, including background-tab deltas', () => {
  const ready = { moon: true };
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
  assert.match(canvas, /ready && \(active \|\| warmingStage\)/);
});
