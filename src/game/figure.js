// Band members (v2): sculpted, jointed people built from lathe-profiled body parts (torso, limbs with muscle
// curves), hands with fingers, a modelled face (eyes with irises and lids, brows, nose, lips, ears), strand hair and
// layered clothing. Arms are posed with a two-bone IK solver so hands sit on the frets, keys, sticks and mic.
// Every wardrobe piece (profile/looks.js) and instrument shape (profile/rig.js) is built once and switched on, and
// static pieces are merged per material, so flipping through looks costs nothing and draw calls stay low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cleanLook } from '../profile/looks.js';
import { cleanPart, HARDWARE_COLOR } from '../profile/rig.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const cloth = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.82, metalness: 0, sheen: 1, sheenRoughness: 0.65, sheenColor: new THREE.Color(0.35, 0.33, 0.3) });
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

/** Pushes vertices along their normals by a cheap 3D wave noise: hair texture, curls, fabric creases. */
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

/** A tube along points (hair strands, locs, drawstrings). */
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
  // drop empty groups left behind
  const empty = [];
  root.traverse((o) => { if (o !== root && o.isGroup && !o.children.length) empty.push(o); });
  for (const o of empty) o.parent.remove(o);
  return root;
}

// out of the box: dark stage clothes, so a player's own character stands out
export const DEFAULT_LOOKS = {
  guitar: cleanLook({ skin: '#6b4128', hair: 'long', hairColor: '#0c0c12', top: '#3a0d1c', pants: '#15120e', finish: '#d81b3a', topStyle: 'tee', facial: 'stubble', move: 'headbang' }),
  bass: cleanLook({ skin: '#c68a5f', hair: 'ponytail', hairColor: '#3b2414', top: '#0d1c3a', pants: '#15120e', finish: '#1b5ed8', topStyle: 'hoodie', accent: '#15120e', move: 'sway' }),
  drums: cleanLook({ skin: '#9a6440', hair: 'shaved', hairColor: '#0c0c12', top: '#2a1a08', pants: '#15120e', finish: '#b86a1b', topStyle: 'tank', facial: 'beard' }),
  keys: cleanLook({ skin: '#e0ac85', hair: 'bun', hairColor: '#8a5a2b', top: '#1c0d3a', pants: '#15120e', finish: '#15120e', topStyle: 'vest', accent: '#3a0d1c', eyes: 'round', move: 'sway' }),
  vocals: cleanLook({ skin: '#f3d3b8', hair: 'spiky', hairColor: '#0c0c12', top: '#151515', pants: '#15120e', finish: '#5a5a5a', topStyle: 'jacket', accent: '#7a0f22', move: 'power' }),
};

// ---------------------------------------------------------------- proportions
const UPPER = 0.29, LOWER = 0.33; // shoulder → elbow, elbow → palm
const HIP_Y = 1.0;                // hip joint height (standing)
const SHOULDER = V(0.205, 0.47, 0); // in the spine's space

