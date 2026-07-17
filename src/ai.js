import * as THREE from 'three';
import { rand, pick } from './util.js';
import { propPos } from './props.js';

// ============================================================================
// HiderAI:躲藏生物的控制器(捉迷藏的"藏"方)
// 状态:lurk 潜伏 → flee 逃窜(玩家靠近/受击) → fight 反击(被逼入绝境/血月)
// 逃窜走迷宫 BFS;鬼火群被逼急了会钻穿树篱开路
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
    // 地形化 lurk 用的内部状态
    this.orbitA = rand(0, Math.PI * 2); // 鬼火绕庙角度
    this.crawlSide = Math.random() < 0.5 ? 1 : -1; // 蜈蚣贴墙滑行方向
    this.patrolPt = null; // 水鬼/雷鬼巡逻目标点
  }

  update(dt) {
    const ctx = this.ctx, c = this.c, v = ctx.village;
    const player = ctx.player;
    // 虚弱中:瘫在原地等待被收服或逃逸
    if (c.weakened) return this.pack(0, 0, false, false, false, false);
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
          // 无路可逃:鬼火群钻墙!
          this.breachTarget = this.nearestHedge();
        } else {
          // 其他生物被堵死 → 拼命
          this.state = 'fight';
          this.fightUntil = ctx.time + 2.5;
        }
      } else if (this.state === 'lurk') {
        // 地形化常态:各鬼按主场地形活动(无主场要素时回退通用游荡)
        this.setLurkTarget(v);
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
      } else if (c.kind === 'water') {
        // 水鬼主场:尽量把战斗拖回最近的水渠;被火/爆炸逼上岸时例外
        const wp = ctx.village.nearestWater(c.pos);
        if (wp && (!c.landPanicT || c.landPanicT <= 0)) {
          this.aim.set(wp.x, 0, wp.z);
          const wx = wp.x - c.pos.x, wz = wp.z - c.pos.z;
          const wd = Math.hypot(wx, wz) || 1;
          if (!ctx.village.isWater(c.pos) || wd > 3) { mx = wx / wd; mz = wz / wd; }
          else { mx = dx / d; mz = dz / d; }
        } else {
          mx = dx / d; mz = dz / d;
        }
      } else if (c.kind === 'thunder') {
        // 雷鬼主场:贴着电源点游走,充能后主动近身电击
        const pp = this.nearestPowered();
        if (pp && c.charge < 55) {
          const ppos = propPos(pp);
          this.aim.copy(ppos).setY(0);
          const ex = ppos.x - c.pos.x, ez = ppos.z - c.pos.z;
          const ed = Math.hypot(ex, ez) || 1;
          mx = ex / ed; mz = ez / ed;
        } else {
          mx = dx / d; mz = dz / d;
        }
      }
    } else if (this.breachTarget && !this.breachTarget.dead) {
      // 鬼火群钻墙
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
        const spd = this.state === 'flee' ? 1 : 0.55; // 潜伏时缓行(地形行为要看得见)
        mx = (dx / d) * spd; mz = (dz / d) * spd;
      }
      this.aim.copy(this.target);
      // 蜈蚣精逃跑时偶尔冲刺(会撞碎沿途的东西 → 给玩家留下线索!)
      if (c.kind === 'dragon' && this.state === 'flee' && this.pulse <= 0 && Math.random() < 0.3) {
        primary = true;
        this.pulse = rand(2.5, 4);
      }
      // 纸傀儡常态:商街里预先囤仆从(平时就魅化)
      if (c.kind === 'guardian' && this.state === 'lurk') {
        const cand = this.nearestCharmable();
        if (cand && c.minions.length < 4) { this.aim.copy(propPos(cand)).setY(0); this.holdPrimary = true; }
      }
    }

    return this.pack(mx, mz, primary, this.holdPrimary, false, this.holdSecondary);
  }

  // ---- 地形化 lurk 目标分派 ----
  setLurkTarget(v) {
    switch (this.c.kind) {
      case 'dragon': return this.lurkDragon(v);
      case 'spheres': return this.lurkSpheres(v);
      case 'water': return this.lurkWater(v);
      case 'thunder': return this.lurkThunder(v);
      default: return this.genericWander(v);
    }
  }

  genericWander(v) {
    const { cx, cz } = v.worldToCell(this.c.pos.x, this.c.pos.z);
    const cc = v.cellCenter(cx, cz);
    this.target.set(cc.x + rand(-7, 7), 0, cc.z + rand(-7, 7));
    this.navT = rand(1.0, 2.2);
  }

  // 蜈蚣精:贴着最近的巷墙沿切向滑行,到头就翻面折返
  lurkDragon(v) {
    const hedge = this.nearestHedge();
    if (!hedge) return this.genericWander(v);
    const hp = propPos(hedge);
    let nx = this.c.pos.x - hp.x, nz = this.c.pos.z - hp.z;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;      // 墙→鬼 的法向
    const tx = -nz * this.crawlSide, tz = nx * this.crawlSide;   // 沿墙切向
    const standoff = 2.4;
    this.target.set(hp.x + nx * standoff + tx * 7, 0, hp.z + nz * standoff + tz * 7);
    this.navT = rand(0.55, 1.0);
    if (Math.random() < 0.15) this.crawlSide *= -1; // 偶尔折返
  }

  // 鬼火群:以稳定角速度绕大庙做圆周(汇聚 + 规律),半径贴着火盆环顺路吞火
  lurkSpheres(v) {
    const tc = v.templeCenter;
    if (!tc) return this.genericWander(v);
    this.orbitA += rand(0.25, 0.5);
    const R = (v.templeR || 30) * rand(0.45, 0.62);
    this.target.set(tc.x + Math.cos(this.orbitA) * R, 0, tc.z + Math.sin(this.orbitA) * R);
    this.navT = rand(0.5, 0.85);
  }

  // 水鬼:在水域之间巡游,尽量待在水里
  lurkWater(v) {
    const rects = v.waterRects;
    if (!rects || !rects.length) return this.genericWander(v);
    if (!this.patrolPt || this.c.pos.distanceTo(this.patrolPt) < 4 || Math.random() < 0.08) {
      const r = pick(rects);
      this.patrolPt = new THREE.Vector3(r.x + rand(-r.hw * 0.6, r.hw * 0.6), 0, r.z + rand(-r.hd * 0.6, r.hd * 0.6));
    }
    this.target.copy(this.patrolPt);
    this.navT = rand(0.6, 1.0);
  }

  // 雷鬼:在电源点之间跳站(到点旁停留吸电充能,再挑下一个)
  lurkThunder(v) {
    const nodes = v.powerNodes;
    if (!nodes || !nodes.length) return this.genericWander(v);
    if (!this.patrolPt || this.c.pos.distanceTo(this.patrolPt) < 3.5 || Math.random() < 0.06) {
      const n = pick(nodes);
      this.patrolPt = new THREE.Vector3(n.x + rand(-2, 2), 0, n.z + rand(-2, 2));
    }
    this.target.copy(this.patrolPt);
    this.navT = rand(0.7, 1.2);
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

  nearestPowered() {
    let best = null, bd = 26 * 26;
    for (const p of this.ctx.props) {
      if (p.dead || !p.def.powered) continue;
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
