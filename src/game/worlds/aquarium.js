// World 1: the Abyssal Aquarium. A stage on the sea floor under a glass dome: caustics dancing on the sand, god
// rays, kelp forests, coral, schools of fish, jellyfish and bubbles. The boss, the Leviathan, is a sea serpent a
// hundred metres long that circles in the dark water beyond the glass.
import { THREE, V, rand, ease, NOISE, skyDome, particleField, instances, animatedStandard, canvasTex, glow, std, BossRig } from './common.js';

export function buildAquarium() {
  const group = new THREE.Group();
  const u = { uTime: { value: 0 }, uBass: { value: 0 }, uPulse: { value: 0 } };

  // the water all around: deep blue going teal near the surface, with light shafts from above
  const sky = skyDome(`
    void main() {
      float y = vDir.y;
      vec3 deep = vec3(0.0, 0.025, 0.06), mid = vec3(0.0, 0.12, 0.2), top = vec3(0.12, 0.45, 0.55);
      vec3 col = mix(deep, mid, smoothstep(-0.3, 0.25, y));
      col = mix(col, top, smoothstep(0.2, 0.9, y));
      float rays = pow(max(0.0, sin(atan(vDir.x, vDir.z) * 14.0 + sin(uTime * 0.3) * 2.0 + fbm(vDir * 3.0 + uTime * 0.05) * 3.0)), 6.0);
      col += vec3(0.25, 0.55, 0.6) * rays * smoothstep(0.0, 0.7, y) * 0.35;
      float surf = fbm(vec3(vDir.xz * 9.0 / max(0.2, y), uTime * 0.2));
      col += vec3(0.4, 0.8, 0.85) * smoothstep(0.55, 0.95, y) * pow(surf, 3.0) * 1.5;
      gl_FragColor = vec4(col, 1.0);
    }`);
  group.add(sky.mesh);

  // sand with caustics
  const sand = animatedStandard({ color: 0xb59a6a, roughness: 0.95 }, {
    vertex: 'transformed.z += (noise(vec3(position.xy * 0.15, 0.0)) - 0.5) * 0.8;',
    frag: `
      vec2 p = vWPos.xz * 0.35;
      float c = 0.0;
      for (int k = 0; k < 3; k++) {
        vec2 q = p * (1.0 + float(k) * 0.7) + vec2(uTime * 0.25, uTime * 0.17) * (1.0 + float(k) * 0.3);
        c += pow(abs(sin(q.x + 2.0 * sin(q.y * 0.9 + uTime * 0.6)) * sin(q.y + 2.0 * sin(q.x * 1.1 - uTime * 0.5))), 6.0);
      }
      float ripple = 0.85 + 0.15 * sin(vWPos.x * 1.7 + sin(vWPos.z * 0.6) * 2.0);
      diffuseColor.rgb *= ripple * (0.75 + 0.25 * noise(vWPos * 0.4));
      totalEmissiveRadiance += vec3(0.2, 0.55, 0.6) * c * 0.35 * (1.0 + uBass);
    `,
    uniforms: { uBass: u.uBass },
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240, 120, 120), sand.mat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // the glass dome behind and over the stage, with steel ribs
  const glass = new THREE.Mesh(new THREE.SphereGeometry(30, 64, 32, Math.PI * 0.05, Math.PI * 0.9, 0, Math.PI * 0.5),
    new THREE.ShaderMaterial({
      uniforms: { uTime: u.uTime },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vW; ${NOISE}
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), vV)), 3.0); float streak = smoothstep(0.7, 1.0, noise(vec3(vW.x * 0.3, vW.y * 0.05, uTime * 0.2)));
          vec3 c = vec3(0.4, 0.85, 1.0) * (f * 0.55 + streak * 0.05); gl_FragColor = vec4(c, f * 0.45 + 0.03); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
  glass.rotation.y = Math.PI * 0.5;
  glass.position.set(0, 0, -2);
  group.add(glass);
  const ribMat = std(0x4a5a66, 0.35, 0.9);
  for (let k = 0; k < 9; k++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(30.1, 0.18, 8, 64, Math.PI), ribMat);
    rib.rotation.y = -Math.PI * 0.45 + (k / 8) * Math.PI * 0.9;
    rib.position.set(0, 0, -2);
    group.add(rib);
  }
  for (let k = 0; k < 4; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(30.1 * Math.cos((k + 1) * 0.3), 0.12, 6, 96, Math.PI * 0.9), ribMat);
    ring.rotation.set(-Math.PI / 2, 0, Math.PI * 0.05 + Math.PI);
    ring.position.set(0, 30.1 * Math.sin((k + 1) * 0.3), -2);
    group.add(ring);
  }

  // kelp forests: tall swaying ribbons
  const kelp = animatedStandard({ color: 0x2f6b2a, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x0a2a10, emissiveIntensity: 0.6 }, {
    head: 'attribute float aPhase;',
    vertex: 'float h = uv.y; transformed.x += sin(uTime * 0.9 + aPhase + h * 2.5) * h * h * 1.6; transformed.z += cos(uTime * 0.7 + aPhase * 1.3 + h * 2.0) * h * 0.8;',
  });
  const kelpGeo = new THREE.PlaneGeometry(0.7, 14, 1, 24).translate(0, 7, 0);
  { const p = kelpGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - y / 16) * (1 + 0.4 * Math.sin(y * 1.3))); } kelpGeo.computeVertexNormals(); }
  const KN = 220;
  const kelpPhase = new Float32Array(KN);
  const kelpMesh = instances(kelpGeo, kelp.mat, KN, (i, d) => {
    const side = i % 2 ? 1 : -1;
    const behind = i % 5 === 0;
    d.position.set(behind ? rand(-40, 40) : side * rand(16, 40), 0, behind ? rand(-45, -32) : rand(-30, 18));
    d.rotation.y = rand(0, Math.PI);
    d.scale.set(rand(0.7, 1.3), rand(0.6, 1.4), 1);
    kelpPhase[i] = Math.random() * 10;
  });
  kelpGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(kelpPhase, 1));
  group.add(kelpMesh);

  // coral reef along the front of the stage and the sides: brain coral, tube coral with glowing tips, fans
  const brainGeo = new THREE.SphereGeometry(1, 16, 11);
  { const p = brainGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.08 * Math.sin(x * 9 + Math.sin(z * 7) * 2) * Math.sin(y * 8); p.setXYZ(i, x * k, y * k * 0.7, z * k); } brainGeo.computeVertexNormals(); }
  const coralCols = [0xff7a6a, 0xff9ad0, 0xffc26a, 0xb48cff, 0x6affd0];
  const brain = instances(brainGeo, std(0xffffff, 0.75), 70, (i, d) => {
    const s = i % 2 ? 1 : -1;
    d.position.set(i < 30 ? rand(-14, 14) : s * rand(13, 26), 0.2, i < 30 ? rand(3.2, 5) : rand(-10, 8));
    d.scale.setScalar(rand(0.4, 1.1));
  });
  for (let i = 0; i < 70; i++) brain.setColorAt(i, new THREE.Color(coralCols[i % coralCols.length]).multiplyScalar(0.8));
  group.add(brain);
  const tubeGeo = new THREE.CylinderGeometry(0.08, 0.12, 1, 8).translate(0, 0.5, 0);
  const tubes = instances(tubeGeo, std(0xe86a8a, 0.6), 260, (i, d) => {
    const cluster = Math.floor(i / 10), s = cluster % 2 ? 1 : -1;
    const cx = cluster < 10 ? -13 + cluster * 2.9 : s * (14 + (cluster % 5) * 3), cz = cluster < 10 ? 4.5 : -8 + (cluster % 7) * 3;
    d.position.set(cx + rand(-0.6, 0.6), 0, cz + rand(-0.5, 0.5));
    d.rotation.set(rand(-0.3, 0.3), 0, rand(-0.3, 0.3));
    d.scale.set(1, rand(0.5, 1.8), 1);
  });
  group.add(tubes);
  const tipMat = glow(0x6affd0, 2.2);
  const tips = instances(new THREE.SphereGeometry(0.11, 8, 6), tipMat, 260, (i, d) => {
    const m = new THREE.Matrix4(); tubes.getMatrixAt(i, m);
    d.position.set(0, 1, 0).applyMatrix4(m);
  });
  group.add(tips);
  const fanGeo = new THREE.CircleGeometry(1.2, 18, 0, Math.PI);
  const fans = instances(fanGeo, std(0xb48cff, 0.8, 0, { side: THREE.DoubleSide, emissive: 0x2a1040 }), 24, (i, d) => {
    const s = i % 2 ? 1 : -1;
    d.position.set(s * rand(13, 22), 0, rand(-6, 8));
    d.rotation.y = rand(0, Math.PI); d.scale.setScalar(rand(0.8, 1.6));
  });
  group.add(fans);

  // schools of fish swimming on loops (all on the GPU)
  const fishGeo = (() => {
    const body = new THREE.SphereGeometry(0.22, 8, 6); body.scale(1.6, 0.6, 0.35);
    const tail = new THREE.ConeGeometry(0.16, 0.3, 4); tail.rotateZ(Math.PI / 2); tail.translate(-0.45, 0, 0); tail.scale(1, 1, 0.3);
    const g = new THREE.BufferGeometry();
    const a = body.toNonIndexed(), b = tail.toNonIndexed();
    const merge = (k) => { const out = new Float32Array(a.attributes[k].array.length + b.attributes[k].array.length); out.set(a.attributes[k].array); out.set(b.attributes[k].array, a.attributes[k].array.length); return out; };
    g.setAttribute('position', new THREE.BufferAttribute(merge('position'), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(merge('normal'), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(merge('uv'), 2));
    return g;
  })();
  const FN = 520;
  const path = new Float32Array(FN * 4), center = new Float32Array(FN * 3);
  const schools = [[-22, 7, -16, 9], [20, 9, -14, 8], [0, 14, -26, 16], [-30, 5, 4, 6], [28, 6, 6, 7]];
  for (let i = 0; i < FN; i++) {
    const s = schools[i % schools.length];
    center.set([s[0] + rand(-1.5, 1.5), s[1] + rand(-1.5, 1.5), s[2] + rand(-1.5, 1.5)], i * 3);
    path.set([s[3] + rand(-1, 1), rand(-1, 1), (i % 2 ? 1 : 1) * (0.35 + Math.random() * 0.1), (i % schools.length) + rand(0, 0.6)], i * 4);
  }
  fishGeo.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
  fishGeo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
  const fishMat = animatedStandard({ color: 0xffffff, roughness: 0.4, metalness: 0.4 }, {
    head: 'attribute vec4 aPath; attribute vec3 aCenter; float fishA() { return aPath.w * 6.2831 + uTime * aPath.z; }',
    vertex: `
      float a = fishA();
      transformed.z += sin(uTime * 12.0 + aPath.w * 30.0) * 0.08 * max(0.0, -position.x) * 3.0;
      vec3 dir = normalize(vec3(-sin(a), cos(a * 2.0) * 0.25, cos(a) * 0.55));
      float yaw = atan(dir.z, dir.x);
      float cy = cos(-yaw), sy = sin(-yaw);
      transformed = vec3(cy * transformed.x - sy * transformed.z, transformed.y + transformed.x * dir.y, sy * transformed.x + cy * transformed.z);
      transformed += aCenter + vec3(cos(a) * aPath.x, sin(a * 2.0) * 1.2 + aPath.y, sin(a) * aPath.x * 0.55);`,
    normal: 'float a2 = fishA(); vec3 d2 = vec3(-sin(a2), 0.0, cos(a2) * 0.55); float yaw2 = atan(d2.z, d2.x); float c2 = cos(-yaw2), s2 = sin(-yaw2); objectNormal = vec3(c2 * objectNormal.x - s2 * objectNormal.z, objectNormal.y, s2 * objectNormal.x + c2 * objectNormal.z);',
  });
  const fish = new THREE.InstancedMesh(fishGeo, fishMat.mat, FN);
  const fishCols = [0xffd23a, 0x3ab0ff, 0xff7a2a, 0xe8e8f0, 0x6affd0];
  for (let i = 0; i < FN; i++) { fish.setMatrixAt(i, new THREE.Matrix4()); fish.setColorAt(i, new THREE.Color(fishCols[i % 5])); }
  fish.frustumCulled = false;
  group.add(fish);

  // jellyfish: glowing bells that pulse with the beat, trailing tentacles
  const jellies = [];
  const bellGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  for (let k = 0; k < 16; k++) {
    const col = new THREE.Color([0x6affd0, 0xff9ad0, 0xb48cff, 0x3ab0ff][k % 4]);
    const j = new THREE.Group();
    const bell = new THREE.Mesh(bellGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    j.add(bell);
    const ten = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.15, 3.5, 12, 8, true).translate(0, -1.8, 0), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.8), transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, wireframe: true }));
    j.add(ten);
    const s = rand(0.5, 1.2);
    j.scale.setScalar(s);
    j.userData = { base: V(k % 2 ? rand(10, 30) : rand(-30, -10), rand(5, 16), rand(-30, 6)), ph: rand(0, 10), bell, ten };
    group.add(j);
    jellies.push(j);
  }

  // bubbles and drifting plankton
  const bubbles = particleField({ n: 500, box: [-35, 35, 0, 26, -40, 20], kind: 'rise', speed: 1.4, size: 0.14, color: 0xbfefff, ring: true, wobble: 0.25 });
  const plankton = particleField({ n: 700, box: [-40, 40, 0, 20, -45, 25], kind: 'float', speed: 0.2, size: 0.05, colors: [0x6affd0, 0x9fe8ff, 0xffffff], wobble: 0.8 });
  group.add(bubbles.pts, plankton.pts);

  // light from the dome
  const sun = new THREE.DirectionalLight(0x7fd8ff, 1.0);
  sun.position.set(5, 30, 10);
  group.add(sun);
  const cyan = new THREE.PointLight(0x2fd3ff, 60, 50, 1.5);
  cyan.position.set(0, 10, -18);
  group.add(cyan);

  const boss = new Leviathan();

  return {
    group, boss,
    look: {
      bg: 0x01101c, fog: 0.014, fogColor: 0x032a3c, crowd: 0.7, crowdTint: 0x8ac8e0, stageColor: 0x0d2a36, light: 0.8, pyro: 0.4, heads: 0, phones: false,
      hide: { floor: true, wall: true, truss: true, pillars: true, stacks: true },
      gels: [[0x2fd3ff, 0x1b5ed8], [0x3dffd0, 0x2447d8], [0x9fe8ff, 0xb14cff]],
    },
    update(dt, f, t) {
      u.uTime.value = t; sky.u.uTime.value = t; sand.u.uTime.value = t; kelp.u.uTime.value = t; fishMat.u.uTime.value = t;
      u.uBass.value += ((f.bass || 0) - u.uBass.value) * Math.min(1, dt * 6);
      bubbles.u.uTime.value = t; plankton.u.uTime.value = t;
      const beat = f.beat ?? t * 2;
      const pump = Math.pow(Math.max(0, Math.cos((beat % 1) * Math.PI * 2)), 4);
      for (const j of jellies) {
        const d = j.userData;
        j.position.copy(d.base).add(V(Math.sin(t * 0.2 + d.ph) * 2, Math.sin(t * 0.5 + d.ph) * 1.2, Math.cos(t * 0.15 + d.ph) * 2));
        d.bell.scale.set(1 + pump * 0.12, 1 - pump * 0.18, 1 + pump * 0.12);
        d.bell.material.opacity = 0.4 + pump * 0.4;
        d.ten.rotation.z = Math.sin(t * 1.3 + d.ph) * 0.15;
      }
      tipMat.color.setRGB(0.4, 2.2, 1.7).multiplyScalar(0.7 + pump * 0.6 + u.uBass.value);
      cyan.intensity = 40 + pump * 40;
      boss.update(dt, t, f);
    },
  };
}

