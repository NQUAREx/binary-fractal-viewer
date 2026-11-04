import Decimal from 'decimal.js';
import { floorDiv } from './dyadic';

// Fixed-point logarithm: integral range is BigInt, fractional resolution is
// 2^-48 octaves. Ordinary +delta/-delta pairs cancel exactly.
export const TICKS = 1n << 48n;
export const FRACTION = Number(TICKS);
export const MIN_COLUMN_LOG = 4n;

export class Scale {
  constructor(public ticks = 5n * TICKS) {}
  get octave(): bigint { return floorDiv(this.ticks, TICKS); }
  get fraction(): number { return Number(this.ticks - this.octave * TICKS) / FRACTION; }
  get structural(): boolean { return this.ticks < MIN_COLUMN_LOG * TICKS; }
  get depth(): bigint {
    return this.structural ? floorDiv(MIN_COLUMN_LOG * TICKS - this.ticks, TICKS) : 0n;
  }
  get blend(): number {
    return this.structural ? Number(MIN_COLUMN_LOG * TICKS - this.ticks - this.depth * TICKS) / FRACTION : 0;
  }
  get column(): Scale { return this.structural ? new Scale(MIN_COLUMN_LOG * TICKS) : this; }
  clone(): Scale { return new Scale(this.ticks); }
  static delta(octaves: number): bigint {
    if (!Number.isFinite(octaves)) throw new RangeError('Non-finite zoom');
    return BigInt(Math.round(octaves * FRACTION));
  }
  static decimalExponent(exponent: string): Scale {
    if (!/^[+-]?\d+$/.test(exponent)) throw new Error('Expected integer decimal exponent');
    // Precision grows with the number of exponent digits, not its magnitude.
    const D = Decimal.clone({ precision: Math.max(80, exponent.length + 45) });
    const binary = new D(exponent).times(new D(10).ln().div(new D(2).ln()));
    return new Scale(BigInt(binary.times(TICKS.toString()).toFixed(0)));
  }
}

/** Integral of an exponentially accelerating held button, in log-scale ticks.
 * No conversion of the unbounded magnitude to a JS Number.
 */
export function heldTicks(milliseconds: number): bigint {
  const seconds = Math.max(0, milliseconds) / 1000;
  const whole = Math.floor(seconds);
  const coefficient = BigInt(Math.round(1.5 / Math.LN2 * 2 ** (seconds - whole) * FRACTION));
  return (coefficient << BigInt(whole)) - BigInt(Math.round(1.5 / Math.LN2 * FRACTION));
}