// ---------------------------------------------------------------- body parts
function headGeometry() {
  const geo = new THREE.SphereGeometry(0.118, 40, 30);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ny = y / 0.118;
    if (ny < 0) x *= 1 - 0.3 * Math.pow(-ny, 1.4);            // jaw narrows to the chin
    if (ny < -0.25 && z > 0) z += 0.016 * (-ny - 0.25);         // chin forward
    if (z < 0 && ny > -0.3) z *= 1.1;                           // back of the skull
    if (z > 0 && Math.abs(ny) < 0.3) x *= 1.04;                 // cheekbones
    if (z > 0.06 && ny > -0.45 && ny < 0.55) z = 0.06 + (z - 0.06) * 0.72; // a flatter face
    p.setXYZ(i, x * 0.9, y * 1.04, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function handGeometry(side) {
  const parts = [];
  const palm = new THREE.SphereGeometry(0.044, 14, 10); palm.scale(0.92, 1.15, 0.5); palm.translate(0, -0.045, 0);
  parts.push(palm);
  for (let k = 0; k < 4; k++) {
    const x = -0.027 + k * 0.018, len = [0.026, 0.03, 0.028, 0.022][k];
    const a = new THREE.CapsuleGeometry(0.0095, len, 3, 6); a.rotateX(0.35); a.translate(x, -0.1 - len * 0.3, 0.006);
    const b = new THREE.CapsuleGeometry(0.0085, len * 0.85, 3, 6); b.rotateX(1.0); b.translate(x, -0.128 - len * 0.6, 0.026);
    parts.push(a, b);
  }
  const th = new THREE.CapsuleGeometry(0.011, 0.034, 3, 6); th.rotateZ(side * 0.9); th.rotateX(0.5); th.translate(side * 0.042, -0.065, 0.02);
  parts.push(th);
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

function buildFigure() {
  const mats = {
    skin: std(0x9a6440, 0.55), lip: std(0x6b3a30, 0.5), cloth: cloth(0x3a0d1c), accent: cloth(0x15120e), pants: cloth(0x15120e),
    hair: std(0x0c0c12, 0.72, 0.05), brow: std(0x0c0c12, 0.8), shoes: std(0x15120e, 0.45, 0.1), sole: std(0xe8e1cf, 0.7), glow: glowMat(),
    metal: std(0xc9a13a, 0.25, 1), lens: std(0x050507, 0.06, 0.9), white: std(0xf2efe8, 0.3), iris: std(0x3a2414, 0.35), pupil: new THREE.MeshBasicMaterial({ color: 0x050403 }),
    leather: std(0x1a1310, 0.55, 0.1), lapel: std(0x0a0908, 0.3, 0.2), visor: glowMat(), halo: glowMat(), horn: std(0x1a1310, 0.55), hornGlow: glowMat(),
    ice: new THREE.MeshStandardMaterial({ color: 0x9fe8ff, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.8, emissive: 0x2a7fa8, emissiveIntensity: 1.1 }),
  };
  const g = new THREE.Group();
  const body = group(g);
  const pelvis = group(body, 0, HIP_Y, 0);
  add(pelvis, lathe([[0.001, -0.17], [0.11, -0.155], [0.17, -0.09], [0.182, 0.0], [0.166, 0.08], [0.15, 0.12]], { sz: 0.7 }), mats.pants);
  // belt + buckle
  const belt = add(pelvis, new THREE.TorusGeometry(0.163, 0.018, 6, 28), mats.leather, 0, 0.09, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.7, 1);
  const buckle = add(pelvis, new THREE.BoxGeometry(0.045, 0.032, 0.01), mats.metal, 0, 0.09, 0.117);
  buckle.userData.keep = true;

  // legs: hip → knee → ankle
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = group(pelvis, sx * 0.095, -0.06, 0);
    add(hip, lathe([[0.001, 0.05], [0.08, 0.03], [0.09, -0.06], [0.08, -0.22], [0.062, -0.4], [0.055, -0.45]], { sz: 0.92 }), mats.pants);
    const knee = group(hip, 0, -0.45, 0);
    add(knee, lathe([[0.055, 0.01], [0.057, -0.08], [0.06, -0.16], [0.048, -0.3], [0.04, -0.41], [0.04, -0.44]], { sz: 0.92 }), mats.pants);
    const ankle = group(knee, 0, -0.44, 0);
    const shoe = new THREE.SphereGeometry(0.058, 18, 12); shoe.scale(0.95, 0.62, 2.0);
    add(ankle, shoe, mats.shoes, 0, -0.035, 0.05);
    add(ankle, lathe([[0.042, 0.02], [0.045, -0.02]], { segs: 14, n: 4 }), mats.shoes, 0, -0.01, 0);
    const sole = add(ankle, new THREE.BoxGeometry(0.105, 0.022, 0.25), mats.sole, 0, -0.072, 0.055);
    const soleGlow = add(ankle, new THREE.BoxGeometry(0.108, 0.006, 0.253), mats.glow, 0, -0.068, 0.055);
    sole.userData.keep = soleGlow.userData.keep = true;
    legs.push({ hip, knee, ankle, sole: soleGlow });
  }

  // spine: torso, neck, head, arms
  const spine = group(pelvis, 0, 0.1, 0);
  const torsoGeo = lathe([[0.15, -0.02], [0.142, 0.08], [0.148, 0.18], [0.17, 0.3], [0.182, 0.39], [0.176, 0.46], [0.14, 0.53], [0.07, 0.57], [0.001, 0.585]], { sx: 1.1, sz: 0.62, n: 28 });
  const torso = add(spine, torsoGeo, mats.cloth);
  torso.userData.keep = true;
  const neck = group(spine, 0, 0.55, 0);
  add(neck, lathe([[0.058, 0], [0.051, 0.06], [0.053, 0.12]], { segs: 16, n: 6 }), mats.skin);

  // head
  const head = group(neck, 0, 0.12, 0.005);
  const face = group(head, 0, 0.09, 0);
  add(face, headGeometry(), mats.skin);
  for (const sx of [-1, 1]) {
    const ear = add(face, new THREE.SphereGeometry(0.028, 12, 10), mats.skin, sx * 0.106, 0.0, -0.01); ear.scale.set(0.35, 1, 0.72);
    add(face, new THREE.SphereGeometry(0.0165, 14, 10), mats.white, sx * 0.039, 0.018, 0.087);
    const iris = add(face, new THREE.CircleGeometry(0.0095, 16), mats.iris, sx * 0.039, 0.018, 0.1033);
    iris.userData.keep = true;
    const pupil = add(face, new THREE.CircleGeometry(0.0045, 12), mats.pupil, sx * 0.039, 0.018, 0.1036);
    pupil.userData.keep = true;
    const lid = add(face, new THREE.SphereGeometry(0.0178, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.38), mats.skin, sx * 0.039, 0.019, 0.087);
    lid.rotation.x = 0.35;
    const brow = add(face, new THREE.CapsuleGeometry(0.0055, 0.034, 3, 6), mats.brow, sx * 0.04, 0.045, 0.097);
    brow.rotation.z = Math.PI / 2 + sx * 0.14;
  }
  const nose = add(face, new THREE.ConeGeometry(0.017, 0.052, 10), mats.skin, 0, -0.008, 0.103); nose.rotation.x = -Math.PI / 2 + 0.55;
  add(face, new THREE.SphereGeometry(0.0145, 12, 10), mats.skin, 0, -0.026, 0.113);
  for (const [y, s] of [[-0.052, 1], [-0.061, 0.85]]) { const lip = add(face, new THREE.SphereGeometry(0.0115, 12, 8), mats.lip, 0, y, 0.098); lip.scale.set(2.1 * s, 0.5, 0.75); }
  const eyes = { iris: [], pupil: [] };
  face.traverse((o) => { if (o.material === mats.iris) eyes.iris.push(o); if (o.material === mats.pupil) eyes.pupil.push(o); });
  mergeStatic(face);

  // hair (centred on the skull)
  const H = (k) => (hair[k] = group(face));
  const hair = {};
  const capGeo = (r, frac, amp = 0.004, y = 0.012) => { const c = new THREE.SphereGeometry(r, 28, 18, 0, Math.PI * 2, 0, Math.PI * frac); c.scale(0.93, 1, 1.02); bumpy(c, amp, 90, r * 100); c.translate(0, y, -0.008); return c; };
  add(H('short'), capGeo(0.128, 0.5), mats.hair);
  const fringe = new THREE.SphereGeometry(0.13, 20, 8, -0.9, 1.8, Math.PI * 0.3, Math.PI * 0.16); bumpy(fringe, 0.006, 70, 3);
  add(hair.short, fringe, mats.hair, 0, 0.01, 0.0);
  add(H('shaved'), capGeo(0.1215, 0.46, 0.0012, 0.006), mats.hair);
  add(H('mohawk'), capGeo(0.1205, 0.45, 0.001, 0.005), mats.hair);
  for (let k = 0; k < 9; k++) {
    const a = -0.9 + k * 0.28;
    const fin = add(hair.mohawk, new THREE.ConeGeometry(0.03, 0.15 - Math.abs(k - 4) * 0.008, 4), mats.hair, 0, 0.11 * Math.cos(a) + 0.02, 0.12 * Math.sin(a));
    fin.rotation.x = a; fin.scale.set(0.45, 1, 1.4);
  }
  add(H('long'), capGeo(0.13, 0.55), mats.hair);
  for (let k = 0; k < 18; k++) {
    const a = Math.PI * 0.18 + (k / 17) * Math.PI * 1.64; // around the back, not over the face
    const sx = Math.sin(a), sz = Math.cos(a);
    if (sz > 0.55) continue;
    add(hair.long, tube([V(sx * 0.12, 0.04, sz * 0.12), V(sx * 0.14, -0.06, sz * 0.13), V(sx * 0.15, -0.18, sz * 0.12 - 0.02), V(sx * 0.15, -0.3, sz * 0.1 - 0.04)], 0.024, 10, 6), mats.hair);
  }
  add(H('bun'), capGeo(0.128, 0.52), mats.hair);
  add(hair.bun, bumpy(new THREE.SphereGeometry(0.058, 16, 12), 0.004, 120, 2), mats.hair, 0, 0.11, -0.085);
  add(H('spiky'), capGeo(0.125, 0.5), mats.hair);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, ring = k % 2 ? 0.55 : 0.9;
    const s = add(hair.spiky, new THREE.ConeGeometry(0.025, 0.1 + (k % 3) * 0.02, 5), mats.hair, Math.sin(a) * 0.07 * ring, 0.1 + (1 - ring) * 0.03, Math.cos(a) * 0.07 * ring - 0.01);
    s.quaternion.setFromUnitVectors(V(0, 1, 0), V(s.position.x, s.position.y + 0.04, s.position.z + 0.01).normalize());
  }
  // big and round, but its lower edge stays above the brows
  const afro = new THREE.SphereGeometry(0.2, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.47); afro.scale(1.05, 0.95, 1); bumpy(afro, 0.012, 55, 5);
  add(H('afro'), afro, mats.hair, 0, 0.065, -0.045);
  add(H('ponytail'), capGeo(0.129, 0.53), mats.hair);
  add(hair.ponytail, tube([V(0, 0.06, -0.12), V(0, 0.0, -0.17), V(0, -0.12, -0.19), V(0, -0.28, -0.16)], 0.03, 14, 8), mats.hair);
  add(hair.ponytail, new THREE.TorusGeometry(0.03, 0.009, 6, 12), mats.leather, 0, 0.045, -0.135).rotation.x = 1.2;
  add(H('locs'), capGeo(0.13, 0.53), mats.hair);
  for (let k = 0; k < 16; k++) {
    const a = Math.PI * 0.25 + (k / 15) * Math.PI * 1.5, sx = Math.sin(a), sz = Math.cos(a);
    add(hair.locs, tube([V(sx * 0.12, 0.02, sz * 0.12), V(sx * 0.14, -0.1, sz * 0.13), V(sx * 0.13, -0.25 - (k % 3) * 0.03, sz * 0.12 - 0.03)], 0.011, 8, 5), mats.hair);
  }
  H('bald');
  for (const h of Object.values(hair)) mergeStatic(h);

  // facial hair
  const facial = { none: group(face), stubble: group(face), beard: group(face), goatee: group(face), moustache: group(face) };
  const jaw = (r, t0, tl, amp) => { const s = new THREE.SphereGeometry(r, 26, 12, Math.PI * 0.05, Math.PI * 0.9, Math.PI * t0, Math.PI * tl); s.scale(0.9, 1.04, 1); bumpy(s, amp, 120, 9); return s; };
  const stubble = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 1, transparent: true, opacity: 0.55 });
  mats.stubble = stubble;
  add(facial.stubble, jaw(0.1195, 0.58, 0.3, 0.0008), stubble);
  add(facial.beard, jaw(0.124, 0.56, 0.36, 0.004), mats.hair);
  add(facial.beard, bumpy(new THREE.SphereGeometry(0.05, 14, 10), 0.006, 100, 4), mats.hair, 0, -0.105, 0.065).scale.set(1.1, 1.2, 0.8);
  add(facial.goatee, bumpy(new THREE.SphereGeometry(0.025, 12, 8), 0.003, 120, 6), mats.hair, 0, -0.088, 0.088).scale.set(1, 1.6, 0.8);
  add(facial.moustache, tube([V(-0.04, -0.052, 0.088), V(-0.02, -0.04, 0.104), V(0.02, -0.04, 0.104), V(0.04, -0.052, 0.088)], 0.006, 10, 6), mats.hair);
  add(facial.goatee, tube([V(-0.03, -0.05, 0.096), V(0, -0.041, 0.106), V(0.03, -0.05, 0.096)], 0.005, 8, 5), mats.hair);
  for (const f of Object.values(facial)) mergeStatic(f);

  // eyewear
  const eyewear = { none: group(face), shades: group(face), round: group(face), visor: group(face), goggles: group(face) };
  for (const sx of [-1, 1]) { const l = add(eyewear.shades, new THREE.SphereGeometry(0.03, 16, 10), mats.lens, sx * 0.04, 0.018, 0.104); l.scale.set(1.25, 0.8, 0.25); }
  add(eyewear.shades, new THREE.BoxGeometry(0.17, 0.008, 0.008), mats.metal, 0, 0.034, 0.108);
  for (const sx of [-1, 1]) {
    add(eyewear.round, new THREE.TorusGeometry(0.023, 0.003, 6, 22), mats.metal, sx * 0.04, 0.018, 0.108);
    add(eyewear.round, new THREE.BoxGeometry(0.003, 0.003, 0.1), mats.metal, sx * 0.1, 0.022, 0.06);
  }
  add(eyewear.round, new THREE.TorusGeometry(0.012, 0.0025, 4, 10, Math.PI), mats.metal, 0, 0.02, 0.11);
  const visorGeo = new THREE.CylinderGeometry(0.122, 0.122, 0.04, 32, 1, true, -1.15, 2.3);
  const visor = add(eyewear.visor, visorGeo, mats.visor, 0, 0.018, 0.0); visor.rotation.y = Math.PI; visor.scale.set(0.95, 1, 1.05);
  mats.visor.side = THREE.DoubleSide;
  for (const sx of [-1, 1]) { const gg = add(eyewear.goggles, new THREE.CylinderGeometry(0.03, 0.033, 0.03, 18), mats.lens, sx * 0.042, 0.02, 0.1); gg.rotation.x = Math.PI / 2; add(eyewear.goggles, new THREE.TorusGeometry(0.031, 0.006, 6, 18), mats.leather, sx * 0.042, 0.02, 0.115); }
  const strap = add(eyewear.goggles, new THREE.TorusGeometry(0.122, 0.009, 6, 30), mats.leather, 0, 0.024, -0.005); strap.rotation.x = Math.PI / 2; strap.scale.set(0.93, 1.05, 1);
  for (const e of Object.values(eyewear)) mergeStatic(e);

  // headwear
  const hats = { none: group(face), beanie: group(face), cap: group(face), cowboy: group(face), bandana: group(face), crown: group(face), horns: group(face), halo: group(face) };
  const hatCap = (r, frac) => { const c = new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI * frac); c.scale(0.95, 1, 1.03); return c; };
  add(hats.beanie, bumpy(hatCap(0.138, 0.5), 0.002, 160, 2), mats.accent, 0, 0.02, -0.005);
  add(hats.beanie, new THREE.TorusGeometry(0.134, 0.017, 10, 32), mats.accent, 0, 0.03, -0.005).rotation.x = Math.PI / 2;
  add(hats.beanie, bumpy(new THREE.SphereGeometry(0.03, 12, 10), 0.006, 140, 3), mats.accent, 0, 0.165, -0.01);
  add(hats.cap, hatCap(0.134, 0.48), mats.accent, 0, 0.022, -0.005);
  const brim = add(hats.cap, new THREE.CylinderGeometry(0.085, 0.085, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), mats.accent, 0, 0.04, 0.1); brim.rotation.x = 0.16;
  add(hats.cap, new THREE.SphereGeometry(0.012, 8, 6), mats.accent, 0, 0.155, -0.005);
  add(hats.cowboy, lathe([[0.001, 0.12], [0.07, 0.115], [0.095, 0.08], [0.1, 0.0]], { segs: 28, sz: 1.15 }), mats.leather, 0, 0.06, 0);
  const brimG = lathe([[0.1, 0.0], [0.17, 0.005], [0.235, 0.03]], { segs: 32, sz: 1.2 });
  add(hats.cowboy, brimG, mats.leather, 0, 0.06, 0);
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
    // taper the horn towards the tip
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

  // arms: shoulder → elbow → wrist, with sleeves
  const arms = [];
  const shortSleeve = lathe([[0.068, 0.03], [0.07, -0.04], [0.066, -0.12], [0.064, -0.135]], { segs: 18, n: 8 });
  const longUpper = lathe([[0.068, 0.03], [0.066, -0.1], [0.058, -0.28], [0.055, -0.3]], { segs: 18, n: 8 });
  const longFore = lathe([[0.056, 0.02], [0.054, -0.12], [0.05, -0.2], [0.056, -0.235], [0.054, -0.25]], { segs: 18, n: 8 });
  for (const sx of [-1, 1]) {
    const shoulder = group(spine, sx * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    const upperSkin = add(shoulder, lathe([[0.04, 0.035], [0.062, 0.0], [0.058, -0.07], [0.05, -0.16], [0.042, -0.27], [0.04, -0.3]], { segs: 16, sz: 0.95 }), mats.skin);
    const sShort = add(shoulder, shortSleeve, mats.cloth);
    const sLong = add(shoulder, longUpper, mats.cloth);
    const elbow = group(shoulder, 0, -UPPER, 0);
    add(elbow, lathe([[0.04, 0.01], [0.045, -0.06], [0.04, -0.15], [0.03, -0.24], [0.027, -0.26]], { segs: 16, sz: 0.9 }), mats.skin);
    const sFore = add(elbow, longFore, mats.cloth);
    const cuffGlow = add(elbow, new THREE.TorusGeometry(0.055, 0.005, 6, 18), mats.glow, 0, -0.235, 0); cuffGlow.rotation.x = Math.PI / 2;
    const wrist = group(elbow, 0, -0.26, 0);
    add(wrist, handGeometry(sx), mats.skin);
    const stick = add(wrist, new THREE.CylinderGeometry(0.007, 0.009, 0.4, 8), mats.white, 0, -0.085, 0.13);
    stick.rotation.x = Math.PI / 2 - 0.2;
    stick.visible = false;
    arms.push({ shoulder, elbow, wrist, upperSkin, sShort, sLong, sFore, cuffGlow, stick, side: sx });
  }

  // clothing layers on the torso
  const top = { tee: group(spine), tank: group(spine), jacket: group(spine), hoodie: group(spine), coat: group(spine), vest: group(spine) };
  const shellPts = [[0.165, -0.04], [0.158, 0.08], [0.163, 0.18], [0.186, 0.3], [0.197, 0.39], [0.19, 0.46], [0.152, 0.53], [0.09, 0.565]];
  const openShell = (pts, gap, sx = 1.1, sz = 0.66) => { const s = lathe(pts, { sx, sz, phiStart: gap, phiLength: Math.PI * 2 - gap * 2, n: 24, segs: 28 }); return s; };
  const jacketMat = mats.cloth;
  add(top.jacket, openShell(shellPts, 0.38), jacketMat);
  for (const sx of [-1, 1]) {
    const lap = add(top.jacket, new THREE.BoxGeometry(0.05, 0.26, 0.012), mats.lapel, sx * 0.095, 0.4, 0.122);
    lap.rotation.set(-0.15, 0, -sx * 0.32);
    add(top.jacket, new THREE.SphereGeometry(0.006, 6, 4), mats.metal, sx * 0.07, 0.25 - (sx + 1) * 0.04, 0.122);
  }
  add(top.jacket, new THREE.TorusGeometry(0.075, 0.018, 6, 20, Math.PI * 1.3), jacketMat, 0, 0.555, -0.01).rotation.set(Math.PI / 2, 0, Math.PI * 0.85);
  mats.cloth.side = THREE.DoubleSide;
  add(top.hoodie, lathe(shellPts, { sx: 1.1, sz: 0.66, n: 24, segs: 28 }), mats.cloth);
  const hood = new THREE.SphereGeometry(0.15, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.62); hood.scale(1, 0.75, 0.95); bumpy(hood, 0.004, 40, 4);
  add(top.hoodie, hood, mats.cloth, 0, 0.53, -0.1).rotation.x = -1.2;
  add(top.hoodie, new THREE.BoxGeometry(0.2, 0.1, 0.02), mats.cloth, 0, 0.1, 0.118).rotation.x = -0.05;
  for (const sx of [-1, 1]) add(top.hoodie, tube([V(sx * 0.035, 0.53, 0.09), V(sx * 0.04, 0.46, 0.12), V(sx * 0.045, 0.38, 0.122)], 0.004, 6, 4), mats.accent);
  add(top.coat, openShell(shellPts, 0.3), mats.cloth);
  add(top.coat, openShell([[0.168, 0.0], [0.19, -0.2], [0.23, -0.45], [0.26, -0.68]], 0.42, 1.08, 0.75), mats.cloth);
  for (const sx of [-1, 1]) { const lap = add(top.coat, new THREE.BoxGeometry(0.07, 0.28, 0.012), mats.accent, sx * 0.08, 0.4, 0.122); lap.rotation.set(-0.1, 0, sx * 0.3); }
  add(top.vest, openShell([[0.162, -0.02], [0.156, 0.1], [0.172, 0.25], [0.186, 0.37], [0.165, 0.46], [0.11, 0.52]], 0.1, 1.11, 0.665), mats.accent);
  for (let k = 0; k < 4; k++) add(top.vest, new THREE.SphereGeometry(0.008, 8, 6), mats.metal, 0.012, 0.06 + k * 0.08, 0.112 - k * 0.002);
  // tank top: straps over bare shoulders
  for (const sx of [-1, 1]) add(top.tank, new THREE.TorusGeometry(0.06, 0.012, 6, 14, Math.PI), mats.cloth, sx * 0.12, 0.5, 0).rotation.y = Math.PI / 2;
  for (const t of Object.values(top)) mergeStatic(t);
  // LED trim down the front
  const trims = [];
  for (const sx of [-1, 1]) { const t = add(spine, new THREE.BoxGeometry(0.006, 0.42, 0.006), mats.glow, sx * 0.05, 0.25, 0.122); t.rotation.x = -0.08; trims.push(t); }

  // accessories
  const extra = { none: group(spine), chain: group(spine), scarf: group(spine), spikes: group(spine), cape: group(spine), wings: group(spine) };
  const chainCurve = []; for (let k = 0; k <= 16; k++) { const a = Math.PI * 0.15 + (k / 16) * Math.PI * 0.7; chainCurve.push(V(Math.cos(a) * 0.075, 0.56 - Math.sin(a) * 0.17, 0.08 + Math.sin(a) * 0.04)); }
  add(extra.chain, tube(chainCurve, 0.004, 32, 5), mats.metal);
  add(extra.chain, new THREE.OctahedronGeometry(0.018), mats.metal, 0, 0.38, 0.125);
  const scarf = add(extra.scarf, bumpy(new THREE.TorusGeometry(0.075, 0.03, 10, 24), 0.004, 60, 2), mats.accent, 0, 0.55, 0.01); scarf.rotation.x = Math.PI / 2;
  add(extra.scarf, tube([V(-0.04, 0.53, 0.09), V(-0.05, 0.42, 0.13), V(-0.045, 0.28, 0.13)], 0.022, 8, 6), mats.accent);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const pad = add(extra.spikes, new THREE.ConeGeometry(0.018, 0.08, 6), mats.metal, sx * (0.18 + k * 0.03), 0.53 - k * 0.012, -0.03 + k * 0.035);
    pad.rotation.z = -sx * 0.8;
  }
  for (const sx of [-1, 1]) add(extra.spikes, new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.leather, sx * 0.19, 0.48, 0);
  const capeGeo = new THREE.PlaneGeometry(0.46, 1.05, 4, 10).translate(0, -0.52, 0);
  const cp = capeGeo.attributes.position; for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); cp.setZ(i, -Math.cos(x * 9) * 0.015 - (x * x) * 0.4 + y * 0.05); }
  capeGeo.computeVertexNormals();
  const capeMat = mats.accent.clone(); capeMat.side = THREE.DoubleSide;
  const cape = add(extra.cape, capeGeo, capeMat, 0, 0.53, -0.13); cape.userData.keep = true;
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = group(extra.wings, sx * 0.08, 0.42, -0.12);
    for (let k = 0; k < 6; k++) {
      const shard = add(w, new THREE.OctahedronGeometry(0.06, 0), mats.ice, sx * (0.12 + k * 0.085), 0.08 + k * 0.05 - k * k * 0.006, -0.02 - k * 0.015);
      shard.scale.set(0.5, 3.4 - k * 0.32, 0.25); shard.rotation.z = -sx * (0.7 + k * 0.17);
    }
    wings.push(w);
  }
  for (const [k, e] of Object.entries(extra)) if (k !== 'wings' && k !== 'cape') mergeStatic(e);

  return { g, body, pelvis, spine, torso, neck, head, face, arms, legs, mats, hair, facial, eyewear, hats, top, extra, trims, cape, wings, halo, eyes };
}

