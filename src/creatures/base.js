import * as THREE from 'three';
import { clamp, damp } from '../util.js';
import { spawnDebris } from '../props.js';
import { addFlash } from '../damage.js';

let _cid = 0;

export class Creature {
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.id = ++_cid;
    this.kind = opts.kind;
    this.cname = opts.cname;
    this.color = opts.color;
    this.isPlayer = !!opts.isPlayer;
    this.pos = new THREE.Vector3(opts.x, 0, opts.z);
    this.vel = new THREE.Vector3();
    this.alive = true;
    this.score = 0;
    this.stats = { destroyed: 0, kills: 0, maxChain: 0 };
    this.stun = 0;
    this.elecT = 0;
    this.root = new THREE.Group();
    ctx.three.scene.add(this.root);
  }

  // 通用地面移动:input.move 是屏幕方向(x右 z下),血雨时打滑
  moveCommon(dt, input, speed, accelK = 6) {
    this.stun = Math.max(0, this.stun - dt);
    this.elecT = Math.max(0, this.elecT - dt);
    const slippery = this.ctx.rain.slippery;
    const k = slippery ? accelK * 0.3 : accelK;
    const tx = this.stun > 0 ? 0 : input.move.x * speed;
    const tz = this.stun > 0 ? 0 : input.move.z * speed;
    this.vel.x = damp(this.vel.x, tx, k, dt);
    this.vel.z = damp(this.vel.z, tz, k, dt);
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -145, 145);
    this.pos.z = clamp(this.pos.z + this.vel.z * dt, -145, 145);
  }

  // 村庄迷宫的墙体碰撞(移动后调用)
  collide() {
    if (this.ctx.village) this.ctx.village.resolveCircle(this.pos, this.colRadius ?? 0.8);
  }

  electrify(dur, src) {
    if (!this.alive) return;
    this.elecT = Math.max(this.elecT, dur);
    this.stun = Math.max(this.stun, 0.8);
    this.takeDamage(12, src);
  }

  // 子类实现:hittable() / takeDamage / update / hpText / hpRatio
  hittable() { return [{ pos: this.pos, r: 1 }]; }

  // ==========================================================================
  // 虚弱 / 收服 / 逃逸:猎鬼核心循环
  // 鬼血打空不死 → 虚弱显形 8 秒 → 结界收服计分;超时逃逸回满血重新躲藏
  // ==========================================================================
  enterWeakened() {
    if (this.weakened || !this.alive || this.isPlayer) return;
    this.weakened = true;
    this.weakenedT = 8.0;
    this.stun = 0;
    if (this.onWeakened) this.onWeakened();
    if (!this.soulRing) {
      this.soulRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.07, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.9, depthWrite: false })
      );
      this.soulRing.rotation.x = Math.PI / 2;
      this.ctx.three.scene.add(this.soulRing);
    }
    this.soulRing.visible = true;
    this.ctx.ui.banner(`${this.cname} 虚弱了 —— 靠近按住右键展开结界收服!`);
  }

  // 虚弱期间的每帧表现;返回 true 表示本帧跳过正常行为
  updateWeakened(dt) {
    if (!this.weakened) return false;
    this.weakenedT -= dt;
    this.root.visible = Math.sin(this.ctx.time * 16) > -0.65; // 魂体闪烁
    if (this.soulRing) {
      this.soulRing.position.set(this.pos.x, 2.6 + Math.sin(this.ctx.time * 3) * 0.2, this.pos.z);
      this.soulRing.rotation.z += dt * 2;
    }
    if (this.weakenedT <= 0) this.escape();
    return true;
  }

  escape() {
    if (!this.weakened) return;
    this.weakened = false;
    this.root.visible = true;
    if (this.soulRing) this.soulRing.visible = false;
    addFlash(this.ctx, this.pos.clone().setY(1.2), 4, 0x8a6acc);
    const at = this.ctx.village.farCell(this.ctx.player.pos.x, this.ctx.player.pos.z, 4);
    this.pos.set(at.x, 0, at.z);
    this.vel.set(0, 0, 0);
    if (this.restoreFull) this.restoreFull();
    this.ctx.ui.banner(`${this.cname} 挣脱逃逸,重新藏了起来…`);
  }

  capture(by) {
    this.weakened = false;
    this.alive = false;
    this.captured = true;
    this.root.visible = false;
    if (this.soulRing) { this.ctx.three.scene.remove(this.soulRing); this.soulRing = null; }
    addFlash(this.ctx, this.pos.clone().setY(1.2), 6, 0xffd75e);
    this.ctx.shake = Math.max(this.ctx.shake, 0.5);
    this.ctx.score.captureBonus(this.ctx, by, this);
  }

  die(src) {
    if (!this.alive) return;
    this.alive = false;
    this.root.visible = false;
    addFlash(this.ctx, this.pos, 6, this.color);
    spawnDebris(this.ctx, this.pos.clone().setY(1.5), this.color, 10,
      src && src.owner ? { owner: src.owner, chain: src.chain + 1 } : null);
    const credited = src && src.owner && src.owner !== this && src.owner.alive;
    if (credited) this.ctx.score.killBonus(this.ctx, src.owner, this);
    // 玩家击杀时 killBonus 已弹"斩杀"横幅,不再覆盖
    if (!(credited && src.owner.isPlayer)) this.ctx.ui.banner(`${this.cname} 灰飞烟灭了!`);
  }
}
