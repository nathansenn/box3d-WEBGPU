/**
 * WebGPU compute backends (`box3d-webgpu-kit/gpu`): the grains, the shallow water and the incompressible flow in
 * float32 on the GPU, each with a float32 CPU reference that runs the same program (the reference gives the bits
 * SwiftShader's GPU gives where docs/GPU_COMPUTE.md says "identical"), and the subsystems of scene sections that say
 * `"backend": "gpu"`.
 *
 *   import {createWorld} from 'box3d-webgpu-kit';
 *   import {loadSimulationScene} from 'box3d-webgpu-kit/simulation';
 *   import {acquireGpuCompute, gpuSceneBackends} from 'box3d-webgpu-kit/gpu';
 *   const compute = await acquireGpuCompute();                     // throws GPU_UNAVAILABLE without WebGPU compute
 *   const loaded = loadSimulationScene(world, scene, {gpu: gpuSceneBackends(compute)});
 *   await loaded.simulation.stepAsync();                           // step() is refused while a section is on the GPU
 *   const saved = await loaded.simulation.checkpointAsync();       // same file format as checkpoint()
 *   await loaded.simulation.pullAsync();                           // the GPU state into the float64 objects (to read or save)
 *
 * `gpuSceneBackends('reference')` runs the same float32 programs on the CPU (no device; slower than the float64
 * solvers): use it for tests and as the fall back. The CPU float64 solvers stay the default and the reference of
 * the validation; a GPU section's results are float32 and are not their bits.
 *
 * TypeScript: the declarations name the WebGPU types (GPUDevice, GPUBuffer, ...). Add `@webgpu/types` to your
 * project's `types` when you import this entry; the rest of the kit does not need them.
 * See docs/GPU_COMPUTE.md in the repository for the validation, the float32 tolerances and the limits.
 */
export {acquireGpuCompute, gpuComputeSupported, GpuCompute, GpuProgram, type GpuAcquireOptions, type GpuComputeInfo, type GpuComputeNeeds} from './core/gpu/compute.js';
export {gpuSceneBackends, gpuShallowWaterSubsystem, gpuGranularSubsystem, GPU_SCENE_BACKEND, type GpuSceneSubsystem} from './core/gpu/scene-backends.js';
export {GpuShallowWater, ShallowWaterRunner, SHALLOW_WATER_GPU_SOLVER_ID, type GpuShallowWaterOptions, type ShallowWaterRunnerOptions} from './core/gpu/shallow-water-gpu.js';
export {ShallowWaterF32, SHALLOW_WATER_CHECKPOINT, type ShallowWaterF32Stats} from './core/gpu/shallow-water-f32.js';
export {GpuGranular, GranularRunner, GpuGranularCoupling, demMemory, GRANULAR_GPU_SOLVER_ID, type GranularRunnerOptions} from './core/gpu/granular-gpu.js';
export {GranularF32, GRANULAR_CHECKPOINT, type DemOptions, type DemStats} from './core/gpu/granular-f32.js';
export {GpuFluid, FluidRunner, fluidMemory, FLUID_GPU_SOLVER_ID} from './core/gpu/fluid-gpu.js';
export {FluidF32, FLUID_F32_SOLVER_ID} from './core/gpu/fluid-f32.js';
export {FLUID_MAX_OBSTACLES, FLUID_PROGRAM_CHECKPOINT, type FluidBackendOptions} from './core/gpu/fluid-program.js';
