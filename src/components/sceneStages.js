import { SCENE_ASSETS } from '../data/sceneAssets.js';

const moon = new Set(['moon.glb', 'alien_planet.glb', 'lava_planet.glb', 'little_planet_earth.glb', 'planet_earth.glb']);
export const STAGE_ORDER = ['opening', 'moon'];
export const STAGE_ASSETS = Object.fromEntries(STAGE_ORDER.map(stage => [stage, []]));
for (const asset of SCENE_ASSETS) {
  const name = asset.url.split('/').pop();
  const stage = moon.has(name) ? 'moon' : 'opening';
  STAGE_ASSETS[stage].push(asset);
}

// Hold the guide at the entrance until its destination is ready.
export function availableProgress(desired, ready) {
  return Math.min(Math.max(0, desired), ready.moon ? 1 : 0);
}

// The descent is deliberately slow and cinematic (the page holds its scroll
// until landing). Scrolling back up is not held, so the rewind catches up with
// the page quickly, yet continuously: the guide flies back along the same path
// instead of lingering in its moon pose over the intro sections.
export function advanceProgress(current, desired, ready, delta) {
  const target = availableProgress(desired, ready);
  const dt = Math.min(Math.max(delta, 0), 0.05);
  if (target >= current) return current + Math.min(dt * 0.12, target - current);
  const rewind = dt * Math.max(0.6, (current - target) * 3);
  return current - Math.min(rewind, current - target);
}
