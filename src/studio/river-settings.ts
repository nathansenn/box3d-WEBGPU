/** Flow ratios from Material Forge's canonical Lessons Bridge water profiles.
 * These tune visible water only. They never change the structural solver. */
export const RIVER_PROFILES = [
  { id: 'calm', name: 'Bridge calm', description: 'A slow current with quiet banks.', flow: .50, wave: .34, foam: .24 },
  { id: 'academy', name: 'Lessons Bridge', description: 'Layered ripples and broken reflections.', flow: 1, wave: 1, foam: 1 },
  { id: 'rapids', name: 'Bridge rapids', description: 'Faster current and stronger surface breakup.', flow: 1.35, wave: 1.24, foam: 1.38 },
] as const;
export type RiverProfile = typeof RIVER_PROFILES[number]['id'];
export interface RiverSettings { flow: number; wave: number; foam: number; animate: boolean }
export const DEFAULT_RIVER: Readonly<RiverSettings> = { flow: 1, wave: 1, foam: 1, animate: true };
const finite = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};
export function normalizeRiver(value: Partial<RiverSettings> = {}): RiverSettings {
  return { flow: finite(value.flow, 1, .15, 2), wave: finite(value.wave, 1, 0, 1.8), foam: finite(value.foam, 1, 0, 2), animate: typeof value.animate === 'boolean' ? value.animate : true };
}
export function riverProfile(settings: RiverSettings): RiverProfile | 'custom' {
  return RIVER_PROFILES.find(p => (['flow', 'wave', 'foam'] as const).every(k => Math.abs(p[k] - settings[k]) < .00001))?.id ?? 'custom';
}
export function readRiver(query: URLSearchParams, fallbackProfile: RiverProfile = 'academy'): RiverSettings {
  const profile = RIVER_PROFILES.find(p => p.id === (query.get('water') ?? fallbackProfile)) ?? RIVER_PROFILES[1];
  const value = (key: 'flow' | 'wave' | 'foam') => query.has(key) && query.get(key)!.trim() !== '' ? Number(query.get(key)) : profile[key];
  return normalizeRiver({flow: value('flow'), wave: value('wave'), foam: value('foam'), animate: query.get('flowMotion') !== '0'});
}
export function writeRiver(query: URLSearchParams, settings: RiverSettings): void {
  const clean = normalizeRiver(settings);
  query.set('water', riverProfile(clean));
  for (const key of ['flow', 'wave', 'foam'] as const) query.set(key, String(clean[key]));
  query.set('flowMotion', clean.animate ? '1' : '0');
}
export function advanceRiverClock(clock: number, elapsed: number, settings: RiverSettings): number {
  if (!settings.animate || !Number.isFinite(elapsed)) return clock;
  return clock + Math.min(.25, Math.max(0, elapsed)) * settings.flow;
}
