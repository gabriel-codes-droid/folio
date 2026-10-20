import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROJECTS } from '../src/data/projects.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every project is reachable without 3D through the project list', () => {
  const index = read('src/components/ProjectIndex.astro');
  assert.match(index, /<dialog id="project-index"/);
  assert.match(index, /PROJECTS\.map/);
  assert.ok(PROJECTS.every(project => project.url.startsWith('https://')));
  assert.match(read('src/pages/index.astro'), /<ProjectIndex \/>/);
  assert.match(read('src/components/PortfolioIntro.astro'), /data-open-projects/);
  // Offered wherever the space scene is still loading.
  assert.match(read('src/components/SpaceExperience.jsx'), /data-open-projects/);
  assert.match(read('src/components/SpaceCanvas.jsx'), /data-open-projects/);
});

test('the fixed 3D layer lets clicks through except in the planet gallery', () => {
  assert.match(read('src/styles/scene-loading.css'), /\.guide-canvas-shell:not\(\.is-gallery\) \*\{pointer-events:none!important\}/);
});
