// The band members' bodies: MakeHuman (MPFB) people baked in Blender by tools/mpfb/build_band.py into
// public/models/band-{m,f}.glb. Each file is one game_engine skeleton with the body, eyes, brows, lashes and every
// wardrobe piece skinned to it (named by piece: hair.long, top.tee, legs.jeans, feet.boots, face.beard, hat.fedora),
// morph targets for builds and face shapes, and a _hide attribute on the body (which skin each piece covers).
// A member gets its own copy of the skeleton and materials; geometry is shared, except the body's index, which drops
// the triangles under the clothes being worn.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// bit order of the body's _hide attribute (tools/mpfb/build_band.py HIDE_BITS)
const HIDE_BITS = ['top.tee', 'top.longsleeve', 'top.shirt', 'top.blouse', 'top.jacket', 'top.suit', 'top.crop',
  'legs.jeans', 'legs.slacks', 'legs.skirt', 'legs.overalls',
  'feet.sneakers', 'feet.runners', 'feet.boots', 'feet.dress', 'feet.brogues', 'feet.hikers'];
const BIT = Object.fromEntries(HIDE_BITS.map((k, i) => [k, 1 << i]));
// bones the rest-pose table keeps (joint positions for the animation rig and accessory anchors)
const JOINTS = ['pelvis', 'spine_01', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r',
  'hand_l', 'hand_r', 'middle_01_l', 'middle_01_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r'];

const templates = {};
const loading = {};
let loader = null;
const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';

/** Starts loading one body (m | f); resolves to its template. Safe to call again. */
export function loadHuman(sex) {
  if (!loading[sex]) {
    loader ||= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loading[sex] = loader.loadAsync(`${base}models/band-${sex}.glb`).then((g) => (templates[sex] = prepare(g, sex)));
    loading[sex].catch((e) => console.warn('[human] could not load', sex, e));
  }
  return loading[sex];
}
export const humanTemplate = (sex) => templates[sex] || null;

function prepare(gltf, sex) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const rest = {};
  const pieces = {};
  scene.traverse((o) => {
    if (o.isBone && JOINTS.includes(o.name)) rest[o.name] = o.getWorldPosition(new THREE.Vector3());
    if (o.isSkinnedMesh) {
      const id = o.userData.piece || o.name;
      pieces[id] = o;
      tuneMaterial(o.material, id);
    }
  });
  // Landmarks in model space. Vertices go through the skin (the packed files store quantized positions and fold the
  // scale into the bind matrices), so this works on packed and unpacked models alike.
  const at = (mesh, i, out) => mesh.localToWorld(mesh.getVertexPosition(i, out));
  const v = new THREE.Vector3();
  // the face anchor: between the eyes, on their front surface
  const bb = new THREE.Box3();
  for (let i = 0; i < pieces.eyes.geometry.attributes.position.count; i++) bb.expandByPoint(at(pieces.eyes, i, v));
  rest.eyeMid = new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.max.z);
  rest.eyeSep = (bb.max.x - bb.min.x) / 2;
  // the top of the head and the chest's front, for hats and accessories
  let top = -1e9, chest = -1e9, belly = -1e9, temple = 0, front = -1e9, back = 1e9;
  for (let i = 0; i < pieces.body.geometry.attributes.position.count; i++) {
    at(pieces.body, i, v);
    if (v.y > top) top = v.y;
    if (Math.abs(v.y - rest.eyeMid.y - 0.03) < 0.008) {
      temple = Math.max(temple, Math.abs(v.x));
      if (Math.abs(v.x) < 0.02) { front = Math.max(front, v.z); back = Math.min(back, v.z); }
    }
    if (Math.abs(v.x) < 0.04 && Math.abs(v.y - rest.spine_03.y) < 0.05) chest = Math.max(chest, v.z);
    if (Math.abs(v.x) < 0.06 && Math.abs(v.y - rest.spine_01.y) < 0.05) belly = Math.max(belly, v.z);
  }
  rest.top = top;
  rest.temple = temple; // half the head's width at the temples
  rest.skullZ = (front + back) / 2; // the middle of the skull, front to back
  rest.chestFront = chest;
  rest.belly = belly; // the front of the belly at the guitar's height
  return { sex, scene, rest, pieces };
}

