// Band members (2.0.1): MakeHuman people (game/human.js, baked from MPFB by tools/mpfb/build_band.py) with real
// hair and clothes, posed by an invisible animation rig. The rig keeps the shape the stage moves were written for
// (pelvis, spine, neck, head, shoulder → elbow → wrist, hip → knee → ankle); every frame its joints are copied onto
// the MPFB skeleton. Arms are posed with a two-bone IK solver so hands sit on the frets, keys, sticks and mic.
// Hats, eyewear, accessories and LED trim are modelled here and ride on the rig's head and chest.
// Instruments (profile/rig.js shapes) are built once and switched on, with static pieces merged per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cleanLook } from '../profile/looks.js';
import { cleanPart, HARDWARE_COLOR } from '../profile/rig.js';
import { loadHuman, humanTemplate, makeHuman } from './human.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const glowMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff });
const setGlow = (mat, hex, k = 2.4) => { mat.color.set(hex || '#000000').multiplyScalar(k); };
const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
const group = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent?.add(g); return g; };

/** A smooth surface of revolution through control points [radius, height] (Catmull-Rom between them). */
function lathe(points, { segs = 22, n = 18, sx = 1, sz = 1, phiStart = 0, phiLength = Math.PI * 2 } = {}) {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)));
  const geo = new THREE.LatheGeometry(curve.getPoints(n), segs, phiStart, phiLength);
  geo.scale(sx, 1, sz);
  geo.computeVertexNormals();
  return geo;
}

/** Pushes vertices along their normals by a cheap 3D wave noise: knit, fabric creases. */
function bumpy(geo, amp, freq = 40, seed = 1) {
  geo.computeVertexNormals();
  const p = geo.attributes.position, nr = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.sin(x * freq + seed) * Math.sin(y * freq * 1.31 + seed * 2.1) * Math.sin(z * freq * 0.87 + seed * 3.7)
      + 0.5 * Math.sin(x * freq * 2.3 - seed) * Math.sin(z * freq * 2.1 + y * freq * 1.7);
    p.setXYZ(i, x + nr.getX(i) * amp * k, y + nr.getY(i) * amp * k, z + nr.getZ(i) * amp * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A tube along points (chains, drawstrings, straps). */
const tube = (pts, r, seg = 12, radial = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, radial, false);

/** Merge the static meshes inside a group into one mesh per material (fewer draw calls). */
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.keep) return;
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(inv.clone().multiply(o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
    victims.push(o);
  });
  for (const o of victims) o.parent.remove(o);
  for (const [mat, geos] of byMat) { const m = new THREE.Mesh(mergeGeometries(geos), mat); root.add(m); }
  const empty = [];
  root.traverse((o) => { if (o !== root && o.isGroup && !o.children.length) empty.push(o); });
  for (const o of empty) o.parent.remove(o);
  return root;
}

// out of the box: dark stage clothes, so a player's own character stands out
export const DEFAULT_LOOKS = {
  guitar: cleanLook({ body: 'm', face: 'faceA', skin: '#6b4128', hair: 'long', hairColor: '#0c0c12', top: '#3a0d1c', pants: '#15120e', legs: 'jeans', kicks: 'boots', finish: '#d81b3a', topStyle: 'tee', facial: 'stubble', move: 'headbang' }),
  bass: cleanLook({ body: 'f', skin: '#c68a5f', hair: 'ponytail', hairColor: '#3b2414', top: '#0d1c3a', pants: '#15120e', legs: 'jeans', kicks: 'sneakers', finish: '#1b5ed8', topStyle: 'crop', accent: '#15120e', move: 'sway' }),
  drums: cleanLook({ body: 'm', face: 'faceC', skin: '#9a6440', hair: 'slick', hairColor: '#0c0c12', top: '#2a1a08', pants: '#15120e', legs: 'overalls', kicks: 'runners', finish: '#b86a1b', topStyle: 'tee', facial: 'beard' }),
  keys: cleanLook({ body: 'f', face: 'faceB', skin: '#e0ac85', hair: 'bob', hairColor: '#8a5a2b', top: '#1c0d3a', pants: '#15120e', legs: 'skirt', kicks: 'boots', finish: '#15120e', topStyle: 'blouse', accent: '#3a0d1c', eyes: 'round', move: 'sway' }),
  vocals: cleanLook({ body: 'm', skin: '#f3d3b8', hair: 'spiky', hairColor: '#0c0c12', top: '#151515', pants: '#15120e', legs: 'jeans', kicks: 'boots', finish: '#5a5a5a', topStyle: 'jacket', accent: '#7a0f22', move: 'power' }),
};

// The MakeHuman people are life-size; the stages were built around slightly larger-than-life players.
const K = 1.1;
// the old figure's proportions, which the accessories below are drawn in (head radius ~0.12, shoulders at ±0.205)
const OLD = { temple: 0.097, top: 0.123, eyeX: 0.039, eyeY: 0.018, eyeZ: 0.1, shoulderX: 0.205, shoulderY: 0.47, chestZ: 0.12 };

