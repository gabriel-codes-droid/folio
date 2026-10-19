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
  // destination = moon + planets, the stage that loads behind the open page.
  const totals = { guide: 0, moon: 0, planets: 0, destination: 0, all: 0 };
  const done = { guide: 0, moon: 0, planets: 0, destination: 0, all: 0 };
  for (const asset of assets) {
    const group = groupOf(asset.url);
    const bytes = Math.min(asset.bytes, received[asset.url] ?? 0);
    totals[group] += asset.bytes; totals.all += asset.bytes;
    done[group] += bytes; done.all += bytes;
    if (group !== 'guide') { totals.destination += asset.bytes; done.destination += bytes; }
  }
  return Object.fromEntries(Object.keys(totals).map(key => [key, totals[key] ? done[key] / totals[key] : 1]));
}

// The page opens once the guide on the first screen is downloaded and warmed
// on the GPU. The moon and planets continue in the background; the journey
// holds the guide at the space entrance until they are ready.
export function bootProgress(groups, readyStages) {
  if (readyStages.opening) return { stage: 'ready', progress: 1 };
  return { stage: groups.guide < 1 ? 'loading' : 'preparing', progress: Math.min(0.99, groups.guide * 0.85) };
}

// detail carries per-row fractions for the loader manifest (guide, moon...).
export function reportBoot(stage, progress, error = '', detail = {}) {
  const hud = document.getElementById('boot-hud');
  if (hud) {
    hud.dataset.stage = stage;
    hud.dataset.progress = String(progress);
    hud.dataset.error = error;
    for (const [key, value] of Object.entries(detail)) hud.dataset[key] = String(value);
  }
  window.dispatchEvent(new CustomEvent('portfolio:preparation', { detail: { stage, progress, error } }));
  window.dispatchEvent(new Event('portfolio:boot'));
}
