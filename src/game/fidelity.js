// v3 graphics on top of the stage (game/stage.js):
//  - reflections: an environment map lit like the show — the rig's light bars and side washes in the current gels,
//    the LED wall behind, a warm key in front — re-rendered when the gels change, so chrome, clear-coat paint and the
//    gloss floor pick up the lights (High and Ultra)
//  - shadows: on Ultra the key spot casts soft shadows from the band onto the stage
//  - the music moves the world, stem by stem: the kick hits the wall light and the LED lip, the bass breathes the
//    haze, the vocals lift the key light, the guitar pushes the moving-head beams (engine.stemLevels)
import * as THREE from 'three';
import { settings } from '../settings.js';

function envRoom() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020202);
  const quad = (w, h, x, y, z, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(...look);
    scene.add(m);
    return m;
  };
  const rig = [], side = [];
  for (const z of [-6, 1, 7]) for (let i = -2; i <= 2; i++) rig.push(quad(1.6, 0.3, i * 3.4, 9.5, z, [i * 3.4, 0, z]));
  for (const x of [-12, 12]) side.push(quad(5, 2.6, x, 4.5, -1, [0, 3, -1]));
  const wall = quad(20, 7, 0, 4.5, -11, [0, 4.5, 0]);
  const key = quad(2.2, 2.2, 0, 12, 10, [0, 2, 0]);
  return { scene, rig, side, wall, key };
}

export class Fidelity {
  constructor(stage, webgl) {
    this.stage = stage;
    this.webgl = webgl;
    this.pmrem = new THREE.PMREMGenerator(webgl);
    this.room = envRoom();
    this.env = null;
    this.envKey = '';
    this.envAt = 0;
    this.shadows = false;
    this.fogBase = null;
    this.venue = null;
    this.castAt = 0;
    this.setQuality(settings.quality);
  }

  setQuality(q) {
    this.quality = q;
    const reflect = q === 'high' || q === 'ultra';
    if (!reflect && this.env) { this.stage.scene.environment = null; this.env.dispose(); this.env = null; this.envKey = ''; }
    this._setShadows(q === 'ultra');
  }

  // the stage's own lights, as a room to reflect
  _renderEnv(now) {
    const s = this.stage, R = this.room;
    const a = s.tgtA, b = s.tgtB;
    for (const m of R.rig) m.material.color.copy(a).multiplyScalar(3.2);
    for (const m of R.side) m.material.color.copy(b).multiplyScalar(1.6);
    R.wall.material.color.copy(a).multiplyScalar(0.35).add(new THREE.Color(b).multiplyScalar(0.25));
    R.key.material.color.setRGB(4.5, 3.9, 3.2);
    const target = this.pmrem.fromScene(R.scene, 0.035, 0.1, 60);
    this.env?.dispose();
    this.env = target;
    s.scene.environment = target.texture;
    s.scene.environmentIntensity = 0.42;
    this.envAt = now;
  }

  _setShadows(on) {
    const r = this.webgl, s = this.stage;
    if (this.shadows === on) return;
    this.shadows = on;
    r.shadowMap.enabled = on;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const k = s.keySpot;
    k.castShadow = on;
    k.shadow.mapSize.set(2048, 2048);
    k.shadow.bias = -0.0004;
    k.shadow.normalBias = 0.03;
    k.shadow.camera.near = 4;
    k.shadow.camera.far = 32;
    s.floor.receiveShadow = on;
    s.scene.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial && o.geometry?.type === 'BoxGeometry') o.receiveShadow = on; });
    this._cast(on);
    // shadow maps are compiled into the materials
    s.scene.traverse((o) => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
  }

  // the band and their gear cast (new looks bring new meshes, so this runs again now and then)
  _cast(on) {
    for (const m of Object.values(this.stage.band || {})) {
      const roots = [m.g, ...Object.values(m).filter((v) => v?.group?.isObject3D).map((v) => v.group)];
      for (const root of roots) root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = on; });
    }
  }

  /** Per frame, after stage.update(dt, f). f.stems: engine.stemLevels() in a song, absent in the menus. */
  frame(dt, f) {
    const s = this.stage, now = performance.now();
    if (this.quality !== 'low') {
      const key = `${s.tgtA.getHexString()}${s.tgtB.getHexString()}${s.venueId}`;
      if (key !== this.envKey && now - this.envAt > 400) { this.envKey = key; this._renderEnv(now); }
    }
    if (this.shadows && now - this.castAt > 2000) { this.castAt = now; this._cast(true); }

    if (s.venueId !== this.venue) { this.venue = s.venueId; this.fogBase = s.scene.fog.density; }
    const st = f?.stems;
    const calm = settings.calmVisuals ? 0.35 : 1;
    if (!st) { if (this.fogBase != null) s.scene.fog.density = this.fogBase; return; }
    const k = st.kick * calm, bass = st.bass * calm, voc = st.vocals * calm, gtr = st.guitar * calm;
    s.wallLight.intensity += k * 90;
    s.lipMat.color.multiplyScalar(1 + k * 1.2);
    s.ledUniforms.uPulse.value = Math.max(s.ledUniforms.uPulse.value, k * 0.8);
    if (this.fogBase != null) s.scene.fog.density = this.fogBase * (1 + bass * 0.3);
    if (s.keySpot.intensity > 0) s.keySpot.intensity += voc * 90;
    for (const h of s.heads) h.beam.material.uniforms.uIntensity.value *= 1 + gtr * 0.35;
  }
}
