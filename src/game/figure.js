// Band members (v2): a stylised figure with every wardrobe piece built once and switched on by the look
// (profile/looks.js), and the instrument it plays built in every shape of the rig (profile/rig.js). Nothing is
// created when a look changes, so the character editor can flip through pieces at full frame rate.
import * as THREE from 'three';
import { cleanLook } from '../profile/looks.js';
import { cleanPart, HARDWARE_COLOR } from '../profile/rig.js';

const std = (color, roughness = 0.8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const glowMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
const group = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
const setGlow = (mat, hex, k = 2.4) => { mat.color.set(hex || '#000000').multiplyScalar(k); };

// out of the box: dark stage clothes, so a player's own character stands out
export const DEFAULT_LOOKS = {
  guitar: cleanLook({ skin: '#2a2026', hair: 'short', hairColor: '#0c0c12', top: '#3a0d1c', pants: '#0c0c12', finish: '#d81b3a', move: 'headbang' }),
  bass: cleanLook({ skin: '#2a2026', hair: 'long', hairColor: '#0c0c12', top: '#0d1c3a', pants: '#0c0c12', finish: '#1b5ed8', move: 'sway' }),
  drums: cleanLook({ skin: '#2a2026', hair: 'shaved', hairColor: '#0c0c12', top: '#2a1a08', pants: '#0c0c12', finish: '#b86a1b', topStyle: 'tank' }),
  keys: cleanLook({ skin: '#2a2026', hair: 'bun', hairColor: '#0c0c12', top: '#1c0d3a', pants: '#0c0c12', finish: '#15120e', move: 'sway' }),
  vocals: cleanLook({ skin: '#2a2026', hair: 'spiky', hairColor: '#0c0c12', top: '#151515', pants: '#0c0c12', finish: '#5a5a5a', topStyle: 'jacket', accent: '#3a0d1c', move: 'power' }),
};

// ---------------------------------------------------------------- the figure
function buildFigure() {
  const mats = {
    skin: std(0x2a2026, 0.7), cloth: std(0x3a0d1c, 0.8), accent: std(0x15120e, 0.6), pants: std(0x0c0c12, 0.9),
    hair: std(0x0c0c12, 0.85), shoes: std(0x15120e, 0.5), glow: glowMat(), metal: std(0xc9a13a, 0.25, 1),
    lens: std(0x050507, 0.08, 0.9), eye: new THREE.MeshBasicMaterial({ color: 0x0a0806 }), visor: glowMat(), halo: glowMat(), horn: std(0x1a1310, 0.6), hornGlow: glowMat(),
    ice: new THREE.MeshStandardMaterial({ color: 0x9fe8ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.75, emissive: 0x2a7fa8, emissiveIntensity: 0.9 }),
  };
  const g = new THREE.Group();
  const body = group(g); // scaled for the build
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = group(body, sx * 0.17, 1.0, 0);
    add(hip, new THREE.CapsuleGeometry(0.13, 0.8, 4, 8), mats.pants, 0, -0.45, 0);
    const shoe = add(hip, new THREE.BoxGeometry(0.2, 0.12, 0.32), mats.shoes, 0, -0.95, 0.05);
    const sole = add(shoe, new THREE.BoxGeometry(0.21, 0.025, 0.33), mats.glow, 0, -0.06, 0);
    legs.push({ hip, sole });
  }
  const torso = group(body, 0, 1.05, 0);
  const chest = add(torso, new THREE.CapsuleGeometry(0.26, 0.55, 4, 12), mats.cloth, 0, 0.35, 0);
  add(torso, new THREE.CylinderGeometry(0.08, 0.09, 0.16, 10), mats.skin, 0, 0.86, 0);

  // top styles: pieces over the plain shirt
  const top = { tee: group(torso), tank: group(torso), jacket: group(torso), hoodie: group(torso), coat: group(torso), vest: group(torso) };
  add(top.jacket, new THREE.BoxGeometry(0.12, 0.62, 0.02), mats.accent, 0, 0.36, 0.262); // the shirt under an open jacket
  for (const sx of [-1, 1]) { const lap = add(top.jacket, new THREE.BoxGeometry(0.09, 0.22, 0.03), mats.cloth, sx * 0.1, 0.62, 0.25); lap.rotation.z = sx * 0.35; }
  const hood = add(top.hoodie, new THREE.TorusGeometry(0.19, 0.075, 8, 16, Math.PI), mats.cloth, 0, 0.84, -0.13);
  hood.rotation.set(-0.5, 0, 0);
  add(top.hoodie, new THREE.BoxGeometry(0.3, 0.13, 0.04), mats.accent, 0, 0.18, 0.25);
  for (const sx of [-1, 1]) add(top.hoodie, new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), mats.accent, sx * 0.06, 0.62, 0.26);
  add(top.coat, new THREE.CylinderGeometry(0.29, 0.37, 0.78, 16, 1, true), mats.cloth, 0, -0.28, 0).material.side = THREE.DoubleSide;
  for (const sx of [-1, 1]) { const lap = add(top.coat, new THREE.BoxGeometry(0.08, 0.5, 0.03), mats.accent, sx * 0.1, 0.45, 0.255); lap.rotation.z = sx * 0.22; }
  for (const sx of [-1, 1]) add(top.vest, new THREE.BoxGeometry(0.2, 0.5, 0.05), mats.accent, sx * 0.11, 0.32, 0.24);
  for (let k = 0; k < 3; k++) add(top.vest, new THREE.SphereGeometry(0.015, 6, 4), mats.metal, 0.02, 0.18 + k * 0.12, 0.27);
  // LED trim (the glow colour): down the front and around the cuffs
  const trims = [];
  for (const sx of [-1, 1]) trims.push(add(torso, new THREE.BoxGeometry(0.018, 0.62, 0.018), mats.glow, sx * 0.07, 0.36, 0.268));

  // head
  const head = group(torso, 0, 0.95, 0);
  add(head, new THREE.SphereGeometry(0.2, 18, 14), mats.skin, 0, 0.12, 0);
  for (const sx of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.024, 8, 6), mats.eye, sx * 0.07, 0.15, 0.178);
    add(head, new THREE.SphereGeometry(0.035, 8, 6), mats.skin, sx * 0.2, 0.12, 0); // ears
  }
  const cap = (r, frac, y = 0.15) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * frac), mats.hair); m.position.y = y; return m; };
  const hair = {};
  for (const k of ['short', 'long', 'mohawk', 'bun', 'shaved', 'spiky', 'afro', 'ponytail', 'locs', 'bald']) hair[k] = group(head);
  hair.short.add(cap(0.22, 0.6));
  hair.shaved.add(cap(0.205, 0.45, 0.13));
  add(hair.mohawk, new THREE.BoxGeometry(0.07, 0.2, 0.38), mats.hair, 0, 0.34, -0.02);
  hair.mohawk.add(cap(0.204, 0.42, 0.13));
  hair.long.add(cap(0.225, 0.62));
  add(hair.long, new THREE.CapsuleGeometry(0.19, 0.34, 4, 10), mats.hair, 0, -0.08, -0.1);
  hair.bun.add(cap(0.225, 0.62));
  add(hair.bun, new THREE.SphereGeometry(0.11, 10, 8), mats.hair, 0, 0.36, -0.1);
  hair.spiky.add(cap(0.215, 0.55));
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2, tilt = 0.5 + (k % 3) * 0.18;
    const s = add(hair.spiky, new THREE.ConeGeometry(0.06, 0.2, 6), mats.hair, Math.sin(a) * 0.12, 0.3, Math.cos(a) * 0.12 - 0.02);
    s.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
  }
  const afro = new THREE.Mesh(new THREE.SphereGeometry(0.29, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.hair);
  afro.position.set(0, 0.24, -0.06);
  hair.afro.add(afro);
  hair.ponytail.add(cap(0.222, 0.6));
  const tail = add(hair.ponytail, new THREE.CapsuleGeometry(0.06, 0.32, 4, 8), mats.hair, 0, 0.02, -0.26);
  tail.rotation.x = 0.5;
  hair.locs.add(cap(0.222, 0.6));
  for (let k = 0; k < 10; k++) {
    const a = Math.PI * 0.35 + (k / 9) * Math.PI * 1.3;
    const l = add(hair.locs, new THREE.CapsuleGeometry(0.028, 0.34, 3, 6), mats.hair, Math.cos(a) * 0.19, -0.06, -Math.abs(Math.sin(a)) * 0.17);
    l.rotation.z = Math.cos(a) * 0.15;
  }
  // facial hair
  const facial = { none: group(head), stubble: group(head), beard: group(head), goatee: group(head), moustache: group(head) };
  const jaw = (r, t0, tl) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI, Math.PI * t0, Math.PI * tl), mats.hair);
  const stub = jaw(0.203, 0.56, 0.3); stub.position.y = 0.12; facial.stubble.add(stub);
  const beard = jaw(0.212, 0.54, 0.4); beard.position.y = 0.12; facial.beard.add(beard);
  const chin = add(facial.beard, new THREE.ConeGeometry(0.1, 0.16, 10), mats.hair, 0, -0.1, 0.11); chin.rotation.x = Math.PI;
  const goatee = add(facial.goatee, new THREE.ConeGeometry(0.045, 0.12, 8), mats.hair, 0, -0.07, 0.16); goatee.rotation.x = Math.PI - 0.3;
  for (const sx of [-1, 1]) { const m = add(facial.moustache, new THREE.BoxGeometry(0.07, 0.022, 0.03), mats.hair, sx * 0.035, 0.065, 0.19); m.rotation.z = sx * -0.25; }
  // eyewear
  const eyes = { none: group(head), shades: group(head), round: group(head), visor: group(head), goggles: group(head) };
  for (const sx of [-1, 1]) add(eyes.shades, new THREE.BoxGeometry(0.09, 0.045, 0.02), mats.lens, sx * 0.068, 0.15, 0.196);
  add(eyes.shades, new THREE.BoxGeometry(0.05, 0.012, 0.015), mats.lens, 0, 0.162, 0.2);
  for (const sx of [-1, 1]) add(eyes.round, new THREE.TorusGeometry(0.038, 0.007, 6, 18), mats.metal, sx * 0.07, 0.15, 0.198);
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.212, 0.212, 0.055, 24, 1, true, -1.1, 2.2), mats.visor);
  visor.position.y = 0.15; visor.rotation.y = Math.PI; eyes.visor.add(visor); visor.material.side = THREE.DoubleSide;
  for (const sx of [-1, 1]) { const gg = add(eyes.goggles, new THREE.CylinderGeometry(0.05, 0.05, 0.05, 14), mats.lens, sx * 0.075, 0.16, 0.19); gg.rotation.x = Math.PI / 2; }
  const strap = add(eyes.goggles, new THREE.TorusGeometry(0.205, 0.016, 6, 24), mats.accent, 0, 0.16, 0); strap.rotation.x = Math.PI / 2;
  // headwear
  const hats = { none: group(head), beanie: group(head), cap: group(head), cowboy: group(head), bandana: group(head), crown: group(head), horns: group(head), halo: group(head) };
  const hatCap = (r, frac, mat) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * frac), mat); m.position.y = 0.15; return m; };
  hats.beanie.add(hatCap(0.235, 0.5, mats.accent));
  const fold = add(hats.beanie, new THREE.TorusGeometry(0.228, 0.035, 8, 24), mats.accent, 0, 0.16, 0); fold.rotation.x = Math.PI / 2;
  add(hats.beanie, new THREE.SphereGeometry(0.05, 8, 6), mats.accent, 0, 0.4, 0);
  hats.cap.add(hatCap(0.225, 0.5, mats.accent));
  const brim = add(hats.cap, new THREE.CylinderGeometry(0.13, 0.13, 0.015, 16, 1, false, -Math.PI / 2, Math.PI), mats.accent, 0, 0.17, 0.14);
  brim.rotation.x = 0.12;
  add(hats.cowboy, new THREE.CylinderGeometry(0.15, 0.18, 0.16, 16), mats.accent, 0, 0.36, 0);
  add(hats.cowboy, new THREE.CylinderGeometry(0.38, 0.38, 0.018, 24), mats.accent, 0, 0.28, 0).rotation.x = 0.06;
  const band = add(hats.bandana, new THREE.TorusGeometry(0.205, 0.028, 8, 24), mats.accent, 0, 0.21, 0); band.rotation.x = Math.PI / 2 - 0.15;
  add(hats.bandana, new THREE.SphereGeometry(0.05, 8, 6), mats.accent, 0, 0.2, -0.22);
  add(hats.crown, new THREE.CylinderGeometry(0.17, 0.19, 0.08, 16, 1, true), mats.metal, 0, 0.32, 0).material.side = THREE.DoubleSide;
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; add(hats.crown, new THREE.ConeGeometry(0.03, 0.09, 5), mats.metal, Math.sin(a) * 0.18, 0.4, Math.cos(a) * 0.18); }
  for (const sx of [-1, 1]) {
    const h = group(hats.horns, sx * 0.15, 0.26, -0.02);
    h.rotation.z = -sx * 0.7;
    add(h, new THREE.ConeGeometry(0.05, 0.22, 8), mats.horn, 0, 0.1, 0);
    const tip = add(h, new THREE.ConeGeometry(0.022, 0.07, 6), mats.hornGlow, 0, 0.23, 0);
    tip.rotation.z = sx * 0.4;
  }
  const halo = add(hats.halo, new THREE.TorusGeometry(0.17, 0.016, 8, 32), mats.halo, 0, 0.47, -0.03); halo.rotation.x = Math.PI / 2 - 0.25;

  // arms
  const arms = [], hands = [];
  for (const sx of [-1, 1]) {
    const shoulder = group(torso, sx * 0.34, 0.62, 0);
    const arm = add(shoulder, new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), mats.cloth, 0, -0.3, 0);
    hands.push(add(shoulder, new THREE.SphereGeometry(0.07, 10, 8), mats.skin, 0, -0.64, 0));
    trims.push(add(shoulder, new THREE.CylinderGeometry(0.085, 0.085, 0.025, 12), mats.glow, 0, -0.55, 0));
    shoulder.rotation.x = -0.6;
    arms.push(shoulder);
    shoulder.userData.sleeve = arm;
  }
  // accessories
  const extra = { none: group(torso), chain: group(torso), scarf: group(torso), spikes: group(torso), cape: group(torso), wings: group(torso) };
  const chain = add(extra.chain, new THREE.TorusGeometry(0.15, 0.012, 6, 24), mats.metal, 0, 0.72, 0.1); chain.rotation.x = 1.25;
  add(extra.chain, new THREE.OctahedronGeometry(0.035), mats.metal, 0, 0.6, 0.25);
  const scarf = add(extra.scarf, new THREE.TorusGeometry(0.13, 0.055, 8, 18), mats.accent, 0, 0.8, 0); scarf.rotation.x = Math.PI / 2;
  add(extra.scarf, new THREE.BoxGeometry(0.1, 0.36, 0.04), mats.accent, -0.09, 0.56, 0.24).rotation.z = 0.12;
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const s = add(extra.spikes, new THREE.ConeGeometry(0.035, 0.13, 6), mats.metal, sx * (0.3 + k * 0.05), 0.75 - k * 0.02, -0.04 + k * 0.05);
    s.rotation.z = -sx * 0.6;
  }
  const capeGeo = new THREE.PlaneGeometry(0.66, 1.25, 1, 6).translate(0, -0.62, 0);
  const cape = add(extra.cape, capeGeo, mats.accent, 0, 0.82, -0.27);
  cape.material = mats.accent.clone(); cape.material.side = THREE.DoubleSide;
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = group(extra.wings, sx * 0.12, 0.7, -0.24);
    for (let k = 0; k < 5; k++) {
      const shard = add(w, new THREE.ConeGeometry(0.06, 0.75 - k * 0.08, 4), mats.ice, sx * (0.18 + k * 0.11), 0.05 + k * 0.06, -k * 0.02);
      shard.rotation.z = -sx * (0.9 + k * 0.18);
    }
    wings.push(w);
  }

  return { g, body, torso, chest, head, arms, hands, legs, mats, hair, facial, eyes, hats, top, extra, trims, cape, wings, halo };
}

