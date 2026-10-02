// World 2: the Orbital Nebula. A holo-deck platform in orbit: a painted nebula and starfield, a ringed gas giant,
// an asteroid belt, holographic rings around the stage and crystal pylons. The boss, the Void Conductor, is a
// giant eye between the stars, ringed with crystal halos, conducting the band with arms of light.
import { THREE, V, rand, ease, NOISE, skyDome, particleField, instances, animatedStandard, glow, std, BossRig } from './common.js';

export function buildNebula() {
  const group = new THREE.Group();
  const u = { uTime: { value: 0 }, uBass: { value: 0 }, uPulse: { value: 0 } };

  // the nebula: three layers of coloured gas, a galaxy band and stars
  const sky = skyDome(`
    void main() {
      vec3 d = vDir;
      float n1 = fbm(d * 2.2 + vec3(0.0, 0.0, uTime * 0.01));
      float n2 = fbm(d * 4.5 - vec3(uTime * 0.008, 0.0, 0.0) + n1);
      vec3 col = vec3(0.005, 0.004, 0.02);
      col += vec3(0.45, 0.08, 0.55) * pow(n1, 3.0) * 1.4;
      col += vec3(0.05, 0.35, 0.6) * pow(n2, 4.0) * 1.8;
      col += vec3(0.9, 0.3, 0.4) * pow(fbm(d * 7.0 + n2 * 2.0), 6.0) * 1.5;
      float band = exp(-pow(dot(d, normalize(vec3(0.3, 1.0, 0.2))) * 4.0, 2.0));
      col += vec3(0.5, 0.45, 0.6) * band * 0.25 * fbm(d * 30.0);
      vec3 g = floor(d * 280.0);
      float star = step(0.9975, hash(g)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 1.0) * 50.0));
      col += vec3(star) * (0.8 + 1.2 * hash(g + 3.0));
      gl_FragColor = vec4(col, 1.0);
    }`);
  group.add(sky.mesh);

  // a ringed gas giant and a moon
  const planet = new THREE.Mesh(new THREE.SphereGeometry(38, 64, 48), new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime },
    vertexShader: 'varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }',
    fragmentShader: `uniform float uTime; varying vec3 vP; varying vec3 vN; varying vec3 vW; ${NOISE}
      void main(){ float lat = vP.y / 38.0; float bands = sin(lat * 22.0 + fbm(vP * 0.08 + vec3(uTime * 0.02, 0.0, 0.0)) * 4.0);
        vec3 c = mix(vec3(0.75, 0.45, 0.3), vec3(0.95, 0.8, 0.55), 0.5 + 0.5 * bands);
        c = mix(c, vec3(0.55, 0.22, 0.25), smoothstep(0.6, 0.9, fbm(vP * 0.15)));
        float spot = smoothstep(0.25, 0.0, length(vec2(atan(vP.z, vP.x) - 1.2, lat + 0.25) * vec2(1.0, 3.0)));
        c = mix(c, vec3(0.8, 0.3, 0.15), spot);
        float light = clamp(dot(vN, normalize(vec3(1.0, 0.4, 0.6))), 0.0, 1.0);
        float rim = pow(1.0 - abs(dot(vN, normalize(cameraPosition - vW))), 3.0);
        gl_FragColor = vec4(c * (0.08 + light * 1.1) + vec3(0.4, 0.6, 1.0) * rim * 0.8, 1.0); }`,
    fog: false,
  }));
  planet.position.set(-75, 18, -125);
  planet.rotation.z = 0.35;
  group.add(planet);
  const rings = new THREE.Mesh(new THREE.RingGeometry(48, 78, 128, 1), new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vP; void main(){ float r = length(vP); float b = 0.5 + 0.5 * sin(r * 2.7) * sin(r * 0.9 + 1.0); float a = smoothstep(48.0, 52.0, r) * smoothstep(78.0, 72.0, r) * (0.25 + 0.6 * b); if (r > 60.0 && r < 62.0) a *= 0.1; gl_FragColor = vec4(vec3(0.9, 0.78, 0.62) * (0.5 + 0.6 * b), a * 0.8); }',
    transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
  }));
  rings.position.copy(planet.position);
  rings.rotation.set(Math.PI / 2 - 0.35, 0.2, 0.35);
  group.add(rings);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 24), std(0xb8b4c8, 0.9, 0, { fog: false, emissive: 0x3a3650, emissiveIntensity: 0.8 }));
  moon.position.set(60, 40, -110);
  group.add(moon);

  // the holo-deck: a hexagon-grid platform under the crowd and the stage, pulsing with the music
  const deck = animatedStandard({ color: 0x0b0a18, roughness: 0.25, metalness: 0.8 }, {
    fragHead: `
      vec2 hexd(vec2 p) { vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5; vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h; return dot(a, a) < dot(b, b) ? a : b; }`,
    frag: `
      vec2 q = hexd(vWPos.xz * 0.45);
      float edge = smoothstep(0.42, 0.5, max(abs(q.x) * 0.866 + abs(q.y) * 0.5, abs(q.y)));
      float wave = 0.5 + 0.5 * sin(length(vWPos.xz) * 0.35 - uTime * 3.0);
      float r = length(vWPos.xz);
      totalEmissiveRadiance += mix(vec3(0.2, 0.6, 1.0), vec3(0.8, 0.2, 1.0), wave) * edge * (0.35 + uPulse * 0.9) * smoothstep(48.0, 30.0, r);
      totalEmissiveRadiance += vec3(0.3, 0.8, 1.0) * smoothstep(0.6, 0.0, abs(r - 46.0)) * 2.0;
      if (r > 47.0) discard;`,
    uniforms: { uPulse: u.uPulse },
  });
  const platform = new THREE.Mesh(new THREE.CircleGeometry(48, 96), deck.mat);
  platform.rotation.x = -Math.PI / 2;
  group.add(platform);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(47, 30, 6, 64, 1, true), std(0x15122a, 0.5, 0.7, { side: THREE.DoubleSide }));
  under.position.y = -3;
  group.add(under);

  // holographic rings around the stage
  const holo = [];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(14 + k * 3.5, 0.06, 6, 160), glow([0x29e0ff, 0xb36bff, 0xff2d7a][k], 2));
    m.position.set(0, 8, -6);
    holo.push(m);
    group.add(m);
  }

  // crystal pylons at the edge of the deck
  const pylonMat = std(0x6b5cff, 0.15, 0.4, { emissive: 0x3a1aff, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 });
  const pylons = instances(new THREE.OctahedronGeometry(1.2, 0).scale(0.7, 3.2, 0.7), pylonMat, 14, (i, d) => {
    const a = Math.PI * 0.15 + (i / 13) * Math.PI * 1.7;
    d.position.set(Math.sin(a) * 40, 4.5 + Math.sin(i * 1.7) * 1.5, Math.cos(a) * 40 - 4);
    d.rotation.set(0.1, i, 0.15);
  });
  group.add(pylons);

  // the asteroid belt, turning slowly around everything
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  { const p = rockGeo.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.75 + Math.random() * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); } rockGeo.computeVertexNormals(); }
  const belt = new THREE.Group();
  belt.add(instances(rockGeo, std(0xa09080, 0.9, 0, { emissive: 0x2a1c30, emissiveIntensity: 0.6 }), 300, (i, d) => {
    const a = Math.random() * Math.PI * 2, r = rand(95, 140);
    d.position.set(Math.cos(a) * r, rand(4, 34) + Math.sin(a * 3) * 6, Math.sin(a) * r);
    d.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    d.scale.setScalar(rand(0.4, 2.4));
  }));
  belt.rotation.z = 0.08;
  group.add(belt);

  const stars = particleField({ n: 900, box: [-90, 90, -20, 60, -110, 60], kind: 'twinkle', speed: 0, size: 0.35, colors: [0xffffff, 0x9fe8ff, 0xffd9a0, 0xb36bff], wobble: 0 });
  const dust = particleField({ n: 500, box: [-40, 40, 0, 25, -45, 30], kind: 'float', speed: 0.15, size: 0.08, colors: [0xb36bff, 0x29e0ff], wobble: 1.2 });
  group.add(stars.pts, dust.pts);

  // comets now and then
  const comet = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.5, 26, 8, 1, true).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.8, 2.4), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  comet.visible = false;
  group.add(comet);
  let cometT = 6;

  const key = new THREE.DirectionalLight(0xffd9c0, 1.3); key.position.set(-40, 25, -40); group.add(key);
  const rim = new THREE.PointLight(0x8a5cff, 80, 60, 1.4); rim.position.set(0, 14, -20); group.add(rim);

  const boss = new Conductor();
  return {
    group, boss,
    look: {
      bg: 0x02010a, fog: 0.006, fogColor: 0x0a0418, crowd: 0.6, crowdTint: 0x9b8cff, stageColor: 0x15122a, light: 1, pyro: 0.6, heads: 0, phones: true,
      hide: { floor: true, wall: true, truss: true, pillars: true, stacks: true },
      gels: [[0xb36bff, 0x29e0ff], [0xff2d7a, 0x6b2bb0], [0x3dff8a, 0x2447d8]],
    },
    update(dt, f, t, pulse) {
      u.uTime.value = t; sky.u.uTime.value = t; deck.u.uTime.value = t; stars.u.uTime.value = t; dust.u.uTime.value = t;
      u.uPulse.value = pulse || 0;
      belt.rotation.y += dt * 0.01;
      planet.rotation.y += dt * 0.004;
      holo.forEach((m, i) => { m.rotation.set(Math.PI / 2 + Math.sin(t * 0.3 + i) * 0.5, t * (0.1 + i * 0.07), Math.cos(t * 0.2 + i * 2) * 0.4); m.material.color.setRGB(...[[0.3, 1.6, 2], [1.4, 0.7, 2], [2, 0.4, 1.0]][i]).multiplyScalar(0.7 + (pulse || 0) * 0.8); });
      pylonMat.emissiveIntensity = 0.8 + (pulse || 0) * 1.5 + (f.bass || 0);
      cometT -= dt;
      if (cometT < 0) {
        comet.visible = true;
        comet.userData = { t: 0, from: V(rand(-80, 80), rand(30, 60), rand(-100, -60)), dir: V(rand(-1, 1), -0.3, rand(0.2, 0.6)).normalize() };
        comet.quaternion.setFromUnitVectors(V(1, 0, 0), comet.userData.dir);
        cometT = rand(7, 14);
      }
      if (comet.visible) { const c = comet.userData; c.t += dt; comet.position.copy(c.from).addScaledVector(c.dir, c.t * 70); if (c.t > 2.5) comet.visible = false; }
      boss.update(dt, t, f);
    },
  };
}

