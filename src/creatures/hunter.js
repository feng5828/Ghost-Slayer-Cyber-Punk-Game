import * as THREE from 'three';
import { Creature } from './base.js';
import { TOON } from '../toon.js';
import { meleeHit, hitCreaturesAt, addFlash, nearbyProps, damageProp } from '../damage.js';
import { ignite } from '../fire.js';
import { damp, clamp, lerp } from '../util.js';

// ============================================================================
// 猎鬼人(玩家):赛博时代的职业驱鬼者,义体就是武器
// 左键/空格按住 = 蓄力;松开 = 向鼠标方向冲撞
//   蓄力越久冲力越大 —— 冲力就是唯一的伤害来源
//   冲力够大就能撞碎场上任何东西(满蓄力可以直接洞穿一栋商铺)
// 右键 = 掷电浆符(符落起火 → 把躲藏的恶鬼逼出来)
// ============================================================================

const MAX_HP = 120;
const SPEED = 17;
const CHARGE_TIME = 1.4;        // 蓄满所需秒数
const CHARGE_MOVE_MULT = 0.5;   // 蓄力时移动减速
const DASH_SPEED_MIN = 24;
const DASH_SPEED_MAX = 62;
const DASH_TIME_MIN = 0.22;
const DASH_TIME_MAX = 0.5;
const DMG_MIN = 35;             // 轻点冲撞
const DMG_MAX = 230;            // 满蓄力(可一击洞穿 150hp 的商铺)
const CREATURE_DMG_MULT = 0.6;  // 对恶鬼的冲撞倍率
const TORCH_CD = 4.0;
const TORCH_RANGE = 22;
const REGEN_DELAY = 5.0;
const REGEN_RATE = 5;
// 结界收服
const BARRIER_RADIUS = 7;     // 结界半径:目标须在此范围内
const BARRIER_COST = 30;      // 收服消耗灵力
const SPIRIT_MAX = 100;
const SPIRIT_REGEN = 1.2;     // 灵力被动回复/秒(主要靠破坏获取)

