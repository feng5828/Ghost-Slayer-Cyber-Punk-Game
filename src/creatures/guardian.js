import * as THREE from 'three';
import { Creature } from './base.js';
import { TOON } from '../toon.js';
import { explode, destroyProp } from '../damage.js';
import { propPos } from '../props.js';
import { damp } from '../util.js';

// ============================================================================
// 纸傀儡(操偶怨魂):原作"友善守护者"的怨灵转世,最阴险的操纵者
// 怨视附物(左键长按)让怨气附上器物成为傀儡环绕自己;摄魂令(右键)全员扑杀
// 不能直接破坏 —— 它的力量全部来自被怨气附身的东西(连村民也能摄魂)
// ============================================================================

const MAX_MINIONS = 4;
const CHARM_TIME = 0.7;
const CHARM_RANGE = 30;   // 距纸傀儡
const CURSOR_RANGE = 5;   // 距鼠标点
const MAX_HP = 120;

export class Guardian extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'guardian', cname: '纸傀儡', color: 0xefe8dc });
    this.hp = MAX_HP;
    this.minions = [];        // 魅化的道具
    this.charmTarget = null;
    this.charmProgress = 0;
    this.hoverY = 1.8;

    // 造型:惨白纸人 —— 扁平纸身 + 墨点眼 + 红腮 + 头顶红符
    const paperMat = TOON({ color: 0xefe8dc, roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), paperMat);
    body.scale.z = 0.35; // 压扁成纸片
    body.castShadow = true;
    this.bodyMesh = body;
    const inkMat = TOON({ color: 0x141414, roughness: 0.8 });
    for (const ex of [-0.2, 0.2]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), inkMat);
      eye.position.set(ex, 0.12, -0.52);
      eye.scale.z = 0.4;
      body.add(eye);
    }
    const cheekMat = TOON({ color: 0xc23434, roughness: 0.9 });
    for (const ex of [-0.32, 0.32]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), cheekMat);
      cheek.position.set(ex, -0.08, -0.5);
      cheek.scale.z = 0.3;
      body.add(cheek);
    }
    // 头顶红符(替代原作的天线星星)
    const star = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.5, 0.03),
      TOON({ color: 0xc22a1a, emissive: 0x661008, roughness: 0.6 })
    );
    star.position.y = 1.0;
    this.star = star;
    body.add(star);
    // 垂纸条手臂(顶端为支点,随风飘摆)
    this.arms = [];
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.14, 0.7, 0.04);
      g.translate(0, -0.35, 0);
      const arm = new THREE.Mesh(g, paperMat);
      arm.position.set(side * 0.52, 0.06, 0);
      arm.castShadow = true;
      body.add(arm);
      this.arms.push(arm);
    }
    this.root.add(body);

    // 怨视射线可视化(惨红怨气)
    this.ray = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.55, depthWrite: false })
    );
    this.ray.visible = false;
    ctx.three.scene.add(this.ray);
  }

  hpText() { return `纸身 ${Math.ceil(this.hp)} / 傀儡 ${this.minions.length}`; }
  hpRatio() { return this.hp / MAX_HP; }

  hittable() { return [{ pos: this.pos, r: 0.9 }]; }

  takeDamage(n, src) {
    if (!this.alive || this.weakened) return;
    this.hp -= n;
    if (this.hp <= 0) {
      this.hp = 0;
      this.enterWeakened();
    }
  }

  onWeakened() {
    this.releaseAll();
    this.ray.visible = false;
  }

  restoreFull() {
    this.hp = MAX_HP;
  }

  onDestroyedProp() {
    this.hp = Math.min(this.hp + 6, MAX_HP); // 破坏回复少量核心
  }

  releaseMinion(m) {
    m.state.charmedBy = null;
    m.state.desiredVel = null;
    m.state.missile = null;
  }

  releaseAll() {
    for (const m of this.minions) this.releaseMinion(m);
    this.minions.length = 0;
  }

  update(dt, input) {
    if (!this.alive) return;
    if (this.updateWeakened(dt)) return;
    const ctx = this.ctx;
    this.moveCommon(dt, input, 21, 8);
    this.collide();
    this.pos.y = 0;

    // 漂浮 + 星星旋转
    this.hoverY = 1.8 + Math.sin(ctx.time * 2.2) * 0.25;
    this.bodyMesh.position.set(this.pos.x, this.hoverY, this.pos.z);
    this.star.rotation.y += dt * 3;
    // 垂纸条手臂随风/移动飘摆
    for (let i = 0; i < this.arms.length; i++) {
      const side = i === 0 ? -1 : 1;
      this.arms[i].rotation.z = Math.sin(ctx.time * 2.2 + i) * 0.4 - this.vel.x * 0.02 * side;
      this.arms[i].rotation.x = Math.sin(ctx.time * 1.7 + i) * 0.25;
    }
    if (this.vel.lengthSq() > 1) {
      this.bodyMesh.rotation.y = damp(this.bodyMesh.rotation.y, Math.atan2(-this.vel.x, -this.vel.z), 6, dt);
    }
    const elec = this.elecT > 0;
    this.bodyMesh.material.emissive.setHex(elec ? 0x4488ff : 0x000000);

    // ---- 凝视魅化 ----
    this.ray.visible = false;
    if (input.primaryHeld && input.aim && this.stun <= 0) {
      const cand = this.findCharmCandidate(input.aim);
      // 没有器物目标时,试着摄魂鼠标附近的村民(变成自爆傀儡)
      if (!cand && (this._critterCd || 0) < ctx.time) {
        const cr = ctx.critters.charmNear(input.aim, this, 2.5);
        if (cr) {
          this._critterCd = ctx.time + 1.0;
          if (this.isPlayer) ctx.ui.popup(ctx, '摄魂了市民', cr.pos, 0);
        }
      }
      if (cand !== this.charmTarget) { this.charmTarget = cand; this.charmProgress = 0; }
      if (cand) {
        this.charmProgress += dt / CHARM_TIME;
        // 射线可视化
        const from = new THREE.Vector3(this.pos.x, this.hoverY, this.pos.z);
        const to = propPos(cand).setY(1.0);
        const mid = from.clone().lerp(to, 0.5);
        const len = from.distanceTo(to);
        this.ray.position.copy(mid);
        this.ray.scale.set(1, len, 1);
        this.ray.lookAt(to);
        this.ray.rotateX(Math.PI / 2);
        this.ray.visible = true;

        if (this.charmProgress >= 1) {
          this.charm(cand);
          this.charmTarget = null;
          this.charmProgress = 0;
        }
      }
      if (this.isPlayer) ctx.ui.charmRing(input, this.charmProgress);
    } else {
      this.charmTarget = null;
      this.charmProgress = 0;
      if (this.isPlayer) ctx.ui.charmRing(null, 0);
    }

    // ---- 指挥突击:所有仆从导弹化,冲向最近的敌方生物 ----
    if (input.secondary && this.minions.length > 0) {
      const enemy = this.nearestEnemy();
      if (enemy) {
        for (const m of this.minions) {
          m.state.missile = { target: enemy, t: 0 };
        }
        if (this.isPlayer) ctx.ui.popup(ctx, '摄魂令!', this.pos, 1);
      }
    }

    // ---- 仆从更新 ----
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const m = this.minions[i];
      if (m.dead) { this.minions.splice(i, 1); continue; }
      const mp = propPos(m);

      if (m.state.missile) {
        const ms = m.state.missile;
        ms.t += dt;
        const tgt = ms.target;
        if (!tgt.alive || ms.t > 3.0) {
          // 没打中:恢复环绕
          m.state.missile = null;
          continue;
        }
        const dir = tgt.pos.clone().setY(1.2).sub(mp);
        const dist = dir.length();
        dir.normalize();
        m.state.desiredVel = { x: dir.x * 34, y: dir.y * 34, z: dir.z * 34 };
        if (dist < 2.5) {
          // 命中:小爆炸,归因纸傀儡,连锁深度1(被操纵物=一层连锁)
          const at = mp.clone();
          this.minions.splice(i, 1);
          this.releaseMinion(m);
          explode(ctx, at, 4.5, 45 + m.body.mass() * 8, { owner: this, chain: 1 });
          // 仆从自身作为弹药被消耗(也给纸傀儡计分)
          destroyProp(ctx, m, { owner: this, chain: 1 });
        }
      } else {
        // 环绕轨道
        const ang = ctx.time * 1.6 + (i / Math.max(this.minions.length, 1)) * Math.PI * 2;
        const tx = this.pos.x + Math.cos(ang) * 3.6;
        const tz = this.pos.z + Math.sin(ang) * 3.6;
        const ty = 2.0 + Math.sin(ctx.time * 2 + i) * 0.4;
        m.state.desiredVel = { x: (tx - mp.x) * 5, y: (ty - mp.y) * 5, z: (tz - mp.z) * 5 };
      }
    }
  }

  findCharmCandidate(aim) {
    let best = null, bestD = CURSOR_RANGE * CURSOR_RANGE;
    for (const p of this.ctx.props) {
      if (p.dead || !p.def.charmable || p.state.charmedBy) continue;
      const pp = propPos(p);
      if (pp.distanceToSquared(this.pos) > CHARM_RANGE * CHARM_RANGE) continue;
      const d = (pp.x - aim.x) ** 2 + (pp.z - aim.z) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  charm(prop) {
    prop.state.charmedBy = this;
    this.minions.push(prop);
    if (this.minions.length > MAX_MINIONS) {
      const old = this.minions.shift();
      this.releaseMinion(old);
    }
    if (this.isPlayer) this.ctx.ui.popup(this.ctx, `怨气附上了${prop.def.name}`, propPos(prop), 0);
  }

  nearestEnemy() {
    // 猎杀模式:纸傀儡的敌人永远是猎人
    const p = this.ctx.player;
    if (p && p.alive && p !== this) return p;
    let best = null, bd = Infinity;
    for (const c of this.ctx.creatures) {
      if (c === this || !c.alive) continue;
      const d = c.pos.distanceToSquared(this.pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}