function show(groups, key) { for (const [k, m] of Object.entries(groups)) m.visible = k === key; }

/** Dress a figure in a look. */
function dress(f, look) {
  const L = look;
  f.mats.skin.color.set(L.skin);
  f.mats.lip.color.set(L.skin).multiplyScalar(0.72).lerp(new THREE.Color(0.55, 0.2, 0.2), 0.25);
  f.mats.cloth.color.set(L.top);
  f.mats.accent.color.set(L.accent);
  f.cape.material.color.set(L.accent);
  f.mats.pants.color.set(L.pants);
  f.mats.hair.color.set(L.hairColor);
  f.mats.brow.color.set(L.hairColor).multiplyScalar(0.8);
  f.mats.stubble.color.set(L.hairColor);
  f.mats.shoes.color.set(L.shoes);
  setGlow(f.mats.glow, L.glow || '#000000');
  setGlow(f.mats.visor, L.glow || '#2fd3ff', 2.2);
  setGlow(f.mats.halo, '#ffe14d', 2.8);
  setGlow(f.mats.hornGlow, '#ff6a1a', 3.2);
  show(f.hair, L.hair);
  show(f.facial, L.facial);
  show(f.eyewear, L.eyes);
  show(f.hats, L.head);
  show(f.top, L.topStyle);
  show(f.extra, L.extra);
  // a hat sits on the head: tall hair under it is shown as short hair
  if (['beanie', 'cap', 'cowboy', 'bandana'].includes(L.head) && ['mohawk', 'spiky', 'afro', 'bun'].includes(L.hair)) {
    f.hair[L.hair].visible = false;
    f.hair.short.visible = true;
  }
  // the shirt under open clothes is the accent colour
  f.torso.material = ['jacket', 'coat'].includes(L.topStyle) ? f.mats.accent : f.mats.cloth;
  const long = ['jacket', 'hoodie', 'coat'].includes(L.topStyle);
  for (const a of f.arms) {
    a.sShort.visible = ['tee', 'vest'].includes(L.topStyle);
    a.sLong.visible = a.sFore.visible = long;
    a.cuffGlow.visible = !!L.glow && long;
  }
  for (const t of f.trims) t.visible = !!L.glow;
  for (const l of f.legs) l.sole.visible = !!L.glow;
  const bx = { slim: 0.9, regular: 1, broad: 1.14 }[L.build] || 1;
  f.spine.scale.set(bx, 1, 0.96 + bx * 0.04);
  f.pelvis.scale.set(0.95 + bx * 0.05, 1, 1);
  f.body.scale.setScalar({ short: 0.93, average: 1, tall: 1.07 }[L.height] || 1);
  f.move = L.move;
}

