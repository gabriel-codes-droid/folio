import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initLoadScreen, MAX_SCREEN_MS, HARD_MAX_SCREEN_MS } from '../src/scripts/bootLoader.js';
import { bootProgress, groupBytes } from '../src/components/bootProgress.js';

// Exercise the loading screen against a controlled DOM and clock: it must
// report progress honestly, never hold a visitor past its time limit, and
// get out of the way once the guide is ready.
function harness(stage = 'loading', progress = '0') {
  let now = 0, sequence = 0;
  const frames = new Map(), timers = new Map();
  class Element extends EventTarget {
    dataset = {}; attributes = {}; hidden = false; textContent = ''; className = ''; children = []; parent = null;
    style = { props: {}, setProperty(key, value) { this.props[key] = value; } };
    setAttribute(key, value) { this.attributes[key] = value; }
    replaceChildren() { this.children = []; }
    append(child) { child.parent = this; this.children.push(child); }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  const ids = ['boot-hud', 'boot-label', 'boot-small-percent', 'boot-skip', 'boot-retry', 'boot-digits'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const root = elements.get('boot-hud');
  root.dataset = { stage, progress, presentation: 'loading' };
  elements.get('boot-retry').hidden = true;
  const htmlClasses = new Set(['portfolio-booting']);
  const window = new EventTarget();
  Object.assign(window, {
    location: { reload() {} }, scrollTo() {}, matchMedia: () => ({ matches: true }),
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
  });
  const document = {
    hidden: false, getElementById: id => elements.get(id), createElement: () => new Element(),
    documentElement: { classList: { remove: name => htmlClasses.delete(name) } },
  };
  const globals = { window, document, performance: { now: () => now },
    requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id) };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  initLoadScreen();
  return {
    root, elements,
    locked: () => htmlClasses.has('portfolio-booting'),
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
    percent: () => Number(elements.get('boot-small-percent').textContent.replace('%', '')),
    digits: () => elements.get('boot-digits').children.map(slot => slot.children.at(-1).textContent).join(''),
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('the counter follows real progress and never claims 100% before the guide is ready', () => {
  const h = harness('loading', '0');
  try {
    h.report('loading', .4);
    h.advance(3000);
    assert.ok(h.percent() >= 35 && h.percent() <= 40, `percent ${h.percent()}`);
    assert.equal(h.digits(), String(h.percent()).padStart(2, '0'));
    h.report('preparing', .85);
    h.advance(4000);
    assert.ok(h.percent() < 100);
    assert.equal(h.root.dataset.presentation, 'loading');
    assert.ok(h.locked());
  } finally { h.restore(); }
});

test('ready: the counter reaches 100, the rocket launches and the page opens', () => {
  const h = harness('loading', '.2');
  try {
    h.advance(1000);
    h.report('ready', 1);
    h.advance(3000);
    assert.equal(h.digits(), '100');
    assert.equal(h.root.hidden, true);
    assert.equal(h.locked(), false);
  } finally { h.restore(); }
});

test('a cached visit still shows the screen briefly instead of flashing', () => {
  const h = harness('ready', '1');
  try {
    h.advance(400);
    assert.equal(h.root.hidden, false);
    h.advance(3000);
    assert.equal(h.root.hidden, true);
  } finally { h.restore(); }
});

test('a slow load never holds the visitor past the time limit', () => {
  const h = harness('loading', '.1');
  try {
    h.advance(MAX_SCREEN_MS + 200);
    assert.equal(h.root.dataset.docked, 'true');
    assert.equal(h.locked(), false);
    assert.equal(h.root.hidden, false);
    h.report('ready', 1);
    h.advance(4000);
    assert.equal(h.root.hidden, true);
  } finally { h.restore(); }
});

test('the final preparation step may finish, but never past the hard limit', () => {
  const h = harness('preparing', '.85');
  try {
    h.advance(MAX_SCREEN_MS + 500);
    assert.equal(h.root.dataset.docked, undefined);
    h.advance(HARD_MAX_SCREEN_MS - MAX_SCREEN_MS);
    assert.equal(h.root.dataset.docked, 'true');
    assert.equal(h.locked(), false);
  } finally { h.restore(); }
});

test('SKIP opens the page immediately', () => {
  const h = harness('loading', '.1');
  try {
    h.advance(500);
    h.elements.get('boot-skip').dispatchEvent(new Event('click'));
    assert.equal(h.locked(), false);
    assert.equal(h.root.dataset.docked, 'true');
  } finally { h.restore(); }
});

test('a failure shows retry instead of a false 100%', () => {
  const h = harness('loading', '.3');
  try {
    h.advance(1000);
    h.report('error', 0);
    h.advance(3000);
    assert.equal(h.root.dataset.presentation, 'error');
    assert.equal(h.elements.get('boot-retry').hidden, false);
    assert.ok(h.percent() < 100);
  } finally { h.restore(); }
});

test('the screen has a failsafe that reopens the page if its script never runs', () => {
  const markup = readFileSync(new URL('../src/components/BootLoader.astro', import.meta.url), 'utf8');
  assert.match(markup, /!hud\.dataset\.initialized/);
  assert.match(markup, /classList\.remove\('portfolio-booting'\)/);
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
