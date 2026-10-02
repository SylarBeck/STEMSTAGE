// Backstage: the 3D set of the character & instrument creator. A dressing room (mirror with bulbs, road cases, a
// costume rack, tour posters, a neon sign) around a spotlit turntable that carries the band member being edited.
// It has its own camera that swoops to the part you're editing, a spark/coin particle system for equips and
// purchases, an LED ring that flashes in the item's colour, emotes, and a thumbnail renderer that photographs the
// character in every option for the item cards.
import * as THREE from 'three';
import { createMember, animateMember } from './figure.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TOP = 0.26; // turntable height
const PLACE = { guitar: [0, 0], bass: [0, 0], vocals: [0, -0.15], drums: [0, -0.55], keys: [0, -0.35] };

// camera framings: target (relative to the turntable) and distance
const SHOTS = {
  full: { t: V(0, 1.2, 0), d: 4.6, h: 0.25 },
  head: { t: V(0, 2.18, 0), d: 1.25, h: 0.02 },
  torso: { t: V(0, 1.7, 0), d: 2.2, h: 0.08 },
  legs: { t: V(0, 0.8, 0), d: 2.6, h: 0.2 },
  instrument: { t: V(0.1, 1.45, 0.25), d: 2.0, h: 0.15 },
  drums: { t: V(0, 1.2, 0.3), d: 4.2, h: 0.5 },
  keys: { t: V(0, 1.4, 0.3), d: 3.0, h: 0.35 },
  mic: { t: V(0, 1.95, 0.35), d: 1.6, h: 0.05 },
};

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const rand = (a, b) => a + Math.random() * (b - a);

export class Backstage {
  constructor(gl) {
    this.gl = gl;
    this.scene = new THREE.Scene();
    this.bg = new THREE.Color(0x0a0807);
    this.scene.background = this.bg;
    this.scene.fog = new THREE.Fog(0x0a0807, 9, 22);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
    this.active = false;
    this.time = 0;
    this.spin = -0.35;          // turntable angle
    this.spinVel = 0;
    this.autoSpin = true;
    this.shot = 'full';
    this.camT = SHOTS.full.t.clone();
    this.camD = SHOTS.full.d;
    this.camH = SHOTS.full.h;
    this.punch = 0;
    this.pop = 0;
    this.flash = 0;
    this.flashCol = new THREE.Color(1, 1, 1);
    this.ringCol = new THREE.Color(0xdf3a2c);
    this.emote = null;
    this.shift = 0.2;          // the model sits right of centre (the menus are on the left)
    this.members = {};
    this.part = 'guitar';
    this.thumbs = new Map();
    this.thumbQueue = [];
    this._build();
  }

