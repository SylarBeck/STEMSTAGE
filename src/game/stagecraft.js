// Custom stages (v2): put a stage-creator layout (game/props.js) together on the stage: a venue size, a backdrop
// on the LED wall, the floor, the light rig, props in the wings / upstage / at the front / overhead, the
// atmosphere, the crowd and the colours. clearLayout() takes it all off again for the built-in venues.
import * as THREE from 'three';
import { cleanLayout, buildProp, buildOverhead, buildFx, floorLook, GEL_SETS, itemOf } from './props.js';

// the LED wall's shader styles (stage.js ledFragment): 0 LED tunnel, 1 brick, 2 curtain, 3.. the extra backdrops
export const BACKDROP_STYLE = { led: 0, brick: 1, curtain: 2, stars: 3, sunset: 4, ocean: 5, matrix: 6, aurora: 7, lava: 8 };
const CROWD = { packed: 1, half: 0.5, small: 0.2, empty: 0.02 };
const SLOT_AT = {
  wingL: [[-11.6, 1.2, -1.6, 1, 0.3]],
  wingR: [[11.6, 1.2, -1.6, 1, -0.3]],
  upstage: [[-6.2, 1.2, -6.6, 0.8, 0.15], [6.2, 1.2, -6.6, 0.8, -0.15]],
  downstage: [[-8, 1.2, 1.7, 0.8, 0], [8, 1.2, 1.7, 0.8, 0]],
};

function lasers() {
  const g = new THREE.Group();
  const beams = [];
  for (let k = 0; k < 14; k++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 60, 6, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set((k - 6.5) * 1.6, 1.4, -7);
    g.add(m);
    beams.push(m);
  }
  return {
    obj: g,
    update: (dt, t, f, pulse, cols, beat) => {
      const pat = Math.floor(beat / 8) % 3;
      beams.forEach((b, i) => {
        const s = i / (beams.length - 1) - 0.5;
        if (pat === 0) b.rotation.set(-1.25 + Math.sin(t * 2 + i * 0.3) * 0.15, 0, s * 1.6);
        else if (pat === 1) b.rotation.set(-1.15, 0, Math.sin(t * 1.5) * 1.2 + s * 0.3);
        else b.rotation.set(-0.9 - Math.abs(Math.sin(t + i)) * 0.5, 0, s * 2.4 * Math.sin(t * 0.7));
        b.material.color.copy(i % 2 ? cols[0] : cols[1]).multiplyScalar(1.6 + pulse * 2);
        b.material.opacity = f.mode === 'game' ? 0.75 : 0.45;
      });
    },
  };
}