function show(groups, key) { for (const [k, m] of Object.entries(groups)) m.visible = k === key; }

/** Dress a figure. */
function dress(f, look) {
  const L = look;
  f.mats.skin.color.set(L.skin);
  f.mats.cloth.color.set(L.top);
  f.mats.accent.color.set(L.accent);
  f.cape.material.color.set(L.accent);
  f.mats.pants.color.set(L.pants);
  f.mats.hair.color.set(L.hairColor);
  f.mats.shoes.color.set(L.shoes);
  setGlow(f.mats.glow, L.glow || '#000000');
  setGlow(f.mats.visor, L.glow || '#2fd3ff', 2);
  setGlow(f.mats.halo, '#ffe14d', 2.6);
  setGlow(f.mats.hornGlow, '#ff6a1a', 3);
  show(f.hair, L.hair);
  show(f.facial, L.facial);
  show(f.eyes, L.eyes);
  show(f.hats, L.head);
  show(f.top, L.topStyle);
  show(f.extra, L.extra);
  // a hat sits on the head: tall hair under it is shown as short hair
  if (['beanie', 'cap', 'cowboy'].includes(L.head) && ['mohawk', 'spiky', 'afro', 'bun'].includes(L.hair)) {
    f.hair[L.hair].visible = false;
    f.hair.short.visible = true;
  }
  for (const t of f.trims) t.visible = !!L.glow;
  for (const l of f.legs) l.sole.visible = !!L.glow;
  for (const a of f.arms) a.userData.sleeve.material = L.topStyle === 'tank' ? f.mats.skin : f.mats.cloth;
  const bx = { slim: 0.88, regular: 1, broad: 1.16 }[L.build] || 1;
  f.torso.scale.set(bx, 1, bx * 0.96 + 0.04);
  const h = { short: 0.92, average: 1, tall: 1.08 }[L.height] || 1;
  f.body.scale.setScalar(h);
  f.move = L.move;
}