// ---------------------------------------------------------------- the animation rig + accessories
function buildFigure() {
  const mats = {
    accent: std(0x15120e, 0.82), cloth: std(0x3a0d1c, 0.82), glow: glowMat(), metal: std(0xc9a13a, 0.25, 1), lens: std(0x050507, 0.06, 0.9),
    white: std(0xf2efe8, 0.3), leather: std(0x1a1310, 0.55, 0.1), visor: glowMat(), halo: glowMat(), horn: std(0x1a1310, 0.55), hornGlow: glowMat(),
    ice: new THREE.MeshStandardMaterial({ color: 0x9fe8ff, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.8, emissive: 0x2a7fa8, emissiveIntensity: 1.1 }),
  };
  const g = new THREE.Group();
  const body = group(g);
  body.scale.setScalar(K);
  const pelvis = group(body);
  const spine = group(pelvis);
  const neck = group(spine);
  const head = group(neck);
  const face = group(head);    // eyewear, in the old head's units: origin at the head's centre, eyes at (±0.039, 0.018, 0.1)
  const crown = group(head);   // headwear, in the same units, sat on the top of the skull
  const chest = group(spine);  // drawn in the old torso's units: shoulders at (±0.205, 0.47)
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = group(pelvis);
    const knee = group(hip);
    const ankle = group(knee);
    const sole = add(ankle, new THREE.BoxGeometry(0.11, 0.006, 0.27), mats.glow, 0, 0, 0);
    legs.push({ hip, knee, ankle, sole, side: sx });
  }
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = group(spine);
    const elbow = group(shoulder);
    const wrist = group(elbow);
    // the palm: x across the knuckles, y out of the palm, z along the fingers (placed by fitRig); things held sit in
    // the fist, along its thumb side
    const grip = group(wrist);
    const fist = group(grip);
    const cuffGlow = add(wrist, new THREE.TorusGeometry(0.045, 0.004, 6, 18), mats.glow, 0, 0.02, 0); cuffGlow.rotation.x = Math.PI / 2;
    const stick = add(fist, new THREE.CylinderGeometry(0.007, 0.009, 0.4, 8), mats.white, 0, 0.1, 0);
    stick.visible = false;
    arms.push({ shoulder, elbow, wrist, grip, fist, cuffGlow, stick, side: sx, fingers: [] });
  }

  // eyewear
  const eyewear = { none: group(face), shades: group(face), round: group(face), visor: group(face), goggles: group(face) };
  for (const sx of [-1, 1]) { const l = add(eyewear.shades, new THREE.SphereGeometry(0.03, 16, 10), mats.lens, sx * 0.04, 0.018, 0.104); l.scale.set(1.25, 0.8, 0.25); }
  add(eyewear.shades, new THREE.BoxGeometry(0.17, 0.008, 0.008), mats.metal, 0, 0.034, 0.108);
  for (const sx of [-1, 1]) {
    add(eyewear.round, new THREE.TorusGeometry(0.023, 0.003, 6, 22), mats.metal, sx * 0.04, 0.018, 0.108);
    add(eyewear.round, new THREE.BoxGeometry(0.003, 0.003, 0.1), mats.metal, sx * 0.1, 0.022, 0.06);
  }
  add(eyewear.round, new THREE.TorusGeometry(0.012, 0.0025, 4, 10, Math.PI), mats.metal, 0, 0.02, 0.11);
  const visor = add(eyewear.visor, new THREE.CylinderGeometry(0.122, 0.122, 0.04, 32, 1, true, -1.15, 2.3), mats.visor, 0, 0.018, -0.01); visor.scale.set(1.0, 1, 1.08);
  mats.visor.side = THREE.DoubleSide;
  for (const sx of [-1, 1]) { const gg = add(eyewear.goggles, new THREE.CylinderGeometry(0.03, 0.033, 0.03, 18), mats.lens, sx * 0.042, 0.02, 0.1); gg.rotation.x = Math.PI / 2; add(eyewear.goggles, new THREE.TorusGeometry(0.031, 0.006, 6, 18), mats.leather, sx * 0.042, 0.02, 0.115); }
  const strap = add(eyewear.goggles, new THREE.TorusGeometry(0.122, 0.009, 6, 30), mats.leather, 0, 0.024, -0.005); strap.rotation.x = Math.PI / 2; strap.scale.set(0.93, 1.05, 1);
  for (const e of Object.values(eyewear)) mergeStatic(e);

  // headwear (the fedora is an MPFB piece)
  const hats = { none: group(crown), fedora: group(crown), beanie: group(crown), cap: group(crown), cowboy: group(crown), bandana: group(crown), crown: group(crown), horns: group(crown), halo: group(crown) };
  const hatCap = (r, frac) => { const c = new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI * frac); c.scale(0.95, 1, 1.03); return c; };
  add(hats.beanie, bumpy(hatCap(0.138, 0.5), 0.002, 160, 2), mats.accent, 0, 0.02, -0.005);
  add(hats.beanie, new THREE.TorusGeometry(0.134, 0.017, 10, 32), mats.accent, 0, 0.03, -0.005).rotation.x = Math.PI / 2;
  add(hats.beanie, bumpy(new THREE.SphereGeometry(0.03, 12, 10), 0.006, 140, 3), mats.accent, 0, 0.165, -0.01);
  add(hats.cap, hatCap(0.134, 0.48), mats.accent, 0, 0.022, -0.005);
  const brim = add(hats.cap, new THREE.CylinderGeometry(0.085, 0.085, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), mats.accent, 0, 0.04, 0.1); brim.rotation.x = 0.16;
  add(hats.cap, new THREE.SphereGeometry(0.012, 8, 6), mats.accent, 0, 0.155, -0.005);
  add(hats.cowboy, lathe([[0.001, 0.12], [0.07, 0.115], [0.095, 0.08], [0.1, 0.0]], { segs: 28, sz: 1.15 }), mats.leather, 0, 0.06, 0);
  add(hats.cowboy, lathe([[0.1, 0.0], [0.17, 0.005], [0.235, 0.03]], { segs: 32, sz: 1.2 }), mats.leather, 0, 0.06, 0);
  mats.leather.side = THREE.DoubleSide;
  add(hats.cowboy, new THREE.TorusGeometry(0.1, 0.008, 6, 28), mats.accent, 0, 0.075, 0).rotation.x = Math.PI / 2;
  add(hats.bandana, new THREE.TorusGeometry(0.125, 0.018, 8, 30), mats.accent, 0, 0.05, -0.005).rotation.x = Math.PI / 2 - 0.15;
  add(hats.bandana, hatCap(0.131, 0.36), mats.accent, 0, 0.024, -0.008);
  for (const sx of [-1, 1]) { const t = add(hats.bandana, new THREE.BoxGeometry(0.03, 0.09, 0.01), mats.accent, sx * 0.02, -0.02, -0.14); t.rotation.z = sx * 0.3; }
  add(hats.crown, new THREE.CylinderGeometry(0.105, 0.115, 0.045, 24, 1, true), mats.metal, 0, 0.1, 0);
  mats.metal.side = THREE.DoubleSide;
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; add(hats.crown, new THREE.ConeGeometry(0.018, 0.06, 5), mats.metal, Math.sin(a) * 0.108, 0.15, Math.cos(a) * 0.108); add(hats.crown, new THREE.OctahedronGeometry(0.011), k % 2 ? mats.hornGlow : mats.visor, Math.sin(a) * 0.118, 0.1, Math.cos(a) * 0.118); }
  for (const sx of [-1, 1]) {
    const pts = [V(sx * 0.08, 0.06, -0.01), V(sx * 0.14, 0.12, -0.03), V(sx * 0.16, 0.2, -0.06), V(sx * 0.13, 0.26, -0.05)];
    const curve = new THREE.CatmullRomCurve3(pts);
    const hg = new THREE.TubeGeometry(curve, 16, 1, 8, false);
    const p = hg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / 9) / 16;
      const c = curve.getPoint(ring);
      const r = 0.026 * (1 - ring * 0.85);
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * r, c.y + (p.getY(i) - c.y) * r, c.z + (p.getZ(i) - c.z) * r);
    }
    hg.computeVertexNormals();
    add(hats.horns, hg, mats.horn);
    add(hats.horns, new THREE.SphereGeometry(0.009, 8, 6), mats.hornGlow, sx * 0.13, 0.262, -0.05);
  }
  const halo = add(hats.halo, new THREE.TorusGeometry(0.105, 0.008, 8, 40), mats.halo, 0, 0.25, -0.02); halo.rotation.x = Math.PI / 2 - 0.3; halo.userData.keep = true;
  for (const [k, h] of Object.entries(hats)) if (k !== 'halo') mergeStatic(h);

  // LED trim down the front
  const trims = [];
  for (const sx of [-1, 1]) { const t = add(chest, new THREE.BoxGeometry(0.006, 0.42, 0.006), mats.glow, sx * 0.06, 0.25, 0.135); t.rotation.x = -0.08; trims.push(t); }

  // accessories
  const extra = { none: group(chest), chain: group(chest), scarf: group(chest), spikes: group(chest), cape: group(chest), wings: group(chest) };
  const chainCurve = []; for (let k = 0; k <= 16; k++) { const a = Math.PI * 0.15 + (k / 16) * Math.PI * 0.7; chainCurve.push(V(Math.cos(a) * 0.075, 0.56 - Math.sin(a) * 0.17, 0.1 + Math.sin(a) * 0.045)); }
  add(extra.chain, tube(chainCurve, 0.004, 32, 5), mats.metal);
  add(extra.chain, new THREE.OctahedronGeometry(0.018), mats.metal, 0, 0.38, 0.15);
  const scarf = add(extra.scarf, bumpy(new THREE.TorusGeometry(0.075, 0.03, 10, 24), 0.004, 60, 2), mats.accent, 0, 0.57, 0.01); scarf.rotation.x = Math.PI / 2;
  add(extra.scarf, tube([V(-0.04, 0.55, 0.1), V(-0.05, 0.42, 0.15), V(-0.045, 0.28, 0.15)], 0.022, 8, 6), mats.accent);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const pad = add(extra.spikes, new THREE.ConeGeometry(0.018, 0.08, 6), mats.metal, sx * (0.18 + k * 0.03), 0.53 - k * 0.012, -0.03 + k * 0.035);
    pad.rotation.z = -sx * 0.8;
  }
  for (const sx of [-1, 1]) add(extra.spikes, new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.leather, sx * 0.19, 0.48, 0);
  const capeGeo = new THREE.PlaneGeometry(0.46, 1.05, 4, 10).translate(0, -0.52, 0);
  const cp = capeGeo.attributes.position; for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); cp.setZ(i, -Math.cos(x * 9) * 0.015 - (x * x) * 0.4 + y * 0.05); }
  capeGeo.computeVertexNormals();
  const capeMat = mats.accent.clone(); capeMat.side = THREE.DoubleSide;
  const cape = add(extra.cape, capeGeo, capeMat, 0, 0.53, -0.15); cape.userData.keep = true;
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = group(extra.wings, sx * 0.08, 0.42, -0.14);
    for (let k = 0; k < 6; k++) {
      const shard = add(w, new THREE.OctahedronGeometry(0.06, 0), mats.ice, sx * (0.12 + k * 0.085), 0.08 + k * 0.05 - k * k * 0.006, -0.02 - k * 0.015);
      shard.scale.set(0.5, 3.4 - k * 0.32, 0.25); shard.rotation.z = -sx * (0.7 + k * 0.17);
    }
    wings.push(w);
  }
  for (const [k, e] of Object.entries(extra)) if (k !== 'wings' && k !== 'cape') mergeStatic(e);

  return { g, body, pelvis, spine, neck, head, face, crown, chest, arms, legs, mats, eyewear, hats, extra, trims, cape, wings, halo, human: null, sex: null };
}

function show(groups, key) { for (const [k, m] of Object.entries(groups)) m.visible = k === key; }

// ---------------------------------------------------------------- fitting the rig to a body
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = V(), _v2 = V(), _mb = new THREE.Matrix4();
const rel = (a, b) => V().subVectors(a, b);
// [rig joint, MPFB bone]; arms[0] / legs[0] are the character's right (−x)
const PAIRS = [['pelvis', 'pelvis'], ['spine', 'spine_01'], ['neck', 'neck_01'], ['head', 'head'],
  ['arm0.shoulder', 'upperarm_r'], ['arm0.elbow', 'lowerarm_r'], ['arm0.wrist', 'hand_r'],
  ['arm1.shoulder', 'upperarm_l'], ['arm1.elbow', 'lowerarm_l'], ['arm1.wrist', 'hand_l'],
  ['leg0.hip', 'thigh_r'], ['leg0.knee', 'calf_r'], ['leg0.ankle', 'foot_r'],
  ['leg1.hip', 'thigh_l'], ['leg1.knee', 'calf_l'], ['leg1.ankle', 'foot_l']];
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