function tuneMaterial(m, id) {
  m.envMapIntensity = 0.6;
  const kind = id.split('.')[0];
  if (['hair', 'face', 'eyebrows', 'eyelashes'].includes(kind)) {
    // cut-out cards, feathered by MSAA where the frame has it (alpha to coverage) instead of hard grainy edges
    m.alphaTest = kind === 'face' ? 0.5 : 0.4;
    m.alphaToCoverage = true;
    m.transparent = false;
    // hair cards face outward; their back faces (seen through gaps) render as a dark crown, so only the front
    m.side = kind === 'hair' && id !== 'hair.curls' ? THREE.FrontSide : THREE.DoubleSide; // (the curls' back cards face in)
    m.roughness = 0.62;
  }
  if (id === 'legs.ripped') { m.alphaTest = 0.5; m.transparent = false; }
  if (id === 'body') m.roughness = 0.6;
  if (id === 'eyes') { m.roughness = 0.12; m.metalness = 0; }
}

/** A member's own copy of a body: { root, sex, rest, pieces, bones, setPieces(list), morph(name, v) }. */
export function makeHuman(sex) {
  const t = templates[sex];
  if (!t) return null;
  const root = cloneSkinned(t.scene);
  const pieces = {};
  const bones = {};
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) {
      const id = o.userData.piece || o.name;
      pieces[id] = o;
      o.material = o.material.clone();
      o.frustumCulled = false; // members never leave the stage; skinned bounds would need recomputing every frame
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  // the body gets its own index: the triangles not covered by the clothes worn
  const skins = Object.entries(pieces).filter(([id, m]) => id === 'body' && m.geometry.attributes._hide).map(([, m]) => {
    const src = m.geometry;
    const geo = new THREE.BufferGeometry();
    for (const [k, at] of Object.entries(src.attributes)) geo.setAttribute(k, at);
    geo.morphAttributes = src.morphAttributes;
    geo.morphTargetsRelative = src.morphTargetsRelative;
    geo.boundingSphere = src.boundingSphere;
    m.geometry = geo;
    return { geo, full: src.index.array, hide: src.attributes._hide };
  });
  // nobody is ever shown without clothes: until an outfit is set the whole person stays hidden
  const always = ['body', 'eyes', 'eyebrows', 'eyelashes'];
  const FALLBACK = { top: 'top.tee', legs: 'legs.jeans', feet: 'feet.sneakers' };
  root.visible = false;
  let mask = -1;
  const h = {
    root, sex, rest: t.rest, pieces, bones,
    /** Show exactly these pieces (plus the body, eyes, brows and lashes). A top, legs and shoes are always worn. */
    setPieces(list) {
      list = list.filter((id) => pieces[id]);
      for (const [slot, id] of Object.entries(FALLBACK)) if (!list.some((x) => x.startsWith(slot + '.'))) list.push(id);
      const on = new Set([...always, ...list]);
      for (const [id, m] of Object.entries(pieces)) m.visible = on.has(id);
      root.visible = true;
      let want = 0;
      for (const id of list) want |= BIT[id] || 0;
      if (want === mask) return;
      mask = want;
      for (const { geo, full, hide } of skins) {
        const out = new (full.constructor)(full.length);
        let n = 0;
        for (let i = 0; i < full.length; i += 3) {
          const x = full[i], y = full[i + 1], z = full[i + 2];
          // skip a triangle only when all of it is under the clothes (no holes at hems and cuffs)
          if (hide.getX(x) & hide.getX(y) & hide.getX(z) & want) continue;
          out[n++] = x; out[n++] = y; out[n++] = z;
        }
        geo.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
      }
    },
    /** Set a morph target (slim, broad, faceA, faceB, faceC) on every piece. */
    morph(name, v) {
      for (const m of Object.values(pieces)) {
        const i = m.morphTargetDictionary?.[name];
        if (i !== undefined) m.morphTargetInfluences[i] = v;
      }
    },
    dispose() {
      for (const k of skins) k.geo.index = null;
      for (const m of Object.values(pieces)) m.material.dispose();
    },
  };
  return h;
}
