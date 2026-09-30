// The venue: LED wall, truss + moving-head beams, band, crowd, pyro, confetti and a camera director.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { settings } from '../settings.js';

// lighting states, like a club rig's gels: amber + red, tungsten + deep blue, crimson + amber, white + red, gold + blue
const PALETTES = [
  [0xff9a2e, 0xd7261c],
  [0xffd9a0, 0x2447d8],
  [0xb81d3a, 0xffb347],
  [0xf2ecdf, 0xd02a1e],
  [0xffc233, 0x3050e0],
];

// The tour's venues: how many people fit, what hangs from the ceiling, what's behind the band and how much
// pyro the fire marshal allows. wall: 0 = the LED wall, 1 = bare brick, 2 = a theatre curtain.
export const VENUE_LOOKS = {
  garage: { crowd: 0.03, heads: 0, stacks: 0, truss: false, pillars: false, wall: 1, wallDim: 0.9, fog: 0.03, bg: 0x060403, fogColor: 0x0b0806, light: 0.55, pyro: 0, phones: false,
    gels: [[0xffb25e, 0x7a2a12], [0xffd9a0, 0xa4331c]] },
  club: { crowd: 0.12, heads: 4, stacks: 1, truss: false, pillars: false, wall: 0, wallDim: 0.55, fog: 0.042, bg: 0x05030a, fogColor: 0x0a0610, light: 0.75, pyro: 0, phones: false,
    gels: [[0xb14cff, 0xff2d6a], [0x3a6bff, 0xff4fd0], [0xff9a2e, 0x7a1cff]] },
  bar: { crowd: 0.2, heads: 6, stacks: 1, truss: false, pillars: true, wall: 0, wallDim: 0.7, fog: 0.032, bg: 0x070306, fogColor: 0x0c0609, light: 0.85, pyro: 0.3, phones: false,
    gels: [[0xff3d8b, 0x19d3ff], [0xff9a2e, 0xd7261c], [0xffe14d, 0xff3d8b]] },
  theater: { crowd: 0.45, heads: 8, stacks: 2, truss: true, pillars: false, wall: 2, wallDim: 1, fog: 0.022, bg: 0x070404, fogColor: 0x0b0806, light: 0.95, pyro: 0.5, phones: true,
    gels: [[0xffd9a0, 0xb81d3a], [0xffc233, 0x7a0f22], [0xf2ecdf, 0xd02a1e]] },
  arena: { crowd: 1, heads: 99, stacks: 4, truss: true, pillars: true, wall: 0, wallDim: 1, fog: 0.021, bg: 0x040302, fogColor: 0x0b0806, light: 1, pyro: 1, phones: true, gels: PALETTES },
  stadium: { crowd: 1, heads: 99, stacks: 4, truss: true, pillars: true, wall: 0, wallDim: 1.1, fog: 0.014, bg: 0x03050c, fogColor: 0x05070f, light: 1.1, pyro: 1.3, phones: true,
    gels: [[0xf2ecdf, 0x2447d8], [0xffc233, 0x3050e0], [0x9fd8ff, 0xd02a1e]] },
  festival: { crowd: 1, heads: 99, stacks: 4, truss: true, pillars: true, wall: 0, wallDim: 1.15, fog: 0.012, bg: 0x0a0f24, fogColor: 0x0d1330, light: 1.15, pyro: 1.5, phones: true,
    gels: [[0xff9a2e, 0x1cc8a0], [0xffe14d, 0xff3d8b], [0x9b5cff, 0x33e0ff]] },
};

// Band members as they look out of the box; a player's character (profiles → look) replaces the one on their part.
export const HAIR_STYLES = ['short', 'long', 'mohawk', 'bun', 'shaved'];
export const DEFAULT_LOOKS = {
  guitar: { skin: '#2a2026', hair: 'short', hairColor: '#0c0c12', top: '#3a0d1c', pants: '#0c0c12', finish: '#d81b3a' },
  bass: { skin: '#2a2026', hair: 'short', hairColor: '#0c0c12', top: '#0d1c3a', pants: '#0c0c12', finish: '#1b5ed8' },
  drums: { skin: '#2a2026', hair: 'short', hairColor: '#0c0c12', top: '#2a1a08', pants: '#0c0c12', finish: '#b86a1b' },
  keys: { skin: '#2a2026', hair: 'short', hairColor: '#0c0c12', top: '#1c0d3a', pants: '#0c0c12', finish: '#0a0a0a' },
};

const GOLD = new THREE.Color(1, 0.8, 0.3);
const WHITE = new THREE.Color(1, 1, 1);
const CROWD_COUNT = { low: 350, high: 950, ultra: 1700 };
const SPEC_LOOKUP = Array.from({ length: 128 }, (_, i) => Math.pow(i / 128, 1.6) * 0.7);