function joint(f, key) {
  const [a, b] = key.split('.');
  if (!b) return f[a];
  return a.startsWith('arm') ? f.arms[+a[3]][b] : f.legs[+a[3]][b];
}
/** Rotation of o relative to the figure's body group. */
function bodyQuat(o, stop, out) {
  out.identity();
  for (let x = o; x && x !== stop; x = x.parent) out.premultiply(x.quaternion);
  return out;
}

/** Put the rig's joints where this body's bones are, and work out how each joint maps onto its bone. */
function fitRig(f, h) {
  const r = h.rest;
  f.pelvis.position.copy(r.pelvis); f.pelvis.quaternion.identity();
  f.spine.position.copy(rel(r.spine_01, r.pelvis)); f.spine.quaternion.identity();
  f.neck.position.copy(rel(r.neck_01, r.spine_01)); f.neck.quaternion.identity();
  f.head.position.copy(rel(r.head, r.neck_01)); f.head.quaternion.identity();
  f.hipY = r.pelvis.y;
  f.pelvisRest = r.pelvis.clone();
  for (const [i, l] of f.legs.entries()) {
    const s = i ? 'l' : 'r';
    l.hip.position.copy(rel(r['thigh_' + s], r.pelvis));
    l.knee.position.copy(rel(r['calf_' + s], r['thigh_' + s]));
    l.ankle.position.copy(rel(r['foot_' + s], r['calf_' + s]));
    for (const j of [l.hip, l.knee, l.ankle]) j.quaternion.identity();
    l.sole.position.set(0, -r['foot_' + s].y + 0.004, r['ball_' + s].z - r['foot_' + s].z - 0.01);
  }
  for (const [i, a] of f.arms.entries()) {
    const s = i ? 'l' : 'r';
    const S = r['upperarm_' + s], E = r['lowerarm_' + s], W = r['hand_' + s], M = r['middle_01_' + s];
    a.upper = S.distanceTo(E);
    a.fore = E.distanceTo(W);
    a.lower = a.fore; // reach() places the wrist; aimHand() turns the hand so the palm lands on its target
    a.shoulder.position.copy(rel(S, r.spine_01));
    // the arm's rest pose: −y down the upper arm, the elbow bending about x
    const dU = rel(E, S).normalize(), dL = rel(W, E).normalize();
    const n = V().crossVectors(dL, dU);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    n.normalize();
    const y = dU.clone().negate(), z = V().crossVectors(n, y);
    a.shoulder.quaternion.setFromRotationMatrix(_mb.makeBasis(n, y, z));
    a.elbow.position.set(0, -a.upper, 0);
    const fl = dL.clone().applyQuaternion(_q.copy(a.shoulder.quaternion).invert());
    a.elbow.rotation.set(Math.atan2(-fl.z, -fl.y), 0, 0);
    a.wrist.position.set(0, -a.fore, 0);
    a.wrist.quaternion.identity();
  }
  f.belly = r.belly - r.spine_01.z; // the front of the belly, in the spine's space (instruments hang in front of it)
  f.mouth = V(r.eyeMid.x - r.head.x, r.eyeMid.y - r.head.y - 0.072, r.eyeMid.z - r.head.z - 0.004); // in the head's space
  f.mouthY = r.eyeMid.y - 0.072;
  // accessories in the old figure's units, fitted to this head and chest
  const s = r.temple / OLD.temple;
  f.face.scale.setScalar(s);
  f.face.position.set(r.eyeMid.x - r.head.x, r.eyeMid.y - r.head.y - OLD.eyeY * s, r.eyeMid.z - r.head.z - OLD.eyeZ * s);
  // hats: the old head's top (0.123 above its centre) on this skull's top, plus a little for hair
  const hs = s * 1.04;
  f.crown.scale.setScalar(hs);
  f.crown.position.set(0, r.top + 0.014 - r.head.y - OLD.top * hs, r.skullZ - r.head.z);
  const sh = r.upperarm_l;
  f.chest.scale.set(Math.abs(sh.x - r.spine_01.x) / OLD.shoulderX, (sh.y - r.spine_01.y) / OLD.shoulderY, Math.max(0.8, (r.chestFront - r.spine_01.z) / OLD.chestZ));
  f.chestScale = f.chest.scale.clone();

  // joint → bone mapping, measured with both at rest
  const root = h.root;
  root.updateMatrixWorld(true);
  const mapped = new Map();
  f.retarget = PAIRS.map(([key, name]) => {
    const j = joint(f, key), b = h.bones[name];
    const qj = bodyQuat(j, f.body, new THREE.Quaternion());
    const qb = bodyQuat(b, f.body, new THREE.Quaternion());
    // the nearest mapped ancestor, and the fixed rotation between it and this bone's parent
    let a = b.parent;
    while (a && !mapped.has(a)) a = a.parent === root ? null : a.parent;
    const qp = bodyQuat(b.parent, f.body, new THREE.Quaternion());
    const fixed = a ? mapped.get(a).qb.clone().invert().multiply(qp) : qp;
    const e = { j, b, offset: qj.invert().multiply(qb), anc: a ? mapped.get(a) : null, fixed, qb, want: new THREE.Quaternion(), restPos: b.position.clone() };
    mapped.set(b, e);
    return e;
  });
  // each hand's palm frame, from its bones: z along the fingers, y out of the palm, x = y × z
  f.body.updateMatrixWorld(true);
  const inBody = (b) => f.body.worldToLocal(b.getWorldPosition(V()));
  for (const [i, a] of f.arms.entries()) {
    const B = (n) => h.bones[`${n}_${i ? 'l' : 'r'}`];
    const W = inBody(B('hand')), M = inBody(B('middle_01')), I = inBody(B('index_01')), P = inBody(B('pinky_01'));
    const fz = rel(M, W).normalize(), across = rel(I, P).normalize();
    const n = V().crossVectors(across, fz).normalize();
    if (n.x * W.x > 0) n.negate(); // in the A pose the palms face the thighs
    n.addScaledVector(fz, -n.dot(fz)).normalize();
    const x = V().crossVectors(n, fz);
    a.thumb = Math.sign(x.dot(across)) || 1; // +1: the grip's x points to the thumb
    const G = new THREE.Quaternion().setFromRotationMatrix(_mb.makeBasis(x, n, fz));
    const Qw = bodyQuat(a.wrist, f.body, new THREE.Quaternion()).invert();
    const palm = W.clone().lerp(M, 0.55).addScaledVector(n, 0.012);
    a.grip.position.copy(palm.sub(W).applyQuaternion(Qw));
    a.grip.quaternion.copy(Qw).multiply(G);
    // held things go through the fist (in front of the palm), along its thumb side
    a.fist.position.set(0, 0.026, 0.012);
    a.fist.quaternion.setFromUnitVectors(V(0, 1, 0), V(a.thumb, 0, 0));
    // finger bones curl about the palm's x axis; the thumb about its own
    a.fingers = [];
    const local = (b, axis) => axis.clone().applyQuaternion(bodyQuat(b, f.body, new THREE.Quaternion()).invert()).normalize();
    for (const fn of FINGERS) for (let k = 1; k <= 3; k++) {
      const b = B(`${fn}_0${k}`);
      if (b) a.fingers.push({ b, rest: b.quaternion.clone(), axis: local(b, x), k: k === 1 ? 0.75 : 1, thumb: false });
    }
    const tAxis = V().crossVectors(n, rel(inBody(B('thumb_03')), inBody(B('thumb_01'))).normalize()).normalize();
    for (let k = 2; k <= 3; k++) {
      const b = B(`thumb_0${k}`);
      if (b) a.fingers.push({ b, rest: b.quaternion.clone(), axis: local(b, tAxis), k: 0.8, thumb: true });
    }
  }
}

/** Curl a hand's fingers toward the palm (0 open … 1.3 a fist), the thumb separately. */
function curl(a, amount, thumb = amount * 0.5) {
  for (const d of a.fingers) d.b.quaternion.copy(d.rest).multiply(_q.setFromAxisAngle(d.axis, -(d.thumb ? thumb : amount) * d.k));
}

const _gq = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _eq = new THREE.Quaternion(), _gx = V(), _gy = V(), _gz = V(), _gw = V(), _gt = V();
/**
 * Put a hand's palm at p (spine space), facing n (out of the palm), fingers toward f. The arm's IK reaches for the
 * wrist that lands it there. pole: where the elbow points.
 */
