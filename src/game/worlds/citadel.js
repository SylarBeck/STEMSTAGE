// World 5: the Storm Citadel. Ancient ruins on a floating island above a sea of clouds: a stormy sunset sky with
// lightning, a glowing rune circle, broken columns, distant islands with waterfalls pouring into the void, and
// wind. The boss, the Thunderbird, is a giant eagle of the storm: wings of electric feathers, lightning between the
// wingtips, and bolts it hurls at the stage.
import { THREE, V, rand, ease, NOISE, skyDome, particleField, instances, animatedStandard, glow, std, BossRig } from './common.js';

function rockIsland(radius, depth, topMat, rockMat) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), topMat);
  top.rotation.x = -Math.PI / 2;
  g.add(top);
  const under = new THREE.LatheGeometry([[radius, 0], [radius * 0.92, -depth * 0.2], [radius * 0.6, -depth * 0.55], [radius * 0.25, -depth * 0.85], [0.5, -depth]].map(([r, y]) => new THREE.Vector2(r, y)), 48);
  { const p = under.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.15 * Math.sin(Math.atan2(z, x) * 7 + y * 0.4) + 0.08 * Math.sin(y * 1.3); p.setXYZ(i, x * k, y, z * k); } under.computeVertexNormals(); }
  g.add(new THREE.Mesh(under, rockMat));
  return g;
}

