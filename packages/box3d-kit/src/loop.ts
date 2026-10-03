export interface FixedStepOptions {
  /** Simulation timestep in seconds. Default 1/60. Must be at most 1/30. */
  readonly step?: number;
  /** Most steps taken per advance() call; excess time is dropped. Default 5. */
  readonly maxSteps?: number;
}

export interface FixedStepResult {
  /** Fixed steps executed during this call. */
  readonly steps: number;
  /** Leftover fraction of a step in [0, 1); use it to interpolate rendering. */
  readonly alpha: number;
  /** Wall-clock seconds discarded because maxSteps was reached. */
  readonly droppedSeconds: number;
}

/**
 * Fixed-timestep accumulator. Frame times vary; physics must not. Feed it the
 * real frame delta and it runs a whole number of identical steps, which keeps
 * simulations deterministic and stable regardless of display refresh rate.
 */
export class FixedStepLoop {
  readonly step: number;
  readonly maxSteps: number;
  private accumulator = 0;

  constructor(options: FixedStepOptions = {}) {
    const step = options.step ?? 1 / 60, maxSteps = options.maxSteps ?? 5;
    if (!(step > 0 && step <= 1 / 30)) throw new RangeError('step must be in (0, 1/30] seconds.');
    if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError('maxSteps must be a positive integer.');
    this.step = step;
    this.maxSteps = maxSteps;
  }

  /** Accumulate frameSeconds and call tick(step) for each whole step due. */
  advance(frameSeconds: number, tick: (step: number) => void): FixedStepResult {
    // Negative, NaN or huge deltas (tab restored after minutes) must not
    // explode the simulation; clamp to the most work we are willing to do.
    const delta = Number.isFinite(frameSeconds) && frameSeconds > 0 ? frameSeconds : 0;
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      tick(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    let droppedSeconds = 0;
    if (this.accumulator >= this.step) {
      droppedSeconds = this.accumulator - (this.accumulator % this.step);
      this.accumulator %= this.step;
    }
    return {steps, alpha: this.accumulator / this.step, droppedSeconds};
  }

  reset(): void { this.accumulator = 0; }
}

/**
 * Reset a loop's accumulator whenever the page is hidden or shown again, so a
 * returning tab resumes smoothly instead of dropping a burst of catch-up time.
 * Accepts a PhysicsWorld (anything with `.loop`) or a FixedStepLoop. Returns an
 * unsubscribe function; a no-op outside the browser.
 */
export function pauseOnHidden(target: FixedStepLoop | {readonly loop: FixedStepLoop}, doc: {addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void} | undefined =
  (globalThis as unknown as {document?: never}).document): () => void {
  if (!doc) return () => {};
  const loop = target instanceof FixedStepLoop ? target : target.loop;
  const onChange = () => loop.reset();
  doc.addEventListener('visibilitychange', onChange);
  return () => doc.removeEventListener('visibilitychange', onChange);
}