/** Dress the stage with a layout. key: 'custom:<id>' (so the same stage isn't rebuilt every frame). */
export function applyLayout(stage, key, layout) {
  const L = cleanLayout(layout);
  const sig = JSON.stringify(L);
  if (stage.venueId === key && stage._layoutSig === sig) return;
  clearLayout(stage);
  stage.setVenue(L.base);
  stage.venueId = key;
  stage._layoutSig = sig;
  const custom = (stage.customGroup = new THREE.Group());
  stage.scene.add(custom);
  stage.customUpdates = [];
  // backdrop: always the LED wall, in the chosen style
  stage.ledWall.visible = stage.wallFrame.visible = true;
  stage.ledUniforms.uStyle.value = BACKDROP_STYLE[L.backdrop] ?? 0;
  stage.wallBright = 1;
  // floor
  const fl = floorLook(L.floor);
  const fm = stage.floor.material;
  stage._floorBase ||= { color: fm.color.clone(), roughness: fm.roughness, metalness: fm.metalness };
  fm.map = fl.map || null;
  fm.emissiveMap = fl.emissiveMap || null;
  fm.emissive.set(fl.emissive ?? 0x000000);
  fm.emissiveIntensity = fl.emissive ? 1.2 : 1;
  fm.color.set(fl.map ? 0xffffff : (fl.color ?? 0x07060c));
  fm.roughness = fl.roughness; fm.metalness = fl.metalness;
  fm.needsUpdate = true;
  // lights
  const rig = L.rig;
  stage.trussMesh.visible = rig === 'truss' || rig === 'lasers';
  [...stage.heads].sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).forEach((h, i) => { h.pivot.visible = (rig === 'truss' || rig === 'lasers') ? true : rig === 'minimal' ? i < 4 : false; });
  if (rig === 'lasers') { const l = lasers(); custom.add(l.obj); stage.customUpdates.push(l.update); }
  if (rig === 'disco') { const d = buildOverhead('discoball'); d.obj.position.set(0, 10.5, -0.5); custom.add(d.obj); stage.customUpdates.push(d.update); }
  stage.lightScale = rig === 'none' ? 0.45 : 1;
  for (const p of stage.pillars) p.visible = false;
  for (const s of stage.stacks) s.mesh.visible = false; // the wings decide what stands there
  // props
  for (const [slot, spots] of Object.entries(SLOT_AT)) {
    const id = L[slot];
    if (!id || id === 'none') continue;
    for (const [x, y, z, sc, ry] of spots) {
      const p = buildProp(id);
      p.obj.position.set(x, y, z);
      p.obj.scale.setScalar(sc);
      p.obj.rotation.y = ry;
      custom.add(p.obj);
      if (p.update) stage.customUpdates.push(p.update);
    }
  }
  if (L.overhead !== 'none') { const o = buildOverhead(L.overhead); o.obj.position.set(0, 10.5, -1); custom.add(o.obj); if (o.update) stage.customUpdates.push(o.update); }
  const fx = buildFx(L.fx);
  if (fx) { custom.add(fx.pts); stage.customUpdates.push((dt, t) => { fx.u.uTime.value = t; }); }
  // crowd + colours
  stage.crowd.count = Math.max(1, Math.round(stage.crowdData.length * (CROWD[L.crowd] ?? 1)));
  stage.phones.pts.visible = L.crowd !== 'empty';
  stage.gels = GEL_SETS[L.gels] || GEL_SETS.classic;
  stage.paletteIndex = 0;
  stage.tgtA.set(stage.gels[0][0]); stage.tgtB.set(stage.gels[0][1]);
}

/** Back to a plain venue. */
export function clearLayout(stage) {
  if (!stage.customGroup) return;
  stage.scene.remove(stage.customGroup);
  stage.customGroup.traverse((o) => { o.geometry?.dispose?.(); });
  stage.customGroup = null;
  stage.customUpdates = [];
  stage._layoutSig = null;
  const fm = stage.floor.material, b = stage._floorBase;
  if (b) { fm.map = null; fm.emissiveMap = null; fm.emissive.set(0); fm.color.copy(b.color); fm.roughness = b.roughness; fm.metalness = b.metalness; fm.needsUpdate = true; }
}

/** The camera spot for each slot (the stage designer frames what you're editing). → { pos, tgt } */
export function slotView(slot) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  switch (slot) {
    case 'wingL': return { pos: V(-4, 5, 9), tgt: V(-11, 3.5, -1.6) };
    case 'wingR': return { pos: V(4, 5, 9), tgt: V(11, 3.5, -1.6) };
    case 'upstage': case 'backdrop': return { pos: V(0, 5, 10), tgt: V(0, 5, -7) };
    case 'downstage': return { pos: V(0, 3.5, 13), tgt: V(0, 2.4, 1.7) };
    case 'overhead': case 'rig': return { pos: V(0, 3, 14), tgt: V(0, 9.5, -1) };
    case 'floor': return { pos: V(0, 9, 14), tgt: V(0, 0, 2) };
    case 'crowd': return { pos: V(0, 9, -5), tgt: V(0, 0, 12) };
    default: return { pos: V(0, 6, 19), tgt: V(0, 3.6, -3) };
  }
}

export { itemOf };
