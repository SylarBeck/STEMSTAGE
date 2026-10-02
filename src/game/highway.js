// The note highway: its own scene/camera, composited over the stage.
// Rock Band-style board: brushed dark track with lane strings, chrome side rails with a status LED
// strip, fret "smashers" at the strikeline, rounded gems (cymbal gems on drums), a 10-segment streak
// meter set into the board, overdrive fire walls and hit effects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FIVE_COLORS = [0x2ed24f, 0xf2332b, 0xffd21f, 0x2f84f0, 0xff8a1a];
export const DRUM_COLORS = [0xff8a1a, 0xf2332b, 0xffd21f, 0x2f84f0, 0x2ed24f];
export const MULT_COLORS = [0xffffff, 0xffffff, 0xffa21a, 0x3cc254, 0x2f84f0, 0xa35cff, 0xf2332b]; // by multiplier 0..6
const HWY_LEN = 62;
const WIDTH = 5;
const BORDER = 0.26;
const MAX_GEMS = 600;
const MAX_CYM = 200;
const MAX_KICKS = 160;
const MAX_SUS = 48;
const MAX_LINES = 96;
const CYMBAL_LANES = new Set([2, 4]); // drums: hi-hat + cymbal lanes get cymbal gems
const WHITE = new THREE.Color(1, 1, 1);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundedRect(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  r = Math.min(r, w / 2, d / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function roundedRing(w, d, r, t) {
  const s = roundedRect(w, d, r);
  const hole = roundedRect(w - 2 * t, d - 2 * t, Math.max(0.01, r - t));
  s.holes.push(new THREE.Path(hole.getPoints(24).reverse()));
  return s;
}
function circleShape(r, hole = 0) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  if (hole > 0) { const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(h); }
  return s;
}
/** Extrude a shape upward (+y) from y = y0. */
function slab(shape, depth, y0 = 0, bevel = 0, curve = 6) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, curveSegments: curve, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  return g;
}
function withPart(geo, part) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
  return g;
}

// Guitar/bass/keys gem: glossy rounded puck + chrome rim + glowing core
function gemGeometry(w = 0.84, d = 0.36) {
  const body = withPart(slab(roundedRect(w, d, 0.15), 0.08, 0, 0.035, 6), 0);
  const top = 0.08 + 0.07;
  const rim = withPart(slab(roundedRing(w * 0.74, d * 0.56, 0.08, 0.035), 0.02, top), 1);
  const core = withPart(slab(roundedRect(w * 0.74 - 0.07, d * 0.56 - 0.07, 0.05), 0.012, top), 2);
  return mergeGeometries([body, rim, core]);
}
// Drum cymbal gem: domed disc with a bright bell
function cymbalGeometry() {
  const pts = [[0, 0.2], [0.07, 0.195], [0.12, 0.17], [0.15, 0.13], [0.3, 0.1], [0.44, 0.06], [0.52, 0.03], [0.53, 0.0], [0, 0]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 40).toNonIndexed();
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const part = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) part[i] = Math.hypot(pos.getX(i), pos.getZ(i)) < 0.155 ? 2 : Math.hypot(pos.getX(i), pos.getZ(i)) > 0.5 ? 1 : 0;
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  return g;
}
function kickGeometry() {
  const bar = withPart(slab(roundedRect(WIDTH - 0.3, 0.17, 0.085), 0.03, 0, 0.02), 0);
  const top = withPart(slab(roundedRect(WIDTH - 0.6, 0.05, 0.025), 0.01, 0.07), 2);
  return mergeGeometries([bar, top]);
}

const NOISE_GLSL = /* glsl */`
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

const gemVertex = /* glsl */`
  attribute float aPart;
  attribute float aGlow;
  attribute float aHopo;
  varying vec3 vN; varying vec3 vPos; varying float vPart; varying vec3 vCol; varying float vGlow; varying float vHopo;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vPos = wp.xyz; vPart = aPart; vCol = instanceColor; vGlow = aGlow; vHopo = aHopo;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const gemFragment = /* glsl */`
  uniform float uTime; uniform float uFar; uniform float uCymbal;
  varying vec3 vN; varying vec3 vPos; varying float vPart; varying vec3 vCol; varying float vGlow; varying float vHopo;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vPos);
    vec3 L = normalize(vec3(0.3, 1.0, 0.55));
    float diff = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 70.0);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    float od = step(0.5, vGlow) * (1.0 - step(1.5, vGlow));
    float dead = step(1.5, vGlow);
    vec3 base = mix(vCol, vec3(0.9, 0.94, 1.04), od * 0.82);
    float top = smoothstep(0.72, 0.95, N.y);
    vec3 col;
    if (vPart < 0.5) {
      // saturated glossy body, slightly lighter top face (white top on hammer-ons)
      vec3 side = base * (0.22 + 0.5 * diff) + base * fres * 1.1;
      vec3 topc = mix(base * (0.62 + 0.3 * diff), vec3(0.95), vHopo * 0.75);
      if (uCymbal > 0.5) topc = base * (0.55 + 0.4 * diff) + vec3(0.18) * spec;
      col = mix(side, topc, top) + spec * 0.9;
    } else if (vPart < 1.5) {
      // chrome rim
      col = vec3(0.78) * (0.45 + 0.55 * diff) + spec * 1.6 + base * 0.12;
    } else {
      // glowing core (the only part meant to bloom)
      col = mix(base * 1.55 + 0.06, vec3(1.5), vHopo * 0.8);
    }
    col += od * vec3(0.45, 0.75, 1.2) * (0.55 + 0.45 * sin(uTime * 9.0 + vPos.z * 0.5)) * (0.45 + top * 0.6);
    col = mix(col, vec3(0.05) + spec * 0.15, dead * 0.86);
    float fade = smoothstep(-uFar, -uFar * 0.72, vPos.z);
    gl_FragColor = vec4(col * fade, 1.0);
  }`;