// ---------------------------------------------------------------- the Void Conductor
class Conductor extends BossRig {
  constructor() {
    super();
    this.home = V(0, 19, -42);
    this.eyeU = { uTime: { value: 0 }, uDilate: { value: 0.3 }, uFlash: { value: 0 }, uGlow: { value: 1 }, uCrack: { value: 0 } };
    const eye = new THREE.Mesh(new THREE.SphereGeometry(6, 64, 48), new THREE.ShaderMaterial({
      uniforms: this.eyeU,
      vertexShader: 'varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position / 6.0; vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }',
      fragmentShader: `uniform float uTime, uDilate, uFlash, uGlow, uCrack; varying vec3 vP; varying vec3 vN; varying vec3 vW; ${NOISE}
        void main(){
          vec2 p = vP.xy; float z = vP.z; float r = length(p);
          vec3 sclera = mix(vec3(0.12, 0.03, 0.18), vec3(0.32, 0.08, 0.35), fbm(vP * 4.0));
          float vein = smoothstep(0.03, 0.0, abs(fbm(vP * 9.0) - 0.5)) * smoothstep(0.35, 1.0, r);
          sclera += vec3(0.9, 0.1, 0.5) * vein * 0.8;
          float ang = atan(p.y, p.x);
          float fibers = 0.5 + 0.5 * sin(ang * 60.0 + fbm(vec3(p * 8.0, uTime * 0.2)) * 6.0);
          vec3 iris = mix(vec3(0.1, 0.9, 1.0), vec3(0.6, 0.2, 1.0), r / 0.55) * (0.6 + 0.6 * fibers);
          iris += vec3(1.0, 0.9, 0.6) * smoothstep(0.1, 0.0, abs(r - 0.3 - 0.03 * sin(uTime * 2.0))) * 0.8;
          float pupilR = 0.12 + uDilate * 0.16;
          vec3 c = sclera;
          if (z > 0.0) { c = mix(c, iris * uGlow, smoothstep(0.56, 0.52, r)); c = mix(c, vec3(0.0), smoothstep(pupilR + 0.02, pupilR, r)); }
          float crack = smoothstep(0.02, 0.0, abs(noise(vP * 12.0) - 0.5)) * uCrack;
          c += vec3(1.0, 0.85, 1.4) * crack * 3.0;
          float spec = pow(max(0.0, dot(reflect(-normalize(vec3(0.4, 0.6, 1.0)), vN), normalize(cameraPosition - vW))), 40.0);
          c += vec3(spec) * 0.8 + vec3(1.0) * uFlash;
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    this.eye = eye;
    // eyelids: two shells of dark crystal that blink
    const lidMat = std(0x1a1030, 0.3, 0.7, { emissive: 0x2a0a50, emissiveIntensity: 0.8 });
    const lidGeo = new THREE.SphereGeometry(6.35, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
    this.lidTop = new THREE.Mesh(lidGeo, lidMat); this.lidBot = new THREE.Mesh(lidGeo, lidMat);
    this.lidBot.rotation.x = Math.PI;
    this.lids = new THREE.Group(); this.lids.add(this.lidTop, this.lidBot);
    // crystal halos
    this.halos = [];
    const shard = new THREE.OctahedronGeometry(0.6, 0);
    const shardMat = std(0x9fe8ff, 0.1, 0.3, { emissive: 0x4a3aff, emissiveIntensity: 1.6 });
    for (let k = 0; k < 3; k++) {
      const h = new THREE.Group();
      h.add(new THREE.Mesh(new THREE.TorusGeometry(9 + k * 2.6, 0.12, 6, 120), glow([0x29e0ff, 0xb36bff, 0xff2d7a][k], 2)));
      h.add(instances(shard, shardMat, 16, (i, d) => { const a = (i / 16) * Math.PI * 2; d.position.set(Math.cos(a) * (9 + k * 2.6), Math.sin(a) * (9 + k * 2.6), 0); d.rotation.z = a; d.scale.set(1, 2.2, 1); }));
      this.halos.push(h);
    }
    // arms of light: ribbons that sweep like a conductor's hands
    this.arms = [];
    for (let k = 0; k < 6; k++) {
      const pts = Array.from({ length: 14 }, () => V());
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p, i) => V(i, 0, 0))), 40, 0.35, 8), glow([0x29e0ff, 0xb36bff][k % 2], 1.8));
      mesh.frustumCulled = false;
      this.arms.push({ mesh, pts, side: k < 3 ? -1 : 1, i: k % 3 });
    }
    this.core = new THREE.Group();
    this.core.add(eye, this.lids, ...this.halos, ...this.arms.map((a) => a.mesh));
    this.group.add(this.core);
    this.motes = particleField({ n: 400, box: [-16, 16, -12, 12, -6, 6], kind: 'float', speed: 0.4, size: 0.25, colors: [0xb36bff, 0x29e0ff, 0xffffff], wobble: 2 });
    this.core.add(this.motes.pts);
    this.light = new THREE.PointLight(0x9a6aff, 160, 70, 1.3);
    this.group.add(this.light);
    // meteors it throws at the stage
    this.meteors = Array.from({ length: 8 }, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), glow(0xff8a2a, 3));
      const trail = new THREE.Mesh(new THREE.ConeGeometry(0.6, 6, 8, 1, true).translate(0, -3, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.8, 0.2), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.add(trail); m.visible = false; m.userData.trail = trail;
      this.group.add(m);
      return m;
    });
    this.cam = { pos: V(0, 5, 12), tgt: this.home.clone() };
  }

  reset() { super.reset(); this.meteors?.forEach((m) => { m.visible = false; }); }

  attack(kind) {
    super.attack(kind);
    if (kind === 'meteor') this.meteors.forEach((m, i) => { m.visible = true; m.userData.t = -i * 0.18; m.userData.from = this.core.position.clone(); m.userData.to = V(rand(-12, 12), 1.5, rand(-6, 4)); });
  }

  pose(dt, t, f) {
    const pres = ease(this.presence), s = this.strike;
    this.eyeU.uTime.value = t; this.motes.u.uTime.value = t;
    // it fades in from deep space, hovers, recoils when hit, and implodes when beaten
    const p = this.home.clone().add(V(Math.sin(t * 0.4) * 3, Math.sin(t * 0.7) * 1.5, 0));
    p.z -= (1 - pres) * 60;
    if (this.flash > 0) p.x += Math.sin(this.hitT * 30) * this.flash * 0.6; // recoil (hitT is Infinity until the first hit)
    this.core.position.copy(p);
    const sc = 1.5 * (0.2 + 0.8 * pres) * (1 - ease(this.dying * 1.2) * 0.98) * (1 + this.dying * 0.4 * Math.sin(this.dying * 40));
    this.core.scale.setScalar(Math.max(0.01, sc));
    // the eye looks at the band, the pupil breathes with the bass and opens wide when it attacks
    this.eye.lookAt(V(Math.sin(t * 0.5) * 6, 4, 8));
    this.lids.quaternion.copy(this.eye.quaternion);
    this.eyeU.uDilate.value += (((f.bass || 0) * 0.6 + s * 0.8) - this.eyeU.uDilate.value) * Math.min(1, dt * 6);
    this.eyeU.uFlash.value = this.flash * 0.6;
    this.eyeU.uCrack.value = this.dying * 2;
    const blackout = this.attackKind === 'blackout' ? s : 0;
    const blink = Math.max(blackout, Math.pow(Math.max(0, Math.sin(t * 0.7)), 60));
    // open lids fold back behind the eye; closed they meet in front
    this.lidTop.rotation.x = -(1 - blink) * 1.35;
    this.lidBot.rotation.x = Math.PI + (1 - blink) * 1.35;
    const spin = 1 + (this.attackKind === 'gravity' ? s * 6 : 0);
    this.halos.forEach((h, i) => { h.rotation.set(Math.sin(t * 0.3 + i) * 1.2, t * 0.4 * spin * (i % 2 ? -1 : 1), t * 0.25 * spin); });
    // arms
    for (const a of this.arms) {
      const base = Math.PI * 0.5 + a.side * (0.9 + a.i * 0.35);
      for (let k = 0; k < a.pts.length; k++) {
        const u = k / (a.pts.length - 1);
        const sweep = Math.sin(t * 1.6 + a.i + u * 2.5) * 0.6 * (1 + s) + (f.beatHit ? 0.05 : 0);
        const ang = base + sweep * u;
        const r = 6.5 + u * (14 + s * 6);
        a.pts[k].set(Math.cos(ang) * r, Math.sin(ang) * r * 0.6 - u * 4 - 2, Math.sin(t + u * 3 + a.i) * 2 * u);
      }
      a.mesh.geometry.dispose();
      a.mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(a.pts), 40, 0.35 * (1 - this.dying), 8);
    }
    // meteors arc down onto the stage
    for (const m of this.meteors) {
      if (!m.visible) continue;
      const d = m.userData; d.t += dt;
      if (d.t < 0) { m.position.copy(this.core.position); continue; }
      const k = Math.min(1, d.t / 1.4);
      m.position.lerpVectors(d.from, d.to, k).y += Math.sin(k * Math.PI) * 6;
      m.lookAt(d.to); m.rotateX(Math.PI / 2);
      if (k >= 1) m.visible = false;
    }
    this.light.position.copy(this.core.position).add(V(0, 0, 10));
    this.light.intensity = (120 + s * 200 + this.flash * 300) * (1 - this.dying);
    this.cam.tgt.copy(this.core.position);
  }
}
