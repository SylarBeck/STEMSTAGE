// WebGL renderer: stage scene, then 1–4 highways composited side by side (each in its own
// viewport, depth cleared), bloom, a stylised post pass, ACES tone mapping.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { settings } from '../settings.js';

// The HDR composer stores two full-size half-float targets and bloom allocates more.
// Keep the default at display resolution; reserve supersampling for Ultra.
const PIXEL_RATIO = { low: 0.75, high: 1, ultra: 1.5 };

function drawHighways(renderer, highways, target, W, H) {
  const n = highways.length;
  if (!n) return;
  const oldAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  for (let i = 0; i < n; i++) {
    const x = Math.floor((i * W) / n), w = Math.floor(((i + 1) * W) / n) - x;
    if (target) {
      // Render-target dimensions are already physical pixels. WebGLRenderer.setViewport()
      // multiplies by pixelRatio again, which changes the highway size with quality.
      target.viewport.set(x, 0, w, H);
      target.scissor.set(x, 0, w, H);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
    } else {
      // The default framebuffer's viewport API expects CSS pixels.
      renderer.setRenderTarget(null);
      renderer.setViewport(x, 0, w, H);
      renderer.setScissor(x, 0, w, H);
      renderer.setScissorTest(true);
    }
    renderer.clearDepth();
    renderer.render(highways[i].scene, highways[i].camera);
  }
  if (target) {
    target.viewport.set(0, 0, W, H);
    target.scissor.set(0, 0, W, H);
    target.scissorTest = false;
    renderer.setRenderTarget(target);
  } else {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
  }
  renderer.autoClear = oldAutoClear;
}

class HighwaysPass extends Pass {
  constructor() {
    super();
    this.highways = [];
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const target = this.renderToScreen ? null : readBuffer;
    drawHighways(renderer, this.highways, target, readBuffer.width, readBuffer.height);
  }
}

