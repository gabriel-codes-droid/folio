import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentHash } from '../scripts/verify-glb-geometry.mjs';
import { readGlb, writeGlb, decoder } from '../scripts/optimize-glb-geometry.mjs';
import { GLTFLoader } from 'three-stdlib';

// Fingerprints taken from the uncompressed, previously deployed assets. These
// cover every decoded byte (including textures), rig, transform and animation,
// rather than only checking that a file has a plausible GLB header.
const originals = {
  'alien_planet.glb': '5f14af19b5883d4268ac2b8ee2accf291710dc007fa95c9acde4947047c78e52',
  'aliencubealpha-unit.glb': '60abd67abf532d3b328a8ca70398f1930aed0a01b88a7b3b1b8407dd7d14dc3a',
  'bot_mecha_warrior.glb': '6cd8c1690dffb14a835adf48b0cf34740a294472e09fe8ebd669ed5299c27b7c',
  'halo_4multiplayercrimsonwreckage.glb': 'e80c91797b6660a47d817696ed13d256b08aaa2b2dcd2d357c248dfca89f5f4e',
  'international_space_station_-_3d_scan_-_module.glb': '0ab769da4a24f98eb351055aaec9c40ef2ab43e642c071c6107006e57a61ddda',
  'lava_planet.glb': '375e75be0aba0c309fb78179506c5abb549586aafb324793f86aff2b141b8cc6',
  'little_planet_earth.glb': 'b814fa67fdddb9533a8886ae58d3b4dba97e31edd822c26afe761f358d7e43d4',
  'moon.glb': 'a2e84508b1f299c210555db7bf5bd8a48edf86801ff80e703ea9a9e458dde7bf',
  'planet_earth.glb': 'e4196a834a6e709fb2ecf769df9a48ab0112415eced84a4de632507a2beec4c2',
  'sci-fi_cube_01.glb': '08ab03a7e081fcdc061ebc69e441e16b2193ecbf9b0d7abbfad9f947139f5ab4',
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