const ledVertex = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ledFragment = /* glsl */`
  varying vec2 vUv;
  uniform float uTime, uPulse, uBass, uOD, uLevel, uDim, uStyle;
  uniform vec3 uA, uB;
  uniform sampler2D uSpec;
  void main() {
    if (uStyle > 1.5) { // theatre: a red velvet curtain
      float fold = 0.55 + 0.45 * sin(vUv.x * 150.0 + sin(vUv.y * 3.0) * 0.6);
      vec3 cur = vec3(0.42, 0.04, 0.06) * fold * (0.35 + 0.65 * smoothstep(0.0, 0.9, vUv.y));
      gl_FragColor = vec4(cur * (0.6 + uPulse * 0.25) * uDim, 1.0);
      return;
    }
    if (uStyle > 0.5) { // garage: bare brick in a pool of warm light
      vec2 b = vUv * vec2(26.0, 19.0);
      b.x += 0.5 * mod(floor(b.y), 2.0);
      vec2 fb = fract(b);
      float mortar = smoothstep(0.02, 0.06, fb.x) * smoothstep(0.03, 0.09, fb.y);
      float n = fract(sin(dot(floor(b), vec2(12.9898, 78.233))) * 43758.5453);
      vec3 brick = vec3(0.30, 0.10, 0.06) * (0.55 + 0.45 * n);
      float glow = 0.3 + 0.7 * exp(-pow((vUv.x - 0.5) * 2.2, 2.0)) * smoothstep(1.0, 0.2, vUv.y);
      gl_FragColor = vec4((brick * mortar * (0.55 + uPulse * 0.3) + uA * 0.05) * glow * uDim, 1.0);
      return;
    }
    vec2 grid = vec2(176.0, 72.0);
    vec2 cell = fract(vUv * grid) - 0.5;
    float dotMask = smoothstep(0.5, 0.2, length(cell));
    vec2 q = (floor(vUv * grid) + 0.5) / grid;
    vec2 c = q - vec2(0.5, 0.5);
    c.x *= 2.45;
    float r = length(c);
    float a = atan(c.y, c.x);
    float rings = sin(9.0 * log(r + 0.03) - uTime * 2.6 - uPulse * 1.5);
    float spokes = 0.5 + 0.5 * sin(a * 6.0 + uTime * 0.6 + r * 4.0);
    float tunnel = smoothstep(0.55, 1.0, rings) * spokes * smoothstep(0.02, 0.35, r);
    float sx = abs(q.x - 0.5) * 2.0;
    float s = texture2D(uSpec, vec2(0.02 + sx * 0.6, 0.5)).r;
    float bars = step(q.y, s * 0.95) * step(0.18, fract(q.x * 44.0));
    float scan = 0.85 + 0.15 * sin(q.y * 240.0 + uTime * 8.0);
    vec3 col = mix(uA, uB, clamp(q.y + 0.25 * sin(uTime * 0.7 + q.x * 5.0), 0.0, 1.0));
    vec3 outc = col * (tunnel * 0.9 + bars * 1.1) * (0.3 + uPulse * 1.2 + uBass * 0.7);
    outc += uOD * vec3(1.0, 0.8, 0.35) * (0.25 + 0.25 * sin(uTime * 9.0 + q.y * 18.0 - q.x * 6.0));
    gl_FragColor = vec4(outc * dotMask * scan * 1.5 * uDim, 1.0);
  }`;

