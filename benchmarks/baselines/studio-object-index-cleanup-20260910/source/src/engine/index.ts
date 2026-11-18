export * from './contracts.ts';
export * from './studio-runtime.ts';
export * from './studio-client.ts';
export * from './workbench-runtime.ts';
export * from './studio-sweep.ts';
export * from './linear-water.ts';
/** Opt-in experiment; default Studio runtime retains the faster object solver. */
export {PackedFailureSimulation} from '../studio/packed-physics.ts';
export {GpuLinearWater,GPU_LINEAR_WATER_BACKEND,type GpuWaterFields,type GpuWaterCheckpoint,type GpuWaterCreateOptions} from '../webgpu/linear-water.ts';
export type {WaterTelemetry} from '../webgpu/water-telemetry.ts';
