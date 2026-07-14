import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld3D } from './world3d.js';
import { Input } from './input.js';
import { buildArena, updateProps } from './props.js';
import { updateFx } from './damage.js';
import { updateFire } from './fire.js';
import { ScoreSystem } from './score.js';
import { EventsSystem } from './events.js';
import { Critters } from './critters.js';
import { AIController } from './ai.js';
import { UI } from './ui.js';
import { Dragon } from './creatures/dragon.js';
import { Spheres } from './creatures/spheres.js';
import { Guardian } from './creatures/guardian.js';
import { damp, clamp } from './util.js';

const KINDS = { dragon: Dragon, spheres: Spheres, guardian: Guardian };

async function boot() {
  await RAPIER.init();
  const ui = new UI();
  const saved = sessionStorage.getItem('gm_config');
  if (saved) {
    sessionStorage.removeItem('gm_config');
    startMatch(ui, JSON.parse(saved));
  } else {
    ui.showMenu((config) => startMatch(ui, config));
  }
}

function startMatch(ui, config) {
  const three = createWorld3D();

  // 物理世界(重力偏大,手感更脆)
  const world = new RAPIER.World({ x: 0, y: -19.6, z: 0 });
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(170, 0.5, 170).setFriction(0.8), groundBody);

  // 共享上下文(致敬原作的 G 表)
  const ctx = {
    three,
    phys: { RAPIER, world },
    props: [], debris: [], creatures: [], fx: [],
    critters: null,
    score: new ScoreSystem(),
    ui,
    mode: config.mode,
    matchDuration: config.mode === 'score' ? 180 : 300,
    time: 0, matchTime: 0,
    zone: { active: false, radius: 999 },
    rain: { active: false, slippery: false },
    shake: 0,
    camTarget: new THREE.Vector3(0, 0, 50),
    over: false,
  };

  buildArena(ctx);
  ctx.critters = new Critters(ctx);
  ctx.events = new EventsSystem(ctx);

  // 生物:玩家一只 + 另外两种各一只 AI
  const spawnAngles = [Math.PI / 2, Math.PI / 2 + (Math.PI * 2) / 3, Math.PI / 2 + (Math.PI * 4) / 3];
  const otherKinds = Object.keys(KINDS).filter((k) => k !== config.kind);
  const specs = [
    { kind: config.kind, isPlayer: true },
    { kind: otherKinds[0], isPlayer: false },
    { kind: otherKinds[1], isPlayer: false },
  ];
  const ais = [];
  specs.forEach((s, i) => {
    const x = Math.cos(spawnAngles[i]) * 52;
    const z = Math.sin(spawnAngles[i]) * 52;
    const c = new KINDS[s.kind](ctx, { x, z, isPlayer: s.isPlayer });
    ctx.creatures.push(c);
    if (s.isPlayer) ctx.player = c;
    else ais.push(new AIController(ctx, c));
  });
  ctx.camTarget.copy(ctx.player.pos);

  const input = new Input(three.camera);
  ui.startHud(ctx);
  ui.banner(config.mode === 'score' ? '3分钟 —— 拆得越狠,分越高!' : '毁掉其余两只生物!');

  // ---- 主循环 ----
  let last = performance.now();
  let brawlGrace = 0;

  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    ctx.time += dt;

    if (!ctx.over) {
      ctx.matchTime += dt;

      // 输入
      const pin = input.sample();
      pin.mouseX = input.mouseX;
      pin.mouseY = input.mouseY;
      if (ctx.player.alive) ctx.player.update(dt, pin);
      for (const ai of ais) {
        if (ai.c.alive) ai.c.update(dt, ai.update(dt));
      }

      ctx.critters.update(ctx, dt);
      updateFire(ctx, dt);
      ctx.events.update(ctx, dt);

      world.timestep = dt;
      world.step();
      updateProps(ctx, dt);
      updateFx(ctx, dt);
      ui.updateHud(ctx);

      // ---- 结束判定 ----
      const aliveCount = ctx.creatures.filter((c) => c.alive).length;
      if (ctx.mode === 'score' && ctx.matchTime >= ctx.matchDuration) endMatch();
      if (ctx.mode === 'brawl') {
        if (aliveCount <= 1) {
          brawlGrace += dt;
          if (brawlGrace > 2.0) endMatch();
        }
        if (ctx.matchTime >= ctx.matchDuration) endMatch();
      }
    } else {
      updateFx(ctx, dt);
    }

    // ---- 相机:跟随玩家(死了就观战最高分)----
    let focus = ctx.player.alive ? ctx.player.pos
      : (ctx.creatures.filter((c) => c.alive).sort((a, b) => b.score - a.score)[0]?.pos || ctx.player.pos);
    ctx.camTarget.x = damp(ctx.camTarget.x, focus.x, 5, dt);
    ctx.camTarget.z = damp(ctx.camTarget.z, focus.z, 5, dt);
    ctx.shake = Math.max(0, ctx.shake - dt * 2.2);
    const sh = ctx.shake * 0.6;
    three.camera.position.set(
      ctx.camTarget.x + (Math.random() - 0.5) * sh,
      26 + (Math.random() - 0.5) * sh,
      ctx.camTarget.z + 18 + (Math.random() - 0.5) * sh
    );
    three.camera.lookAt(ctx.camTarget.x, 0, ctx.camTarget.z);

    three.renderer.render(three.scene, three.camera);
    requestAnimationFrame(frame);
  }

  function endMatch() {
    if (ctx.over) return;
    ctx.over = true;
    ui.showEnd(ctx, config);
  }

  requestAnimationFrame(frame);
}

boot();
