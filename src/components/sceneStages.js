import { SCENE_ASSETS } from '../data/sceneAssets.js';

const route = new Set(['aliencubealpha-unit.glb', 'sci-fi_cube_01.glb']);
const moon = new Set(['moon.glb', 'alien_planet.glb', 'lava_planet.glb', 'little_planet_earth.glb', 'planet_earth.glb']);
export const STAGE_ORDER = ['opening', 'route', 'moon', 'debris'];
export const STAGE_ASSETS = Object.fromEntries(STAGE_ORDER.map(stage => [stage, []]));
for (const asset of SCENE_ASSETS) {
  const name = asset.url.split('/').pop();
  const stage = route.has(name) ? 'route' : moon.has(name) ? 'moon'
    : name === 'halo_4multiplayercrimsonwreckage.glb' ? 'debris' : 'opening';
  STAGE_ASSETS[stage].push(asset);
}

// Keep the mech asleep until cubes exist, and on its last cube until the
// destination is GPU-ready. Scrolling the page is never locked.
export function availableProgress(desired, ready) {
  return Math.min(Math.max(0, desired), !ready.route ? 0.079 : !ready.moon ? 0.459 : 1);
}

export function advanceProgress(current, desired, ready, delta) {
  const target = availableProgress(desired, ready);
  const step = Math.min(Math.max(delta, 0), 0.05) * 0.28;
  return current + Math.max(-step, Math.min(step, target - current));
}