function aimHand(a, p, n, f, pole) {
  _gy.copy(n).normalize();
  _gz.copy(f).addScaledVector(_gy, -f.dot(_gy)).normalize();
  _gx.crossVectors(_gy, _gz);
  _gq.setFromRotationMatrix(_mb.makeBasis(_gx, _gy, _gz));
  _wq.copy(_gq).multiply(_q2.copy(a.grip.quaternion).invert());
  _gw.copy(a.grip.position).applyQuaternion(_wq);
  reach(a, _gt.subVectors(p, _gw), pole);
  _eq.copy(a.shoulder.quaternion).multiply(a.elbow.quaternion).invert();
  a.wrist.quaternion.copy(_eq).multiply(_wq);
}
const _fa = V(), _fn = V(), _ff = V();
/** As aimHand for a fist holding something: along runs from the fist out past the thumb, the palm turned toward n. */
function aimFist(a, p, along, n, pole) {
  _fa.copy(along).normalize().multiplyScalar(a.thumb);
  _fn.copy(n).addScaledVector(_fa, -n.dot(_fa)).normalize();
  aimHand(a, p, _fn, _ff.crossVectors(_fa, _fn), pole);
}

/** Copy the rig's pose onto the MPFB skeleton. */
function retarget(f) {
  if (!f.retarget) return;
  for (const e of f.retarget) {
    bodyQuat(e.j, f.body, e.want).multiply(e.offset);
    const parent = e.anc ? _q.copy(e.anc.want).multiply(e.fixed) : _q.copy(e.fixed);
    e.b.quaternion.copy(parent.invert()).multiply(e.want);
    if (e.j === f.pelvis) {
      // hips drop / jump / sit: move the pelvis bone by the rig's pelvis offset
      _v.subVectors(f.pelvis.position, f.pelvisRest).applyQuaternion(parent);
      e.b.position.copy(e.restPos).add(_v);
    }
  }
}

const HAT_ON = ['beanie', 'cap', 'cowboy', 'bandana', 'fedora'];
const BIG_HAIR = ['curls', 'spiky'];
const TOP_PIECE = { tee: 'tee', crop: 'crop', longsleeve: 'longsleeve', shirt: 'shirt', blouse: 'blouse', jacket: 'jacket', coat: 'suit' };
const TINT = 1.4; // the baked textures are grey at ~0.8; this brings their average back to the chosen colour

/** The MPFB pieces a look wears: always a top, bottoms and shoes; hair, facial hair and the fedora when chosen. */
export function lookPieces(L) {
  let hair = L.hair;
  if (HAT_ON.includes(L.head) && BIG_HAIR.includes(hair)) hair = 'slick'; // big hair doesn't fit under a hat
  const list = [`top.${TOP_PIECE[L.topStyle] || 'tee'}`, `legs.${L.legs}`, `feet.${L.kicks}`];
  if (hair !== 'bald') list.push(`hair.${hair}`);
  if (L.facial !== 'none') list.push(`face.${L.facial}`);
  if (L.head === 'fedora') list.push('hat.fedora');
  return list;
}

/** Dress a figure in a look. */
function dress(f, look) {
  const L = look;
  f.mats.accent.color.set(L.accent);
  f.cape.material.color.set(L.accent);
  f.mats.cloth.color.set(L.top);
  setGlow(f.mats.glow, L.glow || '#000000');
  setGlow(f.mats.visor, L.glow || '#2fd3ff', 2.2);
  setGlow(f.mats.halo, '#ffe14d', 2.8);
  setGlow(f.mats.hornGlow, '#ff6a1a', 3.2);
  show(f.eyewear, L.eyes);
  show(f.hats, L.head);
  show(f.extra, L.extra);
  for (const t of f.trims) t.visible = !!L.glow;
  for (const l of f.legs) l.sole.visible = !!L.glow;
  for (const a of f.arms) a.cuffGlow.visible = !!L.glow && !['tee', 'crop'].includes(L.topStyle);
  f.body.scale.setScalar(K * ({ short: 0.94, average: 1, tall: 1.06 }[L.height] || 1));
  f.move = L.move;

  // the body: swap to the other one if needed (it loads in the background the first time)
  const sex = L.body;
  if (!f.human || f.sex !== sex) {
    if (!humanTemplate(sex)) {
      f.body.visible = false;
      loadHuman(sex).then(() => { if (f.look === L) dress(f, L); }, () => {});
      return;
    }
    if (f.human) { f.body.remove(f.human.root); f.human.dispose(); }
    f.human = makeHuman(sex);
    f.sex = sex;
    f.body.add(f.human.root);
    fitRig(f, f.human);
    f.body.visible = true;
  }
  const H = f.human;
  H.setPieces(lookPieces(L));
  const P = H.pieces;
  const tint = (m, hex, k = TINT) => m && m.material.color.set(hex).multiplyScalar(k);
  tint(P.body, L.skin, 1.3);
  for (const [id, m] of Object.entries(P)) {
    if (id.startsWith('hair.') || id.startsWith('face.')) tint(m, L.hairColor, 1.6);
    else if (id.startsWith('top.')) tint(m, L.top);
    else if (id.startsWith('legs.')) tint(m, L.pants);
    else if (id.startsWith('feet.')) tint(m, L.shoes, 1.6);
    else if (id.startsWith('hat.')) tint(m, L.accent, 1.6);
  }
  tint(P.eyebrows, L.hairColor, 1.2);
  H.morph('slim', L.build === 'slim' ? 1 : 0);
  H.morph('broad', L.build === 'broad' ? 1 : 0);
  for (const k of ['faceA', 'faceB', 'faceC']) H.morph(k, L.face === k ? 0.85 : 0);
}

// ---------------------------------------------------------------- arm IK
const _m = new THREE.Matrix4(), _d = V(), _n = V(), _u = V(), _x = V(), _y = V(), _z = V(), _h = V();
/**
 * Point an arm (shoulder → elbow → palm) at a target in the spine's space. pole: the direction the elbow points.
 */
function reach(arm, target, pole) {
  const S = arm.shoulder.position, UPPER = arm.upper, LOWER = arm.lower;
  _d.subVectors(target, S);
  const dist = Math.max(0.08, Math.min(UPPER + LOWER - 0.002, _d.length()));
  _d.normalize();
  const alpha = Math.acos(Math.max(-1, Math.min(1, (UPPER * UPPER + dist * dist - LOWER * LOWER) / (2 * UPPER * dist))));
  const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, (UPPER * UPPER + LOWER * LOWER - dist * dist) / (2 * UPPER * LOWER))));
  _n.crossVectors(_d, pole);
  if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
  _n.normalize();
  _u.copy(_d).applyAxisAngle(_n, alpha);
  _y.copy(_u).negate(); _x.copy(_n); _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  arm.shoulder.quaternion.setFromRotationMatrix(_m);
  // pick the elbow direction that lands the hand on the target
  let best = 0, err = Infinity;
  for (const s of [-1, 1]) {
    _h.set(0, -Math.cos(s * bend) * LOWER - UPPER, -Math.sin(s * bend) * LOWER).applyQuaternion(arm.shoulder.quaternion).add(S);
    const e2 = _h.distanceToSquared(target);
    if (e2 < err) { err = e2; best = s; }
  }
  arm.elbow.rotation.set(best * bend, 0, 0);
}

const _ra = V(), _rb = V(), _rc = V(), _rd = V();
/** One arm hanging relaxed at the side, palm in. */
function relaxArm(a, t) {
  const S = a.shoulder.position;
  _ra.set(S.x * 1.2, S.y - (a.upper + a.fore) * 0.9, S.z + 0.05 + Math.sin(t * 1.3 + a.side) * 0.01);
  aimHand(a, _ra, _rb.set(-a.side, 0, 0.2), _rc.set(0, -1, 0.15), _rd.set(a.side * 0.3, 0, -1));
  curl(a, 0.4);
}

