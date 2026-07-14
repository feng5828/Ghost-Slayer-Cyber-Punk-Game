export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// 帧率无关的平滑趋近
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
