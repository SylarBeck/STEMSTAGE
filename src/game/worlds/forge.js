// World 3: the Volcanic Forge. An obsidian stage over a lava lake, an erupting volcano behind it, basalt columns,
// fire braziers, hanging forge chains, embers and ash. The boss, the Magma Titan, is a golem of rock and lava that
// rises out of the lake, slams the ground, breathes heat and crumbles back into the lava when beaten.
import { THREE, V, rand, ease, skyDome, particleField, instances, animatedStandard, glow, std, BossRig } from './common.js';

/** Dark rock with glowing lava veins (in the object's own space, so the veins move with it). */
function lavaRock(color = 0x221a16, heat = 1) {
  return animatedStandard({ color, roughness: 0.92, metalness: 0.05, flatShading: true }, {
    head: 'varying vec3 vOPos;',
    vertex: 'vOPos = position;',
    fragHead: 'varying vec3 vOPos;',
    frag: `
      float n = fbm(vOPos * 0.55);
      float vein = smoothstep(0.022, 0.0, abs(n - 0.5)) + smoothstep(0.012, 0.0, abs(fbm(vOPos * 1.7 + 7.0) - 0.5)) * 0.35;
      float pulse = 0.75 + 0.25 * sin(uTime * 2.0 + vOPos.y * 1.5);
      totalEmissiveRadiance += mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.75, 0.2), vein) * vein * uHeat * pulse * 2.2;
      diffuseColor.rgb *= 0.7 + 0.5 * noise(vOPos * 6.0);`,
    uniforms: { uHeat: { value: heat } },
  });
}

