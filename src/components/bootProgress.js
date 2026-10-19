import { SCENE_ASSETS } from '../data/sceneAssets.js';

// Loader rows: the guide (mech, animations, sky), the moon, and the planets.
export const GROUPS = {
  moon: new Set(['moon.glb']),
  planets: new Set(['alien_planet.glb', 'lava_planet.glb', 'little_planet_earth.glb', 'planet_earth.glb']),
};
export const groupOf = url => {
  const name = url.split('/').pop();
  return GROUPS.moon.has(name) ? 'moon' : GROUPS.planets.has(name) ? 'planets' : 'guide';
};

export function groupBytes(received, assets = SCENE_ASSETS) {
  const totals = { guide: 0, moon: 0, planets: 0, all: 0 };
  const done = { guide: 0, moon: 0, planets: 0, all: 0 };
  for (const asset of assets) {
    const group = groupOf(asset.url);
    const bytes = Math.min(asset.bytes, received[asset.url] ?? 0);
    totals[group] += asset.bytes; totals.all += asset.bytes;
    done[group] += bytes; done.all += bytes;
  }
  return Object.fromEntries(Object.keys(totals).map(key => [key, totals[key] ? done[key] / totals[key] : 1]));
}

// Downloads fill the first 82%; parsing and GPU warm-up of each stage the
// rest. Only both stages being warmed may report ready (and 100%).
export function bootProgress(groups, readyStages) {
  const warmed = (readyStages.opening ? 1 : 0) + (readyStages.moon ? 1 : 0);
  if (warmed === 2) return { stage: 'ready', progress: 1 };
  return { stage: groups.all < 1 ? 'loading' : 'preparing', progress: Math.min(0.99, groups.all * 0.82 + warmed * 0.08) };
}
