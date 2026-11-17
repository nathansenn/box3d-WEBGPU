// The one way the scripts and tests create a Dawn GPU object (the `webgpu` npm package, dawn.node).
//
// Every GPU object made here stays referenced until the process exits. Do not drop it (`gpu = null`), and do
// not create one in a scope that ends while its devices can still run: dawn.node 0.4.0 frees its
// dawn::native::Instance when the garbage collector finalizes the JS GPU object, but every adapter, device,
// queue and buffer polls that instance through an AsyncRunner that holds only a raw pointer to it
// (dawn src/dawn/node/binding/AsyncRunner.h: `const dawn::native::Instance* const instance_`; GPU.h owns it
// as `std::unique_ptr<dawn::native::Instance>`). A ProcessEvents callback that setImmediate queued before the
// collection then runs on freed memory: a segmentation fault, `std::system_error: Invalid argument`, a glibc
// mutex assertion, or a hang in InstanceBase::ProcessEvents, depending on what reused the memory. That is the
// CI crash of 2026-11-16 (run 43942495498, commit c059041), reproduced and explained in docs/TEST_PLAN.md
// ("Dawn objects must live until the process exits").
import {create, globals} from 'webgpu';

const pinned = [];
// A global symbol as well as the module array: a module-scope binding that no closure reads is not a GC root
// once the module has finished evaluating.
Object.defineProperty(globalThis, Symbol.for('box3d.dawnGpuObjects'), {value: pinned, enumerable: false});

/** Installs the WebGPU globals (GPUBufferUsage, ...) and returns a Dawn GPU object pinned for the process lifetime. */
export function createDawnGpu(flags = []) {
  Object.assign(globalThis, globals);
  const gpu = create(flags);
  pinned.push(gpu);
  return gpu;
}

/** How many Dawn GPU objects this process has created and pinned. */
export function pinnedDawnGpuCount() {
  return pinned.length;
}

export {globals};
