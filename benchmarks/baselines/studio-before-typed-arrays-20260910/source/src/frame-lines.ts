import type { DebugLine } from './types';

export type DebugLineBuilder = () => readonly DebugLine[];

const EMPTY_DEBUG_LINES: readonly DebugLine[] = Object.freeze([]);

/**
 * Reuses the combined line list while every source version is unchanged.
 * The renderer independently caches the packed GPU line stream; this cache
 * prevents the main loop from rebuilding the same source list before that
 * renderer cache can reject the upload.
 */
export class FrameLineStager {
  private readonly combinedLines: DebugLine[] = [];
  private initialized = false;
  private lastDebugEnabled = false;
  private lastBackendVersion = -1;
  private lastSoftVersion = -1;
  private lastEffectVersion = -1;
  private lastInspectionVersion = -1;
  private lastSoftLines: readonly DebugLine[] | null = null;
  private lastEffectLines: readonly DebugLine[] | null = null;
  private lastInspectionLines: readonly DebugLine[] | null = null;

  resolve(
    debugEnabled: boolean,
    backendVersion: number,
    softVersion: number,
    effectVersion: number,
    buildRigidLines: DebugLineBuilder,
    softLines: readonly DebugLine[],
    effectLines: readonly DebugLine[],
    inspectionLines: readonly DebugLine[] = EMPTY_DEBUG_LINES,
    inspectionVersion = 0,
  ): readonly DebugLine[] {
    const sourceStateUnchanged = this.initialized &&
      this.lastDebugEnabled === debugEnabled &&
      this.lastEffectVersion === effectVersion &&
      this.lastEffectLines === effectLines &&
      this.lastInspectionVersion === inspectionVersion &&
      this.lastInspectionLines === inspectionLines &&
      (!debugEnabled || (
        this.lastBackendVersion === backendVersion &&
        this.lastSoftVersion === softVersion &&
        this.lastSoftLines === softLines
      ));
    if (sourceStateUnchanged) return this.combinedLines;

    let write = 0;
    if (debugEnabled) {
      const rigidLines = buildRigidLines();
      for (let i = 0; i < rigidLines.length; i++) this.combinedLines[write++] = rigidLines[i];
      for (let i = 0; i < softLines.length; i++) this.combinedLines[write++] = softLines[i];
    }
    for (let i = 0; i < effectLines.length; i++) this.combinedLines[write++] = effectLines[i];
    // Inspection witnesses are presentation-only CAD aids. They remain
    // available while solver diagnostics are off and never enter replay or
    // evidence hashes.
    for (let i = 0; i < inspectionLines.length; i++) this.combinedLines[write++] = inspectionLines[i];
    this.combinedLines.length = write;

    this.initialized = true;
    this.lastDebugEnabled = debugEnabled;
    this.lastBackendVersion = backendVersion;
    this.lastSoftVersion = softVersion;
    this.lastEffectVersion = effectVersion;
    this.lastInspectionVersion = inspectionVersion;
    this.lastSoftLines = softLines;
    this.lastEffectLines = effectLines;
    this.lastInspectionLines = inspectionLines;
    return this.combinedLines;
  }
}
