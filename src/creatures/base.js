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

  electrify(dur, src) {
    if (!this.alive) return;
    this.elecT = Math.max(this.elecT, dur);
    this.stun = Math.max(this.stun, 0.8);
    this.takeDamage(12, src);
  }

  // 子类实现:hittable() / takeDamage / update / hpText / hpRatio
  hittable() { return [{ pos: this.pos, r: 1 }]; }

  die(src) {
    if (!this.alive) return;
    this.alive = false;
    this.root.visible = false;
    addFlash(this.ctx, this.pos, 6, this.color);
    spawnDebris(this.ctx, this.pos.clone().setY(1.5), this.color, 10,
      src && src.owner ? { owner: src.owner, chain: src.chain + 1 } : null);
    if (src && src.owner && src.owner !== this && src.owner.alive) {
      this.ctx.score.killBonus(this.ctx, src.owner, this);
    }
    this.ctx.ui.banner(`${this.cname} 被摧毁了!`);
  }
}
