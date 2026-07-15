import * as THREE from 'three';
import { rand, pick } from './util.js';
import { propPos } from './props.js';

// ============================================================================
// HiderAI:躲藏生物的控制器(捉迷藏的"藏"方)
// 状态:lurk 潜伏 → flee 逃窜(玩家靠近/受击) → fight 反击(被逼入绝境/血月)
// 逃窜走迷宫 BFS;金属球群被逼急了会钻穿树篱开路
// ============================================================================

export class HiderAI {
  constructor(ctx, creature) {
    this.ctx = ctx;
    this.c = creature;
    this.state = 'lurk';
    this.navT = 0;
    this.target = new THREE.Vector3(creature.pos.x, 0, creature.pos.z);
    this.aim = new THREE.Vector3();
    this.lastHpRatio = creature.hpRatio();
    this.fightUntil = 0;
    this.pulse = 0;
    this.holdPrimary = false;
    this.holdSecondary = false;
    this.breachTarget = null; // 要钻穿的树篱
  }

  update(dt) {
    const ctx = this.ctx, c = this.c, v = ctx.village;
    const player = ctx.player;
    this.navT -= dt;
    this.pulse -= dt;

    const hpNow = c.hpRatio();
    const gotHit = hpNow < this.lastHpRatio - 0.001;
    this.lastHpRatio = hpNow;

    const pd = player.alive ? c.pos.distanceTo(player.pos) : 999;

    // ---- 状态迁移 ----
    if (ctx.bloodMoon && player.alive) {
      this.state = 'fight';
    } else if (gotHit) {
      // 被打了:先短暂反击,再跑
      if (this.state !== 'fight' || ctx.time > this.fightUntil) {
        this.state = Math.random() < 0.45 ? 'fight' : 'flee';
        this.fightUntil = ctx.time + rand(1.5, 3.0);
      }
      this.navT = 0;
    } else if (this.state === 'fight' && ctx.time > this.fightUntil && !ctx.bloodMoon) {
      this.state = 'flee';
      this.navT = 0;
    } else if (this.state === 'lurk' && pd < 16) {
      this.state = 'flee';
      this.navT = 0;
    } else if (this.state === 'flee' && pd > 45) {
      this.state = 'lurk';
      this.navT = 0;
    }

    // ---- 导航目标更新 ----
    if (this.navT <= 0) {
      this.navT = this.state === 'flee' ? 0.5 : rand(1.2, 2.5);
      const { cx, cz } = v.worldToCell(c.pos.x, c.pos.z);

      if (this.state === 'flee' && player.alive) {
        const pc = v.worldToCell(player.pos.x, player.pos.z);
        const dist = v.bfsFrom(pc.cx, pc.cz);
        // 选 BFS 距离最大的邻格
        let best = null, bd = dist[cx + cz * 9] ?? 0;
        const dirs = [[1, 0, 0], [-1, 0, 1], [0, 1, 2], [0, -1, 3]];
        for (const [dx, dz, dir] of dirs) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nx >= 9 || nz < 0 || nz >= 9) continue;
          if (!v.passable(cx, cz, dir)) continue;
          const nd = dist[nx + nz * 9];
          if (nd > bd) { bd = nd; best = [nx, nz]; }
        }
        if (best) {
          const cc = v.cellCenter(best[0], best[1]);
          this.target.set(cc.x + rand(-4, 4), 0, cc.z + rand(-4, 4));
          this.breachTarget = null;
        } else if (c.kind === 'spheres') {
          // 无路可逃:金属球群钻墙!
          this.breachTarget = this.nearestHedge();
        } else {
          // 其他生物被堵死 → 拼命
          this.state = 'fight';
          this.fightUntil = ctx.time + 2.5;
        }
      } else if (this.state === 'lurk') {
        // 在当前格附近小幅游荡(贴着道具躲)
        const cc = v.cellCenter(cx, cz);
        this.target.set(cc.x + rand(-6, 6), 0, cc.z + rand(-6, 6));
      }
    }

    // ---- 产出输入 ----
    let mx = 0, mz = 0;
    let primary = false;
    this.holdPrimary = false;
    this.holdSecondary = false;

    if (this.state === 'fight' && player.alive) {
      this.aim.copy(player.pos).setY(0);
      const dx = player.pos.x - c.pos.x, dz = player.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz) || 1;

      if (c.kind === 'dragon') {
        mx = dx / d; mz = dz / d;
        if (d > 4 && d < 28 && this.pulse <= 0) { primary = true; this.pulse = rand(1.6, 2.6); }
      } else if (c.kind === 'spheres') {
        mx = dx / d; mz = dz / d;
        this.holdPrimary = d < 30; // 钻头怼人
      } else if (c.kind === 'guardian') {
        // 风筝:保持12~20米,魅化道具丢人
        if (d < 12) { mx = -dx / d; mz = -dz / d; }
        else if (d > 20) { mx = dx / d; mz = dz / d; }
        if (c.minions.length > 0 && d < 26 && this.pulse <= 0) {
          this.pulse = rand(1.8, 3.2);
          return this.pack(mx, mz, false, false, true, false);
        }
        // 补充仆从
        const best = this.nearestCharmable();
        if (best && c.minions.length < 4) {
          this.aim.copy(propPos(best)).setY(0);
          this.holdPrimary = true;
        }
      }
    } else if (this.breachTarget && !this.breachTarget.dead) {
      // 金属球群钻墙
      const bp = propPos(this.breachTarget);
      this.aim.copy(bp).setY(0);
      const dx = bp.x - c.pos.x, dz = bp.z - c.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d;
      this.holdPrimary = true;
      if (this.breachTarget.dead || d < 2) this.breachTarget = null;
    } else {
      const dx = this.target.x - c.pos.x, dz = this.target.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.5) {
        const spd = this.state === 'flee' ? 1 : 0.4; // 潜伏时慢速蠕动
        mx = (dx / d) * spd; mz = (dz / d) * spd;
      }
      this.aim.copy(this.target);
      // 红龙逃跑时偶尔冲刺(会撞碎沿途的东西 → 给玩家留下线索!)
      if (c.kind === 'dragon' && this.state === 'flee' && this.pulse <= 0 && Math.random() < 0.3) {
        primary = true;
        this.pulse = rand(2.5, 4);
      }
    }

    return this.pack(mx, mz, primary, this.holdPrimary, false, this.holdSecondary);
  }

  nearestHedge() {
    let best = null, bd = 20 * 20;
    for (const p of this.ctx.props) {
      if (p.dead || p.type !== 'hedge') continue;
      const d = propPos(p).distanceToSquared(this.c.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  nearestCharmable() {
    let best = null, bd = 24 * 24;
    for (const p of this.ctx.props) {
      if (p.dead || !p.def.charmable || p.state.charmedBy) continue;
      const d = propPos(p).distanceToSquared(this.c.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
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