export function buildForge() {
  const group = new THREE.Group();
  const u = { uTime: { value: 0 }, uPulse: { value: 0 } };

  // a sky of smoke lit red from below
  const sky = skyDome(`
    void main() {
      float y = vDir.y;
      float smoke = fbm(vec3(vDir.xz * 3.0 / max(0.15, y + 0.3), uTime * 0.03) + vDir * 2.0);
      vec3 col = mix(vec3(0.35, 0.06, 0.01), vec3(0.03, 0.01, 0.01), smoothstep(-0.05, 0.5, y));
      col = mix(col, vec3(0.6, 0.18, 0.04), pow(smoke, 3.0) * smoothstep(0.6, 0.0, y) * 1.2);
      col += vec3(0.08, 0.02, 0.0) * smoke;
      gl_FragColor = vec4(col, 1.0);
    }`);
  group.add(sky.mesh);

  // obsidian ground with glowing cracks
  const ground = animatedStandard({ color: 0x0c0a0a, roughness: 0.25, metalness: 0.3 }, {
    frag: `
      vec2 p = vWPos.xz * 0.22;
      vec2 g = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y)); vec2 r = o + vec2(hash(vec3(g + o, 1.0)), hash(vec3(g + o, 7.0))) - f;
        float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      float crack = smoothstep(0.08, 0.0, sqrt(d2) - sqrt(d1));
      float heat = 0.6 + 0.4 * sin(uTime * 1.5 + vWPos.x * 0.2 + vWPos.z * 0.13);
      totalEmissiveRadiance += vec3(1.0, 0.3, 0.03) * crack * heat * (1.4 + uPulse);
      diffuseColor.rgb *= 0.6 + 0.6 * noise(vWPos * 0.8);`,
    uniforms: { uPulse: u.uPulse },
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 80), ground.mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 6;
  group.add(floor);

  // the lava lake around and behind everything
  const lava = animatedStandard({ color: 0x220500, roughness: 0.6, metalness: 0 }, {
    vertex: 'transformed.z += (fbm(vec3(position.xy * 0.05, uTime * 0.1)) - 0.5) * 1.5;',
    frag: `
      vec2 p = vWPos.xz * 0.06;
      float flow = fbm(vec3(p + vec2(uTime * 0.03, uTime * 0.05), uTime * 0.05));
      float crust = smoothstep(0.55, 0.7, fbm(vec3(p * 3.0 + flow * 2.0, uTime * 0.02)));
      vec3 hot = mix(vec3(1.0, 0.25, 0.0), vec3(1.0, 0.85, 0.3), smoothstep(0.4, 0.8, flow));
      totalEmissiveRadiance += hot * (1.0 - crust) * 2.6;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.03, 0.02), crust);`,
  });
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 100, 100), lava.mat);
  lake.rotation.x = -Math.PI / 2;
  lake.position.y = -0.6;
  group.add(lake);

  // the volcano
  const cone = new THREE.LatheGeometry([[0, 62], [9, 60], [14, 56], [30, 30], [55, 8], [80, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 96);
  { const p = cone.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.12 * Math.sin(Math.atan2(z, x) * 9 + y * 0.3) * (1 - y / 70); p.setXYZ(i, x * k, y, z * k); } cone.computeVertexNormals(); }
  const mountainMat = animatedStandard({ color: 0x1a1210, roughness: 0.95, flatShading: true }, {
    frag: `
      float slope = 1.0 - clamp((vWPos.y) / 62.0, 0.0, 1.0);
      float stream = smoothstep(0.08, 0.0, abs(fract(atan(vWPos.z + 140.0, vWPos.x) * 2.2 + fbm(vWPos * 0.05) * 0.8) - 0.5) - 0.02);
      float near = smoothstep(30.0, 60.0, vWPos.y);
      totalEmissiveRadiance += vec3(1.0, 0.35, 0.05) * stream * (0.3 + near * 1.5) * (0.8 + 0.2 * sin(uTime * 2.0 + vWPos.y));`,
  });
  const volcano = new THREE.Mesh(cone, mountainMat.mat);
  volcano.position.set(0, -2, -140);
  group.add(volcano);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(9, 32), glow(0xff6a1a, 3));
  crater.rotation.x = -Math.PI / 2; crater.position.set(0, 59.5, -140);
  group.add(crater);
  const eruption = particleField({ n: 600, box: [-8, 8, 58, 110, -148, -132], kind: 'rise', speed: 9, size: 1.6, colors: [0xff6a1a, 0xffc233, 0xff3d00], wobble: 4 });
  group.add(eruption.pts);
  const smokeCol = particleField({ n: 300, box: [-25, 25, 70, 150, -170, -110], kind: 'rise', speed: 2, size: 9, color: 0x2a1a14, additive: false, wobble: 6 });
  group.add(smokeCol.pts);

  // basalt columns
  const basalt = lavaRock(0x1a1513, 0.35);
  group.add(instances(new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0), basalt.mat, 120, (i, d) => {
    const s = i % 2 ? 1 : -1, cluster = Math.floor(i / 12);
    d.position.set(s * (18 + (cluster % 5) * 5 + rand(-2, 2)), -0.6, -12 + (cluster % 6) * 6 + rand(-2, 2));
    d.scale.set(rand(1, 1.8), rand(2, 9), rand(1, 1.8));
  }));
  // braziers with fire
  const flames = [];
  const bowlMat = std(0x2a2420, 0.4, 0.8);
  for (const [x, z] of [[-13, 3], [13, 3], [-13, -7], [13, -7], [-22, 10], [22, 10]]) {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 2.4, 8).translate(0, 1.2, 0), bowlMat));
    b.add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.5, 0.7, 12, 1, true).translate(0, 2.6, 0), bowlMat));
    const fire = particleField({ n: 120, box: [-0.6, 0.6, 2.7, 5.5, -0.6, 0.6], kind: 'rise', speed: 2.5, size: 0.9, colors: [0xff6a1a, 0xffc233, 0xff3d00], wobble: 0.25 });
    b.add(fire.pts);
    const light = new THREE.PointLight(0xff7a2a, 30, 14, 1.6); light.position.y = 3.5; b.add(light);
    flames.push({ fire, light });
    group.add(b);
  }
  // chains hanging from the dark above
  const chainMat = std(0x3a332e, 0.5, 0.9);
  for (let k = 0; k < 10; k++) {
    const x = -18 + k * 4, len = rand(6, 12);
    const links = instances(new THREE.TorusGeometry(0.3, 0.07, 6, 10), chainMat, Math.floor(len / 0.5), (i, d) => { d.position.set(x, 26 - i * 0.5, -6 + (k % 3) * 2); d.rotation.y = i % 2 ? Math.PI / 2 : 0; });
    group.add(links);
  }

  const embers = particleField({ n: 700, box: [-40, 40, 0, 30, -50, 30], kind: 'rise', speed: 1.8, size: 0.12, colors: [0xff6a1a, 0xffc233], wobble: 1.5 });
  const ash = particleField({ n: 400, box: [-40, 40, 0, 30, -40, 30], kind: 'fall', speed: 0.8, size: 0.1, color: 0x6a6460, additive: false, wobble: 1 });
  group.add(embers.pts, ash.pts);

  const lavaLight = new THREE.PointLight(0xff4a10, 120, 80, 1.3); lavaLight.position.set(0, 3, -25); group.add(lavaLight);
  const hemi = new THREE.HemisphereLight(0x3a1a10, 0xff4a10, 0.5); group.add(hemi);

  const boss = new Titan(lavaRock);
  return {
    group, boss,
    look: {
      bg: 0x120403, fog: 0.012, fogColor: 0x2a0a04, crowd: 0.8, crowdTint: 0xffb08a, stageColor: 0x14100e, light: 0.9, pyro: 1.5, heads: 0, phones: true,
      hide: { floor: true, wall: true, truss: true, pillars: true, stacks: true },
      gels: [[0xff6a1a, 0xd7261c], [0xffc233, 0xff3d00], [0xff2d00, 0x7a0f22]],
    },
    update(dt, f, t, pulse) {
      for (const x of [u, sky.u, ground.u, lava.u, mountainMat.u, basalt.u, eruption.u, smokeCol.u, embers.u, ash.u]) x.uTime.value = t;
      u.uPulse.value = pulse || 0;
      for (const fl of flames) { fl.fire.u.uTime.value = t; fl.light.intensity = 24 + Math.random() * 10 + (pulse || 0) * 20; }
      lavaLight.intensity = 100 + Math.sin(t * 1.3) * 20 + (f.bass || 0) * 60;
      boss.update(dt, t, f);
    },
  };
}

