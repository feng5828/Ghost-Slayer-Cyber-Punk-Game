import * as THREE from 'three';
import { rand } from './util.js';
import { propPos } from './props.js';

// ============================================================================
// 信号系统:捉迷藏的核心 —— 恶鬼不直接显形,而是"污染"周围的场景
//   蜈蚣精 → 附近飘起焦热瘴气余烬,器物被熏得低频晃动
//   鬼火群 → 附近器物阴风高频震颤,青磷浮起
//   纸傀儡 → 附近杂物被怨气托得诡异漂浮,惨白纸灰游走
// 距离越近信号越强;屏幕边缘的红色脉动是心跳(任一恶鬼贴近时)
// ============================================================================

const CUES = {
  dragon:   { color: 0xff5a2a, riseMin: 1.5, riseMax: 3.0, jitterFreq: 4,  jitterAmp: 0.055 },
  spheres:  { color: 0x8fe8c4, riseMin: 0.2, riseMax: 0.7, jitterFreq: 42, jitterAmp: 0.035 },
  guardian: { color: 0xf0e6e8, riseMin: 0.5, riseMax: 1.0, jitterFreq: 1.2, jitterAmp: 0.09 },
};
const SIGNAL_RANGE = 24;   // 玩家距生物多远开始出现信号
const CUE_RADIUS = 7;      // 生物周围多大范围的道具被"污染"
const POOL = 56;

let dotTex = null;
function getDotTex() {
  if (dotTex) return dotTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(cv);
  return dotTex;
}

export class Signals {
  constructor(ctx) {
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getDotTex(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      }));
      s.visible = false;
      ctx.three.scene.add(s);
      this.pool.push({ sprite: s, life: 0, maxLife: 1, vel: new THREE.Vector3(), free: true });
    }
    this.emitAccum = new Map();
    this.pulseEl = document.getElementById('pulse');
  }

  emit(pos, cue, strength) {
    const p = this.pool.find((x) => x.free);
    if (!p) return;
    p.free = false;
    p.life = 0;
    p.maxLife = rand(0.7, 1.4);
    p.sprite.visible = true;
    p.sprite.material.color.setHex(cue.color);
    p.sprite.material.opacity = 0.75 * strength;
    const sc = rand(0.25, 0.55);
    p.sprite.scale.set(sc, sc, 1);
    p.sprite.position.set(pos.x + rand(-3.5, 3.5), rand(0.2, 1.2), pos.z + rand(-3.5, 3.5));
    p.vel.set(rand(-0.4, 0.4), rand(cue.riseMin, cue.riseMax), rand(-0.4, 0.4));
  }

  update(ctx, dt) {
    const player = ctx.player;
    let maxStrength = 0;

    if (player.alive) {
      for (const c of ctx.creatures) {
        if (!c.alive || c === player) continue;
        const d = c.pos.distanceTo(player.pos);
        if (d >= SIGNAL_RANGE) continue;
        const strength = 1 - d / SIGNAL_RANGE;
        maxStrength = Math.max(maxStrength, strength);
        const cue = CUES[c.kind];
        if (!cue) continue;

        // 粒子发射(越近越密)
        const key = c.id;
        let acc = (this.emitAccum.get(key) || 0) + dt * (1.5 + 11 * strength);
        while (acc >= 1) { acc -= 1; this.emit(c.pos, cue, strength); }
        this.emitAccum.set(key, acc);

        // 污染周围道具:网格位置微扰(每帧物理同步后叠加,不影响物理)
        const r2 = CUE_RADIUS * CUE_RADIUS;
        for (const p of ctx.props) {
          if (p.dead) continue;
          const pp = propPos(p);
          if (pp.distanceToSquared(c.pos) > r2) continue;
          const amp = cue.jitterAmp * strength;
          const ph = ctx.time * cue.jitterFreq + p.id * 1.7;
          p.mesh.position.x += Math.sin(ph) * amp;
          p.mesh.position.z += Math.cos(ph * 1.13) * amp;
          if (c.kind === 'guardian') {
            p.mesh.position.y += (Math.sin(ph * 0.7) * 0.5 + 0.5) * amp * 3;
          }
        }
      }
    }

    // 粒子生命周期
    for (const p of this.pool) {
      if (p.free) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.free = true;
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.material.opacity *= 1 - dt * 1.2;
    }

    // 心跳脉动(距离越近越快越亮)
    if (this.pulseEl) {
      if (maxStrength > 0.05) {
        const beat = 0.5 + 0.5 * Math.sin(ctx.time * (2.5 + 9 * maxStrength) * Math.PI);
        this.pulseEl.style.opacity = (maxStrength * 0.55 * (0.4 + 0.6 * beat)).toFixed(3);
      } else {
        this.pulseEl.style.opacity = '0';
      }
    }
  }
}
