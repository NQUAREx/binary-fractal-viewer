import { Camera, type Anchor, type Point } from './camera';
import { heldTicks, Scale, TICKS } from './scale';

interface Pinch { anchor: Anchor; distance: number; ticks: bigint }
interface Hold { direction: bigint; start: number; previous: bigint }

export class Controls {
  private pointers = new Map<number, Point>();
  private pinch: Pinch | null = null;
  private dragAnchor: Anchor | null = null;
  private zoomAnchor: Anchor | null = null;
  private target: bigint;
  private hold: Hold | null = null;
  private frame = 0;
  private lastTime = 0;
  private abort = new AbortController();

  constructor(
    readonly camera: Camera,
    private canvas: HTMLCanvasElement,
    buttons: { plus: HTMLButtonElement; minus: HTMLButtonElement; reset: HTMLButtonElement },
    private changed: () => void,
  ) {
    this.target = camera.scale.ticks;
    const signal = this.abort.signal;
    canvas.addEventListener('wheel', this.wheel, { passive: false, signal });
    canvas.addEventListener('pointerdown', this.down, { signal });
    canvas.addEventListener('pointermove', this.move, { signal });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(name, this.up as EventListener, { signal });
    }
    canvas.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    for (const [button, direction] of [[buttons.plus, 1n], [buttons.minus, -1n]] as const) {
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || this.hold) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.startHold(direction);
      }, { signal });
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(name, () => this.stopHold(), { signal });
      }
      button.addEventListener('click', event => {
        if (event.detail === 0) this.step(direction * TICKS / 2n);
      }, { signal });
    }
    buttons.reset.addEventListener('click', () => this.reset(), { signal });
    window.addEventListener('keydown', this.keydown, { signal });
    window.addEventListener('keyup', event => {
      if (['+', '=', '-', '_'].includes(event.key)) this.stopHold();
    }, { signal });
    window.addEventListener('blur', this.cancel, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancel();
    }, { signal });
  }

  private center = (): Point => ({ x: this.camera.width / 2, y: this.camera.height / 2 });
  private point(event: PointerEvent | WheelEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  private gesture(): { center: Point; distance: number } {
    const [a, b] = [...this.pointers.values()];
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  private rebasePinch(): void {
    this.pinch = null;
    this.dragAnchor = null;
    if (this.pointers.size === 1) this.dragAnchor = this.camera.anchor([...this.pointers.values()][0]);
    if (this.pointers.size >= 2) {
      const g = this.gesture();
      this.pinch = { anchor: this.camera.anchor(g.center), distance: Math.max(1, g.distance), ticks: this.camera.scale.ticks };
    }
  }
  private down = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    this.cancelAnimation();
    this.hold = null;
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.focus({ preventScroll: true });
    this.pointers.set(event.pointerId, this.point(event));
    this.canvas.classList.add('dragging');
    this.rebasePinch();
  };
  private move = (event: PointerEvent): void => {
    const old = this.pointers.get(event.pointerId);
    if (!old) return;
    const p = this.point(event);
    this.pointers.set(event.pointerId, p);
    if (this.pointers.size === 1 && this.dragAnchor) {
      this.camera.zoom(this.camera.scale, { ...this.dragAnchor, point: p });
    }
    else if (this.pinch) {
      const g = this.gesture();
      const delta = Math.log2(Math.max(1, g.distance) / this.pinch.distance);
      const anchor = { ...this.pinch.anchor, point: g.center };
      this.camera.zoom(new Scale(this.pinch.ticks + Scale.delta(delta)), anchor);
    }
    this.target = this.camera.scale.ticks;
    this.changed();
  };
  private up = (event: PointerEvent): void => {
    if (!this.pointers.delete(event.pointerId)) return;
    if (!this.pointers.size) this.canvas.classList.remove('dragging');
    this.rebasePinch();
  };
  private wheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.pointers.size) return;
    this.hold = null;
    const p = this.point(event);
    const mode = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.camera.height : 1;
    const delta = -event.deltaY * mode * (event.ctrlKey ? 0.012 : 0.003);
    if (!Number.isFinite(delta)) return;
    this.step(Scale.delta(delta), p);
  };
  private keydown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const direction = ['+', '='].includes(event.key) ? 1n : ['-', '_'].includes(event.key) ? -1n : 0n;
    if (direction) {
      event.preventDefault();
      if (!event.repeat) this.startHold(direction);
    } else if (['0', 'Home'].includes(event.key)) {
      event.preventDefault(); this.reset();
    } else if (event.key === 'Escape') this.cancel();
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      this.cancelAnimation();
      this.camera.pan(event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0,
        event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0);
      this.changed();
    }
  };

  step(delta: bigint, point = this.center()): void {
    if (!this.zoomAnchor || this.zoomAnchor.point.x !== point.x || this.zoomAnchor.point.y !== point.y) {
      this.zoomAnchor = this.camera.anchor(point);
    }
    this.target += delta;
    this.schedule();
  }
  private startHold(direction: bigint): void {
    this.cancelAnimation();
    this.hold = { direction, start: performance.now(), previous: 0n };
    this.step(direction * TICKS / 3n);
  }
  private stopHold(): void { this.hold = null; }
  private schedule(): void {
    if (!this.frame) { this.lastTime = performance.now(); this.frame = requestAnimationFrame(this.animate); }
  }
  private animate = (time: number): void => {
    this.frame = 0;
    const dt = Math.min(64, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (this.hold) {
      const amount = heldTicks(time - this.hold.start);
      this.target += this.hold.direction * (amount - this.hold.previous);
      this.hold.previous = amount;
    }
    const diff = this.target - this.camera.scale.ticks;
    const factor = BigInt(Math.round((1 - Math.exp(-dt / 55)) * 1_000_000));
    let change = diff * factor / 1_000_000n;
    // Finish sub-pixel logarithmic residue; a finite gesture stops rendering.
    if (diff < TICKS / 100000n && diff > -TICKS / 100000n) change = diff;
    if (change && this.zoomAnchor) {
      this.camera.zoom(new Scale(this.camera.scale.ticks + change), this.zoomAnchor);
      this.changed();
    }
    if (this.hold || this.camera.scale.ticks !== this.target) this.frame = requestAnimationFrame(this.animate);
  };
  private cancelAnimation(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.target = this.camera.scale.ticks;
    this.zoomAnchor = null;
  }
  cancel = (): void => {
    this.hold = null;
    this.cancelAnimation();
    this.pointers.clear();
    this.pinch = null;
    this.dragAnchor = null;
    this.canvas.classList.remove('dragging');
  };
  reset(): void { this.cancel(); this.camera.reset(); this.target = this.camera.scale.ticks; this.changed(); }
  resized(): void { this.cancel(); this.changed(); }
  dispose(): void { this.cancel(); this.abort.abort(); }
}