// ---------------------------------------------------------------- instruments
function guitarShapes(bass) {
  const k = bass ? 1.06 : 1;
  const S = (fn) => { const s = new THREE.Shape(); fn(s); return s; };
  const classic = S((s) => {
    s.moveTo(-0.27, 0);
    s.bezierCurveTo(-0.28, 0.2, -0.06, 0.21, -0.01, 0.12);
    s.bezierCurveTo(0.04, 0.07, 0.12, 0.17, 0.22, 0.13);
    s.quadraticCurveTo(0.25, 0.1, 0.18, 0.045);
    s.lineTo(0.18, -0.045);
    s.quadraticCurveTo(0.23, -0.1, 0.16, -0.135);
    s.bezierCurveTo(0.08, -0.17, 0.03, -0.09, -0.02, -0.13);
    s.bezierCurveTo(-0.08, -0.2, -0.28, -0.2, -0.27, 0);
  });
  const vee = S((s) => { s.moveTo(0.18, 0.045); s.lineTo(-0.33, 0.22); s.lineTo(-0.3, 0.13); s.lineTo(-0.19, 0); s.lineTo(-0.3, -0.13); s.lineTo(-0.33, -0.22); s.lineTo(0.18, -0.045); });
  const star = S((s) => { s.moveTo(0.18, 0.045); s.lineTo(0.02, 0.22); s.lineTo(-0.06, 0.1); s.lineTo(-0.32, 0.17); s.lineTo(-0.2, 0); s.lineTo(-0.32, -0.17); s.lineTo(-0.06, -0.1); s.lineTo(0.02, -0.22); s.lineTo(0.18, -0.045); });
  const offset = S((s) => {
    s.moveTo(-0.26, 0.02);
    s.bezierCurveTo(-0.26, 0.21, -0.02, 0.22, 0.04, 0.12);
    s.bezierCurveTo(0.08, 0.06, 0.2, 0.2, 0.25, 0.12);
    s.quadraticCurveTo(0.27, 0.07, 0.18, 0.045);
    s.lineTo(0.18, -0.045);
    s.bezierCurveTo(0.12, -0.08, 0.06, -0.04, 0.0, -0.12);
    s.bezierCurveTo(-0.06, -0.21, -0.27, -0.19, -0.26, 0.02);
  });
  const hollow = S((s) => {
    s.moveTo(-0.29, 0);
    s.bezierCurveTo(-0.29, 0.24, -0.04, 0.24, 0.02, 0.15);
    s.bezierCurveTo(0.08, 0.1, 0.2, 0.2, 0.2, 0.05);
    s.lineTo(0.2, -0.05);
    s.bezierCurveTo(0.2, -0.2, 0.08, -0.1, 0.02, -0.15);
    s.bezierCurveTo(-0.04, -0.24, -0.29, -0.24, -0.29, 0);
    for (const sy of [-1, 1]) {
      const h = new THREE.Path();
      h.moveTo(-0.14, sy * 0.12); h.bezierCurveTo(-0.12, sy * 0.09, -0.06, sy * 0.13, -0.03, sy * 0.1);
      h.bezierCurveTo(-0.06, sy * 0.115, -0.11, sy * 0.08, -0.14, sy * 0.12);
      s.holes.push(h);
    }
  });
  const thunder = S((s) => { s.moveTo(0.18, 0.045); s.lineTo(0.08, 0.16); s.lineTo(-0.12, 0.09); s.lineTo(-0.34, 0.18); s.lineTo(-0.24, 0); s.lineTo(-0.3, -0.12); s.lineTo(-0.02, -0.08); s.lineTo(0.18, -0.045); });
  const ex = { depth: 0.055, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, curveSegments: 18 };
  const out = {};
  for (const [id, sh] of Object.entries({ classic, vee, star, offset, hollow, thunder })) {
    const geo = new THREE.ExtrudeGeometry(sh, ex).translate(0, 0, -0.0275);
    geo.scale(k, k, 1);
    out[id] = geo;
  }
  return out;
}

function buildGuitar(bass) {
  const inst = new THREE.Group();
  const mats = { finish: new THREE.MeshPhysicalMaterial({ color: 0xd81b3a, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 }), guard: std(0xece5d3, 0.45), hw: std(0xc9ccd6, 0.25, 1), wood: std(0x6a4020, 0.55), board: std(0x1a1008, 0.65), glow: glowMat(), string: std(0xc9ccd6, 0.3, 1), fret: std(0xd9d9d9, 0.3, 1) };
  const bodies = {};
  for (const [id, geo] of Object.entries(guitarShapes(bass))) bodies[id] = add(inst, geo, mats.finish);
  const guardShape = new THREE.Shape();
  guardShape.moveTo(-0.03, -0.02); guardShape.bezierCurveTo(-0.08, -0.15, -0.21, -0.13, -0.21, -0.04);
  guardShape.bezierCurveTo(-0.21, 0.02, -0.12, 0.0, -0.03, -0.02);
  const guard = add(inst, new THREE.ExtrudeGeometry(guardShape, { depth: 0.003, bevelEnabled: false }), mats.guard, 0, 0, 0.04);
  const len = bass ? 0.8 : 0.56;
  const nStr = bass ? 4 : 6;
  const fixed = group(inst);
  add(fixed, new THREE.BoxGeometry(len, 0.052, 0.032), mats.wood, 0.17 + len / 2, 0, 0.008);
  add(fixed, new THREE.BoxGeometry(len, 0.05, 0.008), mats.board, 0.17 + len / 2, 0, 0.028);
  for (let k = 0; k < 18; k++) { const fx = 0.19 + len * (1 - Math.pow(0.94, k + 1)) * 1.75; if (fx < 0.17 + len) add(fixed, new THREE.BoxGeometry(0.003, 0.05, 0.003), mats.fret, fx, 0, 0.033); }
  const head = new THREE.Shape(); head.moveTo(0, -0.03); head.lineTo(0.17, -0.045); head.quadraticCurveTo(0.19, 0, 0.17, 0.045); head.lineTo(0, 0.03);
  add(fixed, new THREE.ExtrudeGeometry(head, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }), mats.finish, 0.17 + len, 0, -0.002);
  for (let k = 0; k < nStr; k++) {
    const side = k < nStr / 2 ? 1 : -1, j = k % (nStr / 2);
    const tu = add(fixed, new THREE.CylinderGeometry(0.006, 0.006, 0.035, 8), mats.hw, 0.17 + len + 0.04 + j * 0.04, side * 0.05, 0.008); tu.rotation.x = Math.PI / 2;
    const knob = add(fixed, new THREE.BoxGeometry(0.014, 0.018, 0.006), mats.hw, 0.17 + len + 0.04 + j * 0.04, side * 0.07, 0.008); knob.rotation.x = Math.PI / 2;
  }
  for (const px of bass ? [0.04] : [-0.02, 0.085]) {
    add(fixed, new THREE.BoxGeometry(0.042, bass ? 0.1 : 0.085, 0.014), mats.board, px, 0, 0.04);
    for (let p = 0; p < (bass ? 4 : 6); p++) add(fixed, new THREE.CylinderGeometry(0.004, 0.004, 0.004, 6), mats.hw, px, (p - (bass ? 1.5 : 2.5)) * 0.012, 0.048).rotation.x = Math.PI / 2;
  }
  add(fixed, new THREE.BoxGeometry(0.03, 0.09, 0.016), mats.hw, -0.12, 0, 0.04);
  for (let k = 0; k < 3; k++) add(fixed, new THREE.CylinderGeometry(0.014, 0.016, 0.018, 14), mats.hw, -0.17 + k * 0.045, -0.1 + k * 0.012, 0.046).rotation.x = Math.PI / 2;
  mergeStatic(fixed);
  const inlays = [];
  for (const k of [3, 5, 7, 9, 12]) inlays.push(add(inst, new THREE.CylinderGeometry(0.005, 0.005, 0.003, 10), mats.glow, 0.19 + len * (1 - Math.pow(0.94, k)) * 1.75 - 0.012, 0, 0.033));
  for (const i of inlays) i.rotation.x = Math.PI / 2;
  const strings = [];
  for (let k = 0; k < nStr; k++) {
    const y = ((k / (nStr - 1)) - 0.5) * 0.034;
    strings.push(add(inst, new THREE.BoxGeometry(len + 0.31, bass ? 0.0028 : 0.0016, bass ? 0.0028 : 0.0016), mats.string, 0.17 + len / 2 - 0.155, y, 0.042));
  }
  // strap
  const strap = add(inst, tube([V(-0.27, 0.0, -0.02), V(-0.3, 0.2, -0.12), V(-0.05, 0.5, -0.18), V(0.25, 0.32, -0.1), V(0.24, 0.12, -0.02)], 0.012, 24, 4), std(0x15120e, 0.6));
  strap.scale.set(1, 1, 1);
  return { group: inst, bodies, guard, mats, inlays, strings, bass, len };
}

function dressGuitar(gt, part) {
  for (const [k, b] of Object.entries(gt.bodies)) b.visible = k === part.shape;
  gt.mats.finish.color.set(part.finish);
  gt.mats.guard.color.set(part.guard);
  gt.guard.visible = part.shape !== 'hollow' && part.shape !== 'vee' && part.shape !== 'star';
  gt.mats.hw.color.set(HARDWARE_COLOR[part.hardware]);
  gt.mats.string.color.set(part.glow || HARDWARE_COLOR[part.hardware]);
  gt.mats.string.emissive.set(part.glow || '#000000');
  gt.mats.string.emissiveIntensity = part.glow ? 2.2 : 0;
  setGlow(gt.mats.glow, part.glow || '#d8d2c2', part.glow ? 3 : 0.8);
}

// The kit is built for a left-handed layout and mirrored in the scene (createMember), so these become the drummer's
// left: the snare between the knees, the hi-hat beside it. The throne is KIT_THRONE behind the kit's origin.
const KIT_THRONE = 0.6, SNARE = [-0.26, 0.64, -0.24], HIHAT = [-0.56, 0.98, -0.18], SEAT = 0.6;

