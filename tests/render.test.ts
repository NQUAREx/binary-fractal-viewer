import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Camera } from '../src/camera';
import { paint } from '../src/render';
import { Scale } from '../src/scale';

describe('software raster and performance', () => {
  it('produces desktop and mobile reference images at normal and extreme scales', () => {
    mkdirSync('artifacts', { recursive: true });
    for (const [width, height, exponent, name] of [
      [1280, 800, null, 'desktop'],
      [390, 844, null, 'mobile'],
      [1280, 800, '-1000', 'scale-1000'],
      [1280, 800, '-1000000', 'scale-1000000'],
      [1280, 800, '-10000000000000000000000000000000000000000', 'scale-1e40'],
    ] as const) {
      const surface = createCanvas(width, height);
      const context = surface.getContext('2d');
      const camera = new Camera(); camera.reset(width, height);
      if (exponent) camera.zoom(Scale.decimalExponent(exponent), camera.anchor({ x: width * .68, y: height * .12 }));
      const stats = paint(context as unknown as CanvasRenderingContext2D, camera);
      expect(stats.rectangles).toBeGreaterThan(0);
      expect(stats.rectangles).toBeLessThan(4 * camera.height + camera.width);
      const pixels = context.getImageData(0, 0, width, height).data;
      let white = 0;
      let nonGray = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) nonGray++;
        if (pixels[i] === 255) white++;
      }
      expect(nonGray).toBe(0);
      expect(white).toBeGreaterThan(1000);
      writeFileSync(`artifacts/${name}.png`, surface.toBuffer('image/png'));
    }
  });
  it('bounds CPU draw work while continuously zooming at a million decimal orders', () => {
    const surface = createCanvas(1280, 800);
    const context = surface.getContext('2d');
    const camera = new Camera(); camera.reset(1280, 800);
    const anchor = camera.anchor({ x: 640, y: 400 });
    camera.zoom(Scale.decimalExponent('-1000000'), anchor);
    const times: number[] = [];
    for (let frame = 0; frame < 300; frame++) {
      const start = performance.now();
      camera.zoom(new Scale(camera.scale.ticks - Scale.delta(.037)), anchor);
      const stats = paint(context as unknown as CanvasRenderingContext2D, camera);
      times.push(performance.now() - start);
      expect(stats.rectangles).toBeLessThan(4 * camera.height + camera.width);
    }
    times.sort((a, b) => a - b);
    const report = { frames: times.length, width: 1280, height: 800, medianMs: times[150], p95Ms: times[285], maxMs: times[299] };
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/performance.json', JSON.stringify(report, null, 2));
    console.info('Native Canvas CPU benchmark (not a browser/device FPS measurement):', report);
    expect(report.p95Ms).toBeLessThan(250);
  });
});
