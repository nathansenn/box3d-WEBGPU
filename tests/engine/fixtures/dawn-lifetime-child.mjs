// Child process of tests/engine/dawn-lifetime.test.mjs (run with --expose-gc).
//   pinned:   the GPU object comes from scripts/dawn-gpu.mjs, as in every script and test of this repository.
//   unpinned: the GPU object comes straight from the `webgpu` package and its last reference is dropped.
// Either way the script drops its own reference and collects garbage while dawn.node still has a ProcessEvents
// callback queued (createRenderPipelineAsync polls the instance through setImmediate), which is the order of
// events at the end of the CI run that crashed.
import {create, globals} from 'webgpu';
import {createDawnGpu} from '../../../scripts/dawn-gpu.mjs';

Object.assign(globalThis, globals);
const mode = process.argv[2];
if (mode !== 'pinned' && mode !== 'unpinned') throw new Error(`unknown mode ${mode}`);
let gpu = mode === 'pinned' ? createDawnGpu(['backend=null']) : create(['backend=null']);
const device = await (await gpu.requestAdapter()).requestDevice();
const code = '@vertex fn v() -> @builtin(position) vec4f { return vec4f(); } @fragment fn f() -> @location(0) vec4f { return vec4f(1.0); }';
const module = device.createShaderModule({code});
await device.createRenderPipelineAsync({layout: 'auto', vertex: {module}, fragment: {module, targets: [{format: 'rgba8unorm'}]}});
device.destroy();
gpu = null;
globalThis.gc();
await new Promise(resolve => setTimeout(resolve, 20));
globalThis.gc();
console.log(`dawn lifetime ${mode}: exited cleanly`);