  // ---------------------------------------------------------------- the room
  _build() {
    const s = this.scene;
    this.room = new THREE.Group();
    s.add(this.room);
    s.add(new THREE.HemisphereLight(0x8a8478, 0x0a0806, 0.35));
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.22);
    fill.position.set(-3, 2.5, 5);
    s.add(fill);
    // floor: dark stage boards
    const boards = canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = '#19120d'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 64) {
        let x = -((y / 64) % 3) * 140;
        while (x < w) {
          const len = 280 + Math.random() * 260;
          const l = 18 + Math.random() * 14;
          g.fillStyle = `hsl(24 ${30 + Math.random() * 15}% ${l}%)`;
          g.fillRect(x + 2, y + 2, len - 4, 60);
          for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(x + Math.random() * len, y + 4 + Math.random() * 54, 30 + Math.random() * 90, 1.5); }
          x += len;
        }
      }
    });
    boards.wrapS = boards.wrapT = THREE.RepeatWrapping;
    boards.repeat.set(5, 5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map: boards, roughness: 0.55, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2;
    this.room.add(floor);
    // rug under the turntable
    const rug = canvasTex(512, 512, (g, w) => {
      const c = w / 2;
      g.fillStyle = '#3a0d1c'; g.beginPath(); g.arc(c, c, c - 4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#f0b429'; g.lineWidth = 10; g.beginPath(); g.arc(c, c, c - 26, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.arc(c, c, c - 46, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; g.save(); g.translate(c + Math.cos(a) * (c - 70), c + Math.sin(a) * (c - 70)); g.rotate(a); g.fillStyle = '#df3a2c'; g.fillRect(-10, -4, 20, 8); g.restore(); }
    });
    const rugM = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), new THREE.MeshStandardMaterial({ map: rug, roughness: 0.95 }));
    rugM.rotation.x = -Math.PI / 2; rugM.position.y = 0.005;
    this.room.add(rugM);
    // walls: painted brick
    const brick = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = '#120d0b'; g.fillRect(0, 0, w, h);
      for (let y = 0, r = 0; y < h; y += 32, r++) for (let x = (r % 2) * -40; x < w; x += 80) {
        g.fillStyle = `hsl(10 ${18 + Math.random() * 10}% ${9 + Math.random() * 6}%)`;
        g.fillRect(x + 2, y + 2, 76, 28);
      }
    });
    brick.wrapS = brick.wrapT = THREE.RepeatWrapping;
    brick.repeat.set(3, 2);
    const wallMat = new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(22, 8), wallMat);
    back.position.set(0, 4, -5);
    this.room.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), wallMat);
    left.position.set(-7, 4, 1); left.rotation.y = Math.PI / 2;
    this.room.add(left);
    // the dressing-room mirror with bulbs
    const mirror = new THREE.Group();
    mirror.position.set(2.6, 2.2, -4.9);
    this.room.add(mirror);
    mirror.add(new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.0, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.5, metalness: 0.3 })));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.6), new THREE.MeshStandardMaterial({ color: 0x6d7480, roughness: 0.04, metalness: 1 }));
    glass.position.z = 0.045;
    mirror.add(glass);
    this.bulbs = [];
    const bulbGeo = new THREE.SphereGeometry(0.06, 12, 8);
    for (let k = 0; k < 22; k++) {
      let x, y;
      if (k < 8) { x = -1.35 + k * 0.385; y = 0.9; } else if (k < 16) { x = -1.35 + (k - 8) * 0.385; y = -0.9; } else { x = (k < 19 ? -1.35 : 1.35); y = -0.45 + ((k - 16) % 3) * 0.45; }
      const m = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
      m.position.set(x, y, 0.08);
      mirror.add(m);
      this.bulbs.push(m);
    }
    const mirrorLight = new THREE.PointLight(0xffc98a, 6, 7, 1.6);
    mirrorLight.position.set(2.6, 2.2, -4.2);
    this.room.add(mirrorLight);
    // neon sign
    const neon = canvasTex(1024, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = '900 150px "Anton", Impact, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#ff2d7a'; g.shadowBlur = 30;
      g.strokeStyle = '#ffd1e4'; g.lineWidth = 8;
      g.strokeText('BACKSTAGE', w / 2, h / 2 + 8);
    });
    this.neonMat = new THREE.MeshBasicMaterial({ map: neon, transparent: true, color: new THREE.Color(2.2, 1.0, 1.5), depthWrite: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), this.neonMat);
    sign.position.set(-2.4, 4.3, -4.9);
    this.room.add(sign);
    const neonLight = new THREE.PointLight(0xff2d7a, 5, 6, 1.8);
    neonLight.position.set(-2.4, 4.0, -4.2);
    this.room.add(neonLight);
    this.neonLight = neonLight;
    // tour posters on the left wall
    const posters = [['NEON', 'OVERDRIVE', '#2fd3ff', '#2a0a3a'], ['WORLD', 'TOUR 2026', '#f0b429', '#3a0d1c'], ['STEM', 'STAGE', '#ece5d3', '#15120e'], ['ABYSS', 'LIVE', '#3dff8a', '#0a1d2a']];
    posters.forEach(([a, b, fg, bg], i) => {
      const tex = canvasTex(256, 384, (g, w, h) => {
        g.fillStyle = bg; g.fillRect(0, 0, w, h);
        for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
        g.fillStyle = fg; g.beginPath(); g.arc(w / 2, h * 0.42, 70, 0, Math.PI * 2); g.globalAlpha = 0.25; g.fill(); g.globalAlpha = 1;
        g.font = '900 64px "Anton", Impact, sans-serif'; g.textAlign = 'center'; g.fillStyle = fg;
        g.fillText(a, w / 2, h * 0.74); g.font = '900 38px "Anton", Impact, sans-serif'; g.fillText(b, w / 2, h * 0.88);
      });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
      p.position.set(-6.95, 2.4 + (i % 2) * 0.25, -3.2 + i * 1.5);
      p.rotation.set(0, Math.PI / 2, (i % 2 ? 1 : -1) * 0.04);
      this.room.add(p);
    });
    // road cases
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6, metalness: 0.2 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa8, roughness: 0.3, metalness: 1 });
    const roadCase = (x, y, z, w, h, d, ry = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y + h / 2, z); g.rotation.y = ry;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), caseMat));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.035, 0.035), edgeMat); e.position.set(0, sy * h / 2, sx * d / 2); g.add(e);
        const e2 = new THREE.Mesh(new THREE.BoxGeometry(0.035, h + 0.02, 0.035), edgeMat); e2.position.set(sx * w / 2, 0, sy * d / 2); g.add(e2);
      }
      const label = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.5, h * 0.25), new THREE.MeshBasicMaterial({ color: 0xece5d3 }));
      label.position.set(0, 0, d / 2 + 0.002); g.add(label);
      this.room.add(g);
    };
    roadCase(-4.4, 0, -3.6, 1.6, 0.9, 0.9, 0.2); roadCase(-4.3, 0.9, -3.6, 1.2, 0.6, 0.8, 0.12); roadCase(4.8, 0, -1.2, 1.1, 1.0, 0.9, -0.5);
    // costume rack
    const rack = new THREE.Group();
    rack.position.set(5.0, 0, -3.6); rack.rotation.y = -0.4;
    this.room.add(rack);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 8), edgeMat);
    bar.position.set(0, 1.9, 0); bar.rotation.z = Math.PI / 2;
    rack.add(bar);
    for (const sx of [-1.1, 1.1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 8), edgeMat); post.position.set(sx, 0.95, 0); rack.add(post); }
    ['#df3a2c', '#15120e', '#2447d8', '#f0b429', '#ece5d3', '#6b2bb0', '#1c7a3a'].forEach((c, i) => {
      const coat = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.7, 4, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
      coat.scale.set(1, 1, 0.25);
      coat.position.set(-0.9 + i * 0.3, 1.35, 0); coat.rotation.y = 1.2 + (i % 2) * 0.2;
      rack.add(coat);
    });
    // the turntable
    this.table = new THREE.Group();
    s.add(this.table);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.9, TOP, 72), new THREE.MeshStandardMaterial({ color: 0x0e0d10, roughness: 0.35, metalness: 0.6 }));
    deck.position.y = TOP / 2;
    s.add(deck);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xdf3a2c });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.86, 0.025, 8, 120), this.ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = TOP - 0.02;
    s.add(ring);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.72, 1.72, 0.02, 72), new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.25, metalness: 0.4 }));
    top.position.y = TOP + 0.01;
    this.table.add(top);
    const marks = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.42, 72), new THREE.MeshBasicMaterial({ color: 0x3a2f24 }));
    marks.rotation.x = -Math.PI / 2; marks.position.y = TOP + 0.022;
    this.table.add(marks);
    this.ringLight = new THREE.PointLight(0xdf3a2c, 8, 5, 1.5);
    this.ringLight.position.set(0, 0.2, 2.1);
    s.add(this.ringLight);
    // lights on the model: a key spot, coloured rims, and a beam you can see in the haze
    const key = new THREE.SpotLight(0xfff6ea, 45, 16, 0.42, 0.6, 1.3);
    key.position.set(1.8, 7, 4.5); key.target.position.set(0, 1.1, 0);
    s.add(key, key.target);
    this.rimA = new THREE.SpotLight(0x2fd3ff, 60, 12, 0.5, 0.6, 1.5);
    this.rimA.position.set(-3.5, 3.5, -3); this.rimA.target.position.set(0, 1.4, 0);
    this.rimB = new THREE.SpotLight(0xffb070, 60, 12, 0.5, 0.6, 1.5);
    this.rimB.position.set(3.5, 3.5, -2.5); this.rimB.target.position.set(0, 1.4, 0);
    s.add(this.rimA, this.rimA.target, this.rimB, this.rimB.target);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1.9, 7.5, 40, 1, true).translate(0, -3.75, 0), new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(1, 0.92, 0.8) }, uAmt: { value: 0.22 } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uCol; uniform float uAmt; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = uAmt * e * pow(vY, 1.3); gl_FragColor = vec4(uCol * a, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    beam.position.set(0, 7.6, 0);
    this.beam = beam;
    s.add(beam);
    // haze motes + the burst particles (sparks, coins)
    this._particles();
  }

  _particles() {
    const soft = canvasTex(64, 64, (g) => {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    });
    const N = 900;
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pSize = new Float32Array(N);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N).fill(1); this.pGrav = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: soft } },
      // points right in front of the camera (close-ups) would fill the screen: cap their size and fade them out
      vertexShader: 'attribute float aSize; varying vec3 vC; void main(){ float d = -(modelViewMatrix * vec4(position,1.0)).z; vC = color * smoothstep(0.35, 1.1, d); vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(48.0, aSize * 380.0 / max(0.1, d)); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; varying vec3 vC; void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vC * a * 1.6, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.pN = N; this.pHead = 0;
    // slow haze motes live in the first 140 slots
    for (let i = 0; i < 140; i++) {
      this.pPos.set([rand(-5, 5), rand(0.2, 5), rand(-4, 3)], i * 3);
      this.pVel.set([rand(-0.05, 0.05), rand(-0.02, 0.04), rand(-0.03, 0.03)], i * 3);
      this.pCol.set([0.16, 0.13, 0.1], i * 3);
      this.pSize[i] = rand(0.02, 0.05);
      this.pLife[i] = Infinity;
    }
    this.pHead = 140;
  }

  _spawn(x, y, z, vx, vy, vz, life, size, col, grav = -6) {
    const i = this.pHead;
    this.pHead = this.pHead + 1 >= this.pN ? 140 : this.pHead + 1;
    this.pPos.set([x, y, z], i * 3); this.pVel.set([vx, vy, vz], i * 3);
    this.pCol.set([col.r, col.g, col.b], i * 3);
    this.pLife[i] = this.pMax[i] = life; this.pSize[i] = size; this.pGrav[i] = grav;
  }

  // ---------------------------------------------------------------- the model
  member(part = this.part) {
    if (!this.members[part]) {
      const [x, z] = PLACE[part] || [0, 0];
      const m = createMember(this.table, part, { x, y: TOP, z, rotY: 0, scale: 1.05 });
      this.members[part] = m;
    }
    return this.members[part];
  }

  /** Show the band member at one part (guitar, bass, drums, keys, vocals). */
  setPart(part) {
    this.part = part;
    this.member(part);
    for (const [k, m] of Object.entries(this.members)) {
      const on = k === part;
      m.g.visible = on;
      if (m.kit) m.kit.group.visible = on;
      if (m.keys) m.keys.group.visible = on;
      if (m.micStand) m.micStand.visible = on;
    }
  }

  dress(look, rig) {
    const m = this.member();
    m.setLook(look);
    m.setRig(rig);
  }

  /** Swoop the camera to a framing: full | head | torso | legs | instrument (instrument picks the part's own). */
  focus(name) {
    let key = name;
    if (name === 'instrument') key = { drums: 'drums', keys: 'keys', vocals: 'mic' }[this.part] || 'instrument';
    if (name === 'full' && this.part === 'drums') key = 'drums';
    if (!SHOTS[key] || key === this.shot) return false;
    this.shot = key;
    return true;
  }

  /** Equip juice: sparks at the edited spot, the ring flashes the item's colour, the turntable pops. */
  burst(color = '#ffd9a0', where = this.shot, coins = false) {
    const c = new THREE.Color(color);
    if (c.r + c.g + c.b < 0.4) c.setRGB(1, 0.85, 0.6);
    const at = SHOTS[where]?.t || SHOTS.full.t;
    const n = coins ? 90 : 60;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = rand(0.8, 2.6);
      const col = coins ? new THREE.Color(1.6, 1.15, 0.3).multiplyScalar(rand(0.7, 1.2)) : c.clone().multiplyScalar(rand(1.2, 2.4)).lerp(new THREE.Color(2, 2, 2), Math.random() * 0.3);
      this._spawn(at.x + rand(-0.15, 0.15), at.y + rand(-0.2, 0.2), at.z + 0.3 + rand(-0.1, 0.1), Math.cos(a) * r, rand(1.5, 4.5) * (coins ? 1.2 : 1), Math.sin(a) * r * 0.6 + 0.6,
        rand(0.6, 1.3), coins ? rand(0.07, 0.12) : rand(0.04, 0.09), col, coins ? -7 : -4);
    }
    this.flash = 1;
    this.flashCol.copy(c);
    this.pop = 1;
    this.punch = coins ? 0.35 : 0.18;
  }

  /** Strike a pose: two seconds of full-energy performance. */
  pose() { this.emote = { t: 0, len: 2.4 }; this.burst('#f0b429', 'full'); }

  /** Turn the turntable by hand (stick / drag); auto-spin pauses for a moment. */
  turn(d) { this.spinVel += d; this.autoSpin = false; clearTimeout(this._spinTimer); this._spinTimer = setTimeout(() => { this.autoSpin = true; }, 3500); }

  // ---------------------------------------------------------------- per frame
  update(dt, f = {}) {
    this.time += dt;
    const t = this.time;
    const W = this.gl.domElement.clientWidth || window.innerWidth, H = this.gl.domElement.clientHeight || window.innerHeight;
    this.camera.aspect = W / H;
    // spin: damped velocity plus a slow idle turn
    this.spinVel *= Math.exp(-dt * 3.2);
    this.spin += this.spinVel * dt + (this.autoSpin ? dt * 0.22 : 0);
    this.table.rotation.y = this.spin;
    // springs: camera framing, pop, punch-in, flash
    const sh = SHOTS[this.shot];
    const k = 1 - Math.exp(-dt * 4.5);
    this.camT.lerp(sh.t, k);
    this.camD += (sh.d - this.camD) * k;
    this.camH += (sh.h - this.camH) * k;
    this.punch = Math.max(0, this.punch - dt * 1.4);
    this.pop = Math.max(0, this.pop - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    const d = this.camD * (1 - this.punch * 0.12);
    const az = 0.18 + Math.sin(t * 0.17) * 0.03;
    this.camera.position.set(this.camT.x + Math.sin(az) * d, this.camT.y + this.camH * d + Math.sin(t * 0.3) * 0.02, this.camT.z + Math.cos(az) * d);
    this.camera.lookAt(this.camT);
    this.camera.setViewOffset(W, H, -W * this.shift, 0, W, H);
    this.camera.updateProjectionMatrix();
    const popS = 1 + Math.sin(this.pop * Math.PI) * 0.035;
    this.table.scale.set(popS, 1 + Math.sin(this.pop * Math.PI) * 0.02, popS);
    // lights: the ring breathes with the music and flashes the equipped item's colour
    const beat = f.beat ?? t * 2;
    const pulse = Math.max(0, Math.cos((beat % 1) * Math.PI * 2)) * 0.5;
    this.ringMat.color.copy(this.ringCol).multiplyScalar(1.4 + pulse * 1.4).lerp(this.flashCol.clone().multiplyScalar(4), this.flash);
    // the light the ring throws on the model: its colour, never its HDR brightness
    this.ringLight.color.copy(this.ringCol).lerp(this.flashCol, this.flash);
    this.ringLight.intensity = 1 + pulse + this.flash * 4;
    // the beam is a cone from the ceiling: fade it out when the camera is inside it (close-ups), or it whites out
    const cy = this.camera.position.y, coneR = 0.15 + 1.75 * Math.max(0, Math.min(1, (7.6 - cy) / 7.5));
    const inside = Math.max(0, Math.min(1, (Math.hypot(this.camera.position.x, this.camera.position.z) - coneR) / 0.9));
    this.beam.material.uniforms.uAmt.value = (0.18 + pulse * 0.08 + this.flash * 0.25) * inside;
    this.beam.visible = inside > 0.01;
    this.neonMat.color.setRGB(2.2, 1.0, 1.5).multiplyScalar(0.85 + 0.15 * Math.sin(t * 23) * (Math.sin(t * 0.7) > 0.93 ? 1 : 0) + 0.1);
    this.rimA.intensity = 24 + Math.sin(t * 0.9) * 6;
    this.rimB.intensity = 18 + Math.cos(t * 0.8) * 5;
    this.bulbs.forEach((b, i) => b.material.color.setRGB(2.4, 1.9, 1.3).multiplyScalar(0.75 + 0.25 * Math.sin(t * 1.3 + i)));
    // the model: idle groove, or an emote
    const m = this.member();
    let energy = 0.4, od = false;
    if (this.emote) {
      this.emote.t += dt;
      energy = 1.2; od = this.emote.t > 0.4 && this.emote.t < 1.9;
      if (this.emote.t > this.emote.len) this.emote = null;
    }
    if (this.moveDemo) energy = Math.max(energy, 1);
    const bp = beat * Math.PI * 2;
    animateMember(m, { bp, hb: Math.max(0, Math.sin(bp)) * (0.12 + energy * 0.25), energy, od, t, pulse });
    // particles
    for (let i = 0; i < this.pN; i++) {
      const life = this.pLife[i];
      if (life <= 0) { this.pSize[i] = 0; continue; }
      const P = this.pPos, Vv = this.pVel, j = i * 3;
      if (life !== Infinity) {
        this.pLife[i] -= dt;
        Vv[j + 1] += this.pGrav[i] * dt;
        Vv[j] *= 0.985; Vv[j + 2] *= 0.985;
        if (P[j + 1] < TOP + 0.02 && Vv[j + 1] < 0) { P[j + 1] = TOP + 0.02; Vv[j + 1] *= -0.35; }
        if (this.pLife[i] <= 0) this.pSize[i] = 0;
      } else if (P[j + 1] > 5.2 || Math.abs(P[j]) > 6) { P[j] = rand(-5, 5); P[j + 1] = rand(0.2, 1); }
      P[j] += Vv[j] * dt; P[j + 1] += Vv[j + 1] * dt; P[j + 2] += Vv[j + 2] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }

  // ---------------------------------------------------------------- item thumbnails
  /**
   * Ask for a photo of the model wearing something: key (cache), look, rig, framing. → a data URL later, through cb.
   * Photos are taken in batches before the next frame is drawn (renderThumbs), so they never flash on screen.
   */
  thumb(key, look, rig, framing, cb) {
    const hit = this.thumbs.get(key);
    if (hit) { cb(hit); return; }
    this.thumbQueue.push({ key, look, rig, framing, cb, part: this.part });
  }

  clearThumbQueue() { this.thumbQueue.length = 0; }

  renderThumbs(max = 3) {
    if (!this.thumbQueue.length) return;
    const gl = this.gl;
    const cam = this._thumbCam ||= new THREE.PerspectiveCamera(30, 0.8, 0.05, 40);
    const c = this._thumbCanvas ||= Object.assign(document.createElement('canvas'), { width: 176, height: 220 });
    const ctx = c.getContext('2d');
    const pr = gl.getPixelRatio();
    const w = c.width / pr, h = c.height / pr;
    const prevSpin = this.table.rotation.y, prevScale = this.table.scale.clone();
    const prevLook = this.member().look, prevRig = this.member().rig, prevPart = this.part, prevBeam = this.beam.visible;
    this.room.visible = false;
    this.points.visible = false;
    this.beam.visible = false;
    this.scene.background = this._thumbBg ||= new THREE.Color(0x17120f);
    this.table.rotation.y = -0.45;
    this.table.scale.set(1, 1, 1);
    gl.setRenderTarget(null);
    gl.setScissorTest(true);
    for (let n = 0; n < max && this.thumbQueue.length; n++) {
      const job = this.thumbQueue.shift();
      if (this.thumbs.has(job.key)) { job.cb(this.thumbs.get(job.key)); continue; }
      if (job.part !== this.part) this.setPart(job.part);
      const m = this.member();
      m.setLook(job.look); m.setRig(job.rig);
      animateMember(m, { bp: 0.6, hb: 0, energy: 0.2, od: false, t: 1, pulse: 0 });
      const sh = SHOTS[job.framing] || SHOTS.full;
      const dd = sh.d * (job.framing === 'head' ? 0.95 : 0.9);
      cam.position.set(sh.t.x + Math.sin(0.25) * dd, sh.t.y + sh.h * dd + 0.02, sh.t.z + Math.cos(0.25) * dd);
      cam.lookAt(sh.t);
      cam.aspect = w / h; cam.updateProjectionMatrix();
      gl.setViewport(0, 0, w, h);
      gl.setScissor(0, 0, w, h);
      gl.render(this.scene, cam);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(gl.domElement, 0, gl.domElement.height - c.height, c.width, c.height, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/webp', 0.82);
      this.thumbs.set(job.key, url);
      job.cb(url);
    }
    gl.setScissorTest(false);
    const size = gl.getSize(new THREE.Vector2());
    gl.setViewport(0, 0, size.x, size.y);
    if (prevPart !== this.part) this.setPart(prevPart);
    this.member().setLook(prevLook); this.member().setRig(prevRig);
    this.room.visible = true; this.points.visible = true; this.beam.visible = prevBeam;
    this.scene.background = this.bg;
    this.table.rotation.y = prevSpin;
    this.table.scale.copy(prevScale);
  }
}