function buildKit() {
  const kit = new THREE.Group();
  const mats = { shell: new THREE.MeshPhysicalMaterial({ color: 0xb86a1b, roughness: 0.25, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }), hw: std(0x9a9aa8, 0.25, 1), head: std(0xe8e1cf, 0.65), cym: std(0xc9a13a, 0.22, 1), glow: glowMat(), seat: std(0x15120e, 0.6) };
  const variants = { standard: group(kit), double: group(kit), fusion: group(kit) };
  const drum = (parent, r, h, x, y, z, tilt = 0) => {
    const d = group(parent, x, y, z); d.rotation.x = tilt;
    add(d, new THREE.CylinderGeometry(r, r, h, 28), mats.shell);
    for (const s of [-1, 1]) { add(d, new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.012, 28), mats.hw, 0, s * h / 2, 0); add(d, new THREE.CircleGeometry(r * 0.98, 28), mats.head, 0, s * (h / 2 + 0.007), 0).rotation.x = -s * Math.PI / 2; }
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; add(d, new THREE.BoxGeometry(0.012, h * 0.7, 0.02), mats.hw, Math.sin(a) * r * 1.01, 0, Math.cos(a) * r * 1.01).rotation.y = a; }
    return d;
  };
  const rings = [];
  const kick = (parent, x, s = 1) => {
    const k = drum(parent, 0.5 * s, 0.45, x, 0.5 * s, 0.2, Math.PI / 2);
    rings.push(add(k, new THREE.TorusGeometry(0.43 * s, 0.013, 6, 40), mats.glow, 0, 0.238, 0));
    rings[rings.length - 1].rotation.x = Math.PI / 2;
    return k;
  };
  kick(variants.standard, 0); kick(variants.double, -0.3, 0.9); kick(variants.double, 0.3, 0.9); kick(variants.fusion, 0, 0.82);
  for (const v of [variants.standard, variants.double]) { drum(v, 0.2, 0.2, -0.22, 1.1, 0.25, 0.35); drum(v, 0.2, 0.2, 0.23, 1.1, 0.25, 0.35); drum(v, 0.3, 0.42, 0.55, 0.5, -0.2); }
  drum(variants.fusion, 0.15, 0.16, -0.27, 1.02, 0.27, 0.35); drum(variants.fusion, 0.15, 0.16, 0.02, 1.07, 0.27, 0.35); drum(variants.fusion, 0.17, 0.17, 0.3, 1.02, 0.25, 0.35); drum(variants.fusion, 0.26, 0.36, 0.55, 0.46, -0.2);
  drum(kit, 0.25, 0.15, SNARE[0], SNARE[1], SNARE[2], 0.12);
  add(kit, new THREE.CylinderGeometry(0.012, 0.012, SNARE[1], 6), mats.hw, SNARE[0], SNARE[1] / 2, SNARE[2]);
  const cymbals = [];
  for (const [cx, cy, cz, r] of [[-0.8, 1.45, 0.05, 1], [0.78, 1.4, 0.0, 1], [...HIHAT, 0.55]]) {
    const cym = add(kit, lathe([[0.001, 0.02], [0.05, 0.012], [0.34, -0.012], [0.345, -0.016]], { segs: 32, n: 8 }), mats.cym, cx, cy, cz);
    cym.scale.set(r, 1, r);
    cym.rotation.x = 0.25;
    add(kit, new THREE.CylinderGeometry(0.012, 0.012, cy, 6), mats.hw, cx, cy / 2, cz);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; const l = add(kit, new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), mats.hw, cx + Math.sin(a) * 0.1, 0.1, cz + Math.cos(a) * 0.1); l.rotation.set(Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7); }
    cymbals.push(cym);
  }
  // the drummer's throne
  add(kit, new THREE.CylinderGeometry(0.2, 0.18, 0.09, 20), mats.seat, 0, 0.56, -KIT_THRONE);
  add(kit, new THREE.CylinderGeometry(0.025, 0.04, 0.5, 8), mats.hw, 0, 0.27, -KIT_THRONE);
  for (const v of Object.values(variants)) v.traverse((o) => { if (o.material === mats.glow) o.userData.keep = true; });
  return { group: kit, mats, variants, rings, cymbals };
}

function dressKit(kit, part) {
  for (const [k, v] of Object.entries(kit.variants)) v.visible = k === part.shape;
  kit.mats.shell.color.set(part.finish);
  kit.mats.hw.color.set(HARDWARE_COLOR[part.hardware]);
  for (const r of kit.rings) r.visible = !!part.glow;
  setGlow(kit.mats.glow, part.glow || '#000000', 3);
}

function buildKeys() {
  const rig = new THREE.Group();
  const mats = { finish: new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.3, metalness: 0.2, clearcoat: 0.8 }), white: std(0xb9b5ad, 0.55), black: std(0x101010, 0.35), hw: std(0x9a9aa8, 0.25, 1), glow: glowMat() };
  const variants = { stage: group(rig), synth: group(rig), keytar: group(rig) };
  const keybed = (parent, w, keys = 36) => {
    const kw = w / keys;
    for (let k = 0; k < keys; k++) add(parent, new THREE.BoxGeometry(kw * 0.92, 0.02, 0.2), mats.white, -w / 2 + kw * (k + 0.5), 0.05, 0.1);
    for (let k = 0; k < keys - 1; k++) if (![2, 6].includes(k % 7)) add(parent, new THREE.BoxGeometry(kw * 0.55, 0.03, 0.12), mats.black, -w / 2 + kw * (k + 1), 0.065, 0.05);
  };
  add(variants.stage, new THREE.BoxGeometry(1.5, 0.08, 0.45), mats.finish);
  keybed(variants.stage, 1.36);
  for (const sx of [-1, 1]) { const l = add(variants.stage, new THREE.BoxGeometry(0.04, 1.05, 0.04), mats.hw, sx * 0.45, -0.52, 0); l.rotation.z = sx * 0.25; const l2 = add(variants.stage, new THREE.BoxGeometry(0.04, 1.05, 0.04), mats.hw, sx * 0.45, -0.52, 0); l2.rotation.z = -sx * 0.25; }
  add(variants.synth, new THREE.BoxGeometry(1.4, 0.1, 0.5), mats.finish);
  keybed(variants.synth, 1.24, 32);
  const panel = add(variants.synth, new THREE.BoxGeometry(1.4, 0.25, 0.04), mats.finish, 0, 0.16, -0.22); panel.rotation.x = -0.5;
  for (let k = 0; k < 10; k++) add(variants.synth, new THREE.CylinderGeometry(0.018, 0.02, 0.03, 12), mats.hw, -0.55 + k * 0.12, 0.2, -0.19).rotation.x = Math.PI / 2 - 0.5;
  add(variants.synth, new THREE.BoxGeometry(0.3, 0.1, 0.01), mats.glow, 0.45, 0.17, -0.2).rotation.x = -0.5;
  for (const sx of [-1, 1]) { const leg = add(variants.synth, new THREE.BoxGeometry(0.045, 1.1, 0.045), mats.hw, sx * 0.35, -0.5, 0); leg.rotation.z = sx * 0.35; }
  for (const v of Object.values(variants)) { v.traverse((o) => { if (o.material === mats.glow) o.userData.keep = true; }); mergeStatic(v); }
  return { group: rig, mats, variants };
}

/** The keytar the keys player wears (shown instead of the keyboard stand). */
function buildKeytar(mats) {
  const kt = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.32, -0.1); s.lineTo(0.2, -0.1); s.lineTo(0.3, 0.02); s.lineTo(0.62, 0.04); s.lineTo(0.62, 0.1); s.lineTo(0.25, 0.1); s.lineTo(0.15, 0.13); s.lineTo(-0.32, 0.12); s.lineTo(-0.32, -0.1);
  add(kt, new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2 }).translate(0, 0, -0.025), mats.finish);
  for (let k = 0; k < 18; k++) add(kt, new THREE.BoxGeometry(0.024, 0.11, 0.012), k % 3 === 1 ? mats.black : mats.white, -0.3 + k * 0.026, -0.03, 0.035);
  const strip = add(kt, new THREE.BoxGeometry(0.3, 0.012, 0.012), mats.glow, 0.42, 0.07, 0.035); strip.userData.keep = true;
  return mergeStatic(kt);
}

function buildMic() {
  const mats = { hw: std(0x9a9aa8, 0.25, 1), grille: std(0x6b6b74, 0.35, 0.9), body: std(0x15120e, 0.35, 0.3), glow: glowMat() };
  const variants = { classic: new THREE.Group(), vintage: new THREE.Group(), wireless: new THREE.Group() };
  const stand = (g) => {
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; const l = add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.32, 6), mats.hw, Math.sin(a) * 0.13, 0.06, Math.cos(a) * 0.13); l.rotation.set(Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2); }
    add(g, new THREE.CylinderGeometry(0.012, 0.012, 1.85, 8), mats.hw, 0, 0.93, 0);
  };
  stand(variants.classic);
  const mic = (g, len = 0.16) => {
    add(g, lathe([[0.016, -len / 2], [0.02, len / 4], [0.024, len / 2]], { segs: 16, n: 6 }), mats.body);
    add(g, bumpy(new THREE.SphereGeometry(0.034, 18, 14), 0.0012, 400, 1), mats.grille, 0, len / 2 + 0.022, 0);
    const r = add(g, new THREE.TorusGeometry(0.023, 0.004, 6, 18), mats.glow, 0, -len / 2 + 0.02, 0); r.rotation.x = Math.PI / 2; return r;
  };
  const c = group(variants.classic, 0, 1.92, -0.06); c.rotation.x = -1.2;
  const glows = [mic(c)];
  stand(variants.vintage);
  const v = group(variants.vintage, 0, 1.95, -0.05);
  add(v, new THREE.CapsuleGeometry(0.05, 0.1, 6, 18), mats.grille);
  add(v, new THREE.TorusGeometry(0.056, 0.008, 6, 24), mats.hw).rotation.x = Math.PI / 2;
  const vg = add(v, new THREE.TorusGeometry(0.055, 0.005, 6, 24), mats.glow, 0, 0.065, 0); vg.rotation.x = Math.PI / 2; glows.push(vg);
  glows.push(mic(variants.wireless, 0.18));
  return { mats, variants, glows };
}