const worldVertex = /* glsl */`
  varying vec2 vUv; varying vec3 vW; varying vec3 vN;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;

const surfaceFragment = /* glsl */`
  uniform float uLanes; uniform vec3 uColors[5]; uniform float uPress[5]; uniform float uFlash[5];
  uniform float uScroll; uniform float uTime; uniform float uOD; uniform float uDanger; uniform float uLen; uniform vec3 uAccent;
  uniform float uPulse; uniform float uSweep; uniform float uFailed; uniform float uStreak; uniform vec3 uMultCol; uniform float uWidth;
  varying vec2 vUv; varying vec3 vW;
  ${NOISE_GLSL}
  void main() {
    float z = vW.z;
    float u = vW.x / uWidth + 0.5;
    float inside = step(0.0, u) * step(u, 1.0);
    float lf = u * uLanes; float li = clamp(floor(lf), 0.0, uLanes - 1.0); float lx = clamp(lf - li, 0.0, 1.0);
    vec3 lc = uColors[0]; float pr = uPress[0]; float fl = uFlash[0];
    for (int i = 0; i < 5; i++) { if (float(i) == li) { lc = uColors[i]; pr = uPress[i]; fl = uFlash[i]; } }
    float s = z - uScroll;
    // brushed dark track
    vec3 col = vec3(0.014, 0.013, 0.028);
    col += vec3(0.010, 0.010, 0.018) * fbm(vec2(vW.x * 2.2, s * 0.06));
    col += vec3(0.02, 0.02, 0.035) * smoothstep(0.93, 1.0, fract(s * 0.25 + noise(vec2(floor(lf) * 7.0, 0.0)) * 0.5)) * inside;
    float laneShape = 1.0 - pow(abs(lx - 0.5) * 2.0, 3.0);
    col += lc * 0.03 * laneShape * inside;
    // lane strings
    float sep = (1.0 - smoothstep(0.0, 0.03, min(lx, 1.0 - lx))) * inside;
    col += vec3(0.34, 0.37, 0.5) * sep * (0.5 + uPulse * 0.5);
    // press / hit light pools near the strikeline
    float near = smoothstep(-9.0, 0.0, z) * (1.0 - smoothstep(0.0, 0.5, z));
    col += lc * (pr * 0.42 + fl * 0.9) * near * laneShape * inside;
    col += lc * exp(-abs(z) * 4.5) * 0.16 * inside;
    // border strip outside the lanes
    col = mix(col, vec3(0.03, 0.03, 0.045) + uAccent * 0.025, 1.0 - inside);
    // streak meter set into the board in front of the strikeline
    if (z > 0.4 && z < 0.72 && inside > 0.5) {
      float seg = u * 10.0; float sf = fract(seg); float si = floor(seg);
      float box = step(0.1, sf) * step(sf, 0.9) * smoothstep(0.42, 0.46, z) * (1.0 - smoothstep(0.66, 0.7, z));
      float lit = step(si + 0.5, uStreak);
      col = mix(col, mix(vec3(0.05, 0.05, 0.08), uMultCol * 1.15, lit), box);
    }
    // overdrive: golden caustics + gold strings
    float odw = fbm(vec2(vW.x * 0.9 + uTime * 0.35, s * 0.12 - uTime * 0.7));
    col = mix(col, col * vec3(1.25, 1.08, 0.72) + vec3(0.13, 0.085, 0.012) * odw, uOD);
    col += uOD * vec3(1.0, 0.72, 0.22) * sep * 0.45;
    col += uOD * vec3(1.0, 0.7, 0.2) * 0.035 * (0.5 + 0.5 * sin(z * 0.9 - uTime * 14.0)) * inside;
    // danger
    // danger: a red pulse creeping in from the lane edges and the rails, never hiding the gems
    float edgeD = (1.0 - laneShape) * inside + (1.0 - inside);
    col += uDanger * vec3(0.14, 0.0, 0.015) * (0.45 + 0.55 * sin(uTime * 7.0)) * (0.25 + 0.75 * edgeD);
    // horizon glow
    col += mix(uAccent, vec3(1.0, 0.75, 0.3), uOD) * exp(-abs(z + uLen * 0.66) * 0.22) * 0.055;
    // activation sweep
    if (uSweep > 0.0) col += vec3(1.4, 1.0, 0.45) * exp(-abs(z + uSweep * uLen) * 0.9) * (1.0 - uSweep) * 1.5;
    col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * 0.35, uFailed);
    float alpha = 0.97 * smoothstep(-uLen, -uLen * 0.6, z);
    gl_FragColor = vec4(col, alpha);
  }`;

const railFragment = /* glsl */`
  uniform vec3 uRail; uniform float uGlow; uniform float uTime; uniform float uLen; uniform float uScroll; uniform float uSide;
  varying vec2 vUv; varying vec3 vW; varying vec3 vN;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float ref = 0.5 + 0.5 * N.y;
    vec3 metal = mix(vec3(0.05, 0.05, 0.07), vec3(0.5, 0.52, 0.6), ref) * (0.55 + fres * 1.2);
    float s = vW.z - uScroll;
    float chase = smoothstep(0.75, 1.0, fract(s * 0.0625));
    float inner = step(0.5, N.y) + step(0.5, -N.x * uSide) * 0.3;
    vec3 led = uRail * (0.55 + uGlow * 1.25 + chase * 0.7);
    vec3 col = mix(metal, led, clamp(inner, 0.0, 1.0));
    col += uRail * fres * 0.5 * uGlow;
    float fade = smoothstep(-uLen, -uLen * 0.55, vW.z);
    gl_FragColor = vec4(col * fade, fade);
  }`;

const susVertex = /* glsl */`
  uniform float uWobble; uniform float uTime;
  varying float vZ; varying vec2 vUv;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.x += sin(wp.z * 5.0 + uTime * 26.0) * 0.07 * uWobble * smoothstep(0.2, -1.5, wp.z);
    vZ = wp.z; vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const susFragment = /* glsl */`
  uniform vec3 uColor; uniform float uState; uniform float uFar; uniform float uTime; uniform float uOd;
  varying float vZ; varying vec2 vUv;
  void main() {
    if (uState > 0.5 && uState < 1.5 && vZ > 0.0) discard;
    float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float body = smoothstep(0.0, 0.3, edge);
    vec3 c = mix(uColor, vec3(0.9, 0.95, 1.05), uOd * 0.7);
    vec3 col;
    if (uState > 1.5) col = vec3(0.1) * body;
    else {
      float flow = uState > 0.5 ? 0.5 + 0.5 * sin(vZ * 5.0 + uTime * 22.0) : 0.0;
      float bright = uState > 0.5 ? 2.3 + 0.8 * flow : 1.0;
      col = (c * (0.45 + 0.55 * body) + vec3(1.0) * pow(edge, 7.0) * 0.85) * bright;
    }
    float fade = smoothstep(-uFar, -uFar * 0.7, vZ);
    gl_FragColor = vec4(col, body * fade);
  }`;

// Procedural fire wall that runs along each side of the highway during overdrive.
const fireFragment = /* glsl */`
  uniform float uTime, uAmt, uLen, uSeed;
  uniform vec3 uHot, uMid, uCool;
  varying vec2 vUv; varying vec3 vW;
  ${NOISE_GLSL}
  void main() {
    float along = vW.z;
    vec2 p = vec2(along * 0.42 + uSeed, vUv.y * 2.4 - uTime * 3.4);
    float n = fbm(p);
    float n2 = fbm(p * 1.9 + vec2(uSeed, -uTime * 1.7));
    float height = uAmt * (0.5 + 0.35 * fbm(vec2(along * 0.15 + uTime * 0.4, uSeed)));
    float f = (1.0 - vUv.y / max(height, 0.001)) * 1.25 - (n * 0.65 + n2 * 0.45) * 0.85;
    f = clamp(f, 0.0, 1.0);
    vec3 col = mix(uCool, uMid, smoothstep(0.08, 0.45, f));
    col = mix(col, uHot, smoothstep(0.45, 0.9, f));
    float fade = smoothstep(-uLen, -uLen * 0.5, along) * (1.0 - 0.75 * smoothstep(-9.0, 0.5, along));
    float a = smoothstep(0.02, 0.3, f) * fade;
    gl_FragColor = vec4(col * a * 0.8, a * 0.85);
  }`;

