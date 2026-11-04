import { describe, expect, it } from 'vitest';
import { Dyadic, floorDiv } from '../src/dyadic';
import { heldTicks, Scale, TICKS } from '../src/scale';
import { Camera } from '../src/camera';
import { geometry, type Rect } from '../src/render';

describe('sparse exact coordinates', () => {
  it('round-trips IEEE values including subnormal and signs', () => {
    for (const n of [0, 1, -1, 0.125, -0.1, Math.PI, 2 ** -1074, 2 ** 80]) {
      expect(Dyadic.number(n).scaled(0n, 0, 1e30)).toBe(n);
    }
  });
  it('matches dense BigInt arithmetic across digit boundaries', () => {
    let seed = 12345n;
    const random = () => { seed = (seed * 1103515245n + 12345n) & ((1n << 256n) - 1n); return seed; };
    for (let i = 0; i < 400; i++) {
      const a = random() - (1n << 254n);
      const b = random() - (1n << 255n);
      const d = Dyadic.term(a, -137n).add(Dyadic.term(b, -137n));
      for (const shift of [-140n, -129n, -1n, 0n, 10n, 127n, 130n, 300n]) {
        const dense = shift < -137n ? (a + b) << (-137n - shift) : floorDiv(a + b, 1n << (shift + 137n));
        expect(d.window(shift, 40)).toBe(dense & ((1n << 40n) - 1n));
        const expected = Dyadic.term(dense, shift);
        expect(d.floorAt(shift).equals(expected)).toBe(true);
      }
    }
  });
  it('retains tiny offsets beside enormous positive and negative coordinates', () => {
    const e = 10n ** 100n;
    const high = Dyadic.term(3n, e);
    const low = Dyadic.term(7n, -e);
    const sum = high.add(low);
    expect(sum.blocks.size).toBeLessThan(5);
    expect(sum.subtract(high).equals(low)).toBe(true);
    expect(sum.window(e, 4)).toBe(3n);
    expect(high.subtract(low).window(e, 4)).toBe(2n);
    expect(high.subtract(low).remainder(e).add(low).equals(Dyadic.term(1n, e))).toBe(true);
    expect(low.negate().floorAt(0n).integer()).toBe(-1n);
  });
});

describe('scale and anchor', () => {
  it('supports decimal scales well beyond underflow and Number exponents', () => {
    for (const e of ['-1000', '-1000000', '1000000', '-' + '1' + '0'.repeat(100)]) {
      const scale = Scale.decimalExponent(e);
      expect(scale.fraction).toBeGreaterThanOrEqual(0);
      expect(scale.fraction).toBeLessThan(1);
      expect(scale.ticks < 0n).toBe(e.startsWith('-'));
    }
    expect(Scale.decimalExponent('-1000000').octave).toBe(-3321929n);
    expect(heldTicks(30000)).toBeGreaterThan(1_000_000_000n * TICKS);
    expect(heldTicks(2_000_000)).toBeGreaterThan(1n << 2000n);
  });
  it('preserves the cursor point at huge scales, returning exactly to the initial camera', () => {
    const camera = new Camera(); camera.reset(960, 640);
    const initial = { x: camera.x, y: camera.y, scale: camera.scale.clone() };
    const anchor = camera.anchor({ x: 217, y: 413 });
    for (const exponent of ['-1000', '-1000000', '1000000', '-1000000000000000000000000000']) {
      camera.zoom(Scale.decimalExponent(exponent), anchor);
      const after = camera.anchor(anchor.point);
      expect(after.x.equals(anchor.x)).toBe(true);
      expect(after.y.equals(anchor.y)).toBe(true);
    }
    camera.zoom(initial.scale, anchor);
    expect(camera.x.equals(initial.x)).toBe(true);
    expect(camera.y.equals(initial.y)).toBe(true);
  });
  it('survives 20,000 alternating zooms and reverse pans without drift', () => {
    const c = new Camera(); c.reset(1024, 768);
    const anchor = c.anchor({ x: 333, y: 444 });
    const original = c.scale.ticks;
    const y = c.y; const x = c.x;
    for (let i = 0; i < 20000; i++) {
      c.zoom(new Scale(c.scale.ticks + (i % 2 ? -1n : 1n) * Scale.delta(0.07)), anchor);
    }
    expect(c.scale.ticks).toBe(original);
    expect(c.y.equals(y)).toBe(true);
    for (let i = 0; i < 1000; i++) { c.pan(0.25, -0.125); c.pan(-0.25, 0.125); }
    expect(c.x.equals(x)).toBe(true); expect(c.y.equals(y)).toBe(true);
  });
});