const beamVertex = /* glsl */`
  varying float vV; varying vec3 vN; varying vec3 vViewPos;
  void main() {
    vV = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;
const beamFragment = /* glsl */`
  uniform vec3 uColor; uniform float uIntensity;
  varying float vV; varying vec3 vN; varying vec3 vViewPos;
  void main() {
    float along = pow(vV, 1.6);
    float edge = pow(abs(dot(normalize(vN), normalize(-vViewPos))), 1.8);
    float a = along * edge * uIntensity;
    gl_FragColor = vec4(uColor * a * 1.4, a);
  }`;

function makePoints(N, additive, map) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uBoost: { value: additive ? 1.1 : 1.0 } },
    vertexShader: `attribute float aSize; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * 420.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: additive
      ? `uniform sampler2D uMap; uniform float uBoost; varying vec3 vC; void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vC * a * uBoost, a); }`
      : `varying vec3 vC; void main(){ vec2 d = abs(gl_PointCoord - 0.5); if (max(d.x, d.y) > 0.42) discard; gl_FragColor = vec4(vC, 1.0); }`,
    transparent: additive, depthWrite: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    pts, N, pos, col, size, head: 0, active: false,
    vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N).fill(1),
    c0: new Float32Array(N * 3), c1: new Float32Array(N * 3), s0: new Float32Array(N),
  };
}

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Stage {
  constructor(quality = 'high') {
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040302);
    this.scene.fog = new THREE.FogExp2(0x0b0806, 0.021);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
    this.camPos = new THREE.Vector3(0, 5, 18);
    this.camTarget = new THREE.Vector3(0, 3, -2);
    this.curTarget = this.camTarget.clone();
    this._camPos = new THREE.Vector3();
    this._camAim = new THREE.Vector3();
    this.camera.position.copy(this.camPos);
    this.time = 0;
    this.pulse = 0;
    this.paletteIndex = 0;
    this.colA = new THREE.Color(PALETTES[0][0]);
    this.colB = new THREE.Color(PALETTES[0][1]);
    this.tgtA = this.colA.clone();
    this.tgtB = this.colB.clone();
    this.shot = 'menu';
    this.shotTimer = 0;
    this.soft = softTexture();
    this.specTex = new THREE.DataTexture(new Uint8Array(128 * 4), 128, 1, THREE.RGBAFormat);
    this.specTex.needsUpdate = true;

    this._lights();
    this._venue();
    this._ledWall();
    this._truss();
    this._band();
    this._crowd();
    this._fx();
    this.setVenue('arena');
  }

  // ---------------------------------------------------------------- build
  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x453528, 0x080504, 0.5));
    this.spots = [];
    const targets = [[-4.5, 1.2, -1.5], [4.5, 1.2, -1.5], [0, 2.2, -4.8], [-8.5, 1.2, -2.5]];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SpotLight(0xffffff, 140, 40, 0.42, 0.6, 1.4);
      s.position.set(targets[i][0] * 0.6, 11, 4);
      s.target.position.set(...targets[i]);
      this.scene.add(s, s.target);
      this.spots.push(s);
    }
    this.keySpot = new THREE.SpotLight(0xffffff, 260, 40, 0.25, 0.5, 1.2);
    this.keySpot.position.set(0, 13, 7);
    this.scene.add(this.keySpot, this.keySpot.target);
    this.wallLight = new THREE.PointLight(0xff9a2e, 60, 30, 1.6);
    this.wallLight.position.set(0, 4, -5.5);
    this.scene.add(this.wallLight);
  }

  _venue() {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x07060c, roughness: 0.32, metalness: 0.65 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const stageMat = new THREE.MeshStandardMaterial({ color: 0x0c0b14, roughness: 0.25, metalness: 0.5 });
    const stage = new THREE.Mesh(new THREE.BoxGeometry(24, 1.2, 10), stageMat);
    stage.position.set(0, 0.6, -2.5);
    this.scene.add(stage);
    // stage lip LED strip
    this.lipMat = new THREE.MeshBasicMaterial({ color: 0xff9a2e });
    const lip = new THREE.Mesh(new THREE.BoxGeometry(24, 0.08, 0.08), this.lipMat);
    lip.position.set(0, 1.18, 2.5);
    this.scene.add(lip);
    const riser = new THREE.Mesh(new THREE.BoxGeometry(6, 0.7, 4), stageMat);
    riser.position.set(0, 1.55, -4.8);
    this.scene.add(riser);
    const riserLip = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 0.05), this.lipMat);
    riserLip.position.set(0, 1.9, -2.8);
    this.scene.add(riserLip);

    // speaker stacks + amps
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x111016, roughness: 0.7, metalness: 0.2 });
    const grilleMat = new THREE.MeshStandardMaterial({ color: 0x040306, roughness: 1 });
    this.stacks = [];
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.6), cabMat);
        cab.position.set(sx * 13.8, 1.2 + 0.65 + k * 1.32, -1.5);
        const gr = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.05), grilleMat);
        gr.position.set(0, 0, 0.81);
        cab.add(gr);
        this.scene.add(cab);
        this.stacks.push({ mesh: cab, level: k });
      }
      for (let k = 0; k < 2; k++) {
        const amp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.8), cabMat);
        amp.position.set(sx * (5.4 + k * 1.7), 1.75, -5.2);
        const gr = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), grilleMat);
        gr.position.z = 0.41;
        amp.add(gr);
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2) }));
        led.position.set(0.6, 0.45, 0.42);
        amp.add(led);
        this.scene.add(amp);
      }
    }
  }

  _ledWall() {
    this.ledUniforms = {
      uTime: { value: 0 }, uPulse: { value: 0 }, uBass: { value: 0 }, uOD: { value: 0 }, uLevel: { value: 0 }, uDim: { value: 1 }, uStyle: { value: 0 },
      uA: { value: this.colA }, uB: { value: this.colB }, uSpec: { value: this.specTex },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.ledUniforms, vertexShader: ledVertex, fragmentShader: ledFragment });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(24, 9.5), mat);
    wall.position.set(0, 6.2, -7.4);
    this.scene.add(wall);
    this.pillars = [];
    const frame = new THREE.Mesh(new THREE.BoxGeometry(24.6, 10, 0.3), new THREE.MeshStandardMaterial({ color: 0x08070c, roughness: 0.5 }));
    frame.position.set(0, 6.2, -7.6);
    this.scene.add(frame);
    // side LED pillars
    this.pillarMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8, 0.18), this.pillarMat);
        p.position.set(sx * (9 + k * 0.9), 5.2, -6.2 + k * 0.5);
        this.scene.add(p);
        this.pillars.push(p);
      }
    }
  }

  _truss() {
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.4, metalness: 0.9 });
    const bars = [];
    const addBar = (x, y, z, w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); bars.push(g); };
    for (const z of [-3.8, 2.2]) {
      for (const dy of [0, 0.6]) for (const dz of [0, 0.6]) addBar(0, 11 + dy, z + dz, 30, 0.08, 0.08);
      for (let x = -15; x <= 15; x += 0.6) addBar(x, 11.3, z + 0.3, 0.05, 0.75, 0.05);
    }
    for (const x of [-15, 15]) for (const z of [-3.8, 2.2]) for (const dx of [0, 0.6]) for (const dz of [0, 0.6]) addBar(x + dx - 0.3, 5.8, z + dz, 0.08, 11.6, 0.08);
    this.trussMesh = new THREE.Mesh(mergeGeometries(bars), trussMat);
    this.scene.add(this.trussMesh);

    // moving heads + beams
    this.heads = [];
    const beamGeo = new THREE.CylinderGeometry(0.06, 1.6, 22, 32, 1, true).translate(0, -11, 0);
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.55, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x151419, metalness: 0.8, roughness: 0.3 });
    const count = this.quality === 'low' ? 8 : 12;
    for (let i = 0; i < count; i++) {
      const front = i % 2 === 0;
      const x = -13 + (i / (count - 1)) * 26;
      const z = front ? 2.5 : -3.5;
      const pivot = new THREE.Group();
      pivot.position.set(x, 10.8, z);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      pivot.add(body);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), lensMat);
      lens.rotation.x = Math.PI / 2; lens.position.y = -0.28;
      pivot.add(lens);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uIntensity: { value: 0.5 } },
        vertexShader: beamVertex, fragmentShader: beamFragment,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(beamGeo, mat);
      pivot.add(beam);
      this.scene.add(pivot);
      this.heads.push({ pivot, beam, lensMat, phase: i * 0.7, front, x });
    }
  }

  _figure(shirt) {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x2a2026, roughness: 0.7 });
    const cloth = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.9 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.85 });
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.8, 4, 8), pants);
      leg.position.set(sx * 0.17, 0.55, 0);
      g.add(leg);
    }
    const torso = new THREE.Group();
    torso.position.y = 1.05;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.55, 4, 10), cloth);
    chest.position.y = 0.35;
    torso.add(chest);
    const head = new THREE.Group();
    head.position.y = 0.95;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
    skull.position.y = 0.12;
    // hair styles (one is shown at a time, see setLook)
    const hair = {
      short: new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat),
      long: new THREE.Group(),
      mohawk: new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.38), hairMat),
      bun: new THREE.Group(),
      shaved: new THREE.Mesh(new THREE.SphereGeometry(0.205, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat),
    };
    hair.short.position.y = 0.15;
    hair.shaved.position.y = 0.13;
    hair.mohawk.position.set(0, 0.34, -0.02);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
    cap.position.y = 0.15;
    const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 4, 10), hairMat);
    back.position.set(0, -0.08, -0.1);
    hair.long.add(cap, back);
    const cap2 = cap.clone();
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), hairMat);
    knot.position.set(0, 0.36, -0.1);
    hair.bun.add(cap2, knot);
    for (const [k, m] of Object.entries(hair)) { m.visible = k === 'short'; head.add(m); }
    head.add(skull);
    torso.add(head);
    const arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * 0.34, 0.62, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), cloth);
      arm.position.y = -0.3;
      shoulder.add(arm);
      shoulder.rotation.x = -0.6;
      torso.add(shoulder);
      arms.push(shoulder);
    }
    g.add(torso);
    return { g, torso, head, arms, hair, mats: { skin, cloth, pants, hair: hairMat } };
  }

  _band() {
    this.band = {};
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9aa8, metalness: 1, roughness: 0.25 });
    const lacquer = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.3 });
    this.finish = {};
    const addGuitar = (fig, color, bass) => {
      const inst = new THREE.Group();
      const finish = lacquer(color);
      this.finish[bass ? 'bass' : 'guitar'] = finish;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.08), finish);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(bass ? 1.05 : 0.8, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0x3a2412 }));
      neck.position.x = bass ? 0.75 : 0.62;
      inst.add(body, neck);
      inst.position.set(0.05, 0.22, 0.28);
      inst.rotation.z = 0.35;
      fig.torso.add(inst);
    };
    const mk = (name, x, z, y, shirt, rotY = 0) => {
      const f = this._figure(shirt);
      f.g.position.set(x, y, z);
      f.g.rotation.y = rotY;
      this.scene.add(f.g);
      this.band[name] = f;
      return f;
    };
    const gtr = mk('guitar', -4.5, -1.2, 1.2, 0x3a0d1c, 0.25);
    addGuitar(gtr, 0xd81b3a, false);
    const bass = mk('bass', 4.5, -1.2, 1.2, 0x0d1c3a, -0.25);
    addGuitar(bass, 0x1b5ed8, true);
    const drm = mk('drums', 0, -5.6, 1.9, 0x2a1a08);
    drm.g.scale.setScalar(0.95);
    // drum kit
    const kit = new THREE.Group();
    kit.position.set(0, 1.9, -4.6);
    const shell = lacquer(0xb86a1b);
    this.finish.drums = shell;
    const kick = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.45, 24).rotateX(Math.PI / 2), shell);
    kick.position.set(0, 0.5, 0.2);
    const snare = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 20), shell);
    snare.position.set(-0.55, 0.75, 0.1);
    const tom1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 20), shell); tom1.position.set(-0.2, 1.1, 0.25);
    const tom2 = tom1.clone(); tom2.position.x = 0.25;
    const floorTom = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 20), shell); floorTom.position.set(0.7, 0.55, 0.1);
    this.cymbals = [];
    for (const [cx, cy] of [[-0.95, 1.45], [0.95, 1.5], [-0.75, 1.05]]) {
      const cym = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.01, 24), new THREE.MeshStandardMaterial({ color: 0xc9a13a, metalness: 1, roughness: 0.2 }));
      cym.position.set(cx, cy, 0.15);
      cym.rotation.x = 0.25;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, cy, 6), metal);
      stand.position.set(cx, cy / 2, 0.15);
      kit.add(cym, stand);
      this.cymbals.push(cym);
    }
    kit.add(kick, snare, tom1, tom2, floorTom);
    this.scene.add(kit);
    // keys
    const keys = mk('keys', -8.6, -2.6, 1.2, 0x1c0d3a, 0.45);
    const kb = new THREE.Group();
    this.finish.keys = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.45), this.finish.keys);
    const whites = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.02, 0.2), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3 }));
    whites.position.set(0, 0.05, 0.1);
    const standL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), metal); standL.position.set(-0.5, -0.5, 0);
    const standR = standL.clone(); standR.position.x = 0.5;
    kb.add(board, whites, standL, standR);
    kb.position.set(-8.6 + 0.35, 1.2 + 1.05, -2.6 + 0.65);
    kb.rotation.y = 0.45;
    this.scene.add(kb);
    // mic stands
    for (const x of [-4.2, 4.2]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 6), metal);
      st.position.set(x, 2.0, -0.35);
      this.scene.add(st);
    }
    this.focusPos = { guitar: new THREE.Vector3(-4.5, 2.4, -1.2), bass: new THREE.Vector3(4.5, 2.4, -1.2), drums: new THREE.Vector3(0, 3.0, -5.2), keys: new THREE.Vector3(-8.6, 2.4, -2.6) };
  }

  _crowd() {
    const n = CROWD_COUNT[this.quality] || 950;
    const body = new THREE.CapsuleGeometry(0.22, 0.75, 3, 7).translate(0, 0.6, 0);
    const head = new THREE.SphereGeometry(0.17, 8, 6).translate(0, 1.32, 0);
    const armL = new THREE.CapsuleGeometry(0.06, 0.55, 2, 5).translate(-0.26, 1.35, 0);
    const armR = armL.clone().translate(0.52, 0, 0);
    const geo = mergeGeometries([body, head, armL, armR]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
    this.crowdUniforms = {
      uCrowdTime: { value: 0 }, uCrowdBeat: { value: 0 },
      uCrowdJump: { value: 0 }, uCrowdOD: { value: 0 },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.crowdUniforms);
      shader.vertexShader = /* glsl */`
        attribute float aCrowdPhase, aCrowdAmp, aCrowdJumper;
        uniform float uCrowdTime, uCrowdBeat, uCrowdJump, uCrowdOD;
        vec3 animateCrowd(vec3 p, bool isNormal) {
          float ph = uCrowdBeat + aCrowdPhase * 0.25;
          float tilt = sin(ph * 0.5) * 0.05;
          float yaw = sin(uCrowdTime * 0.8 + aCrowdPhase) * 0.1;
          if (isNormal) p.y /= 1.0 + uCrowdOD * 0.05;
          else p.y *= 1.0 + uCrowdOD * 0.05;
          float ct = cos(tilt), st = sin(tilt);
          p.xy = vec2(ct * p.x - st * p.y, st * p.x + ct * p.y);
          float cy = cos(yaw), sy = sin(yaw);
          p.xz = vec2(cy * p.x + sy * p.z, -sy * p.x + cy * p.z);
          return p;
        }
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = animateCrowd(objectNormal, true);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = animateCrowd(transformed, false);');
      // Keep the small sway and jump in world units, independent of each person's scale.
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', THREE.ShaderChunk.project_vertex.replace(
        'mvPosition = instanceMatrix * mvPosition;',
        `mvPosition = instanceMatrix * mvPosition;
         float ph = uCrowdBeat + aCrowdPhase * 0.25;
         float jump = mix(sin(ph) * 0.04, max(0.0, sin(ph)) * uCrowdJump * aCrowdAmp, aCrowdJumper);
         mvPosition.xyz += vec3(sin(uCrowdTime * 0.5 + aCrowdPhase) * 0.05, jump, 0.0);`,
      ));
    };
    mat.customProgramCacheKey = () => 'crowd-gpu-animation-v1';
    this.crowd = new THREE.InstancedMesh(geo, mat, n);
    this.crowdData = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const row = Math.random();
      const z = 4 + row * row * 16;
      const spread = 12 + z * 0.6;
      const x = (Math.random() * 2 - 1) * spread;
      this.crowdData.push({ x, z, phase: Math.random() * Math.PI * 2, amp: 0.4 + Math.random() * 0.8, rot: (Math.random() - 0.5) * 0.6, scale: 0.88 + Math.random() * 0.25, jumper: Math.random() < 0.5 });
    }
    // front rows first: a small venue shows only the first part of the crowd (see setVenue)
    this.crowdData.sort((a, b) => a.z + Math.abs(a.x) * 0.35 - (b.z + Math.abs(b.x) * 0.35));
    const phases = new Float32Array(n), amps = new Float32Array(n), jumpers = new Float32Array(n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scale = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const d = this.crowdData[i];
      phases[i] = d.phase; amps[i] = d.amp; jumpers[i] = d.jumper ? 1 : 0;
      pos.set(d.x, 0, d.z);
      q.setFromEuler(e.set(0, d.rot, 0));
      scale.setScalar(d.scale);
      this.crowd.setMatrixAt(i, m.compose(pos, q, scale));
      c.setHSL(0.02 + Math.random() * 0.08, 0.15, 0.04 + Math.random() * 0.07);
      this.crowd.setColorAt(i, c);
    }
    geo.setAttribute('aCrowdPhase', new THREE.InstancedBufferAttribute(phases, 1));
    geo.setAttribute('aCrowdAmp', new THREE.InstancedBufferAttribute(amps, 1));
    geo.setAttribute('aCrowdJumper', new THREE.InstancedBufferAttribute(jumpers, 1));
    this.crowd.instanceMatrix.needsUpdate = true;
    this.crowd.computeBoundingSphere();
    this.crowd.boundingSphere.radius += 1; // allow for the animated jump and sway during culling
    this.scene.add(this.crowd);

    // phone lights
    const lightsN = Math.floor(n * 0.12);
    this.phones = makePoints(lightsN, true, this.soft);
    this.phoneIdx = [];
    for (let i = 0; i < lightsN; i++) {
      const k = Math.floor(Math.random() * n);
      this.phoneIdx.push(k);
      this.phones.col[i * 3] = 1; this.phones.col[i * 3 + 1] = 0.95; this.phones.col[i * 3 + 2] = 0.85;
    }
    this.scene.add(this.phones.pts);
  }

  _fx() {
    const N = this.quality === 'low' ? 1200 : 2600;
    this.fire = makePoints(N, true, this.soft);
    this.scene.add(this.fire.pts);
    this.confetti = makePoints(this.quality === 'low' ? 500 : 1400, false, null);
    this.scene.add(this.confetti.pts);
    const D = 500;
    this.dust = makePoints(D, true, this.soft);
    for (let i = 0; i < D; i++) {
      this.dust.pos[i * 3] = (Math.random() * 2 - 1) * 15;
      this.dust.pos[i * 3 + 1] = Math.random() * 11;
      this.dust.pos[i * 3 + 2] = -6 + Math.random() * 16;
      this.dust.size[i] = 0.02 + Math.random() * 0.04;
      this.dust.col[i * 3] = this.dust.col[i * 3 + 1] = this.dust.col[i * 3 + 2] = 0.12;
      this.dust.vel[i * 3] = (Math.random() - 0.5) * 0.1;
      this.dust.vel[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
    }
    this.scene.add(this.dust.pts);
    this.pyroX = [-9.5, -3.2, 3.2, 9.5];
  }

  // ---------------------------------------------------------------- particle helpers
  _spawn(sys, x, y, z, vx, vy, vz, life, size, c0, c1) {
    sys.active = true;
    const i = sys.head; sys.head = (sys.head + 1) % sys.N;
    sys.pos[i * 3] = x; sys.pos[i * 3 + 1] = y; sys.pos[i * 3 + 2] = z;
    sys.vel[i * 3] = vx; sys.vel[i * 3 + 1] = vy; sys.vel[i * 3 + 2] = vz;
    sys.life[i] = sys.max[i] = life;
    sys.s0[i] = size;
    sys.c0.set(c0, i * 3); sys.c1.set(c1, i * 3);
  }

  pyro(strength = 1) {
    strength *= this.pyroScale ?? 1; // no flame cannons in a garage
    if (strength < 0.05) return;
    for (const x of this.pyroX) {
      for (let k = 0; k < 70 * strength; k++) {
        this._spawn(this.fire, x + (Math.random() - 0.5) * 0.5, 1.3, 2.2 + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 1.6, 7 + Math.random() * 8, (Math.random() - 0.5) * 1.2,
          0.6 + Math.random() * 0.8, 0.28 + Math.random() * 0.3, [1.5, 0.95, 0.35], [0.5, 0.06, 0.01]);
      }
    }
  }

  sparks() {
    if ((this.pyroScale ?? 1) < 0.4) return; // spark falls hang from a truss the small rooms don't have
    for (const x of this.pyroX) {
      for (let k = 0; k < 60; k++) {
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3;
        this._spawn(this.fire, x, 11, 2.3, Math.cos(a) * r, -Math.random() * 2, Math.sin(a) * r,
          1.5 + Math.random(), 0.08 + Math.random() * 0.06, [1.8, 1.5, 1.0], [0.8, 0.3, 0.05]);
      }
    }
  }

  confettiBurst() {
    const cols = [[1, 0.96, 0.88], [0.95, 0.72, 0.16], [0.88, 0.2, 0.14], [1, 0.96, 0.88], [0.25, 0.4, 0.9]];
    for (let k = 0; k < this.confetti.N * 0.8; k++) {
      const c = cols[k % cols.length];
      this._spawn(this.confetti, (Math.random() * 2 - 1) * 14, 11 + Math.random() * 2, -3 + Math.random() * 14,
        (Math.random() - 0.5) * 2, -1 - Math.random(), (Math.random() - 0.5) * 2, 6 + Math.random() * 3, 0.14 + Math.random() * 0.08, c, c);
    }
  }

  _updateSys(sys, dt, gravity, drag, flutter = 0) {
    if (!sys.active) return;
    const d = Math.exp(-drag * dt);
    let active = false;
    for (let i = 0; i < sys.N; i++) {
      if (sys.life[i] <= 0) { sys.size[i] = 0; continue; }
      active = true;
      sys.life[i] -= dt;
      const k = Math.max(0, sys.life[i] / sys.max[i]);
      sys.vel[i * 3 + 1] += gravity * dt;
      sys.vel[i * 3] *= d; sys.vel[i * 3 + 1] *= d; sys.vel[i * 3 + 2] *= d;
      sys.pos[i * 3] += (sys.vel[i * 3] + (flutter ? Math.sin(this.time * 3 + i) * flutter : 0)) * dt;
      sys.pos[i * 3 + 1] += sys.vel[i * 3 + 1] * dt;
      sys.pos[i * 3 + 2] += sys.vel[i * 3 + 2] * dt;
      if (sys.pos[i * 3 + 1] < 0.02) { sys.pos[i * 3 + 1] = 0.02; sys.vel[i * 3 + 1] = 0; sys.vel[i * 3] *= 0.5; }
      for (let c = 0; c < 3; c++) sys.col[i * 3 + c] = sys.c1[i * 3 + c] + (sys.c0[i * 3 + c] - sys.c1[i * 3 + c]) * k;
      sys.size[i] = sys.s0[i] * (flutter ? 1 : 0.4 + 0.6 * k);
    }
    sys.active = active;
    const g = sys.pts.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }

  // ---------------------------------------------------------------- camera
  setShot(name) { this.shot = name; this.shotTimer = 0; }

  nextPalette() {
    const gels = this.gels || PALETTES;
    this.paletteIndex = (this.paletteIndex + 1) % gels.length;
    this.tgtA.set(gels[this.paletteIndex][0]);
    this.tgtB.set(gels[this.paletteIndex][1]);
  }

  /** Dress a band member (guitar / bass / drums / keys) as a player's character; null = the default look. */
  setLook(inst, look) {
    const f = this.band[inst];
    if (!f) return;
    const L = { ...DEFAULT_LOOKS[inst], ...(look || {}) };
    f.mats.skin.color.set(L.skin);
    f.mats.cloth.color.set(L.top);
    f.mats.pants.color.set(L.pants);
    f.mats.hair.color.set(L.hairColor);
    for (const [k, m] of Object.entries(f.hair)) m.visible = k === (HAIR_STYLES.includes(L.hair) ? L.hair : 'short');
    this.finish[inst]?.color.set(L.finish);
  }

  /** Everyone back in their default look. */
  resetLooks() { for (const inst of Object.keys(this.band)) this.setLook(inst, null); }

  /** Menus: frame one band member up close (the character editor), or null to go back to the slow orbit. */
  preview(inst) { this.previewInst = this.band[inst] ? inst : null; }

  /** Dress the stage as one of the tour's venues (VENUE_LOOKS). */
  setVenue(id) {
    const v = VENUE_LOOKS[id] ? VENUE_LOOKS[id] : VENUE_LOOKS.arena;
    if (this.venueId === (VENUE_LOOKS[id] ? id : 'arena')) return;
    this.venueId = VENUE_LOOKS[id] ? id : 'arena';
    this.gels = v.gels;
    this.paletteIndex = 0;
    this.tgtA.set(v.gels[0][0]);
    this.tgtB.set(v.gels[0][1]);
    this.scene.background.set(v.bg);
    this.scene.fog.color.set(v.fogColor);
    this.scene.fog.density = v.fog;
    this.ledUniforms.uStyle.value = v.wall;
    this.wallBright = v.wallDim;
    this.trussMesh.visible = v.truss;
    for (const p of this.pillars) p.visible = v.pillars;
    for (const s of this.stacks) s.mesh.visible = s.level < v.stacks;
    // the lights nearest the middle stay when a room only has a few
    [...this.heads].sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).forEach((h, i) => { h.pivot.visible = i < v.heads; });
    this.crowd.count = Math.max(1, Math.round(this.crowdData.length * v.crowd));
    this.phones.pts.visible = v.phones;
    this.lightScale = v.light;
    this.pyroScale = v.pyro;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  /**
   * f: { mode:'menu'|'game', beat (float beat position), beatHit, bass, mid, high, spectrum, od, intensity 0..1, rock 0..1, focus }
   */
  update(dt, f) {
    this.time += dt;
    const t = this.time;
    if (f.beatHit) this.pulse = 1;
    this.pulse = Math.max(0, this.pulse - dt * 3.2);
    const pulse = this.pulse;
    const beat = f.beat ?? t * 2;
    const intensity = f.intensity ?? 0.5;
    const od = f.od ? 1 : 0;

    this.colA.lerp(this.tgtA, Math.min(1, dt * 2));
    this.colB.lerp(this.tgtB, Math.min(1, dt * 2));

    // spectrum texture
    if (f.spectrum) {
      const d = this.specTex.image.data, s = f.spectrum;
      for (let i = 0; i < 128; i++) d[i * 4] = s[Math.min(s.length - 1, Math.floor(SPEC_LOOKUP[i] * s.length))];
      this.specTex.needsUpdate = true;
    }
    const U = this.ledUniforms;
    U.uTime.value = t; U.uPulse.value = pulse; U.uBass.value = f.bass || 0;
    U.uOD.value += (od - U.uOD.value) * Math.min(1, dt * 4);
    const dimTarget = (f.mode === 'game' ? 0.45 : 0.7) * (this.wallBright ?? 1);
    U.uDim.value += (dimTarget - U.uDim.value) * Math.min(1, dt * 2);
    const dim = U.uDim.value;

    this.lipMat.color.copy(this.colA).multiplyScalar((1.2 + pulse * 2) * dim);
    this.pillarMat.color.copy(this.colB).multiplyScalar((0.35 + pulse * 1.4 + (f.high || 0)) * dim);
    this.wallLight.color.copy(this.colA);
    this.wallLight.intensity = 40 + pulse * 80;

    // moving heads
    const beamI = (0.2 + intensity * 0.35 + pulse * 0.3) * dim * 0.9 * (this.lightScale ?? 1);
    this.heads.forEach((h, i) => {
      const pat = Math.floor(beat / 16) % 3;
      let pan, tilt;
      if (pat === 0) { pan = Math.sin(t * 0.6 + h.phase) * 0.5; tilt = 0.35 + Math.sin(t * 0.9 + h.phase) * 0.25; }
      else if (pat === 1) { pan = (h.x / 13) * -0.4 + Math.sin(beat * Math.PI * 0.5) * 0.25; tilt = 0.5; }
      else { pan = Math.sin(t * 1.4 + i) * 0.7; tilt = 0.2 + Math.abs(Math.sin(t * 0.7 + i * 0.5)) * 0.5; }
      if (od) { pan = Math.sin(t * 3 + i) * 0.8; tilt = 0.3 + Math.sin(t * 5 + i) * 0.3; }
      h.pivot.rotation.set(h.front ? tilt : -tilt * 0.8, 0, pan);
      const col = od ? (i % 2 ? GOLD : WHITE) : i % 2 ? this.colA : this.colB;
      const strobe = od && !settings.calmVisuals && Math.sin(t * 40 + i) > 0.8 ? 1.25 : 1; // no strobing in calm visuals
      h.beam.material.uniforms.uColor.value.copy(col);
      h.beam.material.uniforms.uIntensity.value = beamI * strobe * (0.7 + 0.3 * Math.sin(beat * Math.PI + i));
      h.lensMat.color.copy(col).multiplyScalar((2 + pulse * 2.5) * dim);
    });
    this.spots.forEach((s, i) => { s.color.copy(i % 2 ? this.colA : this.colB); s.intensity = (90 + pulse * 120 + intensity * 60) * (this.lightScale ?? 1); });
    const focus = this.focusPos[f.focus] || this.focusPos.guitar;
    this.keySpot.target.position.copy(focus);
    this.keySpot.intensity = f.mode === 'game' ? 220 + pulse * 100 : 0;
    if (f.mode !== 'game' && this.previewInst) { this.keySpot.target.position.copy(this.focusPos[this.previewInst]); this.keySpot.intensity = 170; }

    // band animation
    const bp = beat * Math.PI * 2;
    const hb = Math.max(0, Math.sin(bp)) * (0.2 + intensity * 0.4);
    for (const [name, b] of Object.entries(this.band)) {
      const energy = f.mode === 'game' ? 1 : 0.5;
      if (name === 'drums') {
        b.arms[0].rotation.x = -0.9 + Math.max(0, Math.sin(bp * 2)) * 0.8 * energy;
        b.arms[1].rotation.x = -0.9 + Math.max(0, Math.sin(bp * 2 + Math.PI)) * 0.8 * energy;
        b.head.rotation.x = hb * 0.6;
        b.torso.position.y = 1.05 + Math.abs(Math.sin(bp)) * 0.03;
      } else {
        b.head.rotation.x = hb * (name === 'keys' ? 0.4 : 0.9) * energy + (od ? Math.sin(bp * 2) * 0.3 : 0);
        b.torso.rotation.x = 0.1 + hb * 0.25 * energy;
        b.torso.rotation.z = Math.sin(bp * 0.5) * 0.06;
        b.g.position.y = 1.2 + (od ? Math.max(0, Math.sin(bp)) * 0.25 : 0);
        b.arms[1].rotation.x = -0.9 + Math.sin(bp * 2) * 0.35 * energy;
      }
    }
    this.cymbals.forEach((c, i) => { c.rotation.z = Math.sin(t * 20 + i) * 0.05 * pulse; });

    // crowd
    const jumpAmp = (0.1 + intensity * 0.45 + od * 0.35) * (f.mode === 'game' ? 1 : 0.4);
    const n = this.crowd.count;
    const CU = this.crowdUniforms;
    CU.uCrowdTime.value = t; CU.uCrowdBeat.value = bp;
    CU.uCrowdJump.value = jumpAmp; CU.uCrowdOD.value = od;
    const calm = 1 - Math.min(1, intensity * 1.6);
    for (let i = 0; i < this.phoneIdx.length && this.phones.pts.visible; i++) {
      if (this.phoneIdx[i] >= n) { this.phones.size[i] = 0; continue; } // nobody standing there in this venue
      const d = this.crowdData[this.phoneIdx[i]];
      this.phones.pos[i * 3] = d.x + 0.2; this.phones.pos[i * 3 + 1] = 1.95 * d.scale; this.phones.pos[i * 3 + 2] = d.z;
      this.phones.size[i] = (0.06 + 0.03 * Math.sin(t * 2 + i)) * (0.25 + calm);
    }
    if (this.phones.pts.visible) {
      const pg = this.phones.pts.geometry;
      pg.attributes.position.needsUpdate = true;
      pg.attributes.aSize.needsUpdate = true;
      // Phone colours are set once in _crowd(); uploading them every frame changes nothing.
    }

    // particles
    this._updateSys(this.fire, dt, -5, 0.6);
    this._updateSys(this.confetti, dt, -0.6, 1.2, 0.8);
    for (let i = 0; i < this.dust.N; i++) {
      this.dust.pos[i * 3] += this.dust.vel[i * 3] * dt;
      this.dust.pos[i * 3 + 1] += this.dust.vel[i * 3 + 1] * dt;
      const b = 0.1 + pulse * 0.25;
      this.dust.col[i * 3] = this.colA.r * b; this.dust.col[i * 3 + 1] = this.colA.g * b; this.dust.col[i * 3 + 2] = this.colB.b * b;
    }
    const dg = this.dust.pts.geometry;
    dg.attributes.position.needsUpdate = true; dg.attributes.color.needsUpdate = true;
    if (!this._dustSized) { dg.attributes.aSize.needsUpdate = true; this._dustSized = true; }

    this._camera(dt, f, pulse, beat);
  }

  _camera(dt, f, pulse, beat) {
    const t = this.time;
    const pos = this._camPos, tgt = this._camAim;
    if (f.mode !== 'game' && this.previewInst) {
      // the character editor: the band member on the right half of the screen, turning slowly
      const focus = this.focusPos[this.previewInst];
      const a = Math.sin(t * 0.25) * 0.35;
      pos.set(focus.x - 0.9 + Math.sin(a) * 3.6, focus.y + 0.3, focus.z + Math.cos(a) * 4.2);
      tgt.set(focus.x - 0.72, focus.y - 0.4, focus.z);
    } else if (f.mode !== 'game') {
      pos.set(Math.sin(t * 0.06) * 13, 4.6 + Math.sin(t * 0.13) * 0.8, 13 + Math.cos(t * 0.06) * 4);
      tgt.set(0, 3.6, -3);
    } else {
      this.shotTimer += dt;
      const focus = this.focusPos[f.focus] || this.focusPos.guitar;
      switch (this.shot) {
        case 'left': pos.set(-10, 4, 11); tgt.set(-1, 3.2, -3); break;
        case 'right': pos.set(10, 4, 11); tgt.set(1, 3.2, -3); break;
        case 'low': pos.set(0, 1.8, 10); tgt.set(0, 4.2, -4); break;
        case 'player': pos.set(focus.x + (focus.x > 0 ? -3.5 : 3.5), focus.y + 2.2, focus.z + 10.5); tgt.copy(focus); break;
        case 'drums': pos.set(3, 4.5, 4); tgt.copy(this.focusPos.drums); break;
        default: pos.set(0, 5.2, 17); tgt.set(0, 3.8, -3);
      }
      pos.x += Math.sin(t * 0.3) * 1.2;
      pos.y += Math.sin(t * 0.47) * 0.4;
      pos.z += Math.cos(t * 0.21) * 0.8;
    }
    const k = Math.min(1, dt * (f.mode === 'game' ? 1.1 : 0.6));
    this.camera.position.lerp(pos, k);
    this.curTarget.lerp(tgt, k);
    this.camera.lookAt(this.curTarget);
    const fovTarget = 48 - pulse * (f.mode === 'game' ? 1.2 : 0.3) - (f.od ? 3 : 0);
    this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 8);
    this.camera.updateProjectionMatrix();
  }
}