// ---------------------------------------------------------------- instruments
function guitarShapes(bass) {
  const k = bass ? 1.08 : 1;
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
  const ex = { depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 14 };
  const out = {};
  for (const [id, sh] of Object.entries({ classic, vee, star, offset, hollow, thunder })) {
    const geo = new THREE.ExtrudeGeometry(sh, ex).translate(0, 0, -0.03);
    geo.scale(k, k, 1);
    out[id] = geo;
  }
  return out;
}

function buildGuitar(bass) {
  const inst = new THREE.Group();
  const mats = { finish: std(0xd81b3a, 0.28, 0.35), guard: std(0xece5d3, 0.5), hw: std(0xc9ccd6, 0.3, 1), wood: std(0x3a2412, 0.6), board: std(0x1a1008, 0.7), glow: glowMat(), string: std(0xc9ccd6, 0.3, 1) };
  const bodies = {};
  for (const [id, geo] of Object.entries(guitarShapes(bass))) { bodies[id] = add(inst, geo, mats.finish); }
  const guardShape = new THREE.Shape();
  guardShape.moveTo(-0.04, -0.02); guardShape.bezierCurveTo(-0.1, -0.14, -0.2, -0.12, -0.2, -0.04);
  guardShape.bezierCurveTo(-0.2, 0.0, -0.1, 0.0, -0.04, -0.02);
  const guard = add(inst, new THREE.ExtrudeGeometry(guardShape, { depth: 0.004, bevelEnabled: false }), mats.guard, 0, 0, 0.044);
  const len = bass ? 0.8 : 0.56;
  const nStr = bass ? 4 : 6;
  add(inst, new THREE.BoxGeometry(len, 0.055, 0.035), mats.wood, 0.17 + len / 2, 0, 0.012);
  add(inst, new THREE.BoxGeometry(len, 0.05, 0.008), mats.board, 0.17 + len / 2, 0, 0.033);
  const inlays = [];
  for (let k = 0; k < 6; k++) inlays.push(add(inst, new THREE.BoxGeometry(0.012, 0.012, 0.004), mats.glow, 0.22 + (k / 6) * len, 0, 0.039));
  add(inst, new THREE.BoxGeometry(0.15, 0.075, 0.025), mats.finish, 0.17 + len + 0.07, 0, 0.012);
  for (let k = 0; k < nStr; k++) {
    const ty = (k < nStr / 2 ? 1 : -1) * 0.045;
    add(inst, new THREE.CylinderGeometry(0.008, 0.008, 0.03, 6), mats.hw, 0.17 + len + 0.03 + (k % (nStr / 2)) * 0.04, ty, 0.03).rotation.x = Math.PI / 2;
  }
  for (const px of bass ? [0.04] : [-0.02, 0.08]) add(inst, new THREE.BoxGeometry(0.045, bass ? 0.11 : 0.12, 0.018), mats.hw, px, 0, 0.044);
  add(inst, new THREE.BoxGeometry(0.035, 0.12, 0.016), mats.hw, -0.12, 0, 0.044);
  for (let k = 0; k < 3; k++) add(inst, new THREE.CylinderGeometry(0.016, 0.016, 0.02, 10), mats.hw, -0.16 + k * 0.05, -0.1, 0.05).rotation.x = Math.PI / 2;
  const strings = [];
  for (let k = 0; k < nStr; k++) {
    const y = ((k / (nStr - 1)) - 0.5) * 0.034;
    strings.push(add(inst, new THREE.BoxGeometry(len + 0.3, 0.003, 0.003), mats.string, 0.17 + len / 2 - 0.15, y, 0.046));
  }
  return { group: inst, bodies, guard, mats, inlays, strings, bass };
}

