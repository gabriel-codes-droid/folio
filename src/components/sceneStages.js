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

export function advanceProgress(current, desired, ready, delta) {
  const target = availableProgress(desired, ready);
  const step = Math.min(Math.max(delta, 0), 0.05) * 0.12;
  return current + Math.max(-step, Math.min(step, target - current));
}
