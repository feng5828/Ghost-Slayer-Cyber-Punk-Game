import * as THREE from 'three';

// ============================================================================
// DOM UI:菜单 / HUD / 弹分 / 结算
// ============================================================================

const SIGNAL_LEGEND = `
<div class="sig"><span style="color:#ff7a4a">● 红色余烬飘起</span> —— 红龙在附近潜行</div>
<div class="sig"><span style="color:#dde6ee">● 器物高频震颤</span> —— 金属球群蛰伏于此</div>
<div class="sig"><span style="color:#ffd75e">● 杂物诡异漂浮</span> —— 守护者伪装其间</div>
<div class="sig" style="color:#c86058">屏幕边缘的心跳脉动 = 猎物已在咫尺</div>`;

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
      <div style="max-width:640px;text-align:center;font-size:15px;line-height:1.9;color:#a8b0ba">
        黄昏的村庄里潜伏着三只超自然生物。你是猎杀者。<br>
        它们不会现身 —— 但它们会<span style="color:#ffd67a">污染周围的场景</span>。读懂信号,找到它们,杀掉它们。<br>
        3 分钟,杀得越多,分越高。单杀分值递增。烧掉树篱能开路,但小心村民。
      </div>`;
    this.el('cards').innerHTML = `<div class="legendbox">${SIGNAL_LEGEND}</div>`;
    const btn = this.el('startbtn');
    btn.disabled = false;
    btn.textContent = '开 始 猎 杀';
    btn.onclick = () => {
      menu.style.display = 'none';
      onStart({ mode: 'hunt' });
    };
  }

  // ---------- HUD ----------
  startHud(ctx) {
    this.el('hud').style.display = 'block';
    this.el('hint').innerHTML =
      'WASD 移动 · 鼠标瞄准<br>左键/空格 突刺斩击<br>右键 掷火把(烧出躲藏的猎物)';
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
      `<div class="row">猎杀 ${p.stats.kills} 只</div>` +
      (p.stats.maxChain > 0 ? `<div class="row" style="color:#ffab4a">最深连锁 ${p.stats.maxChain} 层</div>` : '');

    const hp = this.el('hpbar');
    if (p.alive) {
      hp.querySelector('.val').textContent = p.hpText();
      hp.style.color = p.hpRatio() < 0.3 ? '#ff5040' : '#e8e8e8';
    } else {
      hp.querySelector('.val').textContent = '你被猎杀了';
      hp.style.color = '#888';
    }
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

  // 守护者魅化进度环(现在只有AI守护者,保留接口)
  charmRing() {}

  zoneWarn() {}

  // ---------- 结算 ----------
  showEnd(ctx, config, reason) {
    this.el('hud').style.display = 'none';
    const end = this.el('end');
    end.style.display = 'flex';

    const p = ctx.player;
    this.el('endtitle').textContent = reason === 'dead' ? '你被猎杀了' : '狩猎结束';
    this.el('rankings').innerHTML =
      `<div class="winner">${p.score} 分</div>` +
      `<div>猎杀 ${p.stats.kills} 只超自然生物</div>`;
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
