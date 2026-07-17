import * as THREE from 'three';
import { Creature } from './base.js';
import { TOON } from '../toon.js';
import { nearbyProps } from '../damage.js';
import { propPos } from '../props.js';

// ============================================================================
// 雷鬼:工业机房区常驻鬼
// - 靠近电灯柱/电罐会吸电充能:回血、提速、攻击更猛
// - 视觉上带着电弧和能环,必须一眼能认出来
// - 猎鬼人先撞断电源点可削它主场优势
// ============================================================================

const MAX_HP = 120;
const BASE_SPEED = 14;

export class ThunderGhost extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'thunder', cname: '雷鬼', color: 0xb8d8ff });
    this.hp = MAX_HP;
    this.charge = 0;
    this.colRadius = 0.75;
    this.mat = TOON({ color: 0x24304a, emissive: 0x7ab8ff, emissiveIntensity: 1.0 });
    this.body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.82, 1), this.mat);
    this.body.position.y = 1.25; this.body.castShadow = true;
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.88 }));
    this.halo.position.y = 1.25;
    this.halo2 = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.03, 8, 40), new THREE.MeshBasicMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.44 }));
    this.halo2.position.y = 1.25;
    this.arcs = [];
    for (let i = 0; i < 6; i++) {
      const arc = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), new THREE.MeshBasicMaterial({ color: 0xaee6ff, transparent: true, opacity: 0.75 }));
      this.root.add(arc);
      this.arcs.push(arc);
    }
    // 晶体尖刺(核心向外辐射,充能时伸长)
    this.spikes = [];
    const spDirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let i = 0; i < spDirs.length; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 5), new THREE.MeshBasicMaterial({ color: 0xaee6ff, transparent: true, opacity: 0.85 }));
      const [dx, dy, dz] = spDirs[i];
      sp.position.set(dx * 0.7, dy * 0.7, dz * 0.7);
      sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz));
      this.body.add(sp);
      this.spikes.push(sp);
    }
    this.root.add(this.body, this.halo, this.halo2);
  }
  hpText() { return `电荷 ${Math.ceil(this.hp)} / ${Math.round(this.charge)}`; }
  hpRatio() { return this.hp / MAX_HP; }
  hittable() { return [{ pos: this.pos, r: 1.0 }]; }
  restoreFull() { this.hp = MAX_HP; this.charge = 0; }
  takeDamage(n, src) {
    if (!this.alive || this.weakened) return;
    this.hp -= n * (this.charge > 40 ? 0.75 : 1.0);
    if (this.hp <= 0) { this.hp = 0; this.enterWeakened(); }
  }
  update(dt, input) {
    if (!this.alive) return;
    if (this.updateWeakened(dt)) return;

    let powered = 0;
    for (const p of nearbyProps(this.ctx, this.pos, 10)) {
      if ((p.type === 'pole' || p.type === 'tank') && p.def.powered && !p.dead) {
        powered++;
        const pp = propPos(p);
        if (pp.distanceTo(this.pos) > 2) {
          this.vel.x += (pp.x - this.pos.x) * 0.08 * dt;
          this.vel.z += (pp.z - this.pos.z) * 0.08 * dt;
        }
      }
    }
    if (powered > 0) {
      this.charge = Math.min(100, this.charge + powered * 18 * dt);
      this.hp = Math.min(MAX_HP, this.hp + powered * 4 * dt);
    } else {
      this.charge = Math.max(0, this.charge - 12 * dt);
    }
    const speed = BASE_SPEED + this.charge * 0.07;
    this.moveCommon(dt, input, speed, 7);
    this.collide();

    this.root.position.copy(this.pos);
    this.body.rotation.x += dt * (2 + this.charge * 0.05);
    this.body.rotation.y += dt * (3 + this.charge * 0.06);
    this.body.position.y = 1.2 + Math.sin(this.ctx.time * 9) * 0.12;
    this.halo.rotation.x += dt * 2.3;
    this.halo.rotation.z += dt * 1.8;
    this.halo2.rotation.y -= dt * 1.7;
    this.halo2.rotation.x += dt * 1.1;
    this.mat.emissiveIntensity = 0.85 + this.charge / 55 + Math.sin(this.ctx.time * 24) * 0.25;
    // 晶体尖刺随充能伸长、微颤
    const spLen = 0.8 + this.charge * 0.012;
    for (let i = 0; i < this.spikes.length; i++) {
      this.spikes[i].scale.set(1, spLen + Math.sin(this.ctx.time * 20 + i) * 0.1, 1);
    }
    for (let i = 0; i < this.arcs.length; i++) {
      const arc = this.arcs[i];
      const a = this.ctx.time * (6 + i) + i * 1.4;
      arc.position.set(Math.cos(a) * (0.9 + i * 0.12), 1.2 + Math.sin(a * 2.1) * 0.5, Math.sin(a) * (0.9 + i * 0.12));
      arc.rotation.set(Math.sin(a) * 0.9, a, Math.cos(a * 1.3) * 0.9);
      arc.scale.y = 0.8 + this.charge * 0.012 + Math.abs(Math.sin(a * 2.2)) * 0.8;
      arc.material.opacity = 0.45 + this.charge * 0.003 + Math.abs(Math.sin(a * 3)) * 0.2;
    }

    const player = this.ctx.player;
    if (player?.alive && this.pos.distanceTo(player.pos) < 2.1) {
      player.electrify(0.3, { owner: this, chain: 0 });
      player.takeDamage((10 + this.charge * 0.16) * dt, { owner: this, chain: 0 });
    }
  }
}