// Guards the HDR buffer before bloom: a single NaN/Inf pixel (e.g. from a degenerate normal or a
// negative pow() on some drivers) gets smeared by the blur chain into flashing black blocks.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    float ok(float x) { return (x >= 0.0 && x < 60000.0) ? x : 0.0; }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = vec3(ok(c.r), ok(c.g), ok(c.b));
      gl_FragColor = vec4(min(max(c, vec3(0.0)), vec3(48.0)), 1.0);
    }`,
};

// Shockwave ripple + chromatic aberration + overdrive grade + film grain (runs on linear HDR, before tone mapping)
const FxShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uAberr: { value: 0 }, uShock: { value: -1 },
    uCenter: { value: new THREE.Vector2(0.5, 0.2) }, uAspect: { value: 1.7 }, uOD: { value: 0 }, uGrain: { value: 0.012 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uAberr, uShock, uAspect, uOD, uGrain; uniform vec2 uCenter;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      if (uShock >= 0.0) {
        vec2 d = uv - uCenter; d.x *= uAspect;
        float dist = length(d);
        float r = uShock * 1.4, w = 0.09;
        float ring = smoothstep(r - w, r, dist) * (1.0 - smoothstep(r, r + w, dist));
        uv -= normalize(d + 1e-5) / vec2(uAspect, 1.0) * ring * 0.035 * (1.0 - uShock);
      }
      vec2 c = uv - 0.5;
      float ab = uAberr + uOD * 0.001;
      vec2 off = c * ab * (0.6 + dot(c, c) * 3.0);
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      col = mix(col, col * vec3(1.12, 1.0, 0.84) + vec3(0.015, 0.008, 0.0), uOD * 0.55);
      float g = fract(sin(dot(uv * (fract(uTime) + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, stage, highway, quality = 'high') {
    this.stage = stage;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.stagePass = new RenderPass(stage.scene, stage.camera);
    this.hwyPass = new HighwaysPass();
    this.sanitize = new ShaderPass(SanitizeShader);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 1.0);
    this.fxPass = new ShaderPass(FxShader);
    this.composer.addPass(this.stagePass);
    this.composer.addPass(this.hwyPass);
    this.composer.addPass(this.sanitize);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.fxPass);
    this.composer.addPass(new OutputPass());
    this.time = 0;
    // Auto render scale: when frames run long the 3D drops resolution in steps (and comes back when there's room),
    // so integrated graphics hold their frame rate. Only with Settings → Render scale on Auto.
    this.dyn = { scale: 1, acc: 0, n: 0, slow: 0, fast: 0, last: 0 };
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Draw another scene (the backstage creator) instead of the stage; null goes back to the stage. */
  setView(view) {
    this.view = view || null;
    this.stagePass.scene = view ? view.scene : this.stage.scene;
    this.stagePass.camera = view ? view.camera : this.stage.camera;
  }

  setHighways(list) {
    this.hwyPass.highways = list;
    for (const h of list) if (h.scene && h.camera) this.warm(h.scene, h.camera);
    this._layout();
  }

  setFx(fx) {
    const u = this.fxPass.uniforms;
    u.uAberr.value = fx.aberration;
    u.uShock.value = fx.shock;
    u.uOD.value = fx.od;
  }

  setQuality(q, bloom = true) {
    this.quality = q;
    this.dyn.scale = 1;
    this.bloom.enabled = bloom && q !== 'low';
    this.sanitize.enabled = this.bloom.enabled;
    this.fxPass.uniforms.uGrain.value = q === 'low' || !settings.filmGrain ? 0 : 0.012;
    this.resize();
  }

  setAntialiasing(mode) {
    const requested = mode === 'off' ? 0 : mode === '4x' ? 4 : 2;
    const samples = Math.min(requested, this.renderer.capabilities.maxSamples || 0);
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples === samples) continue;
      target.samples = samples;
      target.dispose(); // recreate the multisample buffers on the next render
    }
  }

  _layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const n = this.hwyPass.highways.length || 1;
    this.hwyPass.highways.forEach((hw, i) => hw.resize(w / n, h, (i * w) / n));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const scale = Number(settings.renderScale);
    const pr = Number.isFinite(scale) && scale >= 50 && scale <= 200
      ? scale / 100 : Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[this.quality] || 1.25) * this.dyn.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.fxPass.uniforms.uAspect.value = w / h;
    this.stage.resize(w, h);
    this._layout();
  }

  /**
   * Compile every material in a scene, hidden ones too (a world's boss, pyro, effects), so nothing stalls the first
   * time it appears mid-song. Synchronous: call it while a loading message is up.
   */
  warm(scene = this.stage.scene, camera = this.stage.camera) {
    const hidden = [];
    scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { this.renderer.compile(scene, camera); } catch (e) { console.warn('[renderer] warm-up', e); }
    for (const o of hidden) o.visible = false;
  }

  /** The auto render-scale governor (see the constructor). */
  _govern(now) {
    const d = this.dyn;
    const gap = d.last ? now - d.last : 0;
    d.last = now;
    if (settings.renderScale !== 'auto' || document.hidden || gap <= 0 || gap > 250) return;
    d.acc += gap; d.n++;
    if (d.acc < 1000) return;
    const avg = d.acc / d.n;
    d.acc = 0; d.n = 0;
    const cap = Number(settings.frameLimit);
    const budget = Number.isFinite(cap) && cap >= 1 ? 1000 / cap : 1000 / 60;
    if (avg > budget * 1.18) { d.slow++; d.fast = 0; } else if (avg < budget * 1.04) { d.fast++; d.slow = 0; } else { d.slow = d.fast = 0; }
    let next = d.scale;
    if (d.slow >= 2 && d.scale > 0.55) next = Math.max(0.55, d.scale - (avg > budget * 1.6 ? 0.15 : 0.08));
    else if (d.fast >= 6 && d.scale < 1) next = Math.min(1, d.scale + 0.05);
    if (next !== d.scale) { d.scale = +next.toFixed(2); d.slow = d.fast = 0; this.resize(); }
  }

  render(dt = 0.016) {
    this._govern(performance.now());
    this.time += dt;
    this.fxPass.uniforms.uTime.value = this.time;
    if (!this.hwyPass.highways.length) this.setFx({ aberration: 0, shock: -1, od: 0 });
    this.view?.renderThumbs?.();
    this.composer.render();
  }
}
