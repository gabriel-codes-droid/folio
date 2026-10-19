import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('scene downloads start from the boot script, without three.js or React', () => {
  const boot = readFileSync(new URL('../src/components/BootLoader.astro', import.meta.url), 'utf8');
  assert.match(boot, /startSceneDownloads\(\);/);
  const source = readFileSync(new URL('../src/components/sceneDownloads.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"](three|react)/);
});

test('the moon stage waits for the guide so the first screen gets full bandwidth', () => {
  const source = readFileSync(new URL('../src/components/sceneDownloads.js', import.meta.url), 'utf8');
  assert.match(source, /run\('opening'\)\)\.catch\(\(\) => \{\}\)\.then\(\(\) => run\('moon'\)\)/);
});