// ---------------------------------------------------------------- arm IK
const _m = new THREE.Matrix4(), _d = V(), _n = V(), _u = V(), _x = V(), _y = V(), _z = V(), _h = V();
/**
 * Point an arm (shoulder → elbow → palm) at a target in the spine's space. pole: the direction the elbow points.
 */
function reach(arm, target, pole) {
  const S = arm.shoulder.position;
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
    // the palm, in the spine's space, with this elbow direction
    _h.set(0, -Math.cos(s * bend) * LOWER - UPPER, -Math.sin(s * bend) * LOWER).applyQuaternion(arm.shoulder.quaternion).add(S);
    const e2 = _h.distanceToSquared(target);
    if (e2 < err) { err = e2; best = s; }
  }
  arm.elbow.rotation.set(best * bend, 0, 0);
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
  for (const v of [variants.standard, variants.double]) { drum(v, 0.2, 0.2, -0.22, 1.1, 0.25, 0.35); drum(v, 0.2, 0.2, 0.23, 1.1, 0.25, 0.35); drum(v, 0.3, 0.42, 0.72, 0.55, 0.1); }
  drum(variants.fusion, 0.15, 0.16, -0.27, 1.02, 0.27, 0.35); drum(variants.fusion, 0.15, 0.16, 0.02, 1.07, 0.27, 0.35); drum(variants.fusion, 0.17, 0.17, 0.3, 1.02, 0.25, 0.35); drum(variants.fusion, 0.26, 0.36, 0.74, 0.5, 0.1);
  drum(kit, 0.25, 0.15, -0.55, 0.78, 0.1, 0.12);
  add(kit, new THREE.CylinderGeometry(0.012, 0.012, 0.78, 6), mats.hw, -0.55, 0.39, 0.1);
  const cymbals = [];
  for (const [cx, cy] of [[-0.95, 1.45], [0.95, 1.5], [-0.78, 1.05]]) {
    const cym = add(kit, lathe([[0.001, 0.02], [0.05, 0.012], [0.34, -0.012], [0.345, -0.016]], { segs: 32, n: 8 }), mats.cym, cx, cy, 0.15);
    cym.rotation.x = 0.25;
    add(kit, new THREE.CylinderGeometry(0.012, 0.012, cy, 6), mats.hw, cx, cy / 2, 0.15);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; const l = add(kit, new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), mats.hw, cx + Math.sin(a) * 0.1, 0.1, 0.15 + Math.cos(a) * 0.1); l.rotation.set(Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7); }
    cymbals.push(cym);
  }
  // the drummer's throne
  add(kit, new THREE.CylinderGeometry(0.2, 0.18, 0.09, 20), mats.seat, 0, 0.56, -1.0);
  add(kit, new THREE.CylinderGeometry(0.025, 0.04, 0.5, 8), mats.hw, 0, 0.27, -1.0);
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
  if (name === 'guitar' || name === 'bass') {
    m.guitar = buildGuitar(name === 'bass');
    m.guitar.group.position.set(0.02, 0.08, 0.17);
    m.guitar.group.rotation.set(0, 0, 0.42);
    m.guitar.group.scale.setScalar(0.92);
    f.spine.add(m.guitar.group);
  } else if (name === 'drums') {
    m.kit = buildKit();
    m.kit.group.position.set(x, y, z + 1.0);
    m.kit.group.rotation.y = rotY;
    scene.add(m.kit.group);
    for (const a of f.arms) a.stick.visible = true;
  } else if (name === 'keys') {
    m.keys = buildKeys();
    m.keys.group.position.set(x + Math.sin(rotY) * 0.62, y + 1.0, z + Math.cos(rotY) * 0.62);
    m.keys.group.rotation.y = rotY;
    scene.add(m.keys.group);
    m.keytar = buildKeytar(m.keys.mats);
    m.keytar.position.set(0.0, 0.12, 0.17);
    m.keytar.rotation.z = 0.3;
    f.spine.add(m.keytar);
  } else if (name === 'vocals') {
    m.mic = buildMic();
    m.micStand = group(scene, x + Math.sin(rotY) * 0.42, y, z + Math.cos(rotY) * 0.42);
    m.micStand.rotation.y = rotY;
    m.micStand.scale.setScalar(scale);
    m.micStand.add(m.mic.variants.classic, m.mic.variants.vintage);
    m.mic.variants.wireless.position.set(0, -0.06, 0.03);
    m.mic.variants.wireless.rotation.x = -0.3;
    f.arms[0].wrist.add(m.mic.variants.wireless);
  }
  m.setLook = (look) => { m.look = cleanLook(look) || DEFAULT_LOOKS[name]; dress(f, m.look); };
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
  if (name === 'drums') {
    // seated on the throne, feet on the pedals
    f.pelvis.position.y = 0.6;
    for (const l of f.legs) { l.hip.rotation.x = -1.45; l.knee.rotation.x = 1.4; }
  }
  return m;
}

