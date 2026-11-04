// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Camera } from '../src/camera';
import { Controls } from '../src/controls';
import { Scale, TICKS } from '../src/scale';

let camera: Camera;
let controls: Controls;
let canvas: HTMLCanvasElement;
let callbacks: Map<number, FrameRequestCallback>;
let now: number;
let next: number;
let changed: () => void;

function advance(ms: number, step = 16): void {
  const end = now + ms;
  while (now < end) {
    now = Math.min(end, now + step);
    const frames = [...callbacks.values()]; callbacks.clear();
    for (const frame of frames) frame(now);
  }
}
function pointer(type: string, id: number, x: number, y: number, target: Element = canvas): void {
  target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
}
function wheel(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', init);
  // Happy DOM WheelEvent currently omits the inherited MouseEvent fields.
  for (const key of ['clientX', 'clientY', 'ctrlKey'] as const) {
    Object.defineProperty(event, key, { value: init[key] ?? (key === 'ctrlKey' ? false : 0) });
  }
  return event;
}

beforeEach(() => {
  callbacks = new Map(); now = 0; next = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callbacks.set(++next, fn); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  document.body.innerHTML = '<canvas></canvas><button id="plus"></button><button id="minus"></button><button id="reset"></button>';
  canvas = document.querySelector('canvas')!;
  // Happy DOM has no physical pointer capture implementation.
  for (const element of document.querySelectorAll('canvas,button')) {
    element.setPointerCapture = vi.fn();
  }
  camera = new Camera(); camera.reset(800, 600);
  changed = vi.fn();
  controls = new Controls(camera, canvas, {
    plus: document.querySelector('#plus')!, minus: document.querySelector('#minus')!, reset: document.querySelector('#reset')!,
  }, changed);
});
afterEach(() => { controls.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('mouse, touch, and zoom lifecycle', () => {
  it('animates wheel zoom around the cursor and stops requesting frames', () => {
    const point = { x: 233, y: 401 };
    const anchor = camera.anchor(point);
    const initial = camera.scale.ticks;
    const event = wheel({ clientX: point.x, clientY: point.y, deltaY: -120, cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    advance(16);
    expect(camera.scale.ticks).toBeGreaterThan(initial);
    expect(camera.scale.ticks).toBeLessThan(initial + Scale.delta(0.36));
    advance(1500);
    expect(camera.scale.ticks).toBe(initial + Scale.delta(0.36));
    expect(camera.anchor(point).y.equals(anchor.y)).toBe(true);
    expect(camera.anchor(point).x.equals(anchor.x)).toBe(true);
    expect(callbacks.size).toBe(0);
  });
  it('handles trackpad ctrl-wheel, line and page deltas', () => {
    const initial = camera.scale.ticks;
    for (const mode of [0, 1, 2]) canvas.dispatchEvent(wheel({
      deltaY: -1, deltaMode: mode, ctrlKey: true, clientX: 400, clientY: 300, cancelable: true,
    }));
    advance(2000);
    expect(camera.scale.ticks).toBe(initial + Scale.delta(.012) + Scale.delta(.192) + Scale.delta(7.2));
  });
  it('pans by one finger then pinches about a moving centroid', () => {
    const initial = camera.anchor({ x: 200, y: 200 });
    pointer('pointerdown', 1, 200, 200); pointer('pointermove', 1, 250, 230);
    expect(camera.anchor({ x: 250, y: 230 }).y.equals(initial.y)).toBe(true);
    pointer('pointerdown', 2, 350, 230);
    const midpoint = camera.anchor({ x: 300, y: 230 });
    const initialScale = camera.scale.ticks;
    pointer('pointermove', 1, 200, 250); pointer('pointermove', 2, 400, 250);
    expect(camera.scale.ticks).toBe(initialScale + TICKS);
    expect(camera.anchor({ x: 300, y: 250 }).y.equals(midpoint.y)).toBe(true);
    expect(camera.anchor({ x: 300, y: 250 }).x.equals(midpoint.x)).toBe(true);
    pointer('pointerup', 2, 400, 250);
    const last = camera.anchor({ x: 200, y: 250 });
    pointer('pointermove', 1, 210, 260);
    expect(camera.anchor({ x: 210, y: 260 }).y.equals(last.y)).toBe(true);
    pointer('pointercancel', 1, 210, 260);
    expect(canvas.classList.contains('dragging')).toBe(false);
  });
  it('rebases three-finger changes and survives coincident touches', () => {
    pointer('pointerdown', 1, 100, 100); pointer('pointerdown', 2, 100, 100);
    pointer('pointermove', 2, 100, 101);
    pointer('pointerdown', 3, 300, 300); pointer('pointerup', 1, 100, 100);
    pointer('pointermove', 3, 310, 310);
    expect(Number.isFinite(camera.scale.fraction)).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(canvas.classList.contains('dragging')).toBe(false);
  });
  it('reaches a million decimal orders by holding a button, then resets', () => {
    pointer('pointerdown', 99, 0, 0, document.querySelector('#minus')!);
    advance(22000, 32);
    expect(camera.scale.ticks).toBeLessThan(Scale.decimalExponent('-1000000').ticks);
    pointer('pointerup', 99, 0, 0, document.querySelector('#minus')!);
    advance(2000);
    expect(callbacks.size).toBe(0);
    document.querySelector<HTMLButtonElement>('#reset')!.click();
    expect(camera.scale.ticks).toBeGreaterThan(0n);
    expect(camera.y.blocks.size).toBeLessThan(3);
  });
  it('stops zoom immediately on blur and works with keyboard and screen reader activation', () => {
    const start = camera.scale.ticks;
    document.querySelector<HTMLButtonElement>('#plus')!.click(); advance(1500);
    expect(camera.scale.ticks).toBe(start + TICKS / 2n);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' })); advance(200);
    window.dispatchEvent(new Event('blur'));
    const stopped = camera.scale.ticks; advance(1000);
    expect(camera.scale.ticks).toBe(stopped);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
    expect(camera.scale.ticks).toBe(start);
  });
  it('keeps wheel and pinch responsive after an enormous scale jump', () => {
    camera.zoom(Scale.decimalExponent('-1000000000000000000000000'), camera.anchor({ x: 400, y: 300 }));
    controls.resized();
    const start = camera.scale.ticks;
    canvas.dispatchEvent(wheel({ deltaY: -100, clientX: 400, clientY: 300 }));
    advance(1500);
    expect(camera.scale.ticks).toBe(start + Scale.delta(0.3));
    pointer('pointerdown', 1, 200, 300); pointer('pointerdown', 2, 400, 300);
    pointer('pointermove', 2, 600, 300);
    expect(camera.scale.ticks).toBe(start + Scale.delta(0.3) + TICKS);
  });
});
