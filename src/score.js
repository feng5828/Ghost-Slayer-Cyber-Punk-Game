// ============================================================================
// 计分:
// - 破坏道具:直接 x1,连锁按深度加倍率(上限 x4)—— 拆村庄也有分,但小头
// - 击杀生物:大头。单杀分值递增(400, 550, 700...),血月期间 ×2
// - 误杀村民:-100
// ============================================================================
export class ScoreSystem {
  award(ctx, owner, base, chain, label, worldPos) {
    const mult = Math.min(1 + 0.5 * chain, 4);
    const pts = Math.round(base * mult);
    owner.score += pts;
    owner.stats.destroyed++;
    owner.stats.maxChain = Math.max(owner.stats.maxChain, chain);
    if (owner.isPlayer) {
      const txt = chain > 0 ? `${label} +${pts} 连锁×${mult.toFixed(1)}` : `${label} +${pts}`;
      ctx.ui.popup(ctx, txt, worldPos, Math.min(chain, 3));
    }
  }

  killBonus(ctx, owner, victim) {
    if (owner.isPlayer) {
      owner.stats.kills++;
      let pts = 400 + (owner.stats.kills - 1) * 150;
      if (ctx.bloodMoon) pts *= 2;
      owner.score += pts;
      ctx.ui.popup(ctx, `斩杀 ${victim.cname} +${pts}${ctx.bloodMoon ? ' 血月×2' : ''}`, victim.pos, 3);
      ctx.ui.banner(`斩杀 ${victim.cname}!(第 ${owner.stats.kills} 只)`);
    } else {
      owner.score += 300;
      owner.stats.kills++;
    }
  }

  penalty(ctx, owner, amount, label, worldPos) {
    owner.score = Math.max(0, owner.score - amount);
    if (owner.isPlayer) ctx.ui.popup(ctx, `${label} -${amount}`, worldPos, 'bad');
  }
}
