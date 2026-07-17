import * as THREE from 'three';
import { propPos } from './props.js';
import { damageProp, nearbyProps, hitCreaturesAt } from './damage.js';
import { rand } from './util.js';

// ============================================================================
// 火焰系统:点燃 → 持续伤害 → 向邻近可燃物蔓延(连锁深度+1)
// 血雨会浇灭一切火并禁止点燃
// ============================================================================

let flameTex = null;
function getFlameTex() {
  if (flameTex) return flameTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 40, 4, 32, 36, 30);
  grad.addColorStop(0, 'rgba(255,240,160,1)');
  grad.addColorStop(0.4, 'rgba(255,140,40,0.9)');
  grad.addColorStop(1, 'rgba(255,60,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  flameTex = new THREE.CanvasTexture(cv);
  return flameTex;
}

// 火焰精灵(火盆常燃焰等场景也会用)
export function createFlameSprite(scale = 2) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getFlameTex(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xffffff,
  }));
  sprite.scale.set(scale, scale * 1.3, 1);
  sprite.userData.base = scale;
  return sprite;
}

export function ignite(ctx, prop, src) {
  if (prop.dead || !prop.def.flammable || prop.state.burning) return;
  if (ctx.rain.active) return; // 血雨中点不着火
  prop.state.burning = { owner: src.owner, chain: src.chain, spreadCd: 0.6 };

  const sprite = createFlameSprite(prop.type === 'balloon' ? 9 : rand(1.6, 2.4));
  ctx.three.scene.add(sprite);
  prop.state.flameSprite = sprite;
}

export function douse(ctx, prop) {
  if (!prop.state.burning) return;
  prop.state.burning = null;
  if (prop.state.flameSprite) {
    ctx.three.scene.remove(prop.state.flameSprite);
    prop.state.flameSprite = null;
  }
}

export function updateFire(ctx, dt) {
  for (const p of ctx.props) {
    const b = p.state.burning;
    if (!b || p.dead) continue;
    if (ctx.rain.active) { douse(ctx, p); continue; }

    // 火焰自伤(归因给点火者)
    damageProp(ctx, p, (p.type === 'balloon' ? 20 : 10) * dt, { owner: b.owner, chain: b.chain });
    if (p.dead) continue;

    // 蔓延
    b.spreadCd -= dt;
    if (b.spreadCd <= 0) {
      b.spreadCd = 0.55;
      const pos = propPos(p);
      for (const q of nearbyProps(ctx, pos, 4.2)) {
        if (q !== p && q.def.flammable && !q.state.burning) {
          ignite(ctx, q, { owner: b.owner, chain: b.chain + 1 });
        }
      }
      // 烧到村民和生物(火把把躲藏的生物逼出来的关键)
      ctx.critters.hitAt(ctx, pos, 2.2, { owner: b.owner, chain: b.chain + 1 });
      hitCreaturesAt(ctx, pos, 2.6, 10, { owner: b.owner, chain: b.chain + 1, fire: true, forceAshore: true }, null);
    }

    // 火焰贴着道具跳动
    const s = p.state.flameSprite;
    if (s) {
      const pos = propPos(p);
      s.position.set(pos.x, pos.y + (p.type === 'balloon' ? 9.5 : 1.0), pos.z);
      const k = s.userData.base * (1 + Math.sin(ctx.time * 17 + p.id) * 0.15);
      s.scale.set(k, k * 1.3, 1);
    }
  }
}
