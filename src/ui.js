import * as THREE from 'three';

// ============================================================================
// DOM UI:菜单 / HUD / 弹分 / 结算
// ============================================================================

const SIGNAL_LEGEND = `
<div class="sig"><span style="color:#ff7a4a">● 焦热余烬飘起</span> —— 蜈蚣精在附近潜行</div>
<div class="sig"><span style="color:#8fe8c4">● 阴风震颤,青磷浮动</span> —— 鬼火群蛰伏于此</div>
<div class="sig"><span style="color:#f0e6e8">● 杂物被怨气托起漂浮</span> —— 纸傀儡伪装其间</div>
<div class="sig" style="color:#c86058">屏幕边缘的心跳脉动 = 恶鬼已在咫尺</div>`;

export class UI {
  constructor() {
    this.el = (id) => document.getElementById(id);
    this._bannerT = null;
  }

  // ---------- 主菜单 ----------
  showMenu(onStart) {
    const menu = this.el('menu');
    menu.style.display = 'flex';
    this.el('modes').innerHTML = `
      <div style="max-width:660px;text-align:center;font-size:15px;line-height:1.9;color:#a8b0ba">
        赛博时代,恶鬼藏进了霓虹街区。你是持牌上岗的职业猎鬼人。<br>
        它们不会现身 —— 但邪气会<span style="color:#ffd67a">污染周围的场景</span>。读懂信号,找到它们。<br>
        <span style="color:#18e0c8">蓄力冲撞把鬼打到虚弱,再按 Q 展开结界收服 —— 只有收进结界才算数。</span><br>
        结界消耗灵力,灵力靠破坏场景获取:拆得越狠,收得越多。3 分钟,收服分递增。E 电浆符纵火驱鬼,小心市民。
      </div>`;
    this.el('cards').innerHTML = `<div class="legendbox">${SIGNAL_LEGEND}</div>`;
    const btn = this.el('startbtn');
    btn.disabled = false;
    btn.textContent = '开 始 猎 鬼';
    btn.onclick = () => {
      menu.style.display = 'none';
      onStart({ mode: 'hunt' });
    };
  }

  // ---------- HUD ----------
  startHud(ctx) {
    this.el('hud').style.display = 'block';
    this.el('hint').innerHTML =
      'WASD 移动 · 按住左键/空格蓄力,松开冲撞<br>把鬼打到虚弱,<span style="color:#ffd75e">按 Q 展开结界收服</span>(耗30灵力)<br>破坏场景获取灵力 · E 掷电浆符纵火驱鬼';
  }

  updateHud(ctx) {
    const remain = Math.max(0, ctx.matchDuration - ctx.matchTime);
    const mm = Math.floor(remain / 60), ss = Math.floor(remain % 60);
    const timer = this.el('timer');
    timer.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    timer.classList.toggle('danger', remain < 30 || ctx.bloodMoon);

    const p = ctx.player;
    this.el('scoreboard').innerHTML =
      `<div class="row me" style="font-size:24px">${p.score} 分</div>` +
      `<div class="row">收服 ${p.stats.kills} 只</div>` +
      (p.stats.maxChain > 0 ? `<div class="row" style="color:#ffab4a">最深连锁 ${p.stats.maxChain} 层</div>` : '');

    const hp = this.el('hpbar');
    if (p.alive) {
      const spirit = Math.round(p.spirit ?? 0);
      const sColor = spirit >= 30 ? '#7ac8ff' : '#ff8a6a';
      hp.querySelector('.val').innerHTML =
        `${p.hpText()}<br><span style="color:${sColor}">灵力 ${spirit}</span><span style="color:#667;font-size:14px"> / 100</span>`;
      hp.style.color = p.hpRatio() < 0.3 ? '#ff5040' : '#e8e8e8';
    } else {
      hp.querySelector('.val').textContent = '你被恶鬼所杀';
      hp.style.color = '#888';
    }
  }

  // 收服进度环:显示在目标鬼头顶
  captureRing(ctx, worldPos, progress) {
    const ring = this.el('capring');
    if (!ring) return; // 防御:元素缺失时绝不能让异常打死主循环
    if (!ctx || !worldPos) { ring.style.display = 'none'; return; }
    const v = new THREE.Vector3(worldPos.x, (worldPos.y || 0) + 3, worldPos.z).project(ctx.three.camera);
    if (v.z > 1) { ring.style.display = 'none'; return; }
    ring.style.display = 'block';
    ring.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    ring.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    ring.style.background = `conic-gradient(#ffd75e ${Math.min(progress, 1) * 360}deg, transparent 0deg)`;
  }

  banner(text) {
    const b = this.el('banner');
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('show'), 2600);
  }

  hurtFlash() {
    const h = this.el('hurt');
    if (!h) return;
    h.style.opacity = '0.5';
    clearTimeout(this._hurtT);
    this._hurtT = setTimeout(() => (h.style.opacity = '0'), 160);
  }

  // 世界坐标弹分(level: 0-3 或 'bad')
  popup(ctx, text, worldPos, level = 0) {
    const v = new THREE.Vector3(worldPos.x, (worldPos.y || 0) + 2, worldPos.z).project(ctx.three.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const d = document.createElement('div');
    d.className = `popup c${level}`;
    d.textContent = text;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.el('popups').appendChild(d);
    d.addEventListener('animationend', () => d.remove());
  }

  // 蓄力环:跟随鼠标,青色渐满,蓄满转红
  chargeRing(input, frac) {
    const ring = this.el('charmring');
    if (!input || frac <= 0.01) { ring.style.display = 'none'; return; }
    ring.style.display = 'block';
    ring.style.left = `${input.mouseX ?? window.innerWidth / 2}px`;
    ring.style.top = `${input.mouseY ?? window.innerHeight / 2}px`;
    const color = frac >= 1 ? '#ff4a3a' : '#18e0c8';
    ring.style.borderColor = frac >= 1 ? '#ff4a3a' : '#2a6a66';
    ring.style.background = `conic-gradient(${color} ${frac * 360}deg, transparent 0deg)`;
    ring.style.boxShadow = frac >= 1 ? '0 0 18px #ff4a3a' : 'none';
  }

  // 纸傀儡魅化进度环(现在只有AI纸傀儡,保留接口)
  charmRing() {}

  zoneWarn() {}

  // ---------- 结算 ----------
  showEnd(ctx, config, reason) {
    this.el('hud').style.display = 'none';
    const end = this.el('end');
    end.style.display = 'flex';

    const p = ctx.player;
    this.el('endtitle').textContent = reason === 'dead' ? '你被恶鬼所杀' : '天亮了';
    this.el('rankings').innerHTML =
      `<div class="winner">${p.score} 分</div>` +
      `<div>收服 ${p.stats.kills} 只恶鬼</div>`;
    this.el('endsub').textContent =
      `破坏 ${p.stats.destroyed} 个物件 · 最深连锁 ${p.stats.maxChain} 层`;

    this.el('againbtn').onclick = () => {
      sessionStorage.setItem('gm_config', JSON.stringify(config));
      location.reload();
    };
    this.el('menubtn').onclick = () => {
      sessionStorage.removeItem('gm_config');
      location.reload();
    };
  }
}
