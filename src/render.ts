import { Camera } from './camera';
import { Dyadic } from './dyadic';
import { Scale } from './scale';

export interface Rect { x: number; y: number; width: number; height: number; alpha: number }
export interface RenderStats { columns: number; rectangles: number; blocks: number }

const FAR = 1e12;
function magnitude(scale: Scale, extra = 0n): number {
  const e = scale.octave + extra;
  return e > 39n ? FAR : 2 ** (Number(e) + scale.fraction);
}

/** The renderer emits exact constant-bit runs, never enumerates hidden rows.
 * Structural chart: r=max(0,-log₂(s)), q=floor(r), t=r-q.
 * Column j represents ORIGINAL bit k=q+j and each coarse row 2^q rows.
 * B(n,k)=B(floor(n/2^q),k-q), k>=q. Column projection is x=r-k.
 * Low column q fades out as t→1; all other runs coincide at the transition.
 */
export function geometry(camera: Camera, emit: (rect: Rect) => void): RenderStats {
  const { width, height, scale } = camera;
  const columnScale = scale.column;
  const q = scale.depth;
  const t = scale.blend;
  const centerX = camera.x.subtract(Dyadic.number(t));
  const columnFloor = centerX.floorAt(0n);
  const index = -columnFloor.integer() - 1n;
  const remainder = centerX.subtract(columnFloor);
  const screenX = (d: Dyadic) => width / 2 + d.scaled(columnScale.octave, columnScale.fraction);
  const left = screenX(remainder.negate());
  const right = screenX(Dyadic.term(1n).subtract(remainder));
  const cellWidth = magnitude(columnScale);
  const rowZero = height / 2 + camera.y.negate().scaled(scale.octave, scale.fraction);
  const top = Math.max(0, rowZero);
  const stats = { columns: 0, rectangles: 0, blocks: camera.x.blocks.size + camera.y.blocks.size };
  if (top >= height) return stats;

  function column(j: bigint, x0: number, x1: number): void {
    if (j < 0n || x1 <= 0 || x0 >= width) return;
    stats.columns++;
    const k = q + j;
    const rem = camera.y.remainder(k);
    const y0 = height / 2 + rem.negate().scaled(scale.octave, scale.fraction);
    const y1 = height / 2 + Dyadic.term(1n, k).subtract(rem).scaled(scale.octave, scale.fraction);
    const run = magnitude(scale, k);
    const bit = Number(camera.y.window(k, 1));
    const fade = j === 0n ? 1 - t * t * (3 - 2 * t) : 1;
    const x = Math.max(0, x0);
    const w = Math.min(width, x1) - x;
    function band(a: number, b: number, white: number): void {
      const y = Math.max(top, a);
      const bottom = Math.min(height, b);
      if (!white || bottom <= y || w <= 0) return;
      stats.rectangles++;
      emit({ x, y, width: w, height: bottom - y, alpha: fade });
    }
    band(y0, y1, bit);
    let end = y0;
    let value = 1 - bit;
    while (end > top) {
      band(end - run, end, value);
      value = 1 - value;
      end -= run;
    }
    let start = y1;
    value = 1 - bit;
    while (start < height) {
      band(start, start + run, value);
      value = 1 - value;
      start += run;
    }
  }

  column(index, left, right);
  let edge = left;
  let j = index + 1n;
  while (edge > 0) { column(j++, edge - cellWidth, edge); edge -= cellWidth; }
  edge = right;
  j = index - 1n;
  while (edge < width) { column(j--, edge, edge + cellWidth); edge += cellWidth; }
  return stats;
}

export interface PaintContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export function paint(ctx: PaintContext, camera: Camera, pixelRatio = 1): RenderStats {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, camera.width, camera.height);
  ctx.fillStyle = '#fff';
  const stats = geometry(camera, r => {
    ctx.globalAlpha = r.alpha;
    // Shared edges snap to the same device pixel, preventing dark seams where
    // two adjacent white cells would otherwise be alpha-composited twice.
    const x = Math.round(r.x * pixelRatio) / pixelRatio;
    const y = Math.round(r.y * pixelRatio) / pixelRatio;
    const right = Math.round((r.x + r.width) * pixelRatio) / pixelRatio;
    const bottom = Math.round((r.y + r.height) * pixelRatio) / pixelRatio;
    ctx.fillRect(x, y, right - x, bottom - y);
  });
  ctx.globalAlpha = 1;
  return stats;
}
