// src/lib/utils.ts
import { Vec2 } from '@/types';

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function len(v: Vec2) {
  return Math.hypot(v.x, v.y);
}

export function normalize(v: Vec2): Vec2 {
  const l = len(v);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clampMagnitude(v: Vec2, maxLen: number): Vec2 {
  const l = len(v);
  if (l <= maxLen) return v;
  const k = maxLen / (l + 1e-9);
  return { x: v.x * k, y: v.y * k };
}

// 二进制向量 cosine（0/1 也能用，结果在 [0,1]）
export function cosine01(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 指数阻尼：v *= exp(-drag*dt)
export function expDampFactor(drag: number, dt: number) {
  return Math.exp(-drag * dt);
}

export function randRange(lo: number, hi: number) {
  return lo + Math.random() * (hi - lo);
}

export function randUnit(): Vec2 {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}