// Small flame above a receptor ("on fire" at max multiplier)
const flameFragment = /* glsl */`
  uniform float uTime, uAmt, uSeed; uniform vec3 uColor;
  varying vec2 vUv; varying vec3 vW;
  ${NOISE_GLSL}
  void main() {
    float x = (vUv.x - 0.5) * 2.0;
    float n = fbm(vec2(vUv.x * 3.2 + uSeed, vUv.y * 2.6 - uTime * 4.5));
    float shape = (1.0 - vUv.y) * 1.3 - abs(x) * (0.9 + vUv.y) - n * 0.55;
    float f = clamp(shape * 1.8, 0.0, 1.0) * uAmt;
    vec3 col = mix(uColor * 0.9, vec3(1.0, 0.96, 0.85), smoothstep(0.55, 1.0, f));
    gl_FragColor = vec4(col * f * 0.85, f * 0.8);
  }`;

// Light column rising from a held fret
const beamFragment = /* glsl */`
  uniform vec3 uColor; uniform float uAmt;
  varying vec2 vUv; varying vec3 vW;
  void main() {
    float x = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float a = pow(1.0 - vUv.y, 2.2) * smoothstep(0.0, 0.7, x) * uAmt;
    gl_FragColor = vec4(uColor * a, a);
  }`;

// Brushed metal for the smasher frames
const metalFragment = /* glsl */`
  uniform vec3 uTint;
  varying vec2 vUv; varying vec3 vW; varying vec3 vN;
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    float d = max(dot(N, normalize(vec3(0.3, 1.0, 0.5))), 0.0);
    vec3 col = vec3(0.07, 0.07, 0.09) * (0.6 + d) + vec3(0.35, 0.37, 0.45) * fres + uTint * 0.08;
    gl_FragColor = vec4(col, 1.0);
  }`;

// Boss hazards (game/boss.js): a full-highway overlay, plus notes that sway sideways or warp in speed. They only
// change what you see: timing and judgement stay exactly the same.
const HAZARDS = {
  ink: { mode: 1 }, bubbles: { mode: 2, sway: 0.12 }, tide: { sway: 0.55 }, gravity: { mode: 9, warp: 0.45 }, blackout: { mode: 8 },
  meteor: { mode: 11, shake: 0.22 }, heat: { mode: 3, sway: 0.28 }, quake: { shake: 0.55 }, ash: { mode: 4 }, frost: { mode: 5 },
  whiteout: { mode: 6 }, shatter: { mode: 12, mirror: true }, lightning: { mode: 10, shake: 0.18 }, gust: { mode: 13, sway: 0.5 }, static: { mode: 7 },
};
const hazardFragment = /* glsl */`
  varying vec2 vUv;
  uniform float uTime, uAmt, uMode, uLane;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
  void main() {
    vec2 uv = vUv; float far = uv.y; // 0 = the strikeline, 1 = the far end
    vec3 col = vec3(0.0); float a = 0.0; float t = uTime;
    int m = int(uMode + 0.5);
    if (m == 1) { // ink: dark clouds rolling in from the far end
      float c = fbm(vec2(uv.x * 3.0, far * 6.0 - t * 0.6)) + fbm(vec2(uv.x * 7.0 + t * 0.2, far * 11.0));
      a = smoothstep(0.55, 1.1, c) * smoothstep(0.12, 0.45, far); col = vec3(0.01, 0.02, 0.05);
    } else if (m == 2) { // bubbles rising up the highway
      vec2 g = vec2(uv.x * 7.0, far * 26.0 + t * 3.5); vec2 id = floor(g); vec2 f = fract(g) - 0.5;
      float r = 0.18 + 0.22 * h(id); vec2 o = vec2(h(id + 3.1) - 0.5, h(id + 7.7) - 0.5) * 0.4;
      float d = length(f - o); float ring = smoothstep(r, r - 0.06, d) * (0.35 + 0.65 * smoothstep(r - 0.12, r, d));
      a = ring * step(0.45, h(id + 1.3)) * smoothstep(0.1, 0.4, far) * 0.6; col = vec3(0.6, 0.9, 1.0);
    } else if (m == 3) { // heat haze: orange shimmer bands
      float w = sin(far * 40.0 - t * 9.0 + sin(uv.x * 12.0 + t) * 2.0);
      a = (0.25 + 0.2 * w) * smoothstep(0.1, 0.5, far); col = vec3(1.0, 0.42, 0.08);
    } else if (m == 4 || m == 13) { // ash (grey specks + haze) / gust (wind streaks)
      float s = m == 4 ? step(0.985, h(floor(vec2(uv.x * 90.0 + t * 7.0, far * 160.0 + t * 30.0)))) : smoothstep(0.92, 1.0, n2(vec2(uv.x * 2.0 - t * 4.0, far * 70.0)));
      a = s * 0.9 + 0.35 * smoothstep(0.25, 0.9, far) * (m == 4 ? 1.0 : 0.3); col = m == 4 ? vec3(0.32, 0.3, 0.28) : vec3(0.85, 0.9, 1.0);
    } else if (m == 5) { // frost creeping in from both sides
      float edge = min(uv.x, 1.0 - uv.x);
      float cr = fbm(vec2(uv.x * 22.0, far * 40.0)) * 0.22;
      a = smoothstep(0.32 + cr, 0.05, edge) * 0.92; col = vec3(0.75, 0.92, 1.0) * (0.8 + 0.4 * n2(vec2(uv.x * 80.0, far * 120.0)));
    } else if (m == 6) { // whiteout
      a = smoothstep(0.08, 0.55, far) * (0.75 + 0.2 * fbm(vec2(uv.x * 4.0 + t * 0.5, far * 5.0))); col = vec3(0.92, 0.96, 1.0);
    } else if (m == 7) { // static
      float s = h(floor(vec2(uv.x * 120.0, far * 220.0)) + floor(t * 30.0));
      float band = step(0.82, fract(far * 3.0 - t * 2.3));
      a = (s * 0.55 + band * 0.25) * (0.5 + 0.5 * step(0.5, fract(t * 7.0))); col = vec3(s);
    } else if (m == 8) { // blackout: only the near end stays lit
      a = smoothstep(0.1, 0.32, far) * 0.97; col = vec3(0.0);
    } else if (m == 9) { // void: purple swirl
      vec2 c = vec2(uv.x - 0.5, far - 0.6); float ang = atan(c.y, c.x) + t * 1.5; float r = length(c);
      a = smoothstep(0.1, 0.6, far) * (0.35 + 0.35 * sin(ang * 5.0 + r * 30.0)); col = vec3(0.35, 0.05, 0.6);
    } else if (m == 10) { // lightning: one lane goes white-hot
      float lane = floor(uv.x * 5.0); float hitLane = step(abs(lane - uLane), 0.5);
      float fl = step(0.55, fract(t * 6.0));
      a = hitLane * fl * 0.9 * smoothstep(0.05, 0.25, far) + 0.08 * fl; col = vec3(0.95, 0.95, 1.4);
    } else if (m == 11) { // meteors streaking down the highway
      vec2 g = vec2(uv.x * 5.0, far * 3.0 + t * 2.6); vec2 id = floor(g); vec2 f = fract(g);
      float on = step(0.6, h(id)); float d = abs(f.x - 0.5);
      a = on * smoothstep(0.12, 0.0, d) * smoothstep(0.0, 0.8, f.y) * 0.95 * smoothstep(0.15, 0.4, far); col = vec3(1.2, 0.55, 0.15);
    } else if (m == 12) { // shatter: ice cracks
      float c = abs(n2(vec2(uv.x * 14.0, far * 24.0)) - 0.5);
      a = smoothstep(0.03, 0.0, c) * 0.9 + 0.15; col = vec3(0.8, 0.95, 1.0);
    }
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAmt);
  }`;