function dressGuitar(gt, part) {
  for (const [k, b] of Object.entries(gt.bodies)) b.visible = k === part.shape;
  gt.mats.finish.color.set(part.finish);
  gt.mats.guard.color.set(part.guard);
  gt.guard.visible = part.shape !== 'hollow' && part.shape !== 'vee';
  gt.mats.hw.color.set(HARDWARE_COLOR[part.hardware]);
  if (part.glow) { setGlow(gt.mats.glow, part.glow, 3); gt.mats.string.emissive?.set(part.glow); gt.mats.string.emissiveIntensity = 1.6; }
  else { setGlow(gt.mats.glow, '#d8d2c2', 0.8); gt.mats.string.emissiveIntensity = 0; }
  gt.mats.string.color.set(part.glow || HARDWARE_COLOR[part.hardware]);
}

function buildKit() {
  const kit = new THREE.Group();
  const mats = { shell: std(0xb86a1b, 0.3, 0.4), hw: std(0x9a9aa8, 0.25, 1), head: std(0xe8e1cf, 0.6), cym: std(0xc9a13a, 0.2, 1), glow: glowMat() };
  const variants = { standard: group(kit), double: group(kit), fusion: group(kit) };
  const kickGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.45, 28).rotateX(Math.PI / 2);
  const kick = (parent, x, s = 1) => {
    const k = add(parent, kickGeo, mats.shell, x, 0.5 * s, 0.2); k.scale.setScalar(s);
    add(parent, new THREE.CircleGeometry(0.46 * s, 28), mats.head, x, 0.5 * s, 0.2 + 0.226 * s);
    const ring = add(parent, new THREE.TorusGeometry(0.43 * s, 0.014, 6, 36), mats.glow, x, 0.5 * s, 0.2 + 0.232 * s);
    return ring;
  };
  const rings = [kick(variants.standard, 0), kick(variants.double, -0.3, 0.9), kick(variants.double, 0.3, 0.9), kick(variants.fusion, 0, 0.82)];
  const drum = (parent, r, h, x, y, z) => add(parent, new THREE.CylinderGeometry(r, r, h, 22), mats.shell, x, y, z);
  for (const v of [variants.standard, variants.double]) { drum(v, 0.2, 0.2, -0.2, 1.1, 0.25); drum(v, 0.2, 0.2, 0.25, 1.1, 0.25); drum(v, 0.3, 0.4, 0.7, 0.55, 0.1); }
  drum(variants.fusion, 0.16, 0.16, -0.25, 1.0, 0.25); drum(variants.fusion, 0.16, 0.16, 0.05, 1.05, 0.25); drum(variants.fusion, 0.18, 0.18, 0.32, 1.0, 0.22); drum(variants.fusion, 0.26, 0.34, 0.72, 0.5, 0.1);
  drum(kit, 0.25, 0.15, -0.55, 0.75, 0.1); // snare
  const cymbals = [];
  for (const [cx, cy] of [[-0.95, 1.45], [0.95, 1.5], [-0.75, 1.05]]) {
    const cym = add(kit, new THREE.CylinderGeometry(0.34, 0.34, 0.01, 24), mats.cym, cx, cy, 0.15);
    cym.rotation.x = 0.25;
    add(kit, new THREE.CylinderGeometry(0.015, 0.015, cy, 6), mats.hw, cx, cy / 2, 0.15);
    cymbals.push(cym);
  }
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
  const mats = { finish: std(0x0a0a0a, 0.4, 0.2), white: std(0xdddddd, 0.3), black: std(0x101010, 0.4), hw: std(0x9a9aa8, 0.25, 1), glow: glowMat() };
  const variants = { stage: group(rig), synth: group(rig), keytar: group(rig) };
  const keybed = (parent, w) => {
    add(parent, new THREE.BoxGeometry(w, 0.02, 0.2), mats.white, 0, 0.05, 0.1);
    for (let k = 0; k < 14; k++) if (k % 7 !== 2 && k % 7 !== 6) add(parent, new THREE.BoxGeometry(0.035, 0.03, 0.11), mats.black, -w / 2 + 0.05 + (k / 14) * (w - 0.1), 0.065, 0.05);
  };
  add(variants.stage, new THREE.BoxGeometry(1.5, 0.08, 0.45), mats.finish);
  keybed(variants.stage, 1.35);
  for (const sx of [-1, 1]) add(variants.stage, new THREE.BoxGeometry(0.05, 1.0, 0.05), mats.hw, sx * 0.5, -0.5, 0);
  add(variants.synth, new THREE.BoxGeometry(1.4, 0.1, 0.5), mats.finish);
  keybed(variants.synth, 1.25);
  const panel = add(variants.synth, new THREE.BoxGeometry(1.4, 0.25, 0.04), mats.finish, 0, 0.16, -0.22); panel.rotation.x = -0.5;
  for (let k = 0; k < 8; k++) add(variants.synth, new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), mats.hw, -0.5 + k * 0.14, 0.2, -0.2).rotation.x = -0.5 + Math.PI / 2;
  const strip = add(variants.synth, new THREE.BoxGeometry(1.3, 0.015, 0.015), mats.glow, 0, 0.27, -0.25);
  for (const sx of [-1, 1]) { const leg = add(variants.synth, new THREE.BoxGeometry(0.05, 1.1, 0.05), mats.hw, sx * 0.35, -0.5, 0); leg.rotation.z = sx * 0.35; }
  return { group: rig, mats, variants, strip, keybed };
}

