/** Mirrors the native-world bounds (dt <= 1/30, 1..16 substeps) so a stalled frame cannot blow up the solver. */
export const MAX_WASM_STEP_DT = 1 / 30;
export function clampWasmSubSteps(subSteps: number): number {
  return Number.isFinite(subSteps) ? Math.min(16, Math.max(1, Math.floor(subSteps))) : 1;
}

/** Hostile-input guard for impulses, kicks and launches: every value must be finite and below this magnitude. */
export const MAX_WASM_INPUT_MAGNITUDE = 1e6;
export function finiteBounded(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_WASM_INPUT_MAGNITUDE);
}
