// Shared pieces for the five worlds: GLSL noise, a sky dome, GPU-animated particle fields, instancing helpers
// and the boss rig base class (state timers for entering, attacking, being hit, falling and fleeing).
import * as THREE from 'three';

export { THREE };
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

export const NOISE = /* glsl */`
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * noise(p); p *= 2.02; a *= 0.5; } return s; }
`;

export const std = (color, roughness = 0.8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
export const glow = (color, k = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });

export function shader(uniforms, vertexShader, fragmentShader, opts = {}) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, ...opts });
}
export const BASIC_VERT = 'varying vec2 vUv; varying vec3 vPos; varying vec3 vN; void main(){ vUv = uv; vPos = (modelMatrix * vec4(position,1.0)).xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * vec4(vPos,1.0); }';

/** A sky dome around everything; frag gets vDir (unit view direction) and uTime. */
export function skyDome(frag, uniforms = {}) {
  const u = { uTime: { value: 0 }, ...uniforms };
  const m = new THREE.Mesh(new THREE.SphereGeometry(160, 48, 24), shader(u,
    'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    `varying vec3 vDir; uniform float uTime; ${NOISE} ${frag}`, { side: THREE.BackSide, depthWrite: false, fog: false }));
  m.renderOrder = -10;
  m.frustumCulled = false;
  return { mesh: m, u };
}

let softTex = null;
export function soft() {
  if (softTex) return softTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

/**
 * A field of particles animated on the GPU (no per-frame CPU work).
 * kind: rise (bubbles, embers) | fall (snow, ash) | float (dust, plankton) | twinkle (stars)
 * box: [x0, x1, y0, y1, z0, z1]; speed: units / s; size; color (or colors[]); ring: true draws soft rings (bubbles)
 */
export function particleField({ n = 600, box = [-20, 20, 0, 12, -20, 15], kind = 'float', speed = 0.5, size = 0.12, color = 0xffffff, colors = null, ring = false, additive = true, wobble = 0.4 }) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rand(box[0], box[1]); pos[i * 3 + 1] = rand(box[2], box[3]); pos[i * 3 + 2] = rand(box[4], box[5]);
    seed[i] = Math.random();
    c.set(colors ? colors[i % colors.length] : color);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const u = { uTime: { value: 0 }, uSpeed: { value: speed }, uSize: { value: size }, uY: { value: new THREE.Vector2(box[2], box[3]) }, uMap: { value: soft() }, uBoost: { value: 1 }, uWob: { value: wobble } };
  const dir = { rise: 1, fall: -1, float: 0.15, twinkle: 0 }[kind] ?? 0;
  const mat = shader(u, `
    attribute float aSeed; uniform float uTime, uSpeed, uSize, uWob; uniform vec2 uY; varying vec3 vC; varying float vA;
    void main() {
      vec3 p = position;
      float h = uY.y - uY.x;
      p.y = uY.x + mod(p.y - uY.x + ${dir.toFixed(2)} * uTime * uSpeed * (0.6 + aSeed * 0.8), h);
      p.x += sin(uTime * (0.5 + aSeed) + aSeed * 40.0) * uWob;
      p.z += cos(uTime * (0.4 + aSeed * 0.7) + aSeed * 23.0) * uWob;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float edge = smoothstep(0.0, 0.08, (p.y - uY.x) / h) * smoothstep(1.0, 0.85, (p.y - uY.x) / h);
      vA = edge * ${kind === 'twinkle' ? '(0.5 + 0.5 * sin(uTime * (2.0 + aSeed * 4.0) + aSeed * 60.0))' : '1.0'};
      vC = color;
      gl_PointSize = min(64.0, uSize * (0.6 + aSeed * 0.8) * 420.0 / max(0.5, -mv.z));
      gl_Position = projectionMatrix * mv;
    }`, `
    uniform sampler2D uMap; uniform float uBoost; varying vec3 vC; varying float vA;
    void main() {
      ${ring ? 'vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.42, r) * (0.25 + 0.75 * smoothstep(0.32, 0.46, r)); a += smoothstep(0.18, 0.0, length(d - vec2(-0.14, -0.14))) * 0.8;'
    : 'float a = texture2D(uMap, gl_PointCoord).a;'}
      gl_FragColor = vec4(vC * uBoost * a * vA, a * vA);
    }`, { transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, u };
}

let progId = 0;
/**
 * A MeshStandardMaterial (lit, fogged, instancing-aware) with GPU vertex animation.
 * head: GLSL declarations; vertex: code that edits \`transformed\` (object space, before instancing);
 * normal: code that edits \`objectNormal\`; frag: code that edits \`diffuseColor\` / \`totalEmissiveRadiance\` (after emissive).
 * uniforms get uTime automatically. → { mat, u }
 */
export function animatedStandard(params, { head = '', vertex = '', normal = '', fragHead = '', frag = '', uniforms = {} } = {}) {
  const mat = new THREE.MeshStandardMaterial(params);
  const u = { uTime: { value: 0 }, ...uniforms };
  const key = `anim-${++progId}`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    const decl = Object.keys(u).map((k) => `uniform ${typeOfUniform(u[k].value)} ${k};`).join('\n');
    sh.vertexShader = `${decl}\nvarying vec3 vWPos;\n${NOISE}\n${head}\n` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${normal}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertex}`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `${decl}\nvarying vec3 vWPos;\n${NOISE}\n${fragHead}\n` + sh.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${frag}`);
  };
  mat.customProgramCacheKey = () => key;
  return { mat, u };
}
function typeOfUniform(v) {
  if (typeof v === 'number') return 'float';
  if (v?.isColor || v?.isVector3) return 'vec3';
  if (v?.isVector2) return 'vec2';
  if (v?.isVector4) return 'vec4';
  if (v?.isTexture) return 'sampler2D';
  return 'float';
}

