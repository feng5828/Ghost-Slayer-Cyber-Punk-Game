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
const DASH_SPEED_MIN = 22;
const DASH_SPEED_MAX = 44;
const DASH_TIME_MIN = 0.18;
const DASH_TIME_MAX = 0.33;      // 冲刺距离收短:满蓄约 14.5,轻点约 4(原来最远约 31)
const DMG_MIN = 35;             // 轻点冲撞
const DMG_MAX = 230;            // 满蓄力(伤害不变,只是冲得更近)
const CREATURE_DMG_MULT = 0.6;  // 对恶鬼的冲撞倍率
const TORCH_CD = 4.0;
const TORCH_RANGE = 22;
const REGEN_DELAY = 5.0;
const REGEN_RATE = 5;
// 结界收服(Q 键施放,置放式场域)
const CAST_RANGE = 8;         // 多远内的鬼会被结界锁定为圆心
const FIELD_R = 5.5;          // 场域半径:目标跑出即挣脱
const BARRIER_COST = 30;      // 施放消耗灵力(空放也消耗)
const FIELD_CD = 0.7;         // 施放间隔
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
    this.field = null;     // 结界场域 {group, target, t, need, fading}
    this.fieldCd = 0;

    // ---- 程序化人形骨架:瘦高义体猎人(关节 Group 便于步态动画)----
    this.gaitPhase = 0;
    const suit = TOON({ color: 0x1a1f30, roughness: 0.45 });      // 义体主色
    const suitDark = TOON({ color: 0x0e111c, roughness: 0.5 });    // 深部件
    const accent = TOON({ color: 0x2a3a52, roughness: 0.4 });      // 关节/护甲
    this.visorMat = TOON({ color: 0x061014, emissive: 0x18e0c8, emissiveIntensity: 1.2, roughness: 0.3 });
    this.sigilMat = TOON({ color: 0x1a0806, emissive: 0xff3a2a, emissiveIntensity: 0.8, roughness: 0.5 });
    const seg = (w, h, d, mat, py, mesh = 'box') => {
      const g = mesh === 'cyl' ? new THREE.CylinderGeometry(w, d, h, 8) : new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, mat); m.position.y = py; m.castShadow = true; return m;
    };
    const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

    this.figure = new THREE.Group();
    // 髋(骨盆)
    this.hips = joint(this.figure, 0, 0.98, 0);
    this.hips.add(seg(0.42, 0.26, 0.26, suitDark, 0));
    // 躯干(可绕腰前倾/呼吸)
    this.chest = joint(this.hips, 0, 0.1, 0);
    this.chest.add(seg(0.34, 0.66, 0.3, suit, 0.35, 'cyl')); // 锥形胸腔(上窄下宽)
    const plate = seg(0.44, 0.34, 0.24, accent, 0.42); this.chest.add(plate); // 胸甲
    const sigil = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.05), this.sigilMat);
    sigil.position.set(0, 0.44, 0.17); this.chest.add(sigil); // 背后符
    // 颈 + 头
    this.chest.add(seg(0.12, 0.14, 0.12, suitDark, 0.74));
    this.head = joint(this.chest, 0, 0.9, 0);
    this.head.add(seg(0.34, 0.36, 0.34, suit, 0)); // 头盔(略方)
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.1), this.visorMat);
    visor.position.set(0, 0.02, -0.17); this.head.add(visor);
    const crest = seg(0.06, 0.22, 0.18, accent, 0.2); this.head.add(crest); // 头顶脊
    // 四肢
    this.armL = this._buildArm(1, suit, accent);
    this.armR = this._buildArm(-1, suit, accent);
    this.legL = this._buildLeg(1, suit, suitDark);
    this.legR = this._buildLeg(-1, suit, suitDark);
    this.root.add(this.figure);

    // 电浆符预制:燃着青焰的符纸
    this.torchGeo = new THREE.BoxGeometry(0.3, 0.02, 0.48);
    this.torchMat = TOON({
      color: 0x10141c, emissive: 0x18e0c8, emissiveIntensity: 1.1,
    });

    // 结界场域:常驻复用的装置(每次施放只重置状态,零分配零销毁,避免卡顿)
    this.fieldRingMat = new THREE.MeshBasicMaterial({
      color: 0x2ee8ff, transparent: true, opacity: 0.9, depthWrite: false,
    });
    this.fieldWallMat = new THREE.MeshBasicMaterial({
      color: 0x2ee8ff, transparent: true, opacity: 0.16, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const ringGeo = new THREE.TorusGeometry(1, 0.028, 8, 56);
    const ringLow = new THREE.Mesh(ringGeo, this.fieldRingMat);
    ringLow.rotation.x = Math.PI / 2; ringLow.position.y = 0.25;
    const ringHigh = new THREE.Mesh(ringGeo, this.fieldRingMat);
    ringHigh.rotation.x = Math.PI / 2; ringHigh.position.y = 2.9;
    ringHigh.scale.setScalar(0.85);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 3, 40, 1, true), this.fieldWallMat
    );
    wall.position.y = 1.5;
    this.fieldGroup = new THREE.Group();
    this.fieldGroup.add(ringLow, ringHigh, wall);
    this.fieldGroup.visible = false;
    this.root.add(this.fieldGroup);
  }

  _buildArm(side, suit, accent) {
    const mk = (w, h, d, mat, py) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.y = py; m.castShadow = true; return m; };
    const sh = new THREE.Group(); sh.position.set(side * 0.3, 0.62, 0); this.chest.add(sh);
    sh.add(mk(0.14, 0.36, 0.14, suit, -0.18));            // 上臂
    const elbow = new THREE.Group(); elbow.position.set(0, -0.36, 0); sh.add(elbow);
    elbow.add(mk(0.12, 0.34, 0.12, accent, -0.17));       // 前臂
    elbow.add(mk(0.15, 0.16, 0.18, suit, -0.4));          // 手/护腕
    const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), TOON({ color: 0x0a0a12, emissive: 0xffd75e, emissiveIntensity: 1.0 }));
    lamp.position.set(side * 0.14, 0.08, 0.02); sh.add(lamp); // 肩灯
    return { sh, elbow };
  }

  _buildLeg(side, suit, dark) {
    const mk = (w, h, d, mat, py) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.y = py; m.castShadow = true; return m; };
    const hip = new THREE.Group(); hip.position.set(side * 0.14, -0.02, 0); this.hips.add(hip);
    hip.add(mk(0.17, 0.46, 0.17, suit, -0.23));           // 大腿
    const knee = new THREE.Group(); knee.position.set(0, -0.46, 0); hip.add(knee);
    knee.add(mk(0.14, 0.44, 0.14, dark, -0.22));          // 小腿
    const foot = mk(0.17, 0.1, 0.32, suit, -0.44); foot.position.z = -0.07; knee.add(foot); // 脚
    return { hip, knee };
  }

  // 状态驱动的人形动画:待机呼吸 / 行走摆腿摆臂 / 蓄力屈膝后拉 / 冲刺突刺
  animate(dt, frac) {
    const ctx = this.ctx;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const sn = clamp(speed / SPEED, 0, 1);
    const dashing = this.dashT > 0, charging = this.charging && !dashing;
    this.gaitPhase += speed * dt * 0.95;
    const gp = this.gaitPhase;
    const R = (o, t, r = 14) => { o.rotation.x = damp(o.rotation.x, t, r, dt); };

    const lean = dashing ? -0.5 : (charging ? -0.22 - frac * 0.22 : 0.05 + sn * 0.13);
    R(this.chest, lean, 12);
    this.head.rotation.x = damp(this.head.rotation.x, -lean * 0.5, 12, dt); // 头略回正保持视线
    const bob = charging ? -0.14 * frac : (dashing ? -0.05 : Math.abs(Math.sin(gp * 2)) * 0.05 * sn);
    this.hips.position.y = damp(this.hips.position.y, 0.98 + bob, 12, dt);

    let hipL, hipR, kneeL, kneeR, shL, shR, elL, elR;
    if (dashing) {
      hipL = 0.9; hipR = -0.75; kneeL = -0.35; kneeR = 0.7; shL = -2.2; shR = -2.2; elL = 0.4; elR = 0.4;
    } else if (charging) {
      hipL = hipR = 0.55; kneeL = kneeR = -1.0; shL = shR = -1.7 - frac * 0.5; elL = elR = 0.7;
    } else {
      const amp = sn * 0.85;
      const lp = Math.sin(gp), lpO = Math.sin(gp + Math.PI);
      hipL = lp * amp; hipR = lpO * amp;
      kneeL = -Math.max(0, -lp) * amp * 1.3 - 0.05;
      kneeR = -Math.max(0, -lpO) * amp * 1.3 - 0.05;
      const aAmp = 0.4 * sn, sway = Math.sin(ctx.time * 1.6) * 0.05 * (1 - sn);
      shL = lpO * aAmp + sway; shR = lp * aAmp - sway;
      elL = 0.22 + Math.max(0, lpO) * 0.35; elR = 0.22 + Math.max(0, lp) * 0.35;
    }
    R(this.legL.hip, hipL); R(this.legR.hip, hipR);
    R(this.legL.knee, kneeL); R(this.legR.knee, kneeR);
    R(this.armL.sh, shL); R(this.armR.sh, shR);
    R(this.armL.elbow, elL); R(this.armR.elbow, elR);
  }

  // 收服概率最高 = 虚弱优先,其次血量最少
  findBarrierTarget() {
    let best = null, bestScore = -1;
    for (const c of this.ctx.creatures) {
      if (c === this || !c.alive) continue;
      if (c.pos.distanceTo(this.pos) > CAST_RANGE) continue;
      const s = c.weakened ? 10 : 1 - c.hpRatio();
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  // ---- 施放结界:近鬼锁鬼为圆心,无鬼在自己脚下空放(纯视觉) ----
  castField() {
    const target = this.findBarrierTarget();
    const center = (target ? target.pos : this.pos).clone().setY(0);
    this.fieldGroup.position.copy(center);
    this.fieldGroup.scale.set(0.01, 1, 0.01);
    this.fieldGroup.visible = true;
    this.fieldRingMat.color.setHex(0x2ee8ff);
    this.fieldRingMat.opacity = 0.9;
    this.fieldWallMat.color.setHex(0x2ee8ff);
    this.field = {
      center, target,
      t: 0,
      need: target ? (target.weakened ? 1.0 : 1.4 + target.hpRatio() * 4.5) : 0.9,
      fading: 0,
    };
  }

  dismissField(instant = false) {
    const f = this.field;
    if (!f) return;
    this.ctx.ui.captureRing(null);
    if (instant) {
      this.fieldGroup.visible = false;
      this.field = null;
    } else {
      f.fading = 0.35;
      f.target = null;
    }
  }

  updateField(dt) {
    const f = this.field;
    if (!f) return;
    const ctx = this.ctx;
    f.t += dt;

    // 展开动画:缓出弹开
    const grow = Math.min(f.t * 3.2, 1);
    const s = FIELD_R * (1 - Math.pow(1 - grow, 3));
    this.fieldGroup.scale.set(Math.max(s, 0.01), 1, Math.max(s, 0.01));
    this.fieldGroup.rotation.y += dt * 1.4;
    this.fieldWallMat.opacity = (0.13 + Math.sin(ctx.time * 9) * 0.05) * (f.fading > 0 ? f.fading / 0.35 : 1);

    // 淡出中
    if (f.fading > 0) {
      f.fading -= dt;
      this.fieldRingMat.opacity = 0.9 * Math.max(f.fading / 0.35, 0);
      if (f.fading <= 0) this.dismissField(true);
      return;
    }

    if (f.target) {
      const tg = f.target;
      if (!tg.alive) return this.dismissField();
      // 目标跑出场域 → 挣脱
      if (tg.pos.distanceTo(f.center) > FIELD_R + 0.6) {
        ctx.ui.popup(ctx, `${tg.cname} 挣脱了结界!`, tg.pos, 'bad');
        return this.dismissField();
      }
      const prog = f.t / f.need;
      ctx.ui.captureRing(ctx, tg.pos, prog);
      // 快收满时法阵转金
      const gold = prog > 0.75;
      this.fieldRingMat.color.setHex(gold ? 0xffd75e : 0x2ee8ff);
      this.fieldWallMat.color.setHex(gold ? 0xffd75e : 0x2ee8ff);
      if (f.t >= f.need) {
        const t = f.target;
        this.dismissField(true);
        t.capture(this);
      }
    } else if (f.t >= f.need) {
      // 空放:视觉展示完毕即散
      this.dismissField();
    }
  }

  hpText() { return `生命 ${Math.ceil(this.hp)}`; }
  hpRatio() { return this.hp / MAX_HP; }
  hittable() { return [{ pos: this.pos, r: 0.9 }]; }

  takeDamage(n, src) {
    if (!this.alive) return;
    this.hp -= n;
    this.lastHurtAt = this.ctx.time;
    this.ctx.ui.hurtFlash();
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

    // ---- 结界收服(Q 键施放置放式场域)----
    this.fieldCd -= dt;
    if (input.barrier && this.stun <= 0 && this.fieldCd <= 0) {
      if (this.spirit < BARRIER_COST) {
        if ((this._spiritWarnCd || 0) < ctx.time) {
          this._spiritWarnCd = ctx.time + 1.5;
          ctx.ui.popup(ctx, `灵力不足(需${BARRIER_COST},破坏场景获取)`, this.pos, 'bad');
        }
      } else {
        this.spirit -= BARRIER_COST;
        this.fieldCd = FIELD_CD;
        this.castField();
      }
    }
    this.updateField(dt);

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
      // 湿滑地形(河道/血雨)冲刺略沉、末段更滑
      const terr = ctx.village?.terrainAt(this.pos);
      const dashSlip = (terr?.slippery || ctx.rain.slippery) ? 0.88 : 1;
      this.vel.copy(this.dashDir).multiplyScalar(this.dashSpeed * dashSlip);
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
      const slow = this.charging ? CHARGE_MOVE_MULT : 1;
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
        const src = { owner: this, chain: 0, fire: true, forceAshore: true };
        for (const p of nearbyProps(ctx, tc.to, 3.0)) {
          if (p.def.flammable) ignite(ctx, p, src);
          damageProp(ctx, p, 12, src);
        }
        hitCreaturesAt(ctx, tc.to, 3.0, 18, src, this);
      }
    }

    // ---- 朝向 ----
    let face = this.facing;
    if (this.dashT > 0) face = Math.atan2(-this.dashDir.x, -this.dashDir.z);
    else if (input.aim) {
      const dx = input.aim.x - this.pos.x, dz = input.aim.z - this.pos.z;
      if (dx * dx + dz * dz > 1) face = Math.atan2(-dx, -dz);
    }
    this.facing = face;
    this.figure.rotation.y = damp(this.figure.rotation.y, face, 12, dt);
    // 走上拱桥:按桥面剖面抬升(平面移动引擎下,让玩家真的"踏上桥面")
    const bridgeY = ctx.village?.bridgeHeightAt(this.pos.x, this.pos.z) || 0;
    this.figure.position.set(this.pos.x, bridgeY, this.pos.z);

    // ---- 人形步态动画 ----
    this.animate(dt, frac);

    // 面甲/符印随蓄力增亮(泛光会放大这个效果)
    const elecFlash = this.elecT > 0 && Math.sin(ctx.time * 30) > 0;
    this.visorMat.emissiveIntensity = 1.2 + frac * 2.2 + (this.dashT > 0 ? 1.5 : 0);
    this.visorMat.emissive.setHex(elecFlash ? 0x4488ff : 0x18e0c8);
    this.sigilMat.emissiveIntensity = 0.8 + frac * 2.5;

    // 蓄力 UI 环
    ctx.ui.chargeRing(this.charging ? input : null, frac);
  }
}
