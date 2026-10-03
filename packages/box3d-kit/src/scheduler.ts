/**
 * Step several worlds (game rooms, split-screen previews, AI rollouts) within
 * a per-frame time budget. Worlds that do not fit this frame keep their owed
 * time and go first next frame, so every world simulates the same total time
 * and none starves.
 */
import type {FixedStepResult} from './loop.js';

export interface SchedulableWorld { update(frameSeconds: number): FixedStepResult }

export interface SchedulerOptions {
  /** Stop starting new worlds once this many milliseconds were spent. Default 8. At least one world always runs. */
  readonly budgetMs?: number;
  /** Clock in milliseconds; injectable for tests. Default performance.now. */
  readonly now?: () => number;
}

export interface SchedulerFrame {
  readonly updated: number;
  readonly deferred: number;
  readonly steps: number;
  readonly elapsedMs: number;
}

export class WorldScheduler<W extends SchedulableWorld = SchedulableWorld> {
  readonly budgetMs: number;
  private readonly now: () => number;
  private readonly owed = new Map<W, number>();
  private order: W[] = [];

  constructor(options: SchedulerOptions = {}) {
    this.budgetMs = options.budgetMs ?? 8;
    this.now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  }

  add(world: W): this { if (!this.owed.has(world)) { this.owed.set(world, 0); this.order.push(world); } return this; }
  remove(world: W): boolean {
    if (!this.owed.delete(world)) return false;
    this.order = this.order.filter(w => w !== world);
    return true;
  }
  get size(): number { return this.order.length; }
  /** Seconds a world is still owed (0 when it is current). */
  owedSeconds(world: W): number { return this.owed.get(world) ?? 0; }

  update(frameSeconds: number): SchedulerFrame {
    const dt = Number.isFinite(frameSeconds) && frameSeconds > 0 ? frameSeconds : 0;
    for (const world of this.order) this.owed.set(world, this.owed.get(world)! + dt);
    const start = this.now(), done: W[] = [], waiting: W[] = [];
    let steps = 0;
    for (const world of this.order) {
      if (done.length > 0 && this.now() - start >= this.budgetMs) { waiting.push(world); continue; }
      steps += world.update(this.owed.get(world)!).steps;
      this.owed.set(world, 0);
      done.push(world);
    }
    // Deferred worlds run first next frame.
    this.order = [...waiting, ...done];
    return {updated: done.length, deferred: waiting.length, steps, elapsedMs: this.now() - start};
  }
}
