import * as THREE from 'three';
import { Creature } from './base.js';
import { TOON } from '../toon.js';
import { addFlash } from '../damage.js';

// ============================================================================
// 水鬼:河道水巷常驻鬼
// - 在水里半透明、免疫大部分伤害并缓慢回血
// - 火符/冷却泵/爆炸会让它受惊上岸,离水后才适合输出
// - 拖着水雾与水波在渠中巡猎;视觉上必须一眼能认出来
// ============================================================================

const MAX_HP = 95;
const SPEED_WATER = 19;
const SPEED_LAND = 12;

export class WaterGhost extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'water', cname: '水鬼', color: 0x42c8ff });
    this.hp = MAX_HP;
    this.colRadius = 0.8;
    this.phase = 0;
    this.landPanicT = 0;
    this.forcedTarget = null;

    this.mat = TOON({ color: 0x1a5f72, emissive: 0x25bfff, emissiveIntensity: 0.9, transparent: true, opacity: 0.84 });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.68, 16, 12), this.mat);
    this.core.position.y = 1.15; this.core.castShadow = true;
    this.skirt = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.5, 12), this.mat);
    this.skirt.position.y = 0.45; this.skirt.rotation.x = Math.PI;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: 0x5ee8ff, transparent: true, opacity: 0.75 }));
    this.ring.rotation.x = Math.PI / 2; this.ring.position.y = 0.15;
    this.outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.04, 8, 40), new THREE.MeshBasicMaterial({ color: 0xb6f3ff, transparent: true, opacity: 0.48 }));
    this.outerRing.rotation.x = Math.PI / 2; this.outerRing.position.y = 0.08;
    // 外层半透水膜(层叠出流动水体的通透感)
    this.shellMat = TOON({ color: 0x1a6f88, emissive: 0x25bfff, emissiveIntensity: 0.5, transparent: true, opacity: 0.28 });
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12), this.shellMat);
    this.shell.position.y = 1.1;
    this.root.add(this.shell);
    this.mist = [];
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x89ebff, transparent: true, opacity: 0.32, depthWrite: false }));
      puff.scale.set(1.2, 1.2, 1);
      this.root.add(puff);
      this.mist.push(puff);
    }
    this.root.add(this.core, this.skirt, this.ring, this.outerRing);
  }
  hpText() { return `怨水 ${Math.ceil(this.hp)}${this.landPanicT > 0 ? ' / 离水' : ''}`; }
  hpRatio() { return this.hp / MAX_HP; }
  hittable() { return [{ pos: this.pos, r: 1.1 }]; }
  inWater() { return this.ctx.village?.isWater(this.pos); }
  forceAshore(src) {
    if (!this.ctx.village || this.landPanicT > 0.5) return;
    this.landPanicT = Math.max(this.landPanicT, 2.8);
    this.forcedTarget = this.ctx.village.nearestDryLand(this.pos);
    addFlash(this.ctx, this.pos.clone().setY(0.8), 3.2, 0x5ee8ff);
    if (src?.owner?.isPlayer) this.ctx.ui.popup(this.ctx, '水鬼被逼上岸!', this.pos, 0);
  }
  takeDamage(n, src) {
    if (!this.alive || this.weakened) return;
    const watery = this.inWater();
    const force = src?.forceAshore || src?.fire || src?.explosion;
    if (watery && force) this.forceAshore(src);
    if (watery && this.landPanicT <= 0) {
      this.stun = Math.max(this.stun, 0.25);
      if (src?.owner?.isPlayer) this.hp -= n * 0.08;
    } else {
      this.hp -= n * (watery ? 0.35 : 1.0);
    }
    if (this.hp <= 0) { this.hp = 0; this.enterWeakened(); }
  }
  restoreFull() { this.hp = MAX_HP; this.landPanicT = 0; this.forcedTarget = null; }
  update(dt, input) {
    if (!this.alive) return;
    if (this.updateWeakened(dt)) return;
    const water = this.inWater();
    this.landPanicT = Math.max(0, this.landPanicT - dt);
    if (water && this.landPanicT <= 0) this.hp = Math.min(MAX_HP, this.hp + 5 * dt);

    if (this.landPanicT > 0 && this.forcedTarget) {
      const dx = this.forcedTarget.x - this.pos.x, dz = this.forcedTarget.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const panic = { move: { x: dx / d, z: dz / d }, aim: input.aim, primary: false, primaryHeld: false, secondary: false, secondaryHeld: false };
      this.moveCommon(dt, panic, SPEED_WATER + 5, 8);
      if (d < 1.4 || !this.inWater()) this.forcedTarget = null;
    } else {
      this.moveCommon(dt, input, water ? SPEED_WATER : SPEED_LAND, water ? 5 : 7);
    }
    this.collide();
    this.phase += dt;
    this.root.position.copy(this.pos);
    const y = water ? 0.25 : 0.75;
    this.core.position.y = y + 0.95 + Math.sin(this.phase * 5) * 0.14;
    this.skirt.position.y = y + 0.2;
    this.ring.visible = water;
    this.outerRing.visible = water;
    this.ring.scale.setScalar(1 + Math.sin(this.phase * 7) * 0.12);
    this.outerRing.scale.setScalar(1.05 + Math.cos(this.phase * 5.5) * 0.08);
    this.mat.opacity = water ? 0.58 : 0.88;
    this.mat.emissiveIntensity = water ? 1.25 : 0.62;
    this.shell.position.y = y + 0.95 + Math.sin(this.phase * 4) * 0.1;
    this.shell.scale.setScalar(1 + Math.sin(this.phase * 3) * 0.06);
    this.shellMat.opacity = water ? 0.2 : 0.32;
    for (let i = 0; i < this.mist.length; i++) {
      const puff = this.mist[i];
      const a = this.phase * 1.5 + (i / this.mist.length) * Math.PI * 2;
      puff.visible = water;
      puff.position.set(Math.cos(a) * (1.1 + i * 0.18), y + 0.6 + Math.sin(a * 2.1) * 0.12, Math.sin(a) * (1.1 + i * 0.18));
      const s = 0.85 + Math.sin(a * 1.7) * 0.18;
      puff.scale.set(s, s, 1);
    }

    const p = this.ctx.player;
    if (p?.alive && this.pos.distanceTo(p.pos) < 2.2) {
      p.takeDamage((water ? 18 : 10) * dt, { owner: this, chain: 0 });
    }
  }
}
