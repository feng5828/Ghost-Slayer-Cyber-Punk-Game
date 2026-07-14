import * as THREE from 'three';
import { rand, pick } from './util.js';
import { propPos } from './props.js';

// ============================================================================
// AI 控制器:产出与玩家相同的 input 结构
// 决策:低血逃跑 > 敌人近身/终局圈小时开战 > 找道具密集区刷分
// ============================================================================

export class AIController {
  constructor(ctx, creature) {
    this.ctx = ctx;
    this.c = creature;
    this.thinkT = rand(0.5, 1.5);
    this.state = 'farm';
    this.target = null;        // Vector3 或 creature
    this.aim = new THREE.Vector3();
    this.holdPrimary = false;
    this.holdSecondary = false;
    this.pulse = 0;
  }

  think() {
    const ctx = this.ctx, c = this.c;
    const enemies = ctx.creatures.filter((e) => e !== c && e.alive);
    let nearest = null, nd = Infinity;
    for (const e of enemies) {
      const d = e.pos.distanceTo(c.pos);
      if (d < nd) { nd = d; nearest = e; }
    }

    const lowHp = c.hpRatio() < 0.3;
    const endgame = ctx.zone.active && ctx.zone.radius < 50;
    const brawl = ctx.mode === 'brawl';

    if (lowHp && nearest && nd < 25) {
      this.state = 'flee';
      this.target = nearest;
    } else if (nearest && (nd < (brawl ? 30 : 16) || endgame)) {
      this.state = 'attack';
      this.target = nearest;
    } else {
      this.state = 'farm';
      // 找一个还活着的道具作为目标(偏爱高分)
      const cand = [];
      for (let i = 0; i < 12; i++) {
        const p = pick(this.ctx.props);
        if (p && !p.dead) cand.push(p);
      }
      cand.sort((a, b) => b.def.points - a.def.points);
      this.target = cand[0] || null;
    }
  }

  update(dt) {
    const ctx = this.ctx, c = this.c;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = rand(1.2, 2.2); this.think(); }
    this.pulse -= dt;

    let tx = 0, tz = 0;
    let primary = false;
    const kind = c.kind;

    // 目标点
    let tp = null;
    if (this.state === 'farm' && this.target && !this.target.dead) {
      tp = propPos(this.target);
    } else if ((this.state === 'attack' || this.state === 'flee') && this.target?.alive) {
      tp = this.target.pos;
    }
    // 圈外先回圈
    const distC = Math.hypot(c.pos.x, c.pos.z);
    if (ctx.zone.active && distC > ctx.zone.radius - 5) {
      tp = new THREE.Vector3(0, 0, 0);
      if (this.state === 'flee') this.state = 'farm';
    }

    if (tp) {
      const dx = tp.x - c.pos.x, dz = tp.z - c.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (this.state === 'flee') { tx = -dx / d; tz = -dz / d; }
      else { tx = dx / d; tz = dz / d; }
      this.aim.copy(tp).setY(0);
      var targetDist = d;
    } else {
      var targetDist = Infinity;
    }

    // 各生物的技能习惯
    if (kind === 'dragon') {
      // 距离合适就朝目标冲刺
      if (this.state !== 'flee' && targetDist > 5 && targetDist < 30 && this.pulse <= 0) {
        primary = true;
        this.pulse = rand(1.5, 2.8);
      }
      this.holdPrimary = false;
      this.holdSecondary = false;
    } else if (kind === 'spheres') {
      if (this.state === 'attack' && targetDist < 30) {
        this.holdPrimary = true; this.holdSecondary = false;      // 钻头怼脸
      } else if (this.state === 'farm' && targetDist < 12) {
        this.holdPrimary = false; this.holdSecondary = true;      // 环形绞盘刷场
      } else {
        this.holdPrimary = false; this.holdSecondary = false;
      }
    } else if (kind === 'guardian') {
      // 与敌人保持距离,魅化目标道具,敌人近了就放导弹
      if (this.state === 'attack' && this.target?.alive) {
        const d = this.target.pos.distanceTo(c.pos);
        if (d < 14) { tx = -tx; tz = -tz; } // 风筝
        if (c.minions.length > 0 && d < 26 && this.pulse <= 0) {
          this.pulse = rand(2, 4);
          return this.pack(tx, tz, false, this.holdPrimary, true, false);
        }
      }
      // farm = 魅化最近的可魅化道具
      if (c.minions.length < 4) {
        let best = null, bd = 26 * 26;
        for (const p of ctx.props) {
          if (p.dead || !p.def.charmable || p.state.charmedBy) continue;
          const d = propPos(p).distanceToSquared(c.pos);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          const bp = propPos(best);
          this.aim.copy(bp).setY(0);
          this.holdPrimary = true;
          // 靠近到魅化射程
          if (bp.distanceTo(c.pos) > 24) { const d = bp.distanceTo(c.pos); tx = (bp.x - c.pos.x) / d; tz = (bp.z - c.pos.z) / d; }
        } else {
          this.holdPrimary = false;
        }
      } else {
        this.holdPrimary = false;
      }
    }

    return this.pack(tx, tz, primary, this.holdPrimary, false, this.holdSecondary);
  }

  pack(mx, mz, primary, primaryHeld, secondary, secondaryHeld) {
    return {
      move: { x: mx, z: mz },
      aim: this.aim,
      primary, primaryHeld: primaryHeld || primary,
      secondary, secondaryHeld: secondaryHeld || secondary,
    };
  }
}