export function buildCitadel() {
  const group = new THREE.Group();
  const flash = { value: 0 };

  // a storm at sunset: orange horizon, bruised clouds swirling overhead, lightning lighting them up
  const sky = skyDome(`
    uniform float uFlash;
    void main() {
      float y = vDir.y;
      vec3 col = mix(vec3(1.0, 0.55, 0.25), vec3(0.18, 0.2, 0.32), smoothstep(-0.05, 0.35, y));
      col = mix(col, vec3(0.05, 0.06, 0.12), smoothstep(0.3, 0.9, y));
      float cl = fbm(vec3(vDir.xz * 2.5 / max(0.12, y + 0.15), uTime * 0.04));
      float cl2 = fbm(vec3(vDir.xz * 6.0 / max(0.12, y + 0.15) + cl, uTime * 0.06));
      vec3 cloudCol = mix(vec3(0.12, 0.12, 0.18), vec3(0.9, 0.5, 0.35), smoothstep(0.25, -0.05, y));
      col = mix(col, cloudCol, smoothstep(0.4, 0.8, cl * 0.7 + cl2 * 0.5) * smoothstep(-0.1, 0.15, y));
      col += vec3(0.7, 0.75, 1.0) * uFlash * (0.15 + cl2 * 0.45);
      float sun = smoothstep(0.995, 1.0, dot(vDir, normalize(vec3(0.6, 0.06, -0.8))));
      col += vec3(1.0, 0.7, 0.4) * sun * 2.0;
      gl_FragColor = vec4(col, 1.0);
    }`, { uFlash: flash });
  group.add(sky.mesh);

  // the sea of clouds far below
  const sea = animatedStandard({ color: 0xc8b8c8, roughness: 1, transparent: true, opacity: 0.95 }, {
    vertex: 'transformed.z += fbm(vec3(position.xy * 0.02, uTime * 0.03)) * 14.0;',
    frag: 'float c = fbm(vec3(vWPos.xz * 0.02 + uTime * 0.01, uTime * 0.02)); diffuseColor.rgb *= 0.55 + 0.6 * c; totalEmissiveRadiance += vec3(0.5, 0.25, 0.15) * c * 0.35 + vec3(0.6, 0.65, 1.0) * uFlash * 0.4;',
    uniforms: { uFlash: flash },
  });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 80, 80), sea.mat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = -30;
  group.add(clouds);

  // the main island: paving stones with a rune circle that glows with the music
  const paving = animatedStandard({ color: 0x8a8070, roughness: 0.9 }, {
    frag: `
      vec2 p = vWPos.xz * 0.5; vec2 g = fract(p + vec2(0.5 * floor(p.y), 0.0));
      float joint = smoothstep(0.03, 0.0, min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)));
      diffuseColor.rgb *= (0.75 + 0.35 * noise(vec3(floor(p + vec2(0.5 * floor(p.y), 0.0)), 1.0))) * (1.0 - joint * 0.5);
      float r = length(vWPos.xz - vec2(0.0, 8.0));
      float ring = smoothstep(0.25, 0.0, abs(r - 22.0)) + smoothstep(0.2, 0.0, abs(r - 19.0));
      float runes = step(0.6, noise(vec3(atan(vWPos.z - 8.0, vWPos.x) * 30.0, 0.0, 0.0))) * step(19.4, r) * step(r, 21.6);
      totalEmissiveRadiance += vec3(0.4, 0.75, 1.0) * (ring + runes * 0.8) * (0.6 + uPulse * 1.4);`,
    uniforms: { uPulse: { value: 0 } },
  });
  const rockMat = std(0x4a4038, 0.95, 0, { flatShading: true });
  const island = rockIsland(42, 34, paving.mat, rockMat);
  island.position.z = 4;
  group.add(island);

  // broken columns in a ring
  const marble = std(0xd8d0c0, 0.6);
  for (let k = 0; k < 12; k++) {
    const a = Math.PI * 0.62 + (k / 11) * Math.PI * 1.76;
    const h = k % 3 === 0 ? rand(3, 6) : rand(9, 13);
    const col = new THREE.Group();
    col.position.set(Math.cos(a) * 30, 0, Math.sin(a) * 26 + 2);
    const shaft = new THREE.CylinderGeometry(0.9, 1.0, h, 16, 6);
    { const p = shaft.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const fl = 1 + 0.05 * Math.cos(Math.atan2(z, x) * 16); p.setX(i, x * fl); p.setZ(i, z * fl); } shaft.computeVertexNormals(); }
    col.add(new THREE.Mesh(shaft.translate(0, h / 2, 0), marble));
    col.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 2.6).translate(0, 0.3, 0), marble));
    if (h > 8) col.add(new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 2.8).translate(0, h + 0.35, 0), marble));
    col.rotation.z = rand(-0.06, 0.06);
    group.add(col);
  }
  // an arch behind the band
  const arch = new THREE.Mesh(new THREE.TorusGeometry(13, 1.1, 10, 40, Math.PI), marble);
  arch.position.set(0, 0, -14);
  group.add(arch);

  // distant islands with waterfalls pouring off them
  const fallMat = animatedStandard({ color: 0xd8f0ff, roughness: 0.3, transparent: true, opacity: 0.8, side: THREE.DoubleSide }, {
    frag: 'float s = noise(vec3(vWPos.x * 1.5, vWPos.y * 0.25 + uTime * 3.0, 0.0)); diffuseColor.a *= 0.5 + 0.5 * s; totalEmissiveRadiance += vec3(0.4, 0.5, 0.6) * s * 0.5;',
  });
  const grass = std(0x5a6a3a, 0.95);
  const islands = [];
  for (const [x, y, z, r] of [[-70, 10, -60, 12], [80, 18, -80, 16], [-40, 30, -130, 20], [45, -4, -40, 8], [-95, -8, 10, 10], [110, 6, 0, 12]]) {
    const isl = rockIsland(r, r * 0.9, grass, rockMat);
    isl.position.set(x, y, z);
    for (let k = 0; k < 2; k++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, rand(4, 8), 10).translate(0, 3, 0), marble); c.position.set(rand(-r / 2, r / 2), 0, rand(-r / 2, r / 2)); isl.add(c); }
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.35, 60, 1, 20).translate(0, -30, 0), fallMat.mat);
    fall.position.set(0, 0, r * 0.92);
    isl.add(fall);
    group.add(isl);
    islands.push({ isl, y, ph: rand(0, 6) });
  }

  // lightning in the distance: jagged bolts that flash and fade
  const boltMat = new THREE.LineBasicMaterial({ color: new THREE.Color(2.5, 2.6, 3.2), transparent: true, opacity: 0 });
  const bolts = Array.from({ length: 3 }, () => { const l = new THREE.Line(new THREE.BufferGeometry(), boltMat.clone()); group.add(l); return l; });
  const strike = (line, from, to) => {
    const pts = [];
    for (let k = 0; k <= 16; k++) { const p = from.clone().lerp(to, k / 16); if (k > 0 && k < 16) p.add(V(rand(-3, 3), rand(-1, 1), rand(-3, 3))); pts.push(p); }
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    line.material.opacity = 1;
  };
  let nextBolt = 2;

  const wind = particleField({ n: 500, box: [-50, 50, 0, 30, -50, 30], kind: 'float', speed: 0, size: 0.07, color: 0xffffff, wobble: 6 });
  const motes = particleField({ n: 200, box: [-25, 25, 0, 15, -20, 25], kind: 'rise', speed: 0.6, size: 0.15, colors: [0x9fd8ff, 0xffe14d], wobble: 1 });
  group.add(wind.pts, motes.pts);

  const sun = new THREE.DirectionalLight(0xffb070, 1.5); sun.position.set(40, 12, -50); group.add(sun);
  const hemi = new THREE.HemisphereLight(0x8a90b0, 0x3a3020, 0.6); group.add(hemi);
  const flashLight = new THREE.DirectionalLight(0xc8d8ff, 0); flashLight.position.set(0, 50, -20); group.add(flashLight);

  const boss = new Thunderbird();
  return {
    group, boss, flash: (k) => { flash.value = Math.max(flash.value, k); },
    look: {
      bg: 0x1a2233, fog: 0.008, fogColor: 0x3a3346, crowd: 0.8, crowdTint: 0xe0d8d0, stageColor: 0x4a4440, light: 1, pyro: 1, heads: 0, phones: true,
      hide: { floor: true, wall: true, truss: true, pillars: true, stacks: true },
      gels: [[0xffe14d, 0x5aa0ff], [0xffffff, 0x9b5cff], [0xffc233, 0x2fd3ff]],
    },
    update(dt, f, t, pulse) {
      for (const x of [sky.u, sea.u, paving.u, fallMat.u, wind.u, motes.u]) x.uTime.value = t;
      paving.u.uPulse.value = pulse || 0;
      for (const i of islands) i.isl.position.y = i.y + Math.sin(t * 0.3 + i.ph) * 1.2;
      nextBolt -= dt;
      if (nextBolt < 0) {
        const b = bolts[Math.floor(Math.random() * bolts.length)];
        const x = rand(-120, 120), z = rand(-160, -60);
        strike(b, V(x, 80, z), V(x + rand(-20, 20), -20, z + rand(-10, 10)));
        flash.value = 1;
        nextBolt = rand(2.5, 7);
      }
      if (boss.zap) { const z = boss.zap; boss.zap = null; strike(bolts[0], z.from, z.to); flash.value = 1; }
      for (const b of bolts) b.material.opacity = Math.max(0, b.material.opacity - dt * 3);
      flash.value = Math.max(0, flash.value - dt * 2.5);
      flashLight.intensity = flash.value * 1.4;
      boss.update(dt, t, f);
    },
  };
}

