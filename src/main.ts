import './style.css';
import { Camera } from './camera';
import { Controls } from './controls';
import { paint } from './render';
import { Scale } from './scale';

const canvas = document.querySelector<HTMLCanvasElement>('#matrix')!;
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('Canvas 2D is unavailable');
const camera = new Camera();
let pending = 0;
const draw = () => {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(camera.width * dpr);
    const h = Math.round(camera.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, camera, dpr);
  });
};
const controls = new Controls(camera, canvas, {
  plus: document.querySelector('#zoom-in')!,
  minus: document.querySelector('#zoom-out')!,
  reset: document.querySelector('#reset')!,
}, draw);
const bounds = canvas.getBoundingClientRect();
camera.reset(bounds.width, bounds.height);
// Optional reproducible deep links; no extra research controls in the UI.
const exponent = new URLSearchParams(location.hash.slice(1)).get('scale');
if (exponent && /^10\^[+-]?\d+$/.test(exponent)) {
  const anchor = camera.anchor({ x: camera.width * 0.68, y: camera.height * 0.12 });
  camera.zoom(Scale.decimalExponent(exponent.slice(3)), anchor);
}
controls.resized();
new ResizeObserver(() => {
  const rect = canvas.getBoundingClientRect();
  camera.resize(rect.width, rect.height);
  controls.resized();
}).observe(canvas);
window.addEventListener('resize', draw);
draw();
