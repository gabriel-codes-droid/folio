import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initLoadStrip } from '../src/scripts/bootLoader.js';
import { bootProgress, groupBytes } from '../src/components/bootProgress.js';

// Exercise the strip against a controlled DOM/clock: the page never waits on
// it, so it must only report progress honestly, finish once, and get out.
function harness(stage = 'loading', progress = '0') {
  let now = 0, sequence = 0;
  const frames = new Map(), timers = new Map();
  class Element extends EventTarget {
    dataset = {}; attributes = {}; hidden = false; textContent = ''; style = {};
    setAttribute(key, value) { this.attributes[key] = value; }
  }
  const elements = new Map(['boot-hud', 'boot-rocket', 'boot-trail', 'boot-label', 'boot-percent', 'boot-retry'].map(id => [id, new Element()]));
  const root = elements.get('boot-hud');
  root.dataset = { stage, progress };
  elements.get('boot-retry').hidden = true;
  const window = new EventTarget();
  Object.assign(window, {
    location: { reload() {} },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
  });
  const globals = { window, document: { getElementById: id => elements.get(id) }, performance: { now: () => now },
    requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id) };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  initLoadStrip();
  return {
    root, elements, frames: () => frames.size,
    report(nextStage, nextProgress) {
      root.dataset.stage = nextStage; root.dataset.progress = String(nextProgress);
      window.dispatchEvent(new Event('portfolio:boot'));
    },
    advance(milliseconds) {
      for (let i = 0; i < Math.ceil(milliseconds / (1000 / 60)); i++) {
        now += 1000 / 60;
        const scheduled = [...frames.values()]; frames.clear();
        scheduled.forEach(callback => callback(now));
        for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    },
    percent: () => Number(elements.get('boot-percent').textContent),
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('the strip follows real progress and never claims 100% before the guide is ready', () => {
  const h = harness('loading', '0');
  try {
    h.report('loading', .4);
    h.advance(3000);
    assert.ok(h.percent() >= 35 && h.percent() <= 40);
    h.report('preparing', .85);
    h.advance(20000);
    assert.ok(h.percent() < 100);
    assert.notEqual(h.root.dataset.state, 'done');
  } finally { h.restore(); }
});

test('the strip finishes once when the guide is ready, then hides itself', () => {
  const h = harness('loading', '.2');
  try {
    h.advance(500);
    h.report('ready', 1);
    h.advance(3000);
    assert.equal(h.root.dataset.state, 'done');
    assert.equal(h.elements.get('boot-label').textContent, '3D READY');
    assert.equal(h.frames(), 0);
    assert.equal(h.root.hidden, true);
  } finally { h.restore(); }
});

test('a cached visit completes before the strip would fade in', () => {
  const h = harness('ready', '1');
  try {
    h.advance(480);
    assert.equal(h.root.dataset.state, 'done');
  } finally { h.restore(); }
});

test('a failure shows retry instead of a false 100%', () => {
  const h = harness('loading', '.3');
  try {
    h.advance(1000);
    h.report('error', 0);
    h.advance(3000);
    assert.equal(h.root.dataset.state, 'error');
    assert.equal(h.elements.get('boot-retry').hidden, false);
    assert.equal(h.root.hidden, false);
  } finally { h.restore(); }
});

test('nothing locks scrolling or covers the page while 3D loads', () => {
  const markup = readFileSync(new URL('../src/components/BootLoader.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(markup, /portfolio-booting|overflow: hidden !important|inset: 0/);
  assert.doesNotMatch(markup, /PAYLOAD/);
});

test('boot progress opens the page once the guide is warmed; planets follow', () => {
  const assets = [
    { url: '/models/bot.glb', bytes: 100 },
    { url: '/models/moon.glb', bytes: 50 },
    { url: '/models/lava_planet.glb', bytes: 50 },
  ];
  const groups = groupBytes({ '/models/bot.glb': 100, '/models/moon.glb': 25 }, assets);
  assert.equal(groups.guide, 1);
  assert.equal(groups.moon, .5);
  assert.equal(groups.planets, 0);
  assert.equal(groups.destination, .25);
  assert.equal(bootProgress(groupBytes({ '/models/bot.glb': 40 }, assets), {}).stage, 'loading');
  // Guide downloaded but not warmed: still preparing, below 100%.
  assert.equal(bootProgress(groups, {}).stage, 'preparing');
  assert.ok(bootProgress(groups, {}).progress < 1);
  // The moon and planets do not hold the page.
  assert.deepEqual(bootProgress(groups, { opening: 1 }), { stage: 'ready', progress: 1 });
});
