// World 4: the Crystal Aurora. An ice cathedral under the northern lights: a sparkling snow floor, crystal
// formations that glow with the music, ice arches, a frozen waterfall, snowy peaks and falling snow. The boss, the
// Frost Wyrm, is an ice dragon with crystal wings that circles the sky, perches on the arches and breathes frost.
import { THREE, V, rand, ease, skyDome, particleField, instances, animatedStandard, glow, std, BossRig } from './common.js';

const icy = (color = 0xbfe9ff, glowAmt = 1) => animatedStandard({ color, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }, {
  frag: `
    float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5);
    float inner = 0.5 + 0.5 * sin(vWPos.y * 1.3 - uTime * 1.5 + noise(vWPos * 0.5) * 6.0);
    totalEmissiveRadiance += vec3(0.35, 0.8, 1.0) * (fres * 0.75 + inner * 0.1) * uGlow;`,
  uniforms: { uGlow: { value: glowAmt } },
});

export function buildAurora() {
  const group = new THREE.Group();

  // night sky with the aurora: curtains of green and violet light rippling across the stars
  const sky = skyDome(`
    void main() {
      vec3 d = vDir; float y = d.y;
      vec3 col = mix(vec3(0.01, 0.025, 0.06), vec3(0.0, 0.0, 0.015), smoothstep(0.0, 0.8, y));
      col += vec3(0.05, 0.1, 0.16) * exp(-abs(y) * 8.0);
      vec3 g = floor(d * 300.0);
      col += vec3(step(0.997, hash(g))) * (0.5 + 0.5 * sin(uTime * 3.0 + hash(g + 2.0) * 40.0));
      float az = atan(d.x, d.z);
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float line = 0.42 + fk * 0.1 + 0.07 * sin(az * (2.0 + fk) + uTime * (0.12 + fk * 0.05)) + 0.05 * fbm(vec3(az * 3.0, fk, uTime * 0.05));
        float curtain = exp(-pow((y - line) * (9.0 - fk * 2.0), 2.0)) * smoothstep(line - 0.25, line, y);
        float rays = 0.4 + 0.6 * fbm(vec3(az * 40.0, y * 2.0, uTime * 0.2 + fk));
        vec3 c = mix(vec3(0.1, 1.0, 0.45), vec3(0.6, 0.25, 1.0), smoothstep(line - 0.05, line + 0.12, y) + fk * 0.25);
        col += c * curtain * rays * (0.9 - fk * 0.2);
      }
      gl_FragColor = vec4(col, 1.0);
    }`);
  group.add(sky.mesh);

  // snow and ice underfoot: drifts, cracks in the ice and glints that sparkle as you move
  const snow = animatedStandard({ color: 0xdfeaff, roughness: 0.7 }, {
    vertex: 'transformed.z += fbm(vec3(position.xy * 0.06, 0.0)) * 2.2 * smoothstep(20.0, 45.0, length(position.xy));',
    frag: `
      float ice = smoothstep(26.0, 18.0, length(vWPos.xz - vec2(0.0, -4.0)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.62, 0.8), ice * 0.7);
      float crack = smoothstep(0.015, 0.0, abs(noise(vWPos * 0.6) - 0.5)) * ice;
      totalEmissiveRadiance += vec3(0.5, 0.85, 1.0) * crack * 0.8;
      float glint = step(0.9985, hash(floor(vWPos * 18.0))) * (0.5 + 0.5 * sin(uTime * 6.0 + vWPos.x * 40.0));
      totalEmissiveRadiance += vec3(glint) * 2.5;`,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(160, 120), snow.mat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // crystal formations (glow with the music)
  const crystalGeo = (() => {
    const shaft = new THREE.CylinderGeometry(1, 1, 4, 6).translate(0, 2, 0).toNonIndexed();
    const tip = new THREE.ConeGeometry(1, 1.8, 6).translate(0, 4.9, 0).toNonIndexed();
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) { const a = shaft.attributes[k].array, b = tip.attributes[k].array; const out = new Float32Array(a.length + b.length); out.set(a); out.set(b, a.length); g.setAttribute(k, new THREE.BufferAttribute(out, k === 'uv' ? 2 : 3)); }
    return g;
  })();
  const crystal = icy(0xbfe9ff, 1);
  group.add(instances(crystalGeo, crystal.mat, 150, (i, d) => {
    const cluster = Math.floor(i / 6), s = cluster % 2 ? 1 : -1;
    const cx = cluster < 8 ? s * (15 + (cluster % 4) * 4) : (cluster % 9) * 7 - 28, cz = cluster < 8 ? -10 + (cluster % 4) * 6 : -24 - (cluster % 3) * 6;
    d.position.set(cx + rand(-1.5, 1.5), 0, cz + rand(-1.5, 1.5));
    d.rotation.set(rand(-0.5, 0.5), rand(0, 6), rand(-0.5, 0.5));
    const k = rand(0.4, 1.4); d.scale.set(k * rand(0.6, 1), k * rand(0.8, 2.2), k * rand(0.6, 1));
  }));
  // ice spikes along the front of the stage
  group.add(instances(new THREE.ConeGeometry(0.35, 1.6, 5).translate(0, 0.8, 0), crystal.mat, 40, (i, d) => { d.position.set(-13 + i * 0.66, 0, 3.4 + Math.sin(i) * 0.3); d.scale.set(1, rand(0.5, 1.5), 1); d.rotation.z = rand(-0.2, 0.2); }));

  // the ice cathedral: arches and pillars behind the band
  const archIce = icy(0x7fb8e0, 0.45);
  const arches = [];
  for (let k = 0; k < 3; k++) {
    const a = new THREE.Mesh(new THREE.TorusGeometry(12 + k * 4, 0.9 - k * 0.15, 10, 64, Math.PI), archIce.mat);
    a.position.set(0, 0, -14 - k * 7);
    group.add(a); arches.push(a);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 6, 6).translate(0, 3, 0), archIce.mat);
      p.position.set(s * (12 + k * 4), 0, -14 - k * 7);
      group.add(p);
    }
  }
  // a frozen waterfall falling out of the cliffs at the back
  const fall = animatedStandard({ color: 0xa9d8ff, roughness: 0.1, transparent: true, opacity: 0.85, side: THREE.DoubleSide }, {
    frag: `float streak = noise(vec3(vWPos.x * 2.0, vWPos.y * 0.15, 0.0)); totalEmissiveRadiance += vec3(0.3, 0.7, 1.0) * (0.25 + streak * 0.6);`,
  });
  const falls = new THREE.Mesh(new THREE.PlaneGeometry(20, 36, 20, 30).translate(0, 18, 0), fall.mat);
  { const p = falls.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 0.5) * 1.5 + Math.random() * 0.4); falls.geometry.computeVertexNormals(); }
  falls.position.set(0, 0, -62);
  group.add(falls);
  // snowy peaks all around
  const peakMat = animatedStandard({ color: 0x3a4a60, roughness: 0.95, flatShading: true }, {
    frag: `float snowCap = smoothstep(0.55, 0.85, normal.y * 0.5 + 0.5 + (vWPos.y - 20.0) * 0.012); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.95, 1.0), snowCap);`,
  });
  const peakGeo = new THREE.ConeGeometry(1, 1, 7, 4);
  { const p = peakGeo.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.85 + Math.random() * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k); } peakGeo.computeVertexNormals(); }
  group.add(instances(peakGeo, peakMat.mat, 26, (i, d) => {
    const a = Math.PI * 0.6 + (i / 25) * Math.PI * 0.8 + rand(-0.05, 0.05), r = rand(110, 140);
    d.position.set(Math.cos(a) * r * 1.2, 0, -Math.abs(Math.sin(a)) * r);
    const h = rand(35, 75); d.scale.set(rand(25, 45), h, rand(25, 45)); d.position.y = h / 2 - 2;
  }));

  const snowFall = particleField({ n: 1400, box: [-45, 45, 0, 30, -45, 30], kind: 'fall', speed: 1.2, size: 0.09, color: 0xffffff, wobble: 1.4 });
  const motes = particleField({ n: 300, box: [-25, 25, 0, 14, -25, 10], kind: 'float', speed: 0.2, size: 0.12, colors: [0x3dff8a, 0xb36bff, 0x9fe8ff], wobble: 1.6 });
  group.add(snowFall.pts, motes.pts);

  const moon = new THREE.DirectionalLight(0xbcd4ff, 1.1); moon.position.set(20, 40, 20); group.add(moon);
  const auroraLight = new THREE.HemisphereLight(0x3dff8a, 0x0a1a2a, 0.45); group.add(auroraLight);
  const cyan = new THREE.PointLight(0x6fd8ff, 60, 50, 1.4); cyan.position.set(0, 9, -18); group.add(cyan);

  const boss = new Wyrm();
  return {
    group, boss,
    look: {
      bg: 0x02060f, fog: 0.011, fogColor: 0x0b1a2c, crowd: 0.75, crowdTint: 0xc8dcff, stageColor: 0x1b2a3a, light: 0.9, pyro: 0.5, heads: 0, phones: true,
      hide: { floor: true, wall: true, truss: true, pillars: true, stacks: true },
      gels: [[0x9fe8ff, 0x3dff8a], [0xb36bff, 0x2fd3ff], [0xffffff, 0x5aa0ff]],
    },
    update(dt, f, t, pulse) {
      for (const x of [sky.u, snow.u, crystal.u, archIce.u, fall.u, peakMat.u, snowFall.u, motes.u]) x.uTime.value = t;
      crystal.u.uGlow.value = 0.45 + (pulse || 0) * 0.9 + (f.bass || 0) * 0.6;
      auroraLight.color.setHSL(0.38 + Math.sin(t * 0.1) * 0.12, 0.9, 0.5);
      boss.update(dt, t, f);
    },
  };
}

