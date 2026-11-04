import { Dyadic } from './dyadic';
import { Scale } from './scale';

export interface Point { x: number; y: number }
export interface Anchor { point: Point; x: Dyadic; y: Dyadic }

export function units(pixels: number, scale: Scale): Dyadic {
  return Dyadic.number(pixels / 2 ** scale.fraction, -scale.octave);
}

export class Camera {
  scale = new Scale();
  x = new Dyadic();
  y = new Dyadic();
  width = 1;
  height = 1;

  reset(width = this.width, height = this.height): void {
    this.width = width;
    this.height = height;
    const cell = Math.min(40, Math.max(24, width / 14));
    this.scale = new Scale(Scale.delta(Math.log2(cell)));
    this.x = units(-width * 0.18, this.scale.column);
    this.y = units(height * 0.38, this.scale);
  }

  anchor(point: Point): Anchor {
    return {
      point: { ...point },
      x: this.x.add(units(point.x - this.width / 2, this.scale.column)),
      y: this.y.add(units(point.y - this.height / 2, this.scale)),
    };
  }

  zoom(scale: Scale, anchor: Anchor): void {
    this.scale = scale;
    this.x = anchor.x.subtract(units(anchor.point.x - this.width / 2, scale.column));
    this.y = anchor.y.subtract(units(anchor.point.y - this.height / 2, scale));
  }

  pan(dx: number, dy: number): void {
    this.x = this.x.subtract(units(dx, this.scale.column));
    this.y = this.y.subtract(units(dy, this.scale));
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; }
}