export class Hunter extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'hunter', cname: '猎鬼人', color: 0x18e0c8 });
    this.hp = MAX_HP;
    this.colRadius = 0.7;
    this.charging = false;
    this.chargeT = 0;
    this.dashT = 0;
    this.dashDur = 0;
    this.dashDmg = 0;
    this.dashDir = new THREE.Vector3(0, 0, -1);
    this.torchCd = 0;
    this.lastHurtAt = -99;
    this.torches = [];
    this.facing = 0;
    this.spirit = 40;
    this.barrier = null;   // {target, t, need}

    // 造型:深色义体 + 青色面甲光条 + 背后符印发光 + 悬浮肩灯
    const suitMat = TOON({ color: 0x161a28, metalness: 0.55, roughness: 0.4 });
    const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 1.4, 10), suitMat);
    bodyM.position.y = 0.95; bodyM.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), suitMat);
    head.position.y = 1.95;
    this.visorMat = TOON({
      color: 0x061014, emissive: 0x18e0c8, emissiveIntensity: 1.2, roughness: 0.3,
    });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.12), this.visorMat);
    visor.position.set(0, 1.98, -0.26);
    // 背后符印(朱红发光的电子符)
    this.sigilMat = TOON({
      color: 0x1a0806, emissive: 0xff3a2a, emissiveIntensity: 0.8, roughness: 0.5,
    });
    const sigil = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.6, 0.04), this.sigilMat);
    sigil.position.set(0, 1.25, 0.4);
    // 肩部悬浮灯(左右各一)
    for (const sx of [-0.55, 0.55]) {
      const lamp = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.09),
        TOON({ color: 0x0a0a12, emissive: 0xffd75e, emissiveIntensity: 1.0 })
      );
      lamp.position.set(sx, 1.7, 0.1);
      lamp.userData.float = true;
      this.root.add(lamp);
    }
    this.figure = new THREE.Group();
    this.figure.add(bodyM, head, visor, sigil);
    this.root.add(this.figure);

    // 电浆符预制:燃着青焰的符纸
    this.torchGeo = new THREE.BoxGeometry(0.3, 0.02, 0.48);
    this.torchMat = TOON({
      color: 0x10141c, emissive: 0x18e0c8, emissiveIntensity: 1.1,
    });

    // 结界法阵:双环
    this.barrierMat = new THREE.MeshBasicMaterial({
      color: 0x18e0c8, transparent: true, opacity: 0.75, depthWrite: false,
    });
    this.barrierRing = new THREE.Mesh(new THREE.TorusGeometry(BARRIER_RADIUS, 0.12, 8, 48), this.barrierMat);
    this.barrierRing.rotation.x = Math.PI / 2;
    this.barrierRing.visible = false;
    this.barrierRing2 = new THREE.Mesh(new THREE.TorusGeometry(BARRIER_RADIUS * 0.7, 0.07, 8, 40), this.barrierMat);
    this.barrierRing2.rotation.x = Math.PI / 2;
    this.barrierRing2.visible = false;
    this.root.add(this.barrierRing, this.barrierRing2);
  }

  findBarrierTarget() {
    let best = null, bestScore = -1;
    for (const c of this.ctx.creatures) {
      if (c === this || !c.alive) continue;
      if (c.pos.distanceTo(this.pos) > BARRIER_RADIUS) continue;
      const s = c.weakened ? 10 : 1 - c.hpRatio(); // 优先虚弱,其次血最少的
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  cancelBarrier() {
    this.barrier = null;
    this.barrierRing.visible = false;
    this.barrierRing2.visible = false;
    this.ctx.ui.captureRing(null);
  }

  hpText() { return `生命 ${Math.ceil(this.hp)}`; }
  hpRatio() { return this.hp / MAX_HP; }
  hittable() { return [{ pos: this.pos, r: 0.9 }]; }

  takeDamage(n, src) {
    if (!this.alive) return;
    this.hp -= n;
    this.lastHurtAt = this.ctx.time;
    this.ctx.ui.hurtFlash();
    // 受击打断结界引导
    if (this.barrier) {
      this.cancelBarrier();
      this.ctx.ui.popup(this.ctx, '结界被打断!', this.pos, 'bad');
    }
    if (this.hp <= 0) this.die(src);
  }

  chargeFrac() { return clamp(this.chargeT / CHARGE_TIME, 0, 1); }

  update(dt, input) {
    if (!this.alive) return;
    const ctx = this.ctx;
    this.torchCd -= dt;

    // 回血 / 灵力被动回复
    if (ctx.time - this.lastHurtAt > REGEN_DELAY && this.hp < MAX_HP) {
      this.hp = Math.min(this.hp + REGEN_RATE * dt, MAX_HP);
    }
    this.spirit = Math.min(this.spirit + SPIRIT_REGEN * dt, SPIRIT_MAX);

    // ---- 结界收服(右键按住引导)----
    // 虚弱的鬼 1 秒收服;满血强收要引导数秒,期间被打就断
    if (input.secondaryHeld && this.stun <= 0 && this.dashT <= 0) {
      const target = this.findBarrierTarget();
      if (!target) {
        this.cancelBarrier();
      } else if (this.spirit < BARRIER_COST) {
        this.cancelBarrier();
        if ((this._spiritWarnCd || 0) < ctx.time) {
          this._spiritWarnCd = ctx.time + 1.5;
          ctx.ui.popup(ctx, `灵力不足(需${BARRIER_COST},破坏场景获取)`, this.pos, 'bad');
        }
      } else {
        if (!this.barrier || this.barrier.target !== target) {
          this.barrier = {
            target, t: 0,
            need: target.weakened ? 1.0 : 1.4 + target.hpRatio() * 4.5,
          };
        }
        this.barrier.t += dt;
        this.charging = false;
        this.chargeT = 0;
        // 法阵视觉:双环旋转,进度越满越金
        const prog = this.barrier.t / this.barrier.need;
        this.barrierRing.visible = this.barrierRing2.visible = true;
        this.barrierRing.position.set(this.pos.x, 0.35, this.pos.z);
        this.barrierRing2.position.set(this.pos.x, 0.55, this.pos.z);
        this.barrierRing.rotation.z += dt * 1.2;
        this.barrierRing2.rotation.z -= dt * 2.0;
        this.barrierMat.color.setHex(prog > 0.99 ? 0xffd75e : (prog > 0.6 ? 0xa0e8a0 : 0x18e0c8));
        ctx.ui.captureRing(ctx, this.barrier.target.pos, prog);

        if (this.barrier.t >= this.barrier.need) {
          this.spirit -= BARRIER_COST;
          const t = this.barrier.target;
          this.cancelBarrier();
          t.capture(this);
        }
      }
    } else if (this.barrier) {
      this.cancelBarrier();
    }

    // ---- 蓄力 → 松开冲撞 ----
    if (this.stun > 0) { this.charging = false; this.chargeT = 0; }
    if (this.dashT <= 0 && this.stun <= 0) {
      if (input.primaryHeld) {
        this.charging = true;
        this.chargeT = Math.min(this.chargeT + dt, CHARGE_TIME);
      } else if (this.charging) {
        // 松开:释放冲撞
        const frac = this.chargeFrac();
        this.charging = false;
        this.chargeT = 0;
        if (input.aim) {
          this.dashDir.copy(input.aim).sub(this.pos).setY(0);
          if (this.dashDir.lengthSq() < 0.1) this.dashDir.set(0, 0, -1);
          this.dashDir.normalize();
        }
        this.dashDur = lerp(DASH_TIME_MIN, DASH_TIME_MAX, frac);
        this.dashT = this.dashDur;
        this.dashSpeed = lerp(DASH_SPEED_MIN, DASH_SPEED_MAX, frac);
        this.dashDmg = lerp(DMG_MIN, DMG_MAX, frac);
        addFlash(ctx, this.pos.clone().setY(1.0), 1.5 + frac * 2.5, 0x18e0c8);
        ctx.shake = Math.max(ctx.shake, frac * 0.35);
      }
    }
    const frac = this.chargeFrac();

    if (this.dashT > 0) {
      // ---- 冲撞中:身体就是炮弹 ----
      this.dashT -= dt;
      this.stun = Math.max(0, this.stun - dt);
      this.elecT = Math.max(0, this.elecT - dt);
      this.vel.copy(this.dashDir).multiplyScalar(this.dashSpeed);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.x = clamp(this.pos.x, -110, 110);
      this.pos.z = clamp(this.pos.z, -110, 110);

      const hitPos = this.pos.clone().addScaledVector(this.dashDir, 1.4);
      const src = { owner: this, chain: 0 };
      meleeHit(ctx, this, hitPos, 2.2, this.dashDmg, src);
      hitCreaturesAt(ctx, hitPos, 2.5, this.dashDmg * CREATURE_DMG_MULT, src, this);
      // 冲撞轨迹残光
      if (Math.random() < 0.5) {
        addFlash(ctx, this.pos.clone().setY(1.0), 1.2, 0x18e0c8);
      }
    } else {
      const slow = this.barrier ? 0.3 : (this.charging ? CHARGE_MOVE_MULT : 1);
      this.moveCommon(dt, input, SPEED * slow, 9);
    }
    this.collide();

    // ---- 掷电浆符(E 键)----
    if (input.tertiary && this.torchCd <= 0 && this.stun <= 0 && input.aim) {
      this.torchCd = TORCH_CD;
      const to = input.aim.clone().setY(0);
      const d = to.distanceTo(this.pos);
      if (d > TORCH_RANGE) to.sub(this.pos).setLength(TORCH_RANGE).add(this.pos);
      const mesh = new THREE.Mesh(this.torchGeo, this.torchMat);
      ctx.three.scene.add(mesh);
      this.torches.push({
        mesh, from: this.pos.clone().setY(1.4), to, t: 0,
        dur: 0.45 + to.distanceTo(this.pos) * 0.012,
      });
    }
    for (let i = this.torches.length - 1; i >= 0; i--) {
      const tc = this.torches[i];
      tc.t += dt;
      const k = Math.min(tc.t / tc.dur, 1);
      tc.mesh.position.lerpVectors(tc.from, tc.to, k);
      tc.mesh.position.y = tc.from.y + Math.sin(k * Math.PI) * 5 - k * 1.2;
      tc.mesh.rotation.x += dt * 12;
      if (k >= 1) {
        ctx.three.scene.remove(tc.mesh);
        this.torches.splice(i, 1);
        addFlash(ctx, tc.to.clone().setY(0.5), 3, 0x18e0c8);
        const src = { owner: this, chain: 0 };
        for (const p of nearbyProps(ctx, tc.to, 3.0)) {
          if (p.def.flammable) ignite(ctx, p, src);
          damageProp(ctx, p, 12, src);
        }
        hitCreaturesAt(ctx, tc.to, 3.0, 18, src, this);
      }
    }

    // ---- 朝向 / 姿态 / 蓄力表现 ----
    let face = this.facing;
    if (this.dashT > 0) face = Math.atan2(-this.dashDir.x, -this.dashDir.z);
    else if (input.aim) {
      const dx = input.aim.x - this.pos.x, dz = input.aim.z - this.pos.z;
      if (dx * dx + dz * dz > 1) face = Math.atan2(-dx, -dz);
    }
    this.facing = face;
    this.figure.rotation.y = damp(this.figure.rotation.y, face, 12, dt);
    this.figure.position.copy(this.pos);
    // 蓄力时身体前倾下压,冲撞时前倾
    const lean = this.dashT > 0 ? -0.35 : (this.charging ? -0.12 - frac * 0.18 : 0);
    this.figure.rotation.x = damp(this.figure.rotation.x, lean, 10, dt);
    this.figure.position.y = this.charging ? -frac * 0.15 : Math.abs(Math.sin(ctx.time * 8)) * 0.05 * Math.min(this.vel.length() / SPEED, 1);

    // 面甲/符印随蓄力增亮(泛光会放大这个效果)
    const elecFlash = this.elecT > 0 && Math.sin(ctx.time * 30) > 0;
    this.visorMat.emissiveIntensity = 1.2 + frac * 2.2 + (this.dashT > 0 ? 1.5 : 0);
    this.visorMat.emissive.setHex(elecFlash ? 0x4488ff : 0x18e0c8);
    this.sigilMat.emissiveIntensity = 0.8 + frac * 2.5;
    // 肩灯环绕
    for (const child of this.root.children) {
      if (child.userData.float) {
        const side = child.position.x > 0 ? 1 : -1;
        const ang = ctx.time * 2.2 * side + (side > 0 ? 0 : Math.PI);
        child.position.set(this.pos.x + Math.cos(ang) * 0.65, 1.7 + Math.sin(ctx.time * 3 + side) * 0.12, this.pos.z + Math.sin(ang) * 0.65);
      }
    }

    // 蓄力 UI 环
    ctx.ui.chargeRing(this.charging ? input : null, frac);
  }
}