// ---------------------------------------------------------------- band members
/**
 * One band member at their place in a scene. name: guitar | bass | drums | keys | vocals.
 * → { name, fig, g, setLook(look), setRig(part), focus }
 */
export function createMember(scene, name, { x, y, z, rotY = 0, scale = 1.05 }) {
  const f = buildFigure();
  f.g.position.set(x, y, z);
  f.g.rotation.y = rotY;
  f.g.scale.setScalar(scale);
  scene.add(f.g);
  const m = { name, fig: f, g: f.g, baseY: y, baseRot: rotY, look: null, scale };
  const ahead = (d, h = 0) => [x + Math.sin(rotY) * d, y + h, z + Math.cos(rotY) * d];
  if (name === 'guitar' || name === 'bass') {
    m.guitar = buildGuitar(name === 'bass');
    m.guitar.group.scale.setScalar(0.82);
    f.spine.add(m.guitar.group); // placed in front of the belly every frame (animateMember)
  } else if (name === 'drums') {
    m.kit = buildKit();
    // a right-handed kit: hi-hat and snare on the drummer's left, floor tom on the right; the throne is at the member
    m.kit.group.position.set(...ahead(KIT_THRONE));
    m.kit.group.rotation.y = rotY;
    m.kit.group.scale.x = -1;
    scene.add(m.kit.group);
    for (const a of f.arms) a.stick.visible = true;
  } else if (name === 'keys') {
    m.keys = buildKeys();
    m.keys.group.position.set(...ahead(0.5, 1.02));
    m.keys.group.rotation.y = rotY;
    scene.add(m.keys.group);
    m.keytar = buildKeytar(m.keys.mats);
    m.keytar.scale.setScalar(0.9);
    f.spine.add(m.keytar);
  } else if (name === 'vocals') {
    m.mic = buildMic();
    m.micStand = group(scene, ...ahead(0.34));
    m.micStand.rotation.y = rotY;
    m.micStand.scale.setScalar(scale);
    m.micStand.add(m.mic.variants.classic, m.mic.variants.vintage);
    // the wireless mic sits in the right fist, its head past the thumb
    m.mic.variants.wireless.position.set(0, 0.04, 0);
    f.arms[0].fist.add(m.mic.variants.wireless);
  }
  m.setLook = (look) => { m.look = f.look = cleanLook(look) || DEFAULT_LOOKS[name]; dress(f, m.look); };
  m.setRig = (part) => {
    const p = cleanPart(name, part || {}, m.look?.finish);
    m.rig = p;
    if (m.guitar) dressGuitar(m.guitar, p);
    if (m.kit) dressKit(m.kit, p);
    if (m.keys) {
      for (const [k, v] of Object.entries(m.keys.variants)) v.visible = k === p.shape && k !== 'keytar';
      m.keytar.visible = p.shape === 'keytar';
      m.keys.mats.finish.color.set(p.finish);
      m.keys.mats.hw.color.set(HARDWARE_COLOR[p.hardware]);
      setGlow(m.keys.mats.glow, p.glow || '#2fd3ff', p.glow ? 3 : 1.2);
    }
    if (m.mic) {
      m.mic.variants.classic.visible = p.shape === 'classic';
      m.mic.variants.vintage.visible = p.shape === 'vintage';
      m.mic.variants.wireless.visible = p.shape === 'wireless';
      m.mic.mats.body.color.set(p.finish);
      m.mic.mats.hw.color.set(HARDWARE_COLOR[p.hardware]);
      for (const g of m.mic.glows) g.visible = !!p.glow;
      setGlow(m.mic.mats.glow, p.glow || '#000000', 3);
    }
  };
  m.setLook(null);
  m.setRig(null);
  m.focus = new THREE.Vector3(x, y + 1.4, z);
  m.headWorld = new THREE.Vector3();
  f.seated = name === 'drums'; // on the throne, feet on the pedals
  return m;
}

const _t1 = V(), _t2 = V(), _n1 = V(), _n2 = V(), _f1 = V(), _f2 = V(), _pole0 = V(), _pole1 = V(), _w = V(), _dq = new THREE.Quaternion(), _sq = new THREE.Quaternion();
/** A point of an object, in a member's spine space. */
function local(m, worldPoint, out) { return m.fig.spine.worldToLocal(out.copy(worldPoint)); }
const atIn = (m, obj, x, y, z, out) => local(m, obj.localToWorld(out.set(x, y, z)), out);
/** A direction of an object, in a member's spine space. */
function dirIn(m, obj, x, y, z, out) {
  obj.getWorldQuaternion(_dq);
  m.fig.spine.getWorldQuaternion(_sq);
  out.set(x, y, z);
  if (obj.matrixWorld.determinant() < 0) out.x = -out.x; // the mirrored kit
  return out.applyQuaternion(_dq).applyQuaternion(_sq.invert()).normalize();
}
/** A direction of something hung on the spine (guitar, keytar), in the spine's space. */
const dirOn = (obj, x, y, z, out) => out.set(x, y, z).applyQuaternion(obj.quaternion).normalize();

