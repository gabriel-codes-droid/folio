import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentHash } from '../scripts/verify-glb-geometry.mjs';
import { readGlb, writeGlb, decoder } from '../scripts/optimize-glb-geometry.mjs';
import { GLTFLoader } from 'three-stdlib';

// Fingerprints of the deployed assets' decoded content (2026-10-19 slimming:
// moon/earth simplified, lava textures 1024px, mech textures re-encoded and its
// unused embedded clip removed; the mech rig and geometry are unchanged). These
// cover every decoded byte (including textures), rig, transform and animation,
// rather than only checking that a file has a plausible GLB header.
const originals = {
  'alien_planet.glb': '5f14af19b5883d4268ac2b8ee2accf291710dc007fa95c9acde4947047c78e52',
  'bot_mecha_warrior.glb': '27afbcfd61b10cb5e5cd1a2342b4652b36915362a8b97a6cabb37fa7d8f13374',
  'lava_planet.glb': '4058302c64410882a0516ad408b4d61fe8bcff36fc82c4177eb041bde753b7c0',
  'little_planet_earth.glb': 'b814fa67fdddb9533a8886ae58d3b4dba97e31edd822c26afe761f358d7e43d4',
  'moon.glb': '986f2d665286fb8c4396720fc5880d5ddbdf569bb7d662676fd9640d6ff2828f',
  'planet_earth.glb': '88dc4e474c42d08ca1db936636bf5d0c7f597b8588b73f733e7f9bbefa90b212',
};
for (const [name, fingerprint] of Object.entries(originals)) {
  test(`${name}: compressed scene data matches the original exactly`, async () => {
    const file = readFileSync(new URL(`../public/models/${name}`, import.meta.url));
    assert.equal(await contentHash(file), fingerprint);
    const model = readGlb(file);
    assert.ok(model.json.extensionsRequired.includes('EXT_meshopt_compression'));
    // Exercise the installed GLTFLoader's extension/fallback-buffer integration
    // headlessly. Texture bytes are checked above; their browser decoding and
    // GPU upload are deliberately not claimed by this Node test.
    model.json.materials = (model.json.materials ?? []).map(material => ({ name: material.name }));
    const headless = writeGlb(model.json, model.bin);
    const loader = new GLTFLoader().setMeshoptDecoder(decoder);
    const result = await loader.parseAsync(headless.buffer.slice(headless.byteOffset, headless.byteOffset + headless.byteLength), '');
    let meshes = 0;
    result.scene.traverse(object => {
      if (!object.isMesh) return;
      meshes++;
      assert.ok(object.geometry.attributes.position.count > 0);
      for (const attribute of Object.values(object.geometry.attributes)) {
        assert.ok(attribute.count > 0);
        assert.ok(Number.isFinite(attribute.getX(0)));
      }
    });
    assert.ok(meshes > 0, `${name} did not construct a scene`);
    result.scene.traverse(object => object.geometry?.dispose());
  });
}