// ---------------------------------------------------------------- the Leviathan
const SEG = 120, RAD = 18, LEN = 95;
class Leviathan extends BossRig {
  constructor() {
    super();
    this.spine = Array.from({ length: SEG }, (_, i) => V(-80 - i * (LEN / SEG), 8, -60));
    this.head = V(-80, 8, -60);
    // the body: a tube rebuilt around the spine every frame (SEG rings × RAD points)
    const pos = new Float32Array(SEG * (RAD + 1) * 3), nrm = new Float32Array(SEG * (RAD + 1) * 3), uv = new Float32Array(SEG * (RAD + 1) * 2);
    const idx = [];
    for (let i = 0; i < SEG; i++) for (let k = 0; k <= RAD; k++) {
      uv.set([k / RAD, i / (SEG - 1)], (i * (RAD + 1) + k) * 2);
      if (i < SEG - 1 && k < RAD) { const a = i * (RAD + 1) + k, b = a + RAD + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.radius = Array.from({ length: SEG }, (_, i) => { const s = i / (SEG - 1); return 3.1 * Math.pow(Math.sin(Math.min(1, s * 6 + 0.25) * Math.PI / 2), 0.7) * (1 - s * 0.88) + 0.12; });
    const scales = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#123844'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const cx = (x + (y % 2) * 0.5) * 16, cy = y * 16;
        const grd = g.createRadialGradient(cx, cy - 4, 1, cx, cy, 12);
        grd.addColorStop(0, '#3f8fa0'); grd.addColorStop(1, '#0a2129');
        g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI); g.fill();
      }
    }, [10, 40]);
    const spots = canvasTex(64, 256, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let y = 8; y < h; y += 16) { g.fillStyle = '#9ff'; g.beginPath(); g.arc(w * 0.25, y, 3, 0, Math.PI * 2); g.arc(w * 0.75, y + 8, 3, 0, Math.PI * 2); g.fill(); }
    }, [1, 10]);
    this.skin = new THREE.MeshStandardMaterial({ map: scales, roughness: 0.38, metalness: 0.35, emissive: 0x2fd3ff, emissiveMap: spots, emissiveIntensity: 1.6, side: THREE.DoubleSide, fog: false });
    this.body = new THREE.Mesh(geo, this.skin);
    this.body.frustumCulled = false;
    this.group.add(this.body);
    // fins along the back
    this.fins = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 2.6, 3).translate(0, 1.3, 0).scale(0.25, 1, 1.4), std(0x1f5a66, 0.5, 0.3, { emissive: 0x0a3040 }), 34);
    this.fins.frustumCulled = false;
    this.group.add(this.fins);
    // the head
    this.headG = new THREE.Group();
    const skullMat = new THREE.MeshStandardMaterial({ map: scales, roughness: 0.35, metalness: 0.35, emissive: 0x0a3a48, emissiveIntensity: 0.5, fog: false });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), skullMat); skull.scale.set(3.6, 1.9, 2.4); skull.position.x = 1.2;
    this.jaw = new THREE.Group(); this.jaw.position.set(-0.6, -0.7, 0);
    const jawM = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), skullMat); jawM.scale.set(3.6, 1.3, 2.0); jawM.position.x = 1.9;
    this.jaw.add(jawM);
    const tooth = new THREE.ConeGeometry(0.16, 0.7, 6);
    const toothMat = std(0xf2efe0, 0.3);
    for (let k = 0; k < 14; k++) {
      const a = (k / 13 - 0.5) * 2.2, x = 4.2 - Math.abs(a) * 1.4;
      const up = new THREE.Mesh(tooth, toothMat); up.position.set(x, -0.6, Math.sin(a) * 1.6); up.rotation.x = Math.PI; this.headG.add(up);
      const dn = new THREE.Mesh(tooth, toothMat); dn.position.set(x - 0.2, 0.25, Math.sin(a) * 1.4); this.jaw.add(dn);
    }
    this.eyeMat = glow(0x9ff7ff, 3.5);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), this.eyeMat); eye.position.set(2.4, 0.55, s * 1.75); this.headG.add(eye);
      for (let k = 0; k < 4; k++) { const fr = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.4 - k * 0.3, 5), skullMat); fr.position.set(-0.4 - k * 0.7, 1.2, s * (1.1 - k * 0.15)); fr.rotation.set(s * 0.6, 0, 1.9 + k * 0.1); this.headG.add(fr); }
      const barbel = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(3.6, -0.6, s * 0.9), V(4.6, -1.6, s * 1.6), V(5.0, -3.0, s * 1.2), V(4.4, -4.2, s * 1.8)]), 16, 0.08, 6), this.eyeMat);
      this.headG.add(barbel);
    }
    this.headG.add(skull, this.jaw);
    this.group.add(this.headG);
    // ink: a cloud of dark particles the boss blows at the stage
    this.cam = { pos: V(0, 4.5, 10), tgt: V(0, 9, -24) };
    // its own light, so it reads against the dark water
    this.light = new THREE.PointLight(0x5fe8ff, 120, 40, 1.4);
    this.group.add(this.light);
    this._fn = [V(), V(), V(), V()];
  }

  reset() { super.reset(); if (this.spine) { this.spine.forEach((p, i) => p.set(-90 - i * (LEN / SEG), 8, -70)); } }

  pose(dt, t) {
    // where the head wants to be: far away (hidden), circling behind the glass, or lunging at the stage when it attacks
    const pres = ease(this.presence);
    const circ = V(Math.sin(t * 0.32) * 22, 12 + Math.sin(t * 0.55) * 4, -27 + Math.cos(t * 0.32) * 6);
    const away = V(-110, 8, -90);
    const target = away.clone().lerp(circ, pres);
    const s = this.strike;
    if (s > 0) target.lerp(V(Math.sin(t * 0.32) * 8, 7, -16), s * 0.85);
    if (this.state === 'dying') target.set(this.head.x * 0.98, this.head.y - this.dying * 20, this.head.z - 5);
    // the head swims towards it, the body follows like a chain
    const speed = this.state === 'dying' ? 4 : 14 + s * 20;
    const to = target.sub(this.head);
    const d = to.length();
    if (d > 0.01) this.head.add(to.multiplyScalar(Math.min(1, (speed * dt) / d)));
    this.spine[0].copy(this.head);
    const link = LEN / SEG;
    for (let i = 1; i < SEG; i++) {
      const a = this.spine[i - 1], b = this.spine[i];
      const dir = b.clone().sub(a);
      const len = dir.length() || 1;
      b.copy(a).add(dir.multiplyScalar(link / len));
      b.y += Math.sin(t * 2.2 - i * 0.18) * 0.012; // a slow wave down the body
    }
    // rebuild the tube
    const P = this.body.geometry.attributes.position.array, N = this.body.geometry.attributes.normal.array;
    const [T, Nn, B, tmp] = this._fn;
    Nn.set(0, 1, 0);
    for (let i = 0; i < SEG; i++) {
      const a = this.spine[Math.max(0, i - 1)], b = this.spine[Math.min(SEG - 1, i + 1)];
      T.subVectors(a, b).normalize();
      B.crossVectors(T, Nn).normalize(); Nn.crossVectors(B, T).normalize();
      const r = this.radius[i] * (1 + 0.05 * Math.sin(t * 3 - i * 0.3));
      for (let k = 0; k <= RAD; k++) {
        const ang = (k / RAD) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
        tmp.set(Nn.x * c + B.x * sn, Nn.y * c * 0.85 + B.y * sn, Nn.z * c + B.z * sn);
        const o = (i * (RAD + 1) + k) * 3;
        P[o] = this.spine[i].x + tmp.x * r; P[o + 1] = this.spine[i].y + tmp.y * r; P[o + 2] = this.spine[i].z + tmp.z * r;
        N[o] = tmp.x; N[o + 1] = tmp.y; N[o + 2] = tmp.z;
      }
    }
    this.body.geometry.attributes.position.needsUpdate = true;
    this.body.geometry.attributes.normal.needsUpdate = true;
    this.body.geometry.computeBoundingSphere();
    // fins and head follow the spine
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V();
    for (let k = 0; k < 34; k++) {
      const i = 6 + k * 3;
      T.subVectors(this.spine[i - 1], this.spine[i + 1]).normalize();
      q.setFromUnitVectors(V(0, 0, 1), T);
      const r = this.radius[i];
      sc.setScalar(Math.max(0.2, r / 2.2));
      m.compose(V(0, r * 0.85, 0).applyQuaternion(q).add(this.spine[i]), q, sc);
      this.fins.setMatrixAt(k, m);
    }
    this.fins.instanceMatrix.needsUpdate = true;
    T.subVectors(this.spine[0], this.spine[3]).normalize();
    this.headG.position.copy(this.head);
    this.headG.quaternion.setFromUnitVectors(V(1, 0, 0), T);
    this.jaw.rotation.z = -0.15 - s * 0.7 - Math.max(0, Math.sin(t * 1.3)) * 0.08;
    // glow: flash white when hit, fade out when beaten
    const life = 1 - this.dying;
    this.skin.emissiveIntensity = (1.4 + this.flash * 4) * life;
    this.eyeMat.color.setRGB(1.2, 3.2, 3.4).multiplyScalar((1 + this.flash * 1.5 + s) * life);
    this.cam.tgt.copy(this.head);
    this.light.position.copy(this.head).add(V(0, 6, 8));
    this.light.intensity = (90 + this.flash * 200 + s * 120) * life;
  }
}
