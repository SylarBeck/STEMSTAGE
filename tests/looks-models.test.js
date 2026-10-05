// Every wardrobe choice has a piece in the baked MPFB models (tools/mpfb/build_band.py), on both bodies, and every
// look is always dressed: a top, bottoms and shoes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanLook, fromPreset, PRESETS, HAIR_STYLES, FACIAL, TOPS, LEGS, KICKS, HEADWEAR, BODIES } from '../src/profile/looks.js';
import { lookPieces } from '../src/game/figure.js';

const models = Object.fromEntries(BODIES.map((b) => [b, JSON.parse(fs.readFileSync(new URL(`../public/models/band-${b}.json`, import.meta.url), 'utf8'))]));

test('every wardrobe choice exists on both bodies, and every look wears clothes', () => {
  const base = cleanLook({});
  const looks = [base, ...PRESETS.map((p) => fromPreset(p.id))];
  for (const hair of HAIR_STYLES) looks.push({ ...base, hair });
  for (const facial of FACIAL) looks.push({ ...base, facial });
  for (const topStyle of TOPS) looks.push({ ...base, topStyle });
  for (const legs of LEGS) looks.push({ ...base, legs });
  for (const kicks of KICKS) looks.push({ ...base, kicks });
  for (const head of HEADWEAR) looks.push({ ...base, head, hair: 'curls' });
  for (const [body, meta] of Object.entries(models)) {
    for (const look of looks) {
      const list = lookPieces({ ...look, body });
      for (const slot of ['top.', 'legs.', 'feet.']) assert.ok(list.some((p) => p.startsWith(slot)), `${body}: a look without ${slot}`);
      for (const p of list) assert.ok(meta.pieces.includes(p), `${body}: no piece ${p}`);
    }
  }
});

test('old and broken looks still get dressed', () => {
  const v1 = cleanLook({ skin: '#6b4128', hair: 'locs', topStyle: 'coat', pants: '#15120e' });
  assert.equal(v1.body, 'm');
  assert.equal(v1.legs, 'jeans');
  assert.equal(v1.kicks, 'sneakers');
  const junk = cleanLook({ topStyle: 'nothing', legs: 'none', kicks: '', body: 'x' });
  assert.equal(junk.topStyle, 'tee');
  assert.equal(junk.legs, 'jeans');
  assert.equal(junk.kicks, 'sneakers');
  assert.equal(junk.body, 'm');
});
