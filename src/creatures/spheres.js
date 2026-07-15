import * as THREE from 'three';
import { Creature } from './base.js';
import { meleeHit, hitCreaturesAt } from '../damage.js';
import { consumeDebrisNear, spawnDebris } from '../props.js';
import { rand, damp, clamp } from '../util.js';

// ============================================================================
// 金属球群:操控群体中心,球按数学阵型运转(原作 Lissajous 轨道)
// 云雾阵型巡航 / 钻头突刺(左键) / 环形绞盘(右键) —— 吞噬碎片成长
// ============================================================================

const START_COUNT = 14;
const MAX_COUNT = 44;
const GROW_PER_HP = 70;

export class Spheres extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'spheres', cname: '金属球群', color: 0xc3cad2 });
    this.count = START_COUNT;
    this.growth = 0;
    this.dmgAccum = 0;
    this.mode = 'cloud';
    this.drillDir = new THREE.Vector3(0, 0, -1);

    this.mat = new THREE.MeshStandardMaterial({ color: 0xbfc7d0, metalness: 0.85, roughness: 0.25 });
    this.imesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 8), this.mat, MAX_COUNT);
    this.imesh.castShadow = true;
    this.root.add(this.imesh);

    this.balls = [];
    for (let i = 0; i < MAX_COUNT; i++) {
      this.balls.push({
        pos: this.pos.clone().add(new THREE.Vector3(rand(-2, 2), rand(0.5, 3), rand(-2, 2))),
        // 每球独立的 Lissajous 参数(原作数学轨道的直接移植)
        la: rand(0.8, 2.2), lb: rand(0.8, 2.2), lc: rand(0.8, 2.2),
        pa: rand(Math.PI * 2), pb: rand(Math.PI * 2), pc: rand(Math.PI * 2),
      });
    }
    this._dummy = new THREE.Object3D();
    this._target = new THREE.Vector3();
  }

  onDestroyedProp(hp) {
    this.growth += hp;
    while (this.growth >= GROW_PER_HP && this.count < MAX_COUNT) {
      this.growth -= GROW_PER_HP;
      this.count++;
    }
  }

  hpText() { return `球数 ${this.count}`; }
  hpRatio() { return this.count / MAX_COUNT; }

  hittable() {
    // 中心 + 采样几颗球
    const out = [{ pos: this.pos, r: 1.2 }];
    for (let i = 0; i < this.count; i += 6) out.push({ pos: this.balls[i].pos, r: 0.5 });
    return out;
  }

  takeDamage(n, src) {
    if (!this.alive) return;
    this.dmgAccum += n;
    while (this.dmgAccum >= 12) {
      this.dmgAccum -= 12;
      this.count--;
      if (this.count >= 0 && this.balls[this.count]) {
        spawnDebris(this.ctx, this.balls[this.count].pos.clone(), 0xbfc7d0, 1, null);
      }
      if (this.count < 5) { this.die(src); return; }
    }
  }

  update(dt, input) {
    if (!this.alive) return;
    const ctx = this.ctx;

    // 阵型切换
    if (this.stun > 0) this.mode = 'cloud';
    else if (input.primaryHeld) this.mode = 'drill';
    else if (input.secondaryHeld) this.mode = 'ring';
    else this.mode = 'cloud';

    if (this.mode === 'drill' && input.aim) {
      const d = this._target.copy(input.aim).sub(this.pos).setY(0);
      if (d.lengthSq() > 0.5) this.drillDir.copy(d.normalize());
    }

    // 移动:钻头模式向瞄准方向猛冲
    if (this.mode === 'drill') {
      this.stun = Math.max(0, this.stun - dt);
      this.elecT = Math.max(0, this.elecT - dt);
      const spd = ctx.rain.slippery ? 20 : 26;
      this.vel.x = damp(this.vel.x, this.drillDir.x * spd, 5, dt);
      this.vel.z = damp(this.vel.z, this.drillDir.z * spd, 5, dt);
      this.pos.x = clamp(this.pos.x + this.vel.x * dt, -145, 145);
      this.pos.z = clamp(this.pos.z + this.vel.z * dt, -145, 145);
    } else {
      this.moveCommon(dt, input, this.mode === 'ring' ? 8 : 13, 5);
    }
    this.collide();
    this.pos.y = 0;

    // 电击:带电球群反而更危险(涌现 buff),但持续自损
    const elec = this.elecT > 0;
    if (elec) this.dmgAccum += 1.5 * dt;
    this.mat.emissive.setHex(elec ? 0x4488ff : 0x000000);
    this.mat.emissiveIntensity = elec ? (0.5 + Math.sin(ctx.time * 25) * 0.4) : 0;

    // 阵型目标位置
    const t = ctx.time;
    const growR = 2.2 + this.count * 0.07;
    for (let i = 0; i < this.count; i++) {
      const b = this.balls[i];
      const frac = i / Math.max(this.count, 1);
      if (this.mode === 'drill') {
        // 锥形钻头:沿冲刺方向排成旋转的锥
        const row = i % 6, ring = Math.floor(i / 6);
        const ang = t * 14 + row * (Math.PI * 2 / 6) + ring * 0.5;
        const rr = 0.25 + ring * 0.32;
        const side = new THREE.Vector3(-this.drillDir.z, 0, this.drillDir.x);
        this._target.copy(this.pos)
          .addScaledVector(this.drillDir, 1.5 + ring * 0.75)
          .addScaledVector(side, Math.cos(ang) * rr);
        this._target.y = 1.0 + Math.sin(ang) * rr;
      } else if (this.mode === 'ring') {
        // 环形绞盘:大半径高速旋转
        const ang = t * 5.5 + frac * Math.PI * 2;
        this._target.set(
          this.pos.x + Math.cos(ang) * 7,
          1.1 + Math.sin(t * 3 + i) * 0.3,
          this.pos.z + Math.sin(ang) * 7
        );
      } else {
        // Lissajous 云(原作金属球的轨道数学)
        this._target.set(
          this.pos.x + Math.sin(b.la * t * 0.9 + b.pa) * growR,
          1.6 + Math.sin(b.lb * t * 0.9 + b.pb) * 1.2,
          this.pos.z + Math.sin(b.lc * t * 0.9 + b.pc) * growR
        );
      }
      const k = this.mode === 'drill' ? 10 : 6;
      b.pos.lerp(this._target, 1 - Math.exp(-k * dt));
    }

    // 实例矩阵
    for (let i = 0; i < MAX_COUNT; i++) {
      if (i < this.count) {
        this._dummy.position.copy(this.balls[i].pos);
        this._dummy.scale.setScalar(1);
      } else {
        this._dummy.position.set(0, -50, 0);
        this._dummy.scale.setScalar(0.001);
      }
      this._dummy.updateMatrix();
      this.imesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.imesh.instanceMatrix.needsUpdate = true;

    // 伤害:按阵型的每秒伤害;meleeHit 每目标 0.22s 冷却,换算成单次命中伤害
    const dps = (this.mode === 'drill' ? 110 : this.mode === 'ring' ? 48 : 8) * (elec ? 1.6 : 1);
    const perHit = dps * 0.22;
    const src = { owner: this, chain: 0 };
    const step = this.mode === 'cloud' ? 3 : 2; // 采样间隔
    for (let i = 0; i < this.count; i += step) {
      meleeHit(ctx, this, this.balls[i].pos, 0.95, perHit, src);
    }

    // 吞噬碎片成长
    const eaten = consumeDebrisNear(ctx, this.pos, 7, 3);
    if (eaten > 0 && this.count < MAX_COUNT) {
      this.count = Math.min(this.count + eaten, MAX_COUNT);
      if (this.isPlayer && Math.random() < 0.4) this.ctx.ui.popup(ctx, `吞噬 +${eaten}`, this.pos, 0);
    }
  }
}
