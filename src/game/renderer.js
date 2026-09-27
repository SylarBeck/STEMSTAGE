// WebGL renderer: stage scene, then 1–4 highways composited side by side (each in its own
// viewport, depth cleared), bloom, a stylised post pass, ACES tone mapping.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

const PIXEL_RATIO = { low: 0.75, high: 1.25, ultra: 2 };

class HighwaysPass extends Pass {
  constructor() {
    super();
    this.highways = [];
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const n = this.highways.length;
    if (!n) return;
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    const target = this.renderToScreen ? null : readBuffer;
    const W = readBuffer.width, H = readBuffer.height;
    for (let i = 0; i < n; i++) {
      const x = Math.floor((i * W) / n), w = Math.floor(((i + 1) * W) / n) - x;
      readBuffer.viewport.set(x, 0, w, H);
      readBuffer.scissor.set(x, 0, w, H);
      readBuffer.scissorTest = true;
      renderer.setRenderTarget(target);
      renderer.clearDepth();
      renderer.render(this.highways[i].scene, this.highways[i].camera);
    }
    readBuffer.viewport.set(0, 0, W, H);
    readBuffer.scissor.set(0, 0, W, H);
    readBuffer.scissorTest = false;
    renderer.setRenderTarget(target);
    renderer.autoClear = oldAutoClear;
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
      float ab = uAberr + uOD * 0.0025;
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

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
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
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setHighways(list) {
    this.hwyPass.highways = list;
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
    this.bloom.enabled = bloom && q !== 'low';
    this.fxPass.uniforms.uGrain.value = q === 'low' ? 0 : 0.012;
    this.resize();
  }

  _layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const n = this.hwyPass.highways.length || 1;
    this.hwyPass.highways.forEach((hw, i) => hw.resize(w / n, h, (i * w) / n));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[this.quality] || 1.25);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.fxPass.uniforms.uAspect.value = w / h;
    this.stage.resize(w, h);
    this._layout();
  }

  render(dt = 0.016) {
    this.time += dt;
    this.fxPass.uniforms.uTime.value = this.time;
    if (!this.hwyPass.highways.length) this.setFx({ aberration: 0, shock: -1, od: 0 });
    this.composer.render();
  }
}
