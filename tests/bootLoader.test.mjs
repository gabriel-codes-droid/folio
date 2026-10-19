import test from 'node:test';
import assert from 'node:assert/strict';
import { initBootLoader } from '../src/scripts/bootLoader.js';
import { createNumberSwap } from '../src/scripts/numberSwap.js';
import { bootProgress, groupBytes } from '../src/components/bootProgress.js';

// Exercise the real loader against a controlled DOM/clock so GPU preparation
// can be slow, cached, or fail without downloading the large scene per case.
function harness(stage = 'loading', progress = '0') {
  let now = 0, sequence = 0;
  const frames = new Map(), timers = new Map();
  class Element extends EventTarget {
    dataset = {};
    attributes = {};
    children = [];
    hidden = false;
    textContent = '';
    className = '';
    querySelector() { return null; }
    querySelectorAll() { return []; }
    style = { setProperty() {} };
    setAttribute(key, value) { this.attributes[key] = value; }
    get firstElementChild() { return this.children[0]; }
    append(child) { this.children.push(child); child.parent = this; }
    replaceChildren() { this.children = []; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  const elements = new Map(['boot-hud', 'boot-panel', 'boot-progress', 'boot-rocket', 'boot-trail', 'boot-altitude', 'boot-clock', 'boot-number', 'boot-announcement', 'boot-error', 'boot-retry'].map(id => [id, new Element()]));
  const root = elements.get('boot-hud');
  root.dataset = { stage, progress };
  elements.get('boot-error').hidden = true;
  const window = new EventTarget();
  Object.assign(window, {
    innerWidth: 1000, innerHeight: 700, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }), scrollTo() {}, location: { reload() {} },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
  });
  let revealed = 0;
  window.addEventListener('portfolio:revealed', () => revealed++);
  const lock = new Set(['portfolio-booting']);
  const document = {
    readyState: 'complete', hidden: false,
    getElementById: id => elements.get(id), createElement: () => new Element(),
    documentElement: { classList: { remove: value => lock.delete(value) } },
  };
  const globals = { window, document, performance: { now: () => now },
    requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), clearTimeout: id => timers.delete(id) };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  initBootLoader();
  return {
    root, elements, lock, revealed: () => revealed, frames: () => frames.size,
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
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('preparation, not elapsed time or download progress, unlocks the scene', () => {
  const h = harness('loading', '1');
  try {
    h.advance(20000);
    assert.equal(h.revealed(), 0);
    assert.ok(Number(h.root.dataset.displayProgress) < 100);
    assert.ok(h.lock.has('portfolio-booting'));
    h.report('ready', 1);
    h.advance(5000);
    assert.equal(h.root.dataset.displayProgress, '100');
    assert.equal(h.revealed(), 1);
    assert.equal(h.root.hidden, true);
    assert.equal(h.lock.size, 0);
    assert.equal(h.frames(), 0);
  } finally { h.restore(); }
});

test('a cached scene still shows a brief launch, holds 100%, then reveals once', () => {
  const h = harness('ready', '1');
  try {
    h.advance(600);
    assert.equal(h.revealed(), 0);
    assert.notEqual(h.root.dataset.presentation, 'complete');
    for (let i = 0; i < 300 && h.root.dataset.presentation !== 'complete'; i++) h.advance(20);
    assert.equal(h.root.dataset.presentation, 'complete');
    h.advance(3000);
    assert.equal(h.revealed(), 1);
    assert.equal(h.root.dataset.revealed, 'true');
  } finally { h.restore(); }
});

test('a cached load starts opening the page in under two seconds', () => {
  const h = harness('ready', '1');
  try {
    let elapsed = 0;
    while (h.root.dataset.presentation !== 'revealing' && elapsed < 10000) { h.advance(50); elapsed += 50; }
    assert.ok(elapsed < 2000, `panel lifted after ${elapsed}ms`);
  } finally { h.restore(); }
});

test('the percentage replaces whole numbers, only ever rising, ending on 100', () => {
  const h = harness('loading', '0');
  try {
    let previous = 0, changes = 0;
    for (let i = 0; i < 400 && !h.revealed(); i++) {
      if (i === 30) h.report('loading', .4);
      if (i === 80) h.report('preparing', .9);
      if (i === 140) h.report('ready', 1);
      h.advance(16);
      const value = Number(h.root.dataset.displayProgress ?? 0);
      assert.ok(value >= previous);
      if (value !== previous) changes++;
      previous = value;
    }
    assert.equal(previous, 100);
    assert.ok(changes < 60, 'large jumps are shown directly instead of counting every integer');
  } finally { h.restore(); }
});

test('number swap keeps at most one outgoing value', () => {
  const h = harness();
  try {
    const container = h.elements.get('boot-number');
    const counter = createNumberSwap(container);
    for (const value of [3, 9, 27, 64, 100]) counter.set(value);
    const values = container.children.filter(child => child.className === 'boot-number-value');
    assert.ok(values.length <= 2);
    assert.equal(values.at(-1).textContent, '100');
    counter.set(100);
    assert.equal(container.children.filter(child => child.className === 'boot-number-value').length, values.length);
  } finally { h.restore(); }
});

test('an asset failure keeps the loader and shows retry instead of a false 100%', () => {
  const h = harness('preparing', '.95');
  try {
    h.advance(5000);
    h.report('error', 0);
    h.advance(10000);
    assert.equal(h.revealed(), 0);
    assert.equal(h.elements.get('boot-error').hidden, false);
    assert.ok(Number(h.root.dataset.displayProgress) < 100);
  } finally { h.restore(); }
});

test('readiness lost during the 100% pause prevents the reveal', () => {
  const h = harness('ready', '1');
  try {
    for (let i = 0; i < 1000 && h.root.dataset.presentation !== 'complete'; i++) h.advance(10);
    assert.equal(h.root.dataset.presentation, 'complete');
    h.report('preparing', .95);
    h.advance(5000);
    assert.equal(h.revealed(), 0);
    assert.ok(h.lock.has('portfolio-booting'));
    h.report('ready', 1);
    h.advance(3000);
    assert.equal(h.revealed(), 1);
  } finally { h.restore(); }
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
