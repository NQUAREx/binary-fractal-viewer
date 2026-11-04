/** Exact sparse dyadic arithmetic. A coordinate is Σ digit[b]·2^(128b).
 * Balanced digits avoid allocating the empty gap between, say, 1 and 2^-10^30.
 * Memory follows occupied precision, never the absolute exponent.
 */
const WIDTH = 128n;
const BASE = 1n << WIDTH;
const HALF = BASE >> 1n;
const data = new DataView(new ArrayBuffer(8));

export function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b < 0n ? q - 1n : q;
}

export class Dyadic {
  readonly blocks: Map<bigint, bigint>;

  constructor(blocks: Map<bigint, bigint> = new Map()) {
    this.blocks = new Map(blocks);
  }

  static number(value: number, exponent = 0n): Dyadic {
    if (!Number.isFinite(value)) throw new RangeError('Non-finite coordinate');
    if (value === 0) return new Dyadic();
    data.setFloat64(0, value);
    const raw = data.getBigUint64(0);
    const exp = Number((raw >> 52n) & 2047n);
    const mantissa = (raw & ((1n << 52n) - 1n)) | (exp ? 1n << 52n : 0n);
    return Dyadic.term(raw >> 63n ? -mantissa : mantissa,
      exponent + BigInt(exp ? exp - 1023 - 52 : -1074));
  }

  static term(mantissa: bigint, exponent = 0n): Dyadic {
    const out = new Dyadic();
    const block = floorDiv(exponent, WIDTH);
    out.insert(block, mantissa << (exponent - block * WIDTH));
    return out;
  }

  private insert(block: bigint, value: bigint): void {
    while (value !== 0n) {
      const total = (this.blocks.get(block) ?? 0n) + value;
      const carry = floorDiv(total + HALF, BASE);
      const digit = total - carry * BASE;
      if (digit) this.blocks.set(block, digit);
      else this.blocks.delete(block);
      value = carry;
      block++;
    }
  }

  add(other: Dyadic): Dyadic {
    const out = new Dyadic(this.blocks);
    for (const [block, digit] of other.blocks) out.insert(block, digit);
    return out;
  }

  negate(): Dyadic {
    const out = new Dyadic();
    for (const [block, digit] of this.blocks) out.insert(block, -digit);
    return out;
  }

  subtract(other: Dyadic): Dyadic { return this.add(other.negate()); }

  sign(): number {
    let highest: bigint | undefined;
    let sign = 0;
    for (const [block, digit] of this.blocks) {
      if (highest === undefined || block > highest) {
        highest = block;
        sign = digit < 0n ? -1 : 1;
      }
    }
    return sign;
  }

  /** Floor to an exact multiple of 2^exponent, without dense shifts. */
  floorAt(exponent: bigint): Dyadic {
    const out = new Dyadic();
    let remainder = new Dyadic();
    for (const [block, digit] of this.blocks) {
      const e = block * WIDTH;
      if (e >= exponent) out.insert(block, digit);
      else if (exponent - e >= WIDTH) remainder.insert(block, digit);
      else {
        const divisor = 1n << (exponent - e);
        const quotient = digit / divisor;
        const rem = digit % divisor;
        if (quotient) {
          const term = Dyadic.term(quotient, exponent);
          for (const [b, d] of term.blocks) out.insert(b, d);
        }
        if (rem) remainder.insert(block, rem);
      }
    }
    if (remainder.sign() < 0) return out.subtract(Dyadic.term(1n, exponent));
    return out;
  }

  remainder(exponent: bigint): Dyadic { return this.subtract(this.floorAt(exponent)); }

  /** floor(this / 2^shift) mod 2^bits, even for negative coordinates. */
  window(shift: bigint, bits: number): bigint {
    const floor = this.floorAt(shift);
    const mask = (1n << BigInt(bits)) - 1n;
    let result = 0n;
    for (const [block, digit] of floor.blocks) {
      const delta = block * WIDTH - shift;
      if (delta >= BigInt(bits)) continue;
      if (delta >= 0n) result += digit << delta;
      else if (-delta < WIDTH) result += digit / (1n << -delta);
    }
    return result & mask;
  }

  /** Convert only a local screen-sized difference. Large distances saturate. */
  scaled(exponent: bigint, fraction = 0, limit = 1e12): number {
    const entries = [...this.blocks].sort(([a], [b]) => a > b ? -1 : 1);
    let sum = 0;
    for (const [block, digit] of entries) {
      const e = block * WIDTH + exponent;
      // Balanced digits ensure a lower block cannot cancel a dominant block.
      if (e > 1024n) return Number(digit > 0n ? 1 : -1) * limit;
      if (e < -1200n) continue;
      // Divide mantissa first so the power itself cannot under/overflow.
      const term = Number(digit) / 2 ** 127 * 2 ** (Number(e) + 127 + fraction);
      sum += term;
      if (Math.abs(sum) > limit * 2) return Math.sign(sum) * limit;
    }
    return Math.max(-limit, Math.min(limit, sum));
  }

  equals(other: Dyadic): boolean { return this.subtract(other).blocks.size === 0; }

  /** For chart column indices only; rows must stay sparse. */
  integer(): bigint {
    let result = 0n;
    for (const [block, digit] of this.floorAt(0n).blocks) {
      const e = block * WIDTH;
      result += e >= 0n ? digit << e : digit / (1n << -e);
    }
    return result;
  }
}
