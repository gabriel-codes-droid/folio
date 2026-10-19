import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spaceCanvas = readFileSync(new URL('../src/components/SpaceCanvas.jsx', import.meta.url), 'utf8');
const sonarGrid = readFileSync(new URL('../src/components/SonarGrid.jsx', import.meta.url), 'utf8');

test('post-journey content shares the sonar background without an empty interstitial', () => {
  const page = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  const outro = readFileSync(new URL('../src/components/PortfolioOutro.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(spaceCanvas, /<SonarGrid/);
  assert.match(page, /<SpaceCanvas[^]*<PortfolioOutro/);
  assert.match(outro, /<SonarGrid background/);
  assert.match(sonarGrid, /aria-hidden="true"/);
});

test('sonar grid is an off-screen-paused canvas animation with no text content', () => {
  assert.match(sonarGrid, /new IntersectionObserver/);
  assert.match(sonarGrid, /prefers-reduced-motion/);
  assert.match(sonarGrid, /requestAnimationFrame/);
  assert.doesNotMatch(sonarGrid, /<p|<h[1-6]|textContent/);
  assert.match(sonarGrid, /color = '#f5f5f5'/);
});