// ---------------------------------------------------------------- the Thunderbird
class Thunderbird extends BossRig {
  constructor() {
    super();
    this.root = new THREE.Group();
    this.root.scale.setScalar(1.35);
    this.group.add(this.root);
    const plume = std(0x1a2a4a, 0.55, 0.3);
    const belly = std(0xd8c8a0, 0.7);
    this.featherU = { uTime: { value: 0 }, uCharge: { value: 0.3 } };
    // body: a streamlined lathe
    const body = new THREE.Mesh(new THREE.LatheGeometry([[0.2, -9], [2.5, -7], [4.2, -3], [4.6, 0], [3.8, 4], [2.2, 7], [1.6, 8.5]].map(([r, y]) => new THREE.Vector2(r, y)), 32), plume);
    body.rotation.x = Math.PI / 2;
    this.root.add(body);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(3.8, 24, 16), belly); chest.position.set(0, -1.6, 2.5); chest.scale.set(0.95, 0.9, 1.1);
    this.root.add(chest);
    // head: skull, hooked beak, crest, burning eyes
    this.head = new THREE.Group(); this.head.position.set(0, 1.5, 9.5); this.root.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(2.1, 24, 16), plume); skull.scale.set(1, 1, 1.2); this.head.add(skull);
    const beakMat = std(0xe6b84a, 0.35, 0.4);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 12), beakMat); beak.rotation.x = Math.PI / 2 + 0.35; beak.position.set(0, -0.5, 2.6); this.head.add(beak);
    const hook = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.0, 8), beakMat); hook.rotation.x = Math.PI - 0.2; hook.position.set(0, -1.6, 3.7); this.head.add(hook);
    this.eyeMat = glow(0xffe14d, 4);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), this.eyeMat); e.position.set(s * 1.25, 0.5, 1.5); this.head.add(e); }
    for (let k = 0; k < 6; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 3.5 - k * 0.3, 5), this.featherGlow = this.featherGlow || glow(0x5aa0ff, 2.2)); c.position.set(0, 1.8 - k * 0.2, -0.5 - k * 0.8); c.rotation.x = -1.2 - k * 0.1; this.head.add(c); }
    // feathers: a blade shape with an electric edge
    const fShape = new THREE.Shape();
    fShape.moveTo(0, 0); fShape.quadraticCurveTo(0.7, 2.5, 0.25, 6.5); fShape.lineTo(0, 7); fShape.lineTo(-0.25, 6.5); fShape.quadraticCurveTo(-0.7, 2.5, 0, 0);
    const fGeo = new THREE.ShapeGeometry(fShape, 6);
    const featherMat = animatedStandard({ color: 0x223a6a, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }, {
      head: 'varying vec2 vF;', vertex: 'vF = uv;', fragHead: 'varying vec2 vF;',
      frag: 'float edge = smoothstep(0.35, 0.5, abs(vF.x - 0.5)) + smoothstep(0.85, 1.0, vF.y); float crackle = step(0.8, noise(vec3(vF * 20.0, uTime * 8.0))); totalEmissiveRadiance += vec3(0.4, 0.7, 1.4) * edge * (0.6 + uCharge * 2.0) + vec3(0.8, 0.9, 1.6) * crackle * uCharge * edge;',
      uniforms: { uCharge: this.featherU.uCharge },
    });
    this.featherMat = featherMat;
    // wings: shoulder → elbow → wrist, each carrying a row of feathers
    this.wings = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group(); shoulder.position.set(s * 3.2, 2, 3); this.root.add(shoulder);
      const segs = [];
      let parent = shoulder;
      for (let k = 0; k < 3; k++) {
        const seg = new THREE.Group();
        if (k) seg.position.x = s * 7;
        parent.add(seg);
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.5 - k * 0.12, 0.7 - k * 0.12, 7, 8), plume); bone.rotation.z = Math.PI / 2; bone.position.x = s * 3.5; seg.add(bone);
        for (let j = 0; j < 6; j++) {
          const f = new THREE.Mesh(fGeo, featherMat.mat);
          const len = 1.2 + k * 0.45 + (k === 2 ? j * 0.08 : 0);
          f.scale.set(1.3 * len, len * (1 + k * 0.25), 1);
          f.position.set(s * (0.6 + j * 1.1), 0, -0.3);
          // lying flat, pointing back from the wing bone and fanning outwards along it
          f.rotation.set(-Math.PI / 2 + 0.12, 0, -s * (0.1 + j * 0.07 + k * 0.18));
          seg.add(f);
        }
        segs.push(seg);
        parent = seg;
      }
      this.wings.push({ shoulder, segs, s });
    }
    // tail fan
    this.tail = new THREE.Group(); this.tail.position.set(0, 0, -8.5); this.root.add(this.tail);
    for (let j = 0; j < 9; j++) { const f = new THREE.Mesh(fGeo, featherMat.mat); f.scale.set(1.8, 1.6, 1); f.rotation.set(-Math.PI / 2 - 0.1, 0, (j - 4) * 0.16); this.tail.add(f); }
    // lightning arcs between the wingtips and the body
    this.arcs = Array.from({ length: 4 }, () => { const l = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color(2.4, 2.6, 3.4), transparent: true, opacity: 0.9 })); this.group.add(l); return l; });
    this.static = particleField({ n: 300, box: [-24, 24, -6, 8, -10, 10], kind: 'float', speed: 0, size: 0.35, colors: [0x9fd8ff, 0xffffff, 0xffe14d], wobble: 3 });
    this.static.pts.visible = false;
    this.root.add(this.static.pts);
    this.light = new THREE.PointLight(0x9fc8ff, 160, 70, 1.3);
    this.group.add(this.light);
    this.cam = { pos: V(0, 4, 13), tgt: V(0, 20, -36) };
    this.zap = null;
  }

  pose(dt, t, f) {
    this.featherU.uTime.value = t; this.featherMat.u.uTime.value = t; this.static.u.uTime.value = t;
    const pres = ease(this.presence), s = this.strike, kind = this.attackKind;
    // fly in from the storm, hover over the ruins (beating its wings), plummet when beaten
    const hover = V(Math.sin(t * 0.4) * 6, 21 + Math.sin(t * 1.6) * 1.2, -36);
    const pos = V(80, 50, -150).lerp(hover, pres);
    if (kind === 'gust') pos.z += s * 8;
    if (this.state === 'dying') { pos.y -= this.dying * this.dying * 60; pos.x += this.dying * 10; }
    this.root.position.copy(pos);
    // it faces the stage (its head is +z)
    this.root.rotation.set(0.2 + (kind === 'gust' ? -s * 0.4 : 0) + this.dying * 1.2, Math.sin(t * 0.4) * 0.15, Math.sin(t * 0.5) * 0.08 + this.dying * this.dying * 6);
    // wings: a big slow beat; raised high to call lightning; a huge downstroke for the gust
    const beat = Math.sin(t * 2.2 + (kind === 'gust' ? s * 4 : 0));
    const raise = kind === 'lightning' ? s : 0;
    for (const w of this.wings) {
      w.shoulder.rotation.z = w.s * (-0.15 + beat * 0.45 * (1 - raise) - raise * 0.9);
      w.segs[1].rotation.z = w.s * (0.25 + beat * 0.2);
      w.segs[2].rotation.z = w.s * (0.2 + Math.sin(t * 2.2 - 0.6) * 0.25);
      w.shoulder.rotation.y = w.s * 0.2;
    }
    this.tail.rotation.x = Math.sin(t * 1.3) * 0.15;
    this.head.rotation.set(-0.2 + (kind === 'static' ? -s * 0.4 : 0) + Math.sin(t * 0.9) * 0.08, Math.sin(t * 0.7) * 0.25, 0);
    const charge = 0.35 + s * 1.2 + this.flash * 2 + (f.bass || 0) * 0.5;
    this.featherU.uCharge.value = charge * (1 - this.dying);
    this.featherGlow.color.setRGB(0.6, 1.2, 2.6).multiplyScalar(0.8 + charge * 0.5);
    this.eyeMat.color.setRGB(4, 3.6, 1.2).multiplyScalar((1 + s + this.flash) * (1 - this.dying));
    // arcs crackle between the wingtips; on a lightning attack a bolt strikes the stage (the world draws it)
    this.root.updateMatrixWorld(true);
    const tipL = this.wings[0].segs[2].localToWorld(V(-7, 0, 0)), tipR = this.wings[1].segs[2].localToWorld(V(7, 0, 0)), core = this.root.localToWorld(V(0, -1, 2));
    this.arcs.forEach((l, i) => {
      const on = Math.random() < (0.25 + charge * 0.4) && this.state !== 'dying';
      l.visible = on;
      if (!on) return;
      const a = i % 2 ? tipL : tipR, b = i < 2 ? core : (i % 2 ? tipR : tipL);
      const pts = []; for (let k = 0; k <= 10; k++) { const p = a.clone().lerp(b, k / 10); if (k % 10) p.add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1))); pts.push(p); }
      l.geometry.dispose(); l.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    });
    if (kind === 'lightning' && this.attackT > 0.5 && !this._zapped) { this._zapped = true; this.zap = { from: (Math.random() < 0.5 ? tipL : tipR).clone(), to: V(rand(-8, 8), 1.4, rand(-4, 2)) }; }
    if (this.attackT < 0.1) this._zapped = false;
    this.static.pts.visible = kind === 'static' && this.attackT < 3;
    this.light.position.copy(core).add(V(0, 4, 8));
    this.light.intensity = (120 + charge * 120) * (1 - this.dying);
    this.cam.tgt.copy(core);
  }
}