// ---------------------------------------------------------------- the Frost Wyrm
const N = 56, RS = 14, LEN = 30;
class Wyrm extends BossRig {
  constructor() {
    super();
    this.spine = Array.from({ length: N }, (_, i) => V(-60 - i * (LEN / N), 30, -70));
    this.headPos = V(-60, 30, -70);
    const pos = new Float32Array(N * (RS + 1) * 3), nrm = new Float32Array(N * (RS + 1) * 3), uv = new Float32Array(N * (RS + 1) * 2), idx = [];
    for (let i = 0; i < N; i++) for (let k = 0; k <= RS; k++) {
      uv.set([k / RS, i / (N - 1)], (i * (RS + 1) + k) * 2);
      if (i < N - 1 && k < RS) { const a = i * (RS + 1) + k, b = a + RS + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    // neck thin, chest thick, tail tapering to a point
    this.radius = Array.from({ length: N }, (_, i) => { const s = i / (N - 1); return s < 0.12 ? 0.9 + s * 6 : s < 0.4 ? 1.6 + Math.sin((s - 0.12) / 0.28 * Math.PI) * 0.9 : 1.6 * (1 - (s - 0.4) / 0.6) + 0.08; });
    this.skin = animatedStandard({ color: 0x1f3a5c, roughness: 0.35, metalness: 0.35, fog: false, side: THREE.DoubleSide }, {
      frag: `float sc = abs(sin(vWPos.x * 3.0 + vWPos.z * 2.0) * sin(vWPos.y * 3.0)); diffuseColor.rgb *= 0.75 + 0.35 * sc;
        float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
        totalEmissiveRadiance += vec3(0.4, 0.85, 1.0) * fres * (0.8 + uFlash * 3.0) * uLife;`,
      uniforms: { uFlash: { value: 0 }, uLife: { value: 1 } },
    });
    this.body = new THREE.Mesh(geo, this.skin.mat);
    this.body.frustumCulled = false;
    this.group.add(this.body);
    this.spikeMat = icy(0xd8f4ff, 1.4);
    this.spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.35, 1.8, 5).translate(0, 0.9, 0), this.spikeMat.mat, 22);
    this.spikes.frustumCulled = false;
    this.group.add(this.spikes);
    // head
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.skin.mat); skull.scale.set(1.5, 1.1, 1.3);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 8), this.skin.mat); snout.rotation.z = -Math.PI / 2; snout.position.set(2.2, -0.15, 0); snout.scale.set(1, 1, 0.8);
    this.jaw = new THREE.Group(); this.jaw.position.set(0.6, -0.6, 0);
    const jawM = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.0, 8), this.skin.mat); jawM.rotation.z = -Math.PI / 2; jawM.position.set(1.4, 0, 0); jawM.scale.set(1, 1, 0.7);
    this.jaw.add(jawM);
    this.eyeMat = glow(0x9ff4ff, 4);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.eyeMat); e.position.set(0.8, 0.45, s * 0.85); this.head.add(e);
      for (let k = 0; k < 2; k++) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22 - k * 0.06, 3.2 - k * 1.1, 6), this.spikeMat.mat);
        horn.position.set(-0.6 - k * 0.5, 0.9, s * (0.7 + k * 0.3)); horn.rotation.set(s * 0.4, 0, 1.9 + k * 0.25);
        this.head.add(horn);
      }
    }
    this.head.add(skull, snout, this.jaw);
    this.group.add(this.head);
    // wings: bones and a crystal membrane, hinged at the shoulders
    this.wingMat = new THREE.MeshStandardMaterial({ color: 0x5a8ab8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7, side: THREE.DoubleSide, emissive: 0x2a6aaf, emissiveIntensity: 0.6, fog: false });
    this.wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(5, 3.5); shape.lineTo(11, 4.5); shape.lineTo(14, 1.5); shape.lineTo(11, 0.2); shape.lineTo(12, -2.2); shape.lineTo(8.5, -0.9); shape.lineTo(8, -3.5); shape.lineTo(5, -1.4); shape.lineTo(3.2, -3.6); shape.lineTo(1.5, -1.2); shape.lineTo(0, 0);
      const mem = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.wingMat);
      mem.rotation.x = -Math.PI / 2;
      w.add(mem);
      for (const [x, y] of [[5, 3.5], [11, 4.5], [14, 1.5], [12, -2.2], [8, -3.5], [3.2, -3.6]]) {
        const len = Math.hypot(x, y);
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, len, 6), this.spikeMat.mat);
        bone.position.set(x / 2, 0, -y / 2); bone.rotation.set(0, Math.atan2(y, x), -Math.PI / 2);
        w.add(bone);
      }
      w.scale.set(s, 1, 1);
      this.group.add(w);
      this.wings.push({ w, s });
    }
    this.breath = particleField({ n: 500, box: [-1, 1, -1, 1, 0, 26], kind: 'float', speed: 0, size: 0.9, colors: [0xdff6ff, 0x9fe8ff, 0xffffff], wobble: 1.6 });
    this.breath.pts.visible = false;
    this.head.add(this.breath.pts);
    this.shards = particleField({ n: 300, box: [-14, 14, -6, 14, -10, 10], kind: 'fall', speed: 6, size: 0.4, color: 0xbfe9ff, wobble: 2 });
    this.shards.pts.visible = false;
    this.group.add(this.shards.pts);
    this.light = new THREE.PointLight(0x9fe8ff, 150, 60, 1.3);
    this.group.add(this.light);
    this.cam = { pos: V(0, 3, 12), tgt: V(0, 16, -30) };
    this._f = [V(), V(), V(), V()];
  }

  reset() { super.reset(); this.spine?.forEach((p, i) => p.set(-70 - i * (LEN / N), 30, -80)); this.headPos?.set(-70, 30, -80); }

  pose(dt, t, f) {
    this.skin.u.uTime.value = t; this.spikeMat.u.uTime.value = t; this.breath.u.uTime.value = t; this.shards.u.uTime.value = t;
    const pres = ease(this.presence), s = this.strike, kind = this.attackKind;
    // it circles the sky, then settles above the arches; it swoops low on attacks; it falls when beaten
    const circle = V(Math.sin(t * 0.35) * 24, 27 + Math.sin(t * 0.7) * 3, -34 + Math.cos(t * 0.35) * 10);
    const perch = V(Math.sin(t * 0.3) * 5, 23 + Math.sin(t * 1.1) * 0.8, -26);
    const want = V(-90, 40, -100).lerp(circle.lerp(perch, ease(Math.min(1, this.presence * 1.3 - 0.3))), pres);
    if (s > 0) want.lerp(V(0, 12, -14), s * (kind === 'frost' ? 0.3 : 0.6));
    if (this.state === 'dying') want.set(this.headPos.x, this.headPos.y - this.dying * 40, this.headPos.z - 4);
    const d = want.sub(this.headPos), dist = d.length();
    if (dist > 0.01) this.headPos.add(d.multiplyScalar(Math.min(1, ((this.state === 'dying' ? 22 : 16 + s * 18) * dt) / dist)));
    this.spine[0].copy(this.headPos);
    const link = LEN / N;
    for (let i = 1; i < N; i++) {
      const a = this.spine[i - 1], b = this.spine[i];
      const dir = b.clone().sub(a); const l = dir.length() || 1;
      b.copy(a).add(dir.multiplyScalar(link / l));
      // flying: the body streams out behind the head (away from the stage) and the tail hangs a little
      b.z -= 0.09 * dt * 30 * (i / N); b.y -= 0.03 * dt * 30 * (i / N);
    }
    const P = this.body.geometry.attributes.position.array, Nr = this.body.geometry.attributes.normal.array;
    const [T, Nn, B, tmp] = this._f;
    Nn.set(0, 1, 0);
    for (let i = 0; i < N; i++) {
      T.subVectors(this.spine[Math.max(0, i - 1)], this.spine[Math.min(N - 1, i + 1)]).normalize();
      B.crossVectors(T, Nn).normalize(); Nn.crossVectors(B, T).normalize();
      const r = this.radius[i];
      for (let k = 0; k <= RS; k++) {
        const ang = (k / RS) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
        tmp.set(Nn.x * c + B.x * sn, Nn.y * c + B.y * sn, Nn.z * c + B.z * sn);
        const o = (i * (RS + 1) + k) * 3;
        P[o] = this.spine[i].x + tmp.x * r; P[o + 1] = this.spine[i].y + tmp.y * r * 0.9; P[o + 2] = this.spine[i].z + tmp.z * r;
        Nr[o] = tmp.x; Nr[o + 1] = tmp.y; Nr[o + 2] = tmp.z;
      }
    }
    this.body.geometry.attributes.position.needsUpdate = true;
    this.body.geometry.attributes.normal.needsUpdate = true;
    this.body.geometry.computeBoundingSphere();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let k = 0; k < 22; k++) {
      const i = 4 + k * 2;
      T.subVectors(this.spine[i - 1], this.spine[i + 1]).normalize();
      q.setFromUnitVectors(V(0, 0, 1), T);
      const r = this.radius[i];
      m.compose(V(0, r * 0.9, 0).applyQuaternion(q).add(this.spine[i]), q, V(1, 1, 1).multiplyScalar(Math.max(0.3, r / 1.6)));
      this.spikes.setMatrixAt(k, m);
    }
    this.spikes.instanceMatrix.needsUpdate = true;
    // head looks where it flies (and down at the band when it breathes)
    T.subVectors(this.spine[0], this.spine[2]).normalize();
    this.head.position.copy(this.headPos);
    this.head.quaternion.setFromUnitVectors(V(1, 0, 0), T);
    if (kind === 'frost' && s > 0) { const look = V(0, 2, 0).sub(this.headPos).normalize(); this.head.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), look), s); }
    this.jaw.rotation.z = -0.1 - s * 0.6;
    this.breath.pts.visible = kind === 'frost' && s > 0.2;
    this.breath.pts.rotation.y = Math.PI / 2;
    this.shards.pts.visible = kind === 'shatter' && this.attackT < 3;
    this.shards.pts.position.set(0, 4, -4);
    // wings at the shoulders: slow beats, a huge downstroke for a whiteout gust
    const sh = this.spine[8];
    T.subVectors(this.spine[7], this.spine[9]).normalize();
    const yaw = Math.atan2(-T.z, T.x);
    const beat = Math.sin(t * (2.4 + s * 3)) * (0.55 + (kind === 'whiteout' ? s * 0.6 : 0));
    for (const { w, s: side } of this.wings) {
      w.position.copy(sh);
      w.rotation.set(0, yaw + Math.PI / 2, 0); // the same turn for both: scale.x = side mirrors the left wing
      w.rotateX(side * beat);
      w.scale.set(side * (1 - this.dying * 0.6), 1, 1 - this.dying * 0.6);
    }
    this.skin.u.uFlash.value = this.flash;
    this.skin.u.uLife.value = 1 - this.dying;
    this.eyeMat.color.setRGB(1.6, 3.8, 4).multiplyScalar((1 + s + this.flash) * (1 - this.dying));
    this.light.position.copy(this.headPos).add(V(0, 4, 6));
    this.light.intensity = (120 + s * 200 + this.flash * 260) * (1 - this.dying);
    this.cam.tgt.copy(this.headPos);
  }
}
