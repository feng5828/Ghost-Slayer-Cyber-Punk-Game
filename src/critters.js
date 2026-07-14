import * as THREE from 'three';
import { rand, damp } from './util.js';
import { spawnDebris } from './props.js';

// ============================================================================
// 孤魂小人:草原上逃窜的中立生物(致敬原作"孤魂"成就)
// 会被一切东西杀死(计分),可被守护者魅化成自爆仆从
// ============================================================================

const COUNT = 14;
const POINTS = 40;

export class Critters {
  constructor(ctx) {
    this.list = [];
    const geoBody = new THREE.SphereGeometry(0.3, 8, 6);
    const geoHead = new THREE.SphereGeometry(0.18, 8, 6);
    const matN = new THREE.MeshStandardMaterial({ color: 0xf2f2ea, roughness: 0.8 });

    for (let i = 0; i < COUNT; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(geoBody, matN);
      body.position.y = 0.35;
      const head = new THREE.Mesh(geoHead, matN);
      head.position.y = 0.75;
      body.castShadow = head.castShadow = true;
      g.add(body, head);
      const a = rand(Math.PI * 2), d = rand(20, 110);
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
      if (Math.hypot(c.pos.x, c.pos.z) > 140) c.dir += Math.PI;
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
    spawnDebris(ctx, c.pos.clone().setY(0.5), 0xf2f2ea, 2, src);
    if (src && src.owner && src.owner.alive) {
      ctx.score.award(ctx, src.owner, POINTS, src.chain, '孤魂', c.pos);
    }
  }

  // 守护者魅化用:找鼠标附近的小人
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
