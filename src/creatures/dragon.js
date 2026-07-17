import * as THREE from 'three';
import { Creature } from './base.js';
import { TOON } from '../toon.js';
import { meleeHit } from '../damage.js';
import { spawnDebris } from '../props.js';
import { clamp, damp } from '../util.js';

// ============================================================================
// 蜈蚣精(百足之妖):分节身体蛇形跟随(移植原作 Creature.lua 的链式算法)
// 身体就是武器 —— 高速掠过撞碎一切;吞噬得越多长得越长
// ============================================================================

const SPACING = 1.05;
const BASE_SPEED = 15;
const DASH_SPEED = 36;
const DASH_TIME = 0.55;
const DASH_CD = 2.1;
const SEG_START = 8;
const SEG_MAX = 26;
const GROW_PER_HP = 55; // 每破坏55点HP的东西长一节

export class Dragon extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'dragon', cname: '蜈蚣精', color: 0xd23a2a });
    this.segs = [];       // {pos, mesh}
    this.growth = 0;
    this.dmgAccum = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.heading = new THREE.Vector3(0, 0, -1);
    this.prevHead = this.pos.clone();

    this.headMat = TOON({ color: 0x992010, roughness: 0.45 });
    this.bodyMat = TOON({ color: 0x992010, roughness: 0.5 });
    this.hornMat = TOON({ color: 0xe07310, roughness: 0.4 });
    this.plateMat = TOON({ color: 0x5a1208, roughness: 0.6 });               // 深色甲片
    this.eyeMat = TOON({ color: 0x140604, emissive: 0xffd23a, emissiveIntensity: 1.3 });
    this.sphereGeo = new THREE.SphereGeometry(1, 14, 10);
    this.coneGeo = new THREE.ConeGeometry(0.15, 0.6, 8);
    this.plateGeo = new THREE.BoxGeometry(1.5, 0.5, 1.7);                    // 背甲棱片

    for (let i = 0; i < SEG_START; i++) this.addSegment(true);
    // 头部:双触角 + 延长触须 + 复眼 + 上颚(赛博蜈蚣头)
    const head = this.segs[0].mesh;
    for (const hx of [-0.5, 0.5]) {
      const horn = new THREE.Mesh(this.coneGeo, this.hornMat);
      horn.position.set(hx, 0.8, 0);
      horn.rotation.z = -hx * 0.35;
      horn.scale.setScalar(1.6);
      head.add(horn);
      // 触须延长段
      const tip = new THREE.Mesh(this.coneGeo, this.hornMat);
      tip.position.set(hx * 1.2, 1.5, -0.1);
      tip.rotation.z = -hx * 0.8; tip.scale.set(0.5, 1.5, 0.5);
      head.add(tip);
    }
    for (const ex of [-0.42, 0.42]) { // 复眼
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.eyeMat);
      eye.position.set(ex, 0.28, -0.62);
      head.add(eye);
    }
    for (const mx of [-0.3, 0.3]) { // 上颚
      const mand = new THREE.Mesh(this.coneGeo, this.plateMat);
      mand.position.set(mx, -0.22, -0.72);
      mand.rotation.x = -1.9; mand.rotation.z = mx * 0.6;
      mand.scale.set(0.9, 1.6, 0.9);
      head.add(mand);
    }
  }

  addSegment(init = false) {
    const i = this.segs.length;
    const t = i / SEG_MAX;
    const r = i === 0 ? 0.62 : Math.max(0.55 - t * 0.32, 0.2);
    const mesh = new THREE.Mesh(this.sphereGeo, i === 0 ? this.headMat : this.bodyMat);
    mesh.scale.setScalar(r);
    mesh.castShadow = true;
    // 百足:每节两侧伸出的细足
    if (i > 0) {
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(this.coneGeo, this.hornMat);
        leg.position.set(side * 0.85, -0.5, 0);
        leg.rotation.z = side * 2.1;
        leg.scale.set(0.7, 1.4, 0.7);
        mesh.add(leg);
      }
      // 背甲棱片(深色,压在节背上)
      const plate = new THREE.Mesh(this.plateGeo, this.plateMat);
      plate.position.set(0, 0.55, 0);
      mesh.add(plate);
    }
    this.root.add(mesh);
    const tail = init && i > 0 ? this.segs[i - 1].pos : (this.segs[i - 1]?.pos ?? this.pos);
    this.segs.push({ pos: tail.clone().add(new THREE.Vector3(0, 0, SPACING * (init ? 1 : 0.2))), mesh, r });
  }

  removeSegment() {
    if (this.segs.length <= 3) return;
    const s = this.segs.pop();
    this.root.remove(s.mesh);
    spawnDebris(this.ctx, s.pos.clone(), 0x992010, 2, null);
  }

  onDestroyedProp(hp) {
    this.growth += hp;
    while (this.growth >= GROW_PER_HP && this.segs.length < SEG_MAX) {
      this.growth -= GROW_PER_HP;
      this.addSegment();
      if (this.isPlayer) this.ctx.ui.popup(this.ctx, '身体成长了!', this.pos, 1);
    }
  }

  hpText() { return `身体 ${this.segs.length} 节`; }
  hpRatio() { return this.segs.length / SEG_MAX; }

  hittable() {
    return this.segs.map((s) => ({ pos: s.pos, r: s.r + 0.2 }));
  }

  takeDamage(n, src) {
    if (!this.alive || this.weakened) return;
    this.dmgAccum += n;
    while (this.dmgAccum >= 25) {
      this.dmgAccum -= 25;
      this.removeSegment();
      if (this.segs.length <= 3) { this.dmgAccum = 0; this.enterWeakened(); return; }
    }
  }

  restoreFull() {
    while (this.segs.length < SEG_START) this.addSegment();
    this.dmgAccum = 0;
    this.growth = 0;
    for (const s of this.segs) s.pos.set(this.pos.x, 1, this.pos.z);
    this.prevHead.copy(this.pos);
  }

  update(dt, input) {
    if (!this.alive) return;
    if (this.updateWeakened(dt)) return;
    const ctx = this.ctx;

    // 冲刺
    this.dashCd -= dt;
    if (input.primary && this.dashCd <= 0 && this.stun <= 0) {
      this.dashT = DASH_TIME;
      this.dashCd = DASH_CD;
      // 冲刺方向:有移动输入用移动方向,否则冲向鼠标
      if (Math.hypot(input.move.x, input.move.z) > 0.1) {
        this.heading.set(input.move.x, 0, input.move.z).normalize();
      } else if (input.aim) {
        this.heading.copy(input.aim).sub(this.pos).setY(0).normalize();
      }
    }
    this.dashT = Math.max(0, this.dashT - dt);

    if (this.dashT > 0) {
      // 冲刺:锁方向高速前进
      this.stun = Math.max(0, this.stun - dt);
      this.elecT = Math.max(0, this.elecT - dt);
      this.vel.copy(this.heading).multiplyScalar(DASH_SPEED);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.x = clamp(this.pos.x, -145, 145);
      this.pos.z = clamp(this.pos.z, -145, 145);
    } else {
      this.moveCommon(dt, input, BASE_SPEED, 7);
      if (this.vel.lengthSq() > 1) this.heading.copy(this.vel).normalize();
    }

    this.collide();

    // 头部速度(用于伤害判定)
    const headSpeed = this.prevHead.distanceTo(this.pos) / Math.max(dt, 1e-4);
    this.prevHead.copy(this.pos);

    // 链式跟随(原作算法:每节朝前一节收紧到固定间距)
    this.segs[0].pos.copy(this.pos);
    for (let i = 1; i < this.segs.length; i++) {
      const prev = this.segs[i - 1].pos, cur = this.segs[i].pos;
      const d = cur.distanceTo(prev);
      if (d > SPACING * 0.98) {
        cur.lerp(prev, 1 - (SPACING * 0.98) / d);
      }
    }

    // 视觉:波浪起伏 + 电击变色
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      s.mesh.position.copy(s.pos);
      s.mesh.position.y = 0.9 + Math.sin(ctx.time * 6 + i * 0.7) * 0.18;
      s.pos.y = s.mesh.position.y;
    }
    const elecFlash = this.elecT > 0 && Math.sin(ctx.time * 30) > 0;
    this.headMat.emissive.setHex(elecFlash ? 0x66aaff : (this.dashT > 0 ? 0x661005 : 0x000000));
    this.bodyMat.emissive.setHex(elecFlash ? 0x66aaff : 0x000000);

    // 伤害:头部高速撞击 + 身体各节甩击
    // meleeHit 有 0.22s/目标的命中冷却,这里的 dmg 是"单次命中伤害"
    const src = { owner: this, chain: 0 };
    if (headSpeed > 9) {
      meleeHit(ctx, this, this.pos, 2.0, headSpeed * (this.dashT > 0 ? 2.2 : 1.0), src);
    }
    if (this.dashT > 0 || headSpeed > 11) {
      // 每隔一节采样,省性能
      for (let i = 2; i < this.segs.length; i += 2) {
        meleeHit(ctx, this, this.segs[i].pos, 1.4, headSpeed * 0.8, src);
      }
    }
  }
}