/** The keytar the keys player wears (shown instead of the keyboard stand). */
function buildKeytar(mats) {
  const kt = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.32, -0.1); s.lineTo(0.2, -0.1); s.lineTo(0.3, 0.02); s.lineTo(0.62, 0.04); s.lineTo(0.62, 0.1); s.lineTo(0.25, 0.1); s.lineTo(0.15, 0.13); s.lineTo(-0.32, 0.12); s.lineTo(-0.32, -0.1);
  add(kt, new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 1 }).translate(0, 0, -0.025), mats.finish);
  const bed = group(kt, -0.08, -0.06, 0.02); bed.rotation.x = Math.PI / 2;
  add(bed, new THREE.BoxGeometry(0.42, 0.02, 0.14), mats.white, 0, 0.0, 0);
  add(kt, new THREE.BoxGeometry(0.3, 0.012, 0.012), mats.glow, 0.42, 0.07, 0.035);
  return kt;
}

function buildMic() {
  const mats = { hw: std(0x9a9aa8, 0.25, 1), grille: std(0x6b6b74, 0.4, 0.9), body: std(0x15120e, 0.4, 0.3), glow: glowMat() };
  const variants = { classic: new THREE.Group(), vintage: new THREE.Group(), wireless: new THREE.Group() };
  const stand = (g) => {
    add(g, new THREE.CylinderGeometry(0.16, 0.16, 0.03, 16), mats.hw, 0, 0.015, 0);
    add(g, new THREE.CylinderGeometry(0.012, 0.012, 1.85, 6), mats.hw, 0, 0.93, 0);
  };
  stand(variants.classic);
  const c = group(variants.classic, 0, 1.92, -0.06); c.rotation.x = -1.2;
  add(c, new THREE.CylinderGeometry(0.022, 0.016, 0.16, 10), mats.body, 0, 0, 0);
  add(c, new THREE.SphereGeometry(0.035, 12, 10), mats.grille, 0, 0.1, 0);
  const cRing = add(c, new THREE.TorusGeometry(0.024, 0.005, 6, 16), mats.glow, 0, 0.03, 0); cRing.rotation.x = Math.PI / 2;
  stand(variants.vintage);
  const v = group(variants.vintage, 0, 1.95, -0.05);
  add(v, new THREE.CapsuleGeometry(0.055, 0.1, 4, 14), mats.grille, 0, 0, 0);
  const vRing = add(v, new THREE.TorusGeometry(0.06, 0.008, 6, 20), mats.hw, 0, 0, 0); vRing.rotation.x = Math.PI / 2;
  const vGlow = add(v, new THREE.TorusGeometry(0.06, 0.005, 6, 20), mats.glow, 0, 0.06, 0); vGlow.rotation.x = Math.PI / 2;
  add(variants.wireless, new THREE.CylinderGeometry(0.022, 0.016, 0.18, 10), mats.body, 0, 0, 0);
  add(variants.wireless, new THREE.SphereGeometry(0.035, 12, 10), mats.grille, 0, 0.11, 0);
  const wRing = add(variants.wireless, new THREE.TorusGeometry(0.023, 0.005, 6, 16), mats.glow, 0, -0.06, 0); wRing.rotation.x = Math.PI / 2;
  return { mats, variants, glows: [cRing, vGlow, wRing] };
}