const _t1 = V(), _t2 = V(), _pole0 = V(), _pole1 = V(), _w = V();
function local(m, worldPoint, out) { return m.fig.spine.worldToLocal(out.copy(worldPoint)); }

/** Per-frame animation by the character's stage move. bp = beat phase (radians), hb = head bob amount. */
export function animateMember(m, { bp, hb, energy, od, t, pulse }) {
  const f = m.fig;
  const move = f.move || 'headbang';
  const beat = bp / (Math.PI * 2);
  // blink now and then
  const blink = (t * 0.37 + m.baseRot * 3) % 4 < 0.08 ? 0.1 : 1;
  for (const e of [...f.eyes.iris, ...f.eyes.pupil]) e.scale.y = blink;

  if (m.name === 'drums') {
    f.head.rotation.x = hb * (move === 'headbang' ? 1.1 : 0.6);
    f.spine.rotation.x = 0.12 + Math.abs(Math.sin(bp)) * 0.04;
    f.g.updateMatrixWorld(true);
    const kit = m.kit.group;
    kit.updateMatrixWorld(true);
    const hitR = Math.max(0, Math.sin(bp * 2)), hitL = Math.max(0, Math.sin(bp * 2 + Math.PI));
    // right hand: hi-hat / ride, left hand: snare
    local(m, kit.localToWorld(_w.set(-0.62, 1.2 + hitR * 0.22 * energy, 0.05)), _t1);
    local(m, kit.localToWorld(_w.set(-0.42, 0.98 + hitL * 0.22 * energy, 0.02)), _t2);
    reach(f.arms[0], _t1, _pole0.set(-1, -0.6, -0.6));
    reach(f.arms[1], _t2, _pole1.set(1, -0.6, -0.6));
    for (const a of f.arms) a.wrist.rotation.x = -0.4 + (a.side < 0 ? hitR : hitL) * 0.6 * energy;
    for (const c of m.kit.cymbals) c.rotation.z = Math.sin(t * 20 + c.position.x) * 0.05 * pulse;
    return;
  }
  let y = m.baseY, rotY = m.baseRot, lean = 0.06, sway = Math.sin(bp * 0.5) * 0.05, head = hb * 0.9 * energy, spread = 0.05, crouch = 0;
  if (move === 'headbang') { head = hb * 1.6 * energy; lean = 0.12 + hb * 0.22 * energy; crouch = 0.1; }
  else if (move === 'sway') { sway = Math.sin(bp * 0.5) * 0.14 * energy; rotY += Math.sin(bp * 0.25) * 0.2; head = hb * 0.5 * energy; }
  else if (move === 'bounce') { const b = Math.max(0, Math.sin(bp)); y += b * 0.14 * energy; crouch = (1 - b) * 0.35 * energy; }
  else if (move === 'power') { spread = 0.24; lean = -0.1 + hb * 0.18 * energy; head = -0.12 + hb * 0.6 * energy; crouch = 0.15; }
  else if (move === 'spin') {
    const ph = ((beat % 16) + 16) % 16;
    if (ph > 15 && energy > 0.7) rotY += (ph - 15) * Math.PI * 2;
    y += Math.max(0, Math.sin(bp)) * 0.05 * energy;
  }
  if (od) { y += Math.max(0, Math.sin(bp)) * 0.22; head += Math.sin(bp * 2) * 0.3; }
  f.g.position.y = y;
  f.g.rotation.y = rotY;
  f.head.rotation.x = head;
  f.head.rotation.y = Math.sin(t * 0.4 + m.baseRot * 5) * 0.15;
  f.spine.rotation.x = lean;
  f.spine.rotation.z = sway;
  // legs: stance + knee bend (the hips drop with it)
  f.pelvis.position.y = HIP_Y - crouch * 0.09;
  for (const [i, l] of f.legs.entries()) {
    l.hip.rotation.z = (i ? 1 : -1) * spread;
    l.hip.rotation.x = -crouch * 0.6;
    l.knee.rotation.x = crouch * 1.2;
    l.ankle.rotation.x = -crouch * 0.6;
    l.ankle.rotation.z = -l.hip.rotation.z;
  }
  f.g.updateMatrixWorld(true);
  const strum = Math.sin(bp * 2) * energy;
  if (m.guitar) {
    const gt = m.guitar.group;
    gt.rotation.z = 0.42 + (od ? Math.sin(bp) * 0.12 : 0);
    gt.updateMatrixWorld(true);
    // fretting hand slides along the neck, the picking hand strums over the pickups
    const slide = 0.35 + 0.15 * Math.sin(bp * 0.25);
    _t2.set(0.17 + m.guitar.len * slide, 0.0, 0.08).applyMatrix4(gt.matrix);
    _t1.set(0.0, 0.03 + strum * 0.05, 0.1).applyMatrix4(gt.matrix);
    reach(f.arms[1], _t2, _pole1.set(0.8, -1, -0.4));
    reach(f.arms[0], _t1, _pole0.set(-1, -0.6, -0.5));
    f.arms[1].wrist.rotation.set(-0.3, 0, -0.6);
    f.arms[0].wrist.rotation.set(-0.5 + strum * 0.3, 0, 0);
  } else if (m.name === 'keys') {
    if (m.keytar.visible) {
      _t1.set(-0.15 + Math.sin(bp) * 0.06, -0.02, 0.06).applyMatrix4(m.keytar.matrix);
      _t2.set(0.42, 0.06, 0.04).applyMatrix4(m.keytar.matrix);
    } else {
      const kb = m.keys.group; kb.updateMatrixWorld(true);
      local(m, kb.localToWorld(_w.set(-0.25 + Math.sin(bp * 0.5) * 0.12, 0.13 + Math.max(0, Math.sin(bp * 2)) * 0.03, 0.1)), _t1);
      local(m, kb.localToWorld(_w.set(0.2 + Math.sin(bp * 0.25) * 0.12, 0.13 + Math.max(0, Math.sin(bp * 2 + 1.5)) * 0.03, 0.1)), _t2);
    }
    reach(f.arms[0], _t1, _pole0.set(-1, -0.7, -0.3));
    reach(f.arms[1], _t2, _pole1.set(1, -0.7, -0.3));
    for (const a of f.arms) a.wrist.rotation.set(-1.1, 0, 0);
  } else if (m.name === 'vocals') {
    const wireless = m.rig?.shape === 'wireless';
    f.neck.updateMatrixWorld(true);
    _t1.set(-0.02, 0.62 + head * 0.02, wireless ? 0.17 : 0.24);
    if (!wireless) { m.micStand.updateMatrixWorld(true); local(m, m.micStand.localToWorld(_w.set(0, 1.86, -0.02)), _t1); }
    reach(f.arms[0], _t1, _pole0.set(-1, -1, 0));
    f.arms[0].wrist.rotation.set(wireless ? -1.2 : -1.0, 0, 0);
    if (od) _t2.set(0.35, 0.95 + Math.sin(bp * 2) * 0.05, 0.25);
    else _t2.set(0.3 + Math.sin(bp * 0.5) * 0.06, 0.25 + Math.max(0, Math.sin(bp * 0.5)) * 0.25 * energy, 0.22);
    reach(f.arms[1], _t2, _pole1.set(1, -1, -0.3));
    f.arms[1].wrist.rotation.set(-0.3, 0, 0);
  }
  if (f.extra.cape.visible) f.cape.rotation.x = 0.1 + Math.abs(Math.sin(bp * 0.5)) * 0.14 * energy;
  if (f.extra.wings.visible) for (const [i, w] of f.wings.entries()) w.rotation.y = (i ? -1 : 1) * (0.25 + Math.sin(t * 2) * 0.12);
  if (f.hats.halo.visible) f.halo.rotation.z = t * 1.5;
}

/** A relaxed idle pose for the character creator's turntable (no instrument motion). */
export function idleMember(m, t) {
  animateMember(m, { bp: t * 3.2, hb: Math.max(0, Math.sin(t * 3.2)) * 0.12, energy: 0.35, od: false, t, pulse: 0 });
}
