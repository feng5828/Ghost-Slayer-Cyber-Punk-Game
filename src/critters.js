import * as THREE from 'three';
import { rand, damp } from './util.js';
import { spawnDebris } from './props.js';

// ============================================================================
// 市民:深夜街区里逃窜的中立生物(原作"孤魂"的转世)
// 猎鬼人误杀会扣分;纸傀儡会摄魂他们当自爆傀儡(拿市民当武器,恶毒)
// ============================================================================

const COUNT = 16;
const PENALTY = 100;

export class Critters {
  constructor(ctx) {
    this.list = [];
    const geoBody = new THREE.SphereGeometry(0.3, 8, 6);
    const geoHead = new THREE.SphereGeometry(0.18, 8, 6);
    const geoVisor = new THREE.BoxGeometry(0.24, 0.06, 0.08);
    const suitColors = [0x3a3f52, 0x4a3a52, 0x2e4448, 0x50423a];
    const visorColors = [0x00e5ff, 0xff2d95, 0x7cffb0, 0xffd75e];

    for (let i = 0; i < COUNT; i++) {
      const g = new THREE.Group();
      const matN = new THREE.MeshStandardMaterial({
        color: suitColors[i % suitColors.length], roughness: 0.7, metalness: 0.2,
      });
      const body = new THREE.Mesh(geoBody, matN);
      body.position.y = 0.35;
      const head = new THREE.Mesh(geoHead, matN);
      head.position.y = 0.75;
      const visor = new THREE.Mesh(geoVisor, new THREE.MeshStandardMaterial({
        color: 0x0a0a12, emissive: visorColors[i % visorColors.length], emissiveIntensity: 1.0,
      }));
      visor.position.set(0, 0.76, -0.14);
      body.castShadow = head.castShadow = true;
      g.add(body, head, visor);
      const a = rand(Math.PI * 2), d = rand(15, 92);
      g.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      ctx.three.scene.add(g);
      this.list.push({
        mesh: g, pos: g.position, alive: true,
        dir: rand(Math.PI * 2), speed: 3,
        wanderT: 0, charmedBy: null, panicT: 0,
      });
    }
  }

  update(ctx, dt) {
    for (const c of this.list) {
      if (!c.alive) continue;

      if (c.charmedBy && c.charmedBy.alive) {
        // 自爆仆从:冲向魅化者的最近敌人
        const enemy = c.charmedBy.nearestEnemy?.();
        if (enemy) {
          const dx = enemy.pos.x - c.pos.x, dz = enemy.pos.z - c.pos.z;
          const d = Math.hypot(dx, dz);
          c.dir = Math.atan2(dz, dx);
          c.speed = 7;
          if (d < 2.0) {
            // 自爆
            this.kill(ctx, c, null);
            enemy.takeDamage(22, { owner: c.charmedBy, chain: 1 });
            continue;
          }
        }
      } else {
        // 逃离最近的生物
        let nearest = null, nd = Infinity;
        for (const cr of ctx.creatures) {
          if (!cr.alive) continue;
          const d = cr.pos.distanceToSquared(c.pos);
          if (d < nd) { nd = d; nearest = cr; }
        }
        if (nearest && nd < 14 * 14) {
          c.dir = Math.atan2(c.pos.z - nearest.pos.z, c.pos.x - nearest.pos.x);
          c.panicT = 0.6;
        }
        c.panicT = Math.max(0, c.panicT - dt);
        c.speed = c.panicT > 0 ? 6.5 : 2.2;
        c.wanderT -= dt;
        if (c.wanderT <= 0 && c.panicT <= 0) {
          c.wanderT = rand(1, 3);
          c.dir += rand(-1.2, 1.2);
        }
      }

      c.pos.x += Math.cos(c.dir) * c.speed * dt;
      c.pos.z += Math.sin(c.dir) * c.speed * dt;
      if (ctx.village) ctx.village.resolveCircle(c.pos, 0.35);
      if (Math.hypot(c.pos.x, c.pos.z) > 100) c.dir += Math.PI;
      c.mesh.rotation.y = -c.dir + Math.PI / 2;
      // 惊慌时上下蹦
      c.mesh.position.y = c.panicT > 0 || c.charmedBy ? Math.abs(Math.sin(ctx.time * 14)) * 0.25 : 0;
    }
  }

  // 范围杀伤入口(火/爆炸/近战共用)
  hitAt(ctx, pos, radius, src) {
    const r2 = radius * radius;
    for (const c of this.list) {
      if (!c.alive) continue;
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
      if (dx * dx + dz * dz < r2) this.kill(ctx, c, src);
    }
  }

  kill(ctx, c, src) {
    if (!c.alive) return;
    c.alive = false;
    c.mesh.visible = false;
    spawnDebris(ctx, c.pos.clone().setY(0.5), 0x8a8fa2, 2, src);
    // 猎鬼人误杀市民:扣分(纵火连营时要小心市民!)
    if (src && src.owner && src.owner.isPlayer && src.owner.alive) {
      ctx.score.penalty(ctx, src.owner, PENALTY, '误杀市民', c.pos);
    }
  }

  // 纸傀儡魅化用:找鼠标附近的小人
  charmNear(aim, guardian, range = 3) {
    for (const c of this.list) {
      if (!c.alive || c.charmedBy) continue;
      if (Math.hypot(c.pos.x - aim.x, c.pos.z - aim.z) < range) {
        c.charmedBy = guardian;
        return c;
      }
    }
    return null;
  }
}