// ---------------------------------------------------------------- the Magma Titan
class Titan extends BossRig {
  constructor(lavaRock) {
    super();
    this.rock = lavaRock(0x2a201b, 1);
    this.root = new THREE.Group();
    this.root.position.set(0, -30, -34);
    this.group.add(this.root);
    const boulder = (r, detail = 1) => {
      const g = new THREE.IcosahedronGeometry(r, detail);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.8 + Math.random() * 0.35; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
      g.computeVertexNormals();
      return new THREE.Mesh(g, this.rock.mat);
    };
    this.parts = [];
    const part = (parent, mesh, x, y, z, sx = 1, sy = 1, sz = 1) => { mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh); this.parts.push(mesh); return mesh; };
    // body: hips, a chest of boulders around a molten core
    this.torso = new THREE.Group(); this.torso.position.y = 14; this.root.add(this.torso);
    part(this.root, boulder(6), 0, 8, 0, 1.2, 0.8, 0.9);
    part(this.torso, boulder(7.5), 0, 4, 0, 1.25, 1, 0.85);
    part(this.torso, boulder(4.5), -6, 7, 1, 1, 0.9, 1);
    part(this.torso, boulder(4.5), 6, 7, 1, 1, 0.9, 1);
    part(this.torso, boulder(3.5), 0, -1, 4, 1.4, 0.8, 0.8);
    this.coreMat = glow(0xff7a1a, 3);
    this.core = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 16), this.coreMat);
    this.core.position.set(0, 4.5, 4.5);
    this.torso.add(this.core);
    // head: a craggy skull with burning eyes and a crown of spikes
    this.head = new THREE.Group(); this.head.position.set(0, 13, 1.5); this.torso.add(this.head);
    part(this.head, boulder(3.4), 0, 0, 0, 1.1, 1, 1);
    part(this.head, boulder(2.2), 0, -2.2, 1.5, 1.2, 0.6, 0.9);
    this.eyeMat = glow(0xffe08a, 4);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), this.eyeMat); e.position.set(s * 1.3, 0.4, 3.1); e.scale.set(1.4, 0.6, 0.6); this.head.add(e);
      for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.5 - k * 0.6, 6), this.rock.mat); sp.position.set(s * (1.2 + k * 1.1), 3 - k * 0.6, -0.5); sp.rotation.z = -s * (0.25 + k * 0.3); this.head.add(sp); this.parts.push(sp); }
    }
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 0.6), this.eyeMat); this.mouth.position.set(0, -1.4, 3.2); this.head.add(this.mouth);
    // arms: shoulder → elbow → fist
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 10, 8, 0); this.torso.add(sh);
      part(sh, boulder(3.6), 0, 0, 0, 1, 1, 1);
      const upper = new THREE.Group(); sh.add(upper);
      part(upper, boulder(2.6), 0, -5, 0, 1, 1.9, 1);
      const elbow = new THREE.Group(); elbow.position.y = -10; upper.add(elbow);
      part(elbow, boulder(2.4), 0, -4.5, 0, 1, 1.9, 1);
      part(elbow, boulder(3.6, 1), 0, -10, 0.5, 1.2, 1, 1.1);
      sh.rotation.z = s * 0.25;
      this.arms.push({ sh, upper, elbow, s });
    }
    this.breath = particleField({ n: 300, box: [-3, 3, -3, 3, 0, 30], kind: 'float', speed: 0, size: 1.4, colors: [0xff6a1a, 0xffc233, 0xff3d00], wobble: 1.5 });
    this.breath.pts.visible = false;
    this.head.add(this.breath.pts);
    this.light = new THREE.PointLight(0xff5a10, 200, 60, 1.3);
    this.group.add(this.light);
    // falling pieces when it crumbles
    this.debris = this.parts.map((m) => ({ m, v: V(), r: V() }));
    this.cam = { pos: V(0, 3, 12), tgt: V(0, 18, -34) };
  }

  reset() {
    super.reset();
    if (!this.debris) return;
    for (const d of this.debris) { d.m.position.copy(d.m.userData.home ||= d.m.position.clone()); d.m.rotation.set(0, 0, 0); }
  }

  defeat() {
    super.defeat();
    for (const d of this.debris) { d.m.userData.home ||= d.m.position.clone(); d.v.set(rand(-6, 6), rand(2, 10), rand(-2, 8)); d.r.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)); }
  }

  pose(dt, t, f) {
    this.rock.u.uTime.value = t; this.breath.u.uTime.value = t;
    const pres = ease(this.presence), s = this.strike, kind = this.attackKind;
    // rise from the lava, breathing, leaning in on attacks
    this.root.position.y = -32 + pres * 32 + Math.sin(t * 0.8) * 0.4 - (this.state === 'dying' ? this.dying * 20 : 0);
    this.root.rotation.y = Math.sin(t * 0.25) * 0.15;
    this.torso.rotation.x = 0.08 + Math.sin(t * 0.8) * 0.03 + (kind === 'quake' ? s * 0.35 : 0) - (kind === 'ash' ? s * 0.3 : 0);
    this.head.rotation.x = (kind === 'ash' ? -s * 0.7 : 0) + Math.sin(t * 0.6) * 0.05;
    for (const a of this.arms) {
      const slam = kind === 'quake' ? s : 0;
      a.sh.rotation.x = -0.3 - slam * 1.6 + Math.sin(t * 0.7 + a.s) * 0.08;
      a.sh.rotation.z = a.s * (0.25 + Math.sin(t * 0.5) * 0.05) + (kind === 'heat' ? a.s * s * 0.5 : 0);
      a.elbow.rotation.x = -0.6 - slam * 0.4;
    }
    // the core flares with the music and on heat attacks; it flashes white when hit
    const flare = 1 + (f.bass || 0) * 0.8 + (kind === 'heat' ? s * 2 : 0) + this.flash * 2;
    this.coreMat.color.setRGB(3 * flare, 1.1 * flare, 0.25 * flare).lerp(new THREE.Color(4, 4, 4), this.flash * 0.6);
    this.eyeMat.color.setRGB(4, 3.2, 1.4).multiplyScalar(0.8 + s * 0.8 + this.flash);
    this.rock.u.uHeat.value = (1 + this.flash * 2 + (kind === 'heat' ? s : 0)) * (1 - this.dying);
    this.breath.pts.visible = kind === 'heat' && s > 0.15;
    this.breath.pts.position.set(0, -1.5, 3);
    // crumbling: every piece falls into the lava
    if (this.state === 'dying') {
      for (const d of this.debris) {
        d.v.y -= 14 * dt;
        d.m.position.addScaledVector(d.v, dt);
        d.m.rotation.x += d.r.x * dt; d.m.rotation.y += d.r.y * dt;
      }
    }
    this.light.position.set(0, this.root.position.y + 20, -24);
    this.light.intensity = (160 + flare * 60) * (1 - this.dying);
    this.cam.tgt.set(0, this.root.position.y + 22, -34);
  }
}
