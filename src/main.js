import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld3D } from './world3d.js';
import { Input } from './input.js';
import { updateProps } from './props.js';
import { updateFx } from './damage.js';
import { updateFire } from './fire.js';
import { ScoreSystem } from './score.js';
import { EventsSystem } from './events.js';
import { Critters } from './critters.js';
import { HiderAI } from './ai.js';
import { UI } from './ui.js';
import { Village } from './village.js';
import { Signals } from './signals.js';
import { Hunter } from './creatures/hunter.js';
import { Dragon } from './creatures/dragon.js';
import { Spheres } from './creatures/spheres.js';
import { Guardian } from './creatures/guardian.js';
import { damp, clamp, pick } from './util.js';

const HIDER_KINDS = { dragon: Dragon, spheres: Spheres, guardian: Guardian };
const RESPAWN_DELAY = 4.0;

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

  const world = new RAPIER.World({ x: 0, y: -19.6, z: 0 });
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(170, 0.5, 170).setFriction(0.8), groundBody);

  // 共享上下文(致敬原作的 G 表)
  const ctx = {
    three,
    phys: { RAPIER, world },
    props: [], debris: [], creatures: [], fx: [],
    critters: null,
    village: null,
    score: new ScoreSystem(),
    ui,
    mode: 'hunt',
    matchDuration: 180,
    time: 0, matchTime: 0,
    bloodMoon: false,
    zone: { active: false, radius: 999 },
    rain: { active: false, slippery: false },
    shake: 0,
    camTarget: new THREE.Vector3(0, 0, 0),
    over: false,
  };

  window.GM = ctx; // 调试句柄
  new Village(ctx);
  ctx.critters = new Critters(ctx);
  ctx.events = new EventsSystem(ctx);
  ctx.signals = new Signals(ctx);

  // 猎人出生在村庄广场
  const cc = ctx.village.cellCenter(4, 4);
  const hunter = new Hunter(ctx, { x: cc.x, z: cc.z + 6, isPlayer: true });
  ctx.player = hunter;
  ctx.creatures.push(hunter);
  ctx.camTarget.set(hunter.pos.x, 0, hunter.pos.z);

  // 三只躲藏生物,各刷在远处
  const ais = [];
  function spawnHider(kind) {
    const at = ctx.village.farCell(ctx.player.pos.x, ctx.player.pos.z, 4);
    const c = new HIDER_KINDS[kind](ctx, { x: at.x, z: at.z, isPlayer: false });
    ctx.creatures.push(c);
    ais.push(new HiderAI(ctx, c));
    return c;
  }
  for (const k of ['dragon', 'spheres', 'guardian']) spawnHider(k);

  const respawnQueue = []; // {at, kind}

  const input = new Input(three.camera);
  ui.startHud(ctx);
  ui.banner('读懂场景的信号,找出躲藏的生物');

  // ---- 主循环 ----
  let last = performance.now();

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
      if (hunter.alive) hunter.update(dt, pin);
      for (let i = ais.length - 1; i >= 0; i--) {
        const ai = ais[i];
        if (!ai.c.alive) {
          // 死亡 → 排队重生一只新的(随机种类)
          respawnQueue.push({ at: ctx.time + RESPAWN_DELAY, kind: pick(Object.keys(HIDER_KINDS)) });
          ais.splice(i, 1);
          continue;
        }
        ai.c.update(dt, ai.update(dt));
      }
      for (let i = respawnQueue.length - 1; i >= 0; i--) {
        if (ctx.time >= respawnQueue[i].at) {
          spawnHider(respawnQueue[i].kind);
          respawnQueue.splice(i, 1);
        }
      }

      ctx.critters.update(ctx, dt);
      updateFire(ctx, dt);
      ctx.events.update(ctx, dt);

      world.timestep = dt;
      world.step();
      updateProps(ctx, dt);
      ctx.signals.update(ctx, dt); // 信号在物理同步后叠加网格微扰
      updateFx(ctx, dt);
      ui.updateHud(ctx);

      // ---- 结束判定 ----
      if (ctx.matchTime >= ctx.matchDuration) endMatch('time');
      else if (!hunter.alive) {
        if (!ctx._deadT) ctx._deadT = ctx.time;
        if (ctx.time - ctx._deadT > 2.0) endMatch('dead');
      }
    } else {
      updateFx(ctx, dt);
    }

    // ---- 相机 ----
    const focus = hunter.pos;
    ctx.camTarget.x = damp(ctx.camTarget.x, focus.x, 6, dt);
    ctx.camTarget.z = damp(ctx.camTarget.z, focus.z, 6, dt);
    ctx.shake = Math.max(0, ctx.shake - dt * 2.2);
    const sh = ctx.shake * 0.6;
    three.camera.position.set(
      ctx.camTarget.x + (Math.random() - 0.5) * sh,
      17 + (Math.random() - 0.5) * sh,
      ctx.camTarget.z + 11.5 + (Math.random() - 0.5) * sh
    );
    three.camera.lookAt(ctx.camTarget.x, 0, ctx.camTarget.z);

    three.composer.render();
    requestAnimationFrame(frame);
  }

  function endMatch(reason) {
    if (ctx.over) return;
    ctx.over = true;
    ui.showEnd(ctx, config, reason);
  }

  requestAnimationFrame(frame);
}

boot();