// ---------------------------------------------------------------- band members
/**
 * One band member at their place on stage. name: guitar | bass | drums | keys | vocals.
 * → { name, fig, g, torso, head, arms, setLook(look), setRig(part), animate(...) }
 */
export function createMember(scene, name, { x, y, z, rotY = 0, scale = 1 }) {
  const f = buildFigure();
  f.g.position.set(x, y, z);
  f.g.rotation.y = rotY;
  f.g.scale.setScalar(scale);
  scene.add(f.g);
  const m = { name, fig: f, g: f.g, torso: f.torso, head: f.head, arms: f.arms, baseY: y, baseRot: rotY, look: null };
  if (name === 'guitar' || name === 'bass') {
    m.guitar = buildGuitar(name === 'bass');
    m.guitar.group.position.set(0.05, 0.22, 0.3);
    m.guitar.group.rotation.z = 0.35;
    f.torso.add(m.guitar.group);
  } else if (name === 'drums') {
    m.kit = buildKit();
    m.kit.group.position.set(0, y, z + 1.0);
    scene.add(m.kit.group);
  } else if (name === 'keys') {
    m.keys = buildKeys();
    m.keys.group.position.set(x + 0.35, y + 1.05, z + 0.65);
    m.keys.group.rotation.y = rotY;
    scene.add(m.keys.group);
    m.keytar = buildKeytar(m.keys.mats);
    m.keytar.position.set(0.02, 0.25, 0.3);
    m.keytar.rotation.z = 0.32;
    f.torso.add(m.keytar);
  } else if (name === 'vocals') {
    m.mic = buildMic();
    m.micStand = group(scene, x, y, z + 0.42);
    m.micStand.add(m.mic.variants.classic, m.mic.variants.vintage);
    m.mic.variants.wireless.position.set(0, -0.66, 0.08);
    m.mic.variants.wireless.rotation.x = -0.5;
    f.arms[1].add(m.mic.variants.wireless);
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
  m.focus = new THREE.Vector3(x, y + 1.2, z);
  return m;
}

/** Per-frame animation by the character's stage move. bp = beat phase (radians), hb = head bob amount. */
export function animateMember(m, { bp, hb, energy, od, t, pulse }) {
  const f = m.fig;
  const move = f.move || 'headbang';
  if (m.name === 'drums') {
    f.arms[0].rotation.x = -0.9 + Math.max(0, Math.sin(bp * 2)) * 0.8 * energy;
    f.arms[1].rotation.x = -0.9 + Math.max(0, Math.sin(bp * 2 + Math.PI)) * 0.8 * energy;
    f.head.rotation.x = hb * (move === 'headbang' ? 1 : 0.6);
    f.torso.position.y = 1.05 + Math.abs(Math.sin(bp)) * 0.03;
    for (const c of m.kit.cymbals) c.rotation.z = Math.sin(t * 20 + c.position.x) * 0.05 * pulse;
    return;
  }
  const beat = bp / (Math.PI * 2);
  let y = m.baseY, rotY = m.baseRot, lean = 0.1, sway = Math.sin(bp * 0.5) * 0.06, head = hb * 0.9 * energy, spread = 0;
  if (move === 'headbang') { head = hb * 1.5 * energy; lean = 0.18 + hb * 0.25 * energy; }
  else if (move === 'sway') { sway = Math.sin(bp * 0.5) * 0.16 * energy; rotY += Math.sin(bp * 0.25) * 0.18; head = hb * 0.5 * energy; }
  else if (move === 'bounce') { y += Math.max(0, Math.sin(bp)) * 0.16 * energy; }
  else if (move === 'power') { spread = 0.22; lean = -0.08 + hb * 0.2 * energy; head = -0.15 + hb * 0.7 * energy; }
  else if (move === 'spin') {
    const ph = ((beat % 16) + 16) % 16;
    if (ph > 15 && energy > 0.7) rotY += (ph - 15) * Math.PI * 2;
    y += Math.max(0, Math.sin(bp)) * 0.06 * energy;
  }
  if (od) { y += Math.max(0, Math.sin(bp)) * 0.25; head += Math.sin(bp * 2) * 0.3; }
  f.g.position.y = y;
  f.g.rotation.y = rotY;
  f.head.rotation.x = head;
  f.torso.rotation.x = lean;
  f.torso.rotation.z = sway;
  for (const [i, l] of f.legs.entries()) l.hip.rotation.z = (i ? -1 : 1) * spread;
  if (m.name === 'vocals') {
    const wireless = m.rig?.shape === 'wireless';
    f.arms[1].rotation.x = wireless ? -2.0 + Math.sin(bp) * 0.1 : -1.3 + Math.sin(bp * 0.5) * 0.15;
    f.arms[0].rotation.x = od ? -2.6 + Math.sin(bp * 2) * 0.2 : -0.5 + Math.sin(bp * 0.5) * 0.2 * energy;
  } else {
    f.arms[1].rotation.x = -0.9 + Math.sin(bp * 2) * 0.35 * energy; // strumming / playing hand
  }
  if (f.extra.cape.visible) f.cape.rotation.x = 0.12 + Math.abs(Math.sin(bp * 0.5)) * 0.15 * energy;
  if (f.extra.wings.visible) for (const [i, w] of f.wings.entries()) w.rotation.y = (i ? -1 : 1) * (0.2 + Math.sin(t * 2) * 0.12);
  if (f.hats.halo.visible) f.halo.rotation.z = t * 1.5;
}