export class Highway {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
    this.camBase = new THREE.Vector3(0, 3.55, 4.9);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, 0, -7.5);
    this.len = HWY_LEN;
    this.speed = 20;
    this.shake = 0;
    this.pulse = 0;
    this.time = 0;
    this._start = 0;
    this._bStart = 0;
    this.vp = { x: 0, w: 1, h: 1 };
    this._anchorV = new THREE.Vector3();
    this.glowTex = glowTexture();
    this._buildSurface();
    this._buildReceptors();
    this._buildGems();
    this._buildSustains();
    this._buildLines();
    this._buildParticles();
    this._buildFlames();
    this._buildFire();
    this._buildRings();
    this._buildHazards();
    this.configure({ instrument: 'guitar', lefty: false, speed: 20, accent: 0xe0432f });
  }

  _buildSurface() {
    this.surfaceUniforms = {
      uLanes: { value: 5 }, uColors: { value: FIVE_COLORS.map((c) => new THREE.Color(c)) }, uPress: { value: [0, 0, 0, 0, 0] }, uFlash: { value: [0, 0, 0, 0, 0] },
      uScroll: { value: 0 }, uTime: { value: 0 }, uOD: { value: 0 }, uDanger: { value: 0 }, uLen: { value: HWY_LEN },
      uAccent: { value: new THREE.Color(0xe0432f) }, uPulse: { value: 0 }, uSweep: { value: 0 }, uFailed: { value: 0 },
      uStreak: { value: 0 }, uMultCol: { value: new THREE.Color(1, 1, 1) }, uWidth: { value: WIDTH },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.surfaceUniforms, vertexShader: worldVertex, fragmentShader: surfaceFragment, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(WIDTH + BORDER * 2, HWY_LEN + 2, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, -HWY_LEN / 2 + 1);
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.renderOrder = -3;
    this.scene.add(this.surface);
    // chrome rails with an LED strip (colour = status: accent / OD ready / overdrive / danger)
    this.rails = [];
    const railGeo = new THREE.BoxGeometry(0.13, 0.11, HWY_LEN + 2, 1, 1, 1).translate(0, 0.045, -HWY_LEN / 2 + 1);
    for (const side of [-1, 1]) {
      const mat2 = new THREE.ShaderMaterial({
        uniforms: { uRail: { value: new THREE.Color(0xe0432f) }, uGlow: { value: 0 }, uTime: { value: 0 }, uLen: { value: HWY_LEN }, uScroll: { value: 0 }, uSide: { value: side } },
        vertexShader: worldVertex, fragmentShader: railFragment, transparent: true, depthWrite: false,
      });
      const rail = new THREE.Mesh(railGeo, mat2);
      rail.position.x = side * (WIDTH / 2 + BORDER - 0.03);
      rail.renderOrder = -2;
      this.scene.add(rail);
      this.rails.push(rail);
    }
    this.railCol = new THREE.Color(0xe0432f);
    this._railTarget = new THREE.Color();
    const strike = new THREE.Mesh(new THREE.BoxGeometry(WIDTH + 0.1, 0.018, 0.045), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.8) }));
    strike.position.set(0, 0.012, 0);
    this.scene.add(strike);
    this.strike = strike;
  }

  _buildReceptors() {
    this.receptors = [];
    const metal = new THREE.ShaderMaterial({ uniforms: { uTint: { value: new THREE.Color(0, 0, 0) } }, vertexShader: worldVertex, fragmentShader: metalFragment });
    const shapes = {
      rect: {
        frame: slab(roundedRing(0.94, 0.5, 0.2, 0.1), 0.05, -0.005),
        ring: slab(roundedRing(0.74, 0.3, 0.12, 0.04), 0.06, 0),
        cap: slab(roundedRect(0.66, 0.22, 0.09), 0.02, 0.005),
      },
      round: {
        frame: slab(circleShape(0.46, 0.36), 0.05, -0.005, 0, 32),
        ring: slab(circleShape(0.36, 0.31), 0.06, 0, 0, 32),
        cap: slab(circleShape(0.31), 0.02, 0.005, 0, 32),
      },
    };
    const beamGeo = new THREE.PlaneGeometry(0.7, 2.6).translate(0, 1.3, 0);
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const parts = {};
      for (const [kind, s] of Object.entries(shapes)) {
        const grp = new THREE.Group();
        const frame = new THREE.Mesh(s.frame, metal);
        const ring = new THREE.Mesh(s.ring, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const cap = new THREE.Mesh(s.cap, new THREE.MeshBasicMaterial({ color: 0x111111 }));
        grp.add(frame, ring, cap);
        g.add(grp);
        parts[kind] = { grp, ring, cap };
      }
      const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uAmt: { value: 0 } }, vertexShader: worldVertex, fragmentShader: beamFragment,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      beam.renderOrder = 3;
      beam.visible = false;
      g.add(beam);
      this.scene.add(g);
      this.receptors.push({ g, parts, beam, flash: 0, press: 0, kind: 'rect' });
    }
    const kbGeo = slab(roundedRect(WIDTH, 0.13, 0.065), 0.035, -0.01);
    this.kickReceptor = new THREE.Mesh(kbGeo, new THREE.MeshBasicMaterial({ color: 0xff8a1a }));
    this.scene.add(this.kickReceptor);
  }

  _gemMaterial(cymbal = false) {
    return new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uFar: { value: HWY_LEN }, uCymbal: { value: cymbal ? 1 : 0 } }, vertexShader: gemVertex, fragmentShader: gemFragment });
  }

  _buildGems() {
    const mk = (geo, count, cymbal = false) => {
      geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
      geo.setAttribute('aHopo', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
      const m = new THREE.InstancedMesh(geo, this._gemMaterial(cymbal), count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const c = new THREE.Color(1, 1, 1);
      for (let i = 0; i < count; i++) m.setColorAt(i, c);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      this.scene.add(m);
      return m;
    };
    this.gems = mk(gemGeometry(), MAX_GEMS);
    this.pads = mk(gemGeometry(1.0, 0.34), MAX_GEMS);
    this.cymbals = mk(cymbalGeometry(), MAX_CYM, true);
    this.kicks = mk(kickGeometry(), MAX_KICKS);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  _buildSustains() {
    const geo = new THREE.PlaneGeometry(0.22, 1, 1, 40).rotateX(-Math.PI / 2).translate(0, 0.035, -0.5);
    this.sustains = [];
    for (let i = 0; i < MAX_SUS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uState: { value: 0 }, uFar: { value: HWY_LEN }, uTime: { value: 0 }, uWobble: { value: 0 }, uOd: { value: 0 } },
        vertexShader: susVertex, fragmentShader: susFragment, transparent: true, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.renderOrder = -1; m.frustumCulled = false;
      this.scene.add(m);
      this.sustains.push(m);
    }
  }

  _buildLines() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lines = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX_LINES);
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAX_LINES; i++) this.lines.setColorAt(i, c);
    this.lines.count = 0; this.lines.frustumCulled = false; this.lines.renderOrder = -1;
    this.scene.add(this.lines);
  }

  _buildParticles() {
    const N = 1800;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N).fill(1);
    this.pSize = new Float32Array(N);
    this.pHead = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.glowTex } },
      vertexShader: `attribute float aSize; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * 300.0 / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vC * a * 1.5, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  _buildFlames() {
    this.flames = [];
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      this.scene.add(s);
      this.flames.push({ s, life: 0, max: 0.3, big: false });
    }
    this.flameHead = 0;
  }

  _buildFire() {
    this.fireWalls = [];
    const geo = new THREE.PlaneGeometry(HWY_LEN, 3.4, 1, 1).rotateY(Math.PI / 2).translate(0, 1.7, -HWY_LEN / 2);
    for (const side of [-1, 1]) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uAmt: { value: 0 }, uLen: { value: HWY_LEN }, uSeed: { value: side * 17.3 },
          uHot: { value: new THREE.Color(1.0, 0.92, 0.6) }, uMid: { value: new THREE.Color(1.0, 0.42, 0.05) }, uCool: { value: new THREE.Color(0.55, 0.04, 0.0) },
        },
        vertexShader: worldVertex, fragmentShader: fireFragment,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.x = side * (WIDTH / 2 + BORDER + 0.1);
      m.frustumCulled = false;
      m.renderOrder = 1;
      m.visible = false;
      this.scene.add(m);
      this.fireWalls.push(m);
    }
    this.fireAmt = 0;
    this.receptorFlames = [];
    const fgeo = new THREE.PlaneGeometry(0.75, 1.05).translate(0, 0.5, 0);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uSeed: { value: i * 3.7 }, uColor: { value: new THREE.Color() } },
        vertexShader: worldVertex, fragmentShader: flameFragment,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(fgeo, mat);
      m.rotation.x = -0.35;
      m.frustumCulled = false;
      m.renderOrder = 2;
      m.visible = false;
      this.scene.add(m);
      this.receptorFlames.push(m);
    }
    this.flameAmt = 0;
  }

  _buildRings() {
    this.rings = [];
    const geo = new THREE.RingGeometry(0.36, 0.46, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.position.y = 0.05;
      this.scene.add(m);
      this.rings.push({ m, life: 0 });
    }
    this.ringHead = 0;
    this.sweep = 0;
  }

  _buildHazards() {
    this.hazardU = { uTime: { value: 0 }, uAmt: { value: 0 }, uMode: { value: 0 }, uLane: { value: 2 } };
    const geo = new THREE.PlaneGeometry(WIDTH + BORDER * 2 + 0.4, HWY_LEN, 1, 1).rotateX(-Math.PI / 2).translate(0, 0.42, -HWY_LEN / 2);
    // uv.y runs from the strikeline (0) to the far end (1)
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.hazardMesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.hazardU, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: hazardFragment, transparent: true, depthWrite: false, depthTest: false,
    }));
    this.hazardMesh.renderOrder = 20;
    this.hazardMesh.visible = false;
    this.hazardMesh.frustumCulled = false;
    this.scene.add(this.hazardMesh);
    this.hazards = new Map(); // kind -> { until (performance.now ms), mild }
    this.sway = 0; this.warp = 0;
  }

  /** A boss hazard for ms milliseconds. mild: cosmetic strength only (Settings → Boss hazards). → the hazard's spec */
  hazard(kind, ms, mild = false) {
    const hz = HAZARDS[kind];
    if (!hz) return null;
    this.hazards.set(kind, { until: performance.now() + ms, mild });
    if (hz.mode === 10) this.hazardU.uLane.value = Math.floor(Math.random() * 5);
    if (hz.shake) this.shake = Math.max(this.shake, hz.shake * (mild ? 0.4 : 1));
    return hz;
  }

  clearHazards() { this.hazards.clear(); }

  ring(x, color, big = false) {
    const r = this.rings[this.ringHead];
    this.ringHead = (this.ringHead + 1) % this.rings.length;
    r.m.visible = true;
    r.m.position.x = x;
    r.m.material.color.copy(color).multiplyScalar(big ? 2.2 : 1.4);
    r.life = 1;
    r.big = big;
  }

  configure({ instrument, lefty, speed, accent }) {
    this.instrument = instrument;
    this.drums = instrument === 'drums';
    this.lefty = !!lefty;
    this.speed = speed;
    this.accent = new THREE.Color(accent);
    this.colors = (this.drums ? DRUM_COLORS : FIVE_COLORS).map((c) => new THREE.Color(c));
    const lanesDrawn = this.drums ? 4 : 5;
    this.surfaceUniforms.uLanes.value = lanesDrawn;
    const drawOrder = [];
    for (let v = 0; v < lanesDrawn; v++) drawOrder.push(this.laneAtVisual(v, lanesDrawn));
    this.surfaceUniforms.uColors.value = [0, 1, 2, 3, 4].map((v) => this.colors[drawOrder[v] ?? 0].clone());
    this.surfaceUniforms.uAccent.value.set(accent);
    this.railCol.set(accent);
    this.receptors.forEach((r, lane) => {
      const visible = !(this.drums && lane === 0);
      r.g.visible = visible;
      if (!visible) return;
      r.g.position.set(this.laneX(lane), 0, 0);
      r.kind = this.drums && CYMBAL_LANES.has(lane) ? 'round' : 'rect';
      r.parts.rect.grp.visible = r.kind === 'rect';
      r.parts.round.grp.visible = r.kind === 'round';
      const sc = this.drums ? (r.kind === 'round' ? 1.05 : 1.22) : 1;
      r.parts.rect.grp.scale.set(sc, 1, 1);
      r.parts.round.grp.scale.set(sc, 1, sc);
      const col = this.colors[lane];
      for (const p of Object.values(r.parts)) p.ring.material.color.copy(col).multiplyScalar(1.4);
      r.beam.material.uniforms.uColor.value.copy(col);
      r.beam.scale.x = this.drums ? 1.25 : 1;
      r.col = col;
    });
    this.kickReceptor.visible = this.drums;
    this.kickReceptor.material.color.copy(this.colors[0]).multiplyScalar(2);
  }

  laneAtVisual(v) {
    if (this.drums) { const lane = v + 1; return this.lefty ? 5 - lane : lane; }
    return this.lefty ? 4 - v : v;
  }

  laneX(lane) {
    if (this.drums) {
      if (lane === 0) return 0;
      const v = this.lefty ? 4 - lane : lane - 1; // 0..3
      return (v - 1.5) * (WIDTH / 4);
    }
    const v = this.lefty ? 4 - lane : lane;
    return (v - 2) * (WIDTH / 5);
  }

  resize(w, h, x0 = 0) {
    this.vp = { x: x0, w, h };
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1.2 ? 58 : 52;
    // pull the camera back until the whole strikeline fits (narrow band-mode columns)
    const hf = 2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * aspect);
    const need = 3.35 / Math.tan(hf / 2);
    const k = Math.max(1, need / 6.05);
    this.camBase.set(0, 3.55 * k, 4.9 * k);
    this.camera.updateProjectionMatrix();
  }

  /** Screen position (CSS px) of the strikeline ends, for HUD elements that hug the highway. */
  anchor() {
    this.camera.updateMatrixWorld();
    const v = this._anchorV;
    const out = {};
    for (const [key, x] of [['l', -(WIDTH / 2 + BORDER)], ['r', WIDTH / 2 + BORDER]]) {
      v.set(x, 0, 0.35).project(this.camera);
      out[key] = this.vp.x + (v.x * 0.5 + 0.5) * this.vp.w;
      out.y = (1 - (v.y * 0.5 + 0.5)) * this.vp.h;
    }
    v.set(0, 0, -HWY_LEN * 0.55).project(this.camera);
    out.top = (1 - (v.y * 0.5 + 0.5)) * this.vp.h;
    return out;
  }

  // ---------------------------------------------------------------- effects
  emit(x, y, z, color, count, spread = 1, up = 6) {
    for (let k = 0; k < count; k++) {
      const i = this.pHead; this.pHead = (this.pHead + 1) % this.pN;
      this.pPos[i * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pPos[i * 3 + 1] = y;
      this.pPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.2 * spread;
      this.pVel[i * 3] = Math.cos(a) * r;
      this.pVel[i * 3 + 1] = up * (0.5 + Math.random());
      this.pVel[i * 3 + 2] = Math.sin(a) * r * 0.6 + 1.5;
      const w = Math.random() * 0.5;
      this.pCol[i * 3] = color.r + w; this.pCol[i * 3 + 1] = color.g + w; this.pCol[i * 3 + 2] = color.b + w;
      this.pMax[i] = this.pLife[i] = 0.35 + Math.random() * 0.45;
      this.pSize[i] = 0.12 + Math.random() * 0.18;
    }
  }

  flame(x, color, big = false) {
    const f = this.flames[this.flameHead];
    this.flameHead = (this.flameHead + 1) % this.flames.length;
    f.s.visible = true;
    f.s.position.set(x, big ? 0.6 : 0.35, 0.05);
    f.s.material.color.copy(color).multiplyScalar(big ? 1.5 : 1.1);
    f.life = f.max = big ? 0.42 : 0.26;
    f.big = big;
  }

  hitFx(lane, judgment) {
    const x = this.laneX(lane);
    const col = this.colors[lane];
    const r = this.receptors[lane];
    if (r) r.flash = 1;
    if (this.drums && lane === 0) {
      for (let k = -2; k <= 2; k++) this.emit(k * 1.1, 0.1, 0.2, col, 5, 0.6, 4);
      this.flame(0, col, true);
      this.ring(0, col, true);
      this.shake = Math.max(this.shake, 0.05);
      return;
    }
    this.emit(x, 0.15, 0, col, judgment === 'perfect' ? 20 : 12);
    this.flame(x, col, judgment === 'perfect');
    if (judgment !== 'good') this.ring(x, col, judgment === 'perfect');
  }

  sustainSparks(lane) {
    const x = this.laneX(lane);
    if (Math.random() < 0.8) this.emit(x, 0.12, 0, this.colors[lane], 1, 0.5, 4);
  }

  missFx(lane) {
    const r = this.receptors[lane];
    if (r) r.flash = -1;
  }

  odBurst() {
    this.sweep = 0.001;
    const gold = new THREE.Color(1, 0.75, 0.25);
    for (let lane = 0; lane < 5; lane++) this.emit(this.laneX(lane), 0.2, 0, gold, 14, 1.6, 9);
    this.shake = 0.35;
  }

  // ---------------------------------------------------------------- per frame
  /**
   * @param {number} t song time (s)
   * @param {object} st { notes, beats, downbeat, held:[bool x5], od, odReady, danger, whammy, beatHit, mult, maxMult, streak, onFire, failed }
   */
  update(t, dt, st) {
    this.time += dt;
    const speed = this.speed;
    // fog (a battle attack): notes only show up on the near part of the highway
    this.fogK = (this.fogK || 0) + ((this.fog ? 1 : 0) - (this.fogK || 0)) * Math.min(1, dt * 8);
    // boss hazards: the overlay, sway and speed warp of whatever is active (the newest overlay wins)
    const nowMs = performance.now();
    let mode = 0, sway = 0, warp = 0, mild = false;
    for (const [kind, h] of this.hazards) {
      if (h.until < nowMs) { this.hazards.delete(kind); continue; }
      const hz = HAZARDS[kind];
      if (hz.mode) mode = hz.mode;
      sway = Math.max(sway, hz.sway || 0); warp = Math.max(warp, hz.warp || 0); mild = mild || h.mild;
      if (kind === 'quake' && st.beatHit) this.shake = Math.max(this.shake, mild ? 0.15 : 0.4);
    }
    const HU = this.hazardU;
    if (mode) HU.uMode.value = mode;
    HU.uAmt.value += ((mode ? (mild ? 0.4 : 1) : 0) - HU.uAmt.value) * Math.min(1, dt * 5);
    HU.uTime.value = this.time;
    this.hazardMesh.visible = HU.uAmt.value > 0.01;
    this.sway += ((mild ? sway * 0.4 : sway) - this.sway) * Math.min(1, dt * 3);
    this.warp += ((mild ? warp * 0.4 : warp) - this.warp) * Math.min(1, dt * 3);
    const warpK = 1 + this.warp * Math.sin(this.time * 2.2);
    const lookahead = (this.len / speed) * (1 - 0.68 * this.fogK) / Math.max(0.55, warpK);
    const U = this.surfaceUniforms;
    U.uTime.value = this.time;
    U.uScroll.value = t * speed;
    U.uOD.value += ((st.od ? 1 : 0) - U.uOD.value) * Math.min(1, dt * 6);
    U.uDanger.value += ((st.danger || 0) - U.uDanger.value) * Math.min(1, dt * 4);
    this.pulse = Math.max(0, this.pulse - dt * 4);
    if (st.beatHit) this.pulse = 1;
    U.uPulse.value = this.pulse;
    U.uFailed.value += ((st.failed ? 1 : 0) - U.uFailed.value) * Math.min(1, dt * 3);
    if (this.sweep > 0) { this.sweep += dt * 1.6; if (this.sweep >= 1) this.sweep = 0; }
    U.uSweep.value = this.sweep;
    // streak meter + multiplier colour
    const mult = st.mult || 1, maxMult = st.maxMult || 4;
    const streakLit = mult >= maxMult ? 10 : (st.streak || 0) % 10;
    U.uStreak.value += (streakLit - U.uStreak.value) * Math.min(1, dt * 20);
    U.uMultCol.value.set(st.od ? 0xf6c945 : MULT_COLORS[Math.min(6, mult)]);
    // rails: accent, electric blue when overdrive is ready, gold in overdrive, pulsing red in danger
    if (st.od) this._railTarget.setRGB(1.0, 0.72, 0.2);
    else if (st.danger) this._railTarget.setRGB(1.0, 0.08, 0.1).multiplyScalar(0.6 + 0.4 * Math.abs(Math.sin(this.time * 6)));
    else if (st.odReady) this._railTarget.setRGB(0.25, 0.62, 0.9);
    else this._railTarget.copy(this.accent);
    this.railCol.lerp(this._railTarget, Math.min(1, dt * 8));
    // the fire walls carry overdrive; rails stay moderate so the pair doesn't bloom into a white-out
    const glow = st.od ? 0.3 + this.pulse * 0.2 : Math.min(1, (mult - 1) / Math.max(1, maxMult - 1)) * 0.8 + this.pulse * 0.35;
    for (const rail of this.rails) {
      const u = rail.material.uniforms;
      u.uRail.value.copy(this.railCol);
      u.uGlow.value = glow * (st.failed ? 0.1 : 1);
      u.uTime.value = this.time;
      u.uScroll.value = t * speed;
    }
    // fire walls: roaring orange in overdrive, low blue flicker when overdrive is ready
    const fireTarget = st.od ? 1 : st.odReady ? 0.2 : 0;
    this.fireAmt += (fireTarget - this.fireAmt) * Math.min(1, dt * (st.od ? 3 : 2));
    const blue = !st.od && !!st.odReady;
    for (const w of this.fireWalls) {
      const u = w.material.uniforms;
      u.uTime.value = this.time;
      u.uAmt.value = this.fireAmt * (1 + this.pulse * 0.15);
      if (blue !== this._fireBlue) {
        if (blue) { u.uHot.value.setRGB(0.8, 0.95, 1.2); u.uMid.value.setRGB(0.15, 0.55, 1.2); u.uCool.value.setRGB(0.02, 0.08, 0.5); }
        else { u.uHot.value.setRGB(1.0, 0.92, 0.6); u.uMid.value.setRGB(1.0, 0.42, 0.05); u.uCool.value.setRGB(0.55, 0.04, 0.0); }
      }
      w.visible = this.fireAmt > 0.01;
    }
    this._fireBlue = blue;
    this.flameAmt += ((st.onFire ? 1 : 0) - this.flameAmt) * Math.min(1, dt * 4);
    this.receptorFlames.forEach((f, lane) => {
      const show = this.flameAmt > 0.02 && !(this.drums && lane === 0);
      f.visible = show;
      if (!show) return;
      f.position.set(this.laneX(lane), 0.05, 0.35);
      const u = f.material.uniforms;
      u.uTime.value = this.time;
      u.uAmt.value = this.flameAmt * (0.4 + 0.6 * (st.held[lane] ? 1 : 0));
      u.uColor.value.copy(this.colors[lane]);
    });
    for (const r of this.rings) {
      if (r.life <= 0) { r.m.visible = false; continue; }
      r.life -= dt * (r.big ? 2.4 : 3.2);
      const k = 1 - Math.max(0, r.life);
      const sc = 1 + k * (r.big ? 2.6 : 1.8);
      r.m.scale.set(sc, 1, sc);
      r.m.material.opacity = Math.max(0, r.life);
    }
    for (let lane = 0; lane < 5; lane++) {
      const held = st.held[lane] ? 1 : 0;
      const r = this.receptors[lane];
      r.press += (held - r.press) * Math.min(1, dt * 30);
      r.flash += (0 - r.flash) * Math.min(1, dt * 10);
      const vis = this.drums ? lane - 1 : lane;
      if (vis >= 0) {
        const drawV = this.drums ? (this.lefty ? 3 - vis : vis) : (this.lefty ? 4 - vis : vis);
        U.uPress.value[drawV] = r.press;
        U.uFlash.value[drawV] = Math.max(0, r.flash);
      }
      if (r.col && r.g.visible) {
        const f = r.flash;
        const p = r.parts[r.kind];
        const lit = r.press * 2.2 + Math.max(0, f) * 5;
        if (f < -0.05) p.cap.material.color.setRGB(0.7 * -f, 0.02, 0.03);
        else p.cap.material.color.copy(r.col).multiplyScalar(0.06 + lit);
        p.ring.material.color.copy(r.col).multiplyScalar(1.2 + r.press * 1.2 + Math.max(0, f) * 2.5);
        p.cap.position.y = -r.press * 0.02;
        const s = 1 + Math.max(0, f) * 0.08;
        p.grp.scale.y = 1;
        p.cap.scale.set(s, 1, s);
        const beamAmt = Math.min(1, r.press * 0.32 + Math.max(0, f) * 0.5) * (st.failed ? 0.3 : 1);
        r.beam.visible = beamAmt > 0.01;
        r.beam.material.uniforms.uAmt.value = beamAmt;
      }
    }
    if (this.drums) {
      const k = this.receptors[0];
      this.kickReceptor.material.color.copy(this.colors[0]).multiplyScalar(0.8 + k.press * 3 + Math.max(0, k.flash) * 4);
    }

    // gems + sustains
    const notes = st.notes;
    let gi = 0, pi = 0, ci = 0, ki = 0, si = 0;
    if (notes) {
      while (this._start < notes.length && notes[this._start].t + (notes[this._start].len || 0) < t - 1.2) this._start++;
      for (let i = this._start || 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.t > t + lookahead) break;
        const z = -(n.t - t) * speed * warpK;
        const tailEnd = n.len > 0 ? -(n.t + n.len - t) * speed * warpK : z;
        const swayX = this.sway ? this.sway * Math.sin(z * 0.22 + this.time * 2.6) * Math.min(1, -z / 12) : 0;
        const odNote = n.p >= 0 && st.odPhraseAlive?.(n.p);
        // sustain tail
        if (n.len > 0 && !n.sus?.done && si < MAX_SUS && tailEnd < 0.5) {
          const m = this.sustains[si++];
          const state = n.sus?.held ? 1 : (n.missed || n.sus?.dead) ? 2 : 0;
          const headZ = state === 1 ? Math.min(0, z) : z;
          m.visible = true;
          m.position.set(this.laneX(n.lane) + swayX, 0, headZ);
          m.scale.set(this.drums ? 1.2 : 1, 1, Math.max(0.001, headZ - tailEnd));
          const u = m.material.uniforms;
          u.uColor.value.copy(this.colors[n.lane]);
          u.uState.value = state;
          u.uTime.value = this.time;
          u.uOd.value = odNote ? 1 : 0;
          u.uWobble.value = state === 1 ? 0.25 + st.whammy * 1.5 : 0;
        }
        if (n.hit) continue;
        if (z > 3) continue;
        const glow = n.missed ? 2 : odNote ? 1 : 0;
        let mesh, idx;
        if (this.drums && n.lane === 0) {
          if (ki >= MAX_KICKS) continue;
          mesh = this.kicks; idx = ki++;
          this._p.set(0, 0.02, z); this._s.set(1, 1, 1);
        } else if (this.drums && CYMBAL_LANES.has(n.lane)) {
          if (ci >= MAX_CYM) continue;
          mesh = this.cymbals; idx = ci++;
          this._p.set(this.laneX(n.lane) + swayX, 0.02, z); this._s.set(1, 1, 0.72);
        } else if (this.drums) {
          if (pi >= MAX_GEMS) continue;
          mesh = this.pads; idx = pi++;
          this._p.set(this.laneX(n.lane) + swayX, 0.02, z); this._s.set(1.08, 1, 1.05);
        } else {
          if (gi >= MAX_GEMS) continue;
          mesh = this.gems; idx = gi++;
          const hs = n.hopo ? 0.84 : 1;
          this._p.set(this.laneX(n.lane) + swayX, 0.02, z); this._s.set(hs, n.hopo ? 1.15 : 1, hs);
        }
        this._q.identity();
        this._m.compose(this._p, this._q, this._s);
        mesh.setMatrixAt(idx, this._m);
        mesh.setColorAt(idx, this.colors[n.lane]);
        mesh.geometry.attributes.aGlow.array[idx] = glow;
        mesh.geometry.attributes.aHopo.array[idx] = n.hopo ? 1 : 0;
      }
    }
    for (const [mesh, count] of [[this.gems, gi], [this.pads, pi], [this.cymbals, ci], [this.kicks, ki]]) {
      mesh.count = count;
      mesh.visible = count > 0;
      if (!count) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.geometry.attributes.aGlow.needsUpdate = true;
      mesh.geometry.attributes.aHopo.needsUpdate = true;
      mesh.material.uniforms.uTime.value = this.time;
    }
    for (let i = si; i < MAX_SUS; i++) this.sustains[i].visible = false;

    // beat lines
    let li = 0;
    if (st.beats) {
      const b = st.beats;
      if (this._bStart == null || this._bStart >= b.length || b[this._bStart] > t + 1) this._bStart = 0;
      while (this._bStart < b.length - 1 && b[this._bStart] < t - 0.5) this._bStart++;
      for (let i = this._bStart; i < b.length && li < MAX_LINES; i++) {
        if (b[i] > t + lookahead) break;
        const z = -(b[i] - t) * speed * warpK;
        const measure = ((i - st.downbeat) % 4 + 4) % 4 === 0;
        this._p.set(0, 0.006, z); this._s.set(WIDTH, 0.008, measure ? 0.085 : 0.035); this._q.identity();
        this._m.compose(this._p, this._q, this._s);
        this.lines.setMatrixAt(li, this._m);
        if (measure) this._c.copy(this.railCol).lerp(WHITE, 0.72); else this._c.setScalar(0.32);
        this.lines.setColorAt(li, this._c);
        li++;
        const nb = b[i + 1];
        if (nb && li < MAX_LINES) {
          const hz = -((b[i] + nb) / 2 - t) * speed * warpK;
          this._p.set(0, 0.005, hz); this._s.set(WIDTH, 0.004, 0.018);
          this._m.compose(this._p, this._q, this._s);
          this.lines.setMatrixAt(li, this._m);
          this._c.setScalar(0.1);
          this.lines.setColorAt(li, this._c);
          li++;
        }
      }
    }
    this.lines.count = li;
    this.lines.instanceMatrix.needsUpdate = true;
    if (this.lines.instanceColor) this.lines.instanceColor.needsUpdate = true;

    // particles
    const P = this.pPos, V = this.pVel;
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) { this.pSize[i] = 0; continue; }
      this.pLife[i] -= dt;
      V[i * 3 + 1] -= 16 * dt;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < 0) { P[i * 3 + 1] = 0; V[i * 3 + 1] *= -0.3; }
      const k = Math.max(0, this.pLife[i] / this.pMax[i]);
      this.pSize[i] = (0.1 + 0.2 * k) * (this.pLife[i] > 0 ? 1 : 0);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;

    // flames
    for (const f of this.flames) {
      if (f.life <= 0) { f.s.visible = false; continue; }
      f.life -= dt;
      const k = 1 - f.life / f.max;
      const base = f.big ? 1.3 : 0.9;
      f.s.scale.set(base * (0.6 + k * 0.8), base * (0.8 + k * 1.4), 1);
      f.s.material.opacity = Math.max(0, 1 - k);
    }

    // camera shake
    this.shake = Math.max(0, this.shake - dt * 1.2);
    const sh = st.cameraShake === false ? 0 : this.shake;
    this.camera.position.set(
      this.camBase.x + (Math.random() - 0.5) * sh * 0.4,
      this.camBase.y + (Math.random() - 0.5) * sh * 0.3 - this.pulse * 0.02,
      this.camBase.z,
    );
    this.camera.lookAt(0, 0, -7.5);
  }

  resetScroll() { this._start = 0; this._bStart = 0; }
}