function rectangles(c: Camera): Rect[] {
  const result: Rect[] = []; geometry(c, r => result.push(r)); return result;
}
function sample(rects: Rect[], x: number, y: number): number {
  return rects.find(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)?.alpha ?? 0;
}

describe('recursive run renderer', () => {
  it('matches the actual matrix for every cell in a small viewport', () => {
    const c = new Camera(); c.resize(512, 512);
    c.scale = new Scale(4n * TICKS); c.x = Dyadic.number(-8); c.y = Dyadic.number(16);
    const rects = rectangles(c);
    for (let n = 0; n < 32; n++) for (let k = 0; k < 16; k++) {
      expect(sample(rects, 384 - (k + 0.5) * 16, (n + 0.5) * 16)).toBe((n >> k) & 1);
    }
  });
  it('structural cells equal the original bits of huge block indices', () => {
    const c = new Camera(); c.resize(512, 512);
    c.scale = new Scale(-1000n * TICKS); const q = c.scale.depth;
    c.x = Dyadic.number(-8); c.y = Dyadic.term(16n, q);
    const rects = rectangles(c);
    for (let n = 0; n < 32; n++) for (let j = 0; j < 16; j++) {
      const originalN = BigInt(n) << q;
      expect(sample(rects, 264 - (j + 0.5), 240 + (n + 0.5)))
        .toBe(Number((originalN >> (q + BigInt(j))) & 1n));
    }
  });
  it('stays continuous at structural level boundaries', () => {
    const c = new Camera(); c.resize(400, 300); c.x = Dyadic.number(-5); c.y = Dyadic.number(18.25);
    for (const exponent of [4n, 3n, -20n]) {
      c.scale = new Scale(exponent * TICKS - 1n); const before = rectangles(c);
      c.scale = new Scale(exponent * TICKS + 1n); const after = rectangles(c);
      for (let y = 0.37; y < 300; y += 7.31) for (let x = 0.29; x < 400; x += 11.13) {
        expect(Math.abs(sample(before, x, y) - sample(after, x, y))).toBeLessThan(1e-8);
      }
    }
  });
  it('renders tiny differences beside a cell boundary after enormous zoom in', () => {
    const c = new Camera(); c.resize(320, 240); c.scale = Scale.decimalExponent('1000000');
    c.x = Dyadic.number(-0.5); c.y = Dyadic.term(1n).add(Dyadic.number(20 / 2 ** c.scale.fraction, -c.scale.octave));
    const rects = rectangles(c);
    expect(sample(rects, 160, 99)).toBe(0);
    expect(sample(rects, 160, 101)).toBe(1);
  });
  it('has bounded render work for extreme scales and finite geometry', () => {
    const c = new Camera(); c.reset(1920, 1080);
    const anchor = c.anchor({ x: 1300, y: 100 });
    for (const e of ['-1000', '-1000000', '-1000000000000000000000000000000', '1000000']) {
      c.zoom(Scale.decimalExponent(e), anchor);
      const stats = geometry(c, r => {
        for (const n of Object.values(r)) expect(Number.isFinite(n)).toBe(true);
        expect(r.width).toBeGreaterThan(0); expect(r.height).toBeGreaterThan(0);
      });
      expect(stats.rectangles).toBeLessThan(4 * c.height + c.width);
      expect(stats.columns).toBeLessThan(c.width + 2);
      expect(stats.blocks).toBeLessThan(20);
    }
  });
});