/** Put many copies of one geometry into an InstancedMesh: place(i, dummy) positions each. */
export function instances(geo, mat, n, place) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) { d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); place(i, d); d.updateMatrix(); m.setMatrixAt(i, d.matrix); }
  m.instanceMatrix.needsUpdate = true;
  return m;
}

/** A canvas texture. */
export function canvasTex(w, h, draw, repeat = null) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/**
 * A boss's body and its moods. Subclasses build this.group and implement pose(dt, t, f) using:
 *   this.presence 0..1 (arriving / leaving), this.attackT (s since the last attack, 1e6 = none),
 *   this.hitT (s since hit), this.dying (0..1 while falling), this.state (hidden | enter | idle | dying | gone | leaving)
 */
export class BossRig {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.cam = { pos: V(0, 6, 16), tgt: V(0, 6, -20) };
    this.reset();
  }
  reset() {
    // timers start far in the past (not Infinity: sin(Infinity) would poison every pose with NaN)
    this.state = 'hidden'; this.presence = 0; this.attackT = 1e6; this.attackKind = null; this.hitT = 1e6; this.dying = 0; this.big = false;
    this.group.visible = false;
  }
  enter() { this.state = 'enter'; this.group.visible = true; this.presence = 0; }
  attack(kind) { this.attackT = 0; this.attackKind = kind; }
  hit(big = false) { this.hitT = 0; this.big = big; }
  defeat() { this.state = 'dying'; this.dying = 0; }
  escape() { this.state = 'leaving'; }
  update(dt, t, f) {
    if (this.state === 'hidden' || this.state === 'gone') return;
    if (this.state === 'enter') { this.presence = Math.min(1, this.presence + dt / 3.5); if (this.presence >= 1) this.state = 'idle'; }
    if (this.state === 'leaving') { this.presence = Math.max(0, this.presence - dt / 3); if (this.presence <= 0) { this.state = 'gone'; this.group.visible = false; return; } }
    if (this.state === 'dying') { this.dying = Math.min(1, this.dying + dt / 3.2); if (this.dying >= 1) { this.state = 'gone'; this.group.visible = false; return; } }
    this.attackT += dt; this.hitT += dt;
    this.pose(dt, t, f);
  }
  /** A flash factor for "just got hit" (1 → 0 over 0.25 s). */
  get flash() { return Math.max(0, 1 - this.hitT / (this.big ? 0.4 : 0.22)); }
  /** 0..1..0 over an attack's first 2 seconds (wind-up, strike, settle). */
  get strike() { const a = this.attackT; return a > 2 ? 0 : Math.sin(Math.min(1, a / 2) * Math.PI); }
  pose() {}
}