/** Per-frame animation by the character's stage move. bp = beat phase (radians), hb = head bob amount. */
export function animateMember(m, { bp, hb, energy, od, t, pulse }) {
  const f = m.fig;
  if (!f.retarget) return; // the body is still loading
  const move = f.move || 'headbang';
  const beat = bp / (Math.PI * 2);
  const [R, L] = f.arms; // the character's right and left arms

  if (m.name === 'drums' && m.kit.group.visible) {
    // seated on the throne, thighs level, feet down on the pedals
    f.g.position.y = m.baseY;
    f.pelvis.position.set(f.pelvisRest.x, SEAT, f.pelvisRest.z - 0.04);
    for (const l of f.legs) { l.hip.rotation.set(-1.5, 0, l.side * 0.16); l.knee.rotation.set(1.5, 0, 0); l.ankle.rotation.set(0.05, 0, 0); }
    f.head.rotation.set(hb * (move === 'headbang' ? 1.1 : 0.6), Math.sin(bp * 0.25) * 0.12, 0);
    f.spine.rotation.set(0.14 + Math.abs(Math.sin(bp)) * 0.04, 0, 0);
    f.g.updateMatrixWorld(true);
    const kit = m.kit.group;
    kit.updateMatrixWorld(true);
    // the right hand crosses over to the hi-hat (on the ride now and then), the left plays the snare
    const hitR = Math.max(0, Math.sin(bp * 2)), hitL = Math.max(0, Math.sin(bp * 2 + Math.PI)) * (0.4 + 0.6 * energy);
    const ride = Math.floor(beat / 8) % 2 === 1 && energy > 0.6;
    const tipR = ride ? atIn(m, kit, 0.6, 1.43 + hitR * 0.16, -0.05, _t1) : atIn(m, kit, HIHAT[0] + 0.1, HIHAT[1] + 0.03 + hitR * 0.18, HIHAT[2] - 0.06, _t1);
    const tipL = atIn(m, kit, SNARE[0] + 0.02, SNARE[1] + 0.085 + hitL * 0.2, SNARE[2] - 0.06, _t2);
    for (const [a, tip, pole] of [[R, tipR, _pole0.set(-1, -0.4, -0.3)], [L, tipL, _pole1.set(1, -0.5, -0.4)]]) {
      // the stick points from just in front of the shoulder to its tip; the fist sits 0.27 back along it
      const along = _f1.copy(tip).sub(_w.copy(a.shoulder.position).add(_n2.set(0, -0.32, 0.22))).normalize();
      aimFist(a, _w.copy(tip).addScaledVector(along, -0.27), along, _n1.set(0, -1, 0.3), pole);
      curl(a, 1.25, 0.9);
    }
    for (const c of m.kit.cymbals) c.rotation.z = Math.sin(t * 20 + c.position.x) * 0.05 * pulse;
    retarget(f);
    return;
  }
  let y = m.baseY, rotY = m.baseRot, lean = 0.06, sway = Math.sin(bp * 0.5) * 0.05, head = hb * 0.9 * energy, spread = 0.06, crouch = 0;
  if (move === 'headbang') { head = hb * 1.4 * energy; lean = 0.1 + hb * 0.18 * energy; crouch = 0.1; }
  else if (move === 'sway') { sway = Math.sin(bp * 0.5) * 0.12 * energy; rotY += Math.sin(bp * 0.25) * 0.2; head = hb * 0.5 * energy; }
  else if (move === 'bounce') { const b = Math.max(0, Math.sin(bp)); y += b * 0.12 * energy; crouch = (1 - b) * 0.3 * energy; }
  else if (move === 'power') { spread = 0.16; lean = -0.06 + hb * 0.14 * energy; head = -0.1 + hb * 0.5 * energy; crouch = 0.14; }
  else if (move === 'spin') {
    const ph = ((beat % 16) + 16) % 16;
    if (ph > 15 && energy > 0.7) rotY += (ph - 15) * Math.PI * 2;
    y += Math.max(0, Math.sin(bp)) * 0.05 * energy;
  }
  if (od) { y += Math.max(0, Math.sin(bp)) * 0.18; head += Math.sin(bp * 2) * 0.25; }
  f.g.position.y = y;
  f.g.rotation.y = rotY;
  f.head.rotation.x = head;
  f.head.rotation.y = Math.sin(t * 0.4 + m.baseRot * 5) * 0.15;
  f.spine.rotation.x = lean;
  f.spine.rotation.z = sway;
  // legs: stance + knee bend (the hips drop with it)
  f.pelvis.position.set(f.pelvisRest.x, f.hipY - crouch * 0.09, f.pelvisRest.z);
  for (const [i, l] of f.legs.entries()) {
    l.hip.rotation.set(-crouch * 0.6, 0, (i ? 1 : -1) * spread);
    l.knee.rotation.set(crouch * 1.2, 0, 0);
    l.ankle.rotation.set(-crouch * 0.6, 0, -l.hip.rotation.z);
  }
  f.g.updateMatrixWorld(true);
  const strum = Math.sin(bp * 2) * energy;
  if (m.guitar) {
    const gt = m.guitar.group, len = m.guitar.len;
    // slung at the belly, the neck up to the left
    gt.position.set(0.03, -0.04, f.belly + 0.06);
    gt.rotation.set(-0.08, 0.12, 0.38 + (od ? Math.sin(bp) * 0.1 : 0));
    gt.updateMatrix();
    // fretting hand: under the neck, palm up to it, fingers over the fretboard, sliding along it
    const slide = (m.guitar.bass ? 0.18 : 0.22) + 0.14 * (0.5 + 0.5 * Math.sin(bp * 0.25));
    _t2.set(0.17 + len * slide, -0.048, 0.012).applyMatrix4(gt.matrix);
    aimHand(L, _t2, dirOn(gt, 0, 1, 0.15, _n2), dirOn(gt, 0.1, 0.25, 1, _f2), _pole1.set(0.6, -1, -0.5));
    curl(L, 0.95 + 0.15 * Math.sin(bp * 2), 0.35);
    // picking hand: over the strings by the pickups, palm to the strings, strumming down and up
    _t1.set(m.guitar.bass ? 0.0 : -0.04, 0.02 + strum * 0.035, 0.075).applyMatrix4(gt.matrix);
    aimHand(R, _t1, dirOn(gt, 0, 0.15, -1, _n1), dirOn(gt, 0.35, -1, 0, _f1), _pole0.set(-1, -0.3, -0.6));
    curl(R, 1.05, 0.8);
  } else if (m.name === 'keys' && (m.keytar.visible || m.keys.group.visible)) {
    if (m.keytar.visible) {
      const kt = m.keytar;
      kt.position.set(0.0, 0.04, f.belly + 0.07);
      kt.rotation.set(-0.1, 0.1, 0.3);
      kt.updateMatrix();
      // right hand over the keys (they face out), left hand under the neck
      _t1.set(-0.12 + Math.sin(bp) * 0.07, -0.01 + Math.max(0, Math.sin(bp * 2)) * 0.01, 0.075).applyMatrix4(kt.matrix);
      aimHand(R, _t1, dirOn(kt, 0, 0, -1, _n1), dirOn(kt, 0.2, -1, 0, _f1), _pole0.set(-1, -0.4, -0.6));
      _t2.set(0.44, 0.0, 0.005).applyMatrix4(kt.matrix);
      aimHand(L, _t2, dirOn(kt, 0, 1, 0.1, _n2), dirOn(kt, 0, 0.2, 1, _f2), _pole1.set(0.6, -1, -0.4));
      curl(R, 0.5, 0.3); curl(L, 0.9, 0.3);
    } else {
      // both hands on the keys, palms down, fingers forward; the right hand runs the melody, the left the chords
      const kb = m.keys.group; kb.updateMatrixWorld(true);
      const pr = Math.max(0, Math.sin(bp * 2)) * 0.015, pl = Math.max(0, Math.sin(bp * 2 + 1.5)) * 0.015;
      atIn(m, kb, -0.2 + Math.sin(bp * 0.5) * 0.12, 0.115 - pr, -0.02, _t1);
      atIn(m, kb, 0.24 + Math.sin(bp * 0.25) * 0.08, 0.115 - pl, -0.02, _t2);
      dirIn(m, kb, 0, -1, 0, _n1);
      dirIn(m, kb, 0, -0.15, 1, _f1);
      aimHand(R, _t1, _n1, _f1, _pole0.set(-1, -0.6, -0.2));
      aimHand(L, _t2, _n1, _f1, _pole1.set(1, -0.6, -0.2));
      curl(R, 0.45 + pr * 12, 0.2); curl(L, 0.45 + pl * 12, 0.2);
    }
  } else if (m.name === 'vocals') {
    const shape = m.rig?.shape || 'classic';
    // the stand's height follows the singer: the mic at the mouth
    const mouthY = f.mouthY * f.body.scale.y + 0.01;
    m.micStand.scale.setScalar(m.scale * mouthY / (shape === 'vintage' ? 1.95 : 1.92));
    m.micStand.visible = shape !== 'wireless';
    f.head.updateMatrixWorld(true);
    const mouth = local(m, f.head.localToWorld(_w.copy(f.mouth)), _t2);
    if (shape === 'wireless') {
      // the mic up to the mouth, its head just in front of the lips
      const p = _t1.copy(mouth).add(_n2.set(-0.02, -0.11, 0.1));
      aimFist(R, p, _f1.copy(mouth).add(_n1.set(0, 0, 0.04)).sub(p), _n1.set(1, 0, 0.3), _pole0.set(-1, -1, -0.2));
    } else {
      // a hand on the mic, below and behind its head
      const st = m.micStand; st.updateMatrixWorld(true);
      if (shape === 'vintage') {
        atIn(m, st, 0, 1.83, -0.045, _t1);
        aimFist(R, _t1, dirIn(m, st, 0, 1, 0, _f1), dirIn(m, st, 0.3, 0, 1, _n1), _pole0.set(-1, -1, 0));
      } else {
        const ax = dirIn(m, st, 0, Math.cos(-1.2), Math.sin(-1.2), _f1); // the mic points at the singer
        atIn(m, st, 0, 1.92, -0.06, _t1).addScaledVector(ax, -0.075).addScaledVector(dirIn(m, st, 0, 1, 0, _n2), -0.035);
        aimFist(R, _t1, ax, _n1.set(0, 1, 0), _pole0.set(-1, -1, 0));
      }
    }
    curl(R, 1.25, 0.9);
    // the other hand: out to the crowd, up on the big notes
    if (od) _t2.set(0.36, 0.78 + Math.sin(bp * 2) * 0.05, 0.22);
    else _t2.set(0.3 + Math.sin(bp * 0.5) * 0.05, 0.18 + Math.max(0, Math.sin(bp * 0.5)) * 0.22 * energy, 0.24);
    aimHand(L, _t2, _n2.set(-0.3, od ? 0.2 : -0.2, 1), _f2.set(0.2, 1, -0.1), _pole1.set(1, -1, -0.3));
    curl(L, od ? 0.2 : 0.35, 0.1);
  } else {
    for (const a of f.arms) relaxArm(a, t);
  }
  if (f.extra.cape.visible) f.cape.rotation.x = 0.1 + Math.abs(Math.sin(bp * 0.5)) * 0.14 * energy;
  if (f.extra.wings.visible) for (const [i, w] of f.wings.entries()) w.rotation.y = (i ? -1 : 1) * (0.25 + Math.sin(t * 2) * 0.12);
  if (f.hats.halo.visible) f.halo.rotation.z = t * 1.5;
  retarget(f);
}

/** A relaxed idle pose for the character creator's turntable (no instrument motion). */
export function idleMember(m, t) {
  animateMember(m, { bp: t * 3.2, hb: Math.max(0, Math.sin(t * 3.2)) * 0.12, energy: 0.35, od: false, t, pulse: 0 });
}
