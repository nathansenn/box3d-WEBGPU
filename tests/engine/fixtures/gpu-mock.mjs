// A stand-in for a WebGPU device, for the tests of what does not need a shader to run (tests/engine/gpu-*.test.mjs).
// Buffers are real memory: writeBuffer, copyBufferToBuffer, clearBuffer and mapAsync behave as on a device. Compute
// dispatches are recorded in the order the queue runs them (entry point, bind-group label, dynamic offsets, workgroup
// counts) and, when `execute` is given, handed to it with the bound buffers, so a test can stand in for the shader.
// `destroy()` loses the device: `lost` resolves and every later map is refused.
export const GPU_GLOBALS = {
  GPUBufferUsage: {MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512},
  GPUShaderStage: {VERTEX: 1, FRAGMENT: 2, COMPUTE: 4},
  GPUMapMode: {READ: 1, WRITE: 2},
};
export function installGpuGlobals() { for (const [name, value] of Object.entries(GPU_GLOBALS)) if (!(name in globalThis)) globalThis[name] = value; }

export function mockDevice({limits = {}, execute = null} = {}) {
  let lost = false, resolveLost;
  const dispatches = [], submitted = [];
  const device = {
    label: 'mock', dispatches, submitted,
    limits: {maxStorageBuffersPerShaderStage: 8, maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, maxComputeWorkgroupsPerDimension: 65535, maxComputeInvocationsPerWorkgroup: 256, minUniformBufferOffsetAlignment: 256, ...limits},
    features: new Set(),
    lost: new Promise((resolve) => { resolveLost = resolve; }),
    pushErrorScope() {}, popErrorScope: async () => null,
    addEventListener() {}, removeEventListener() {},
    destroy() { if (!lost) { lost = true; resolveLost({reason: 'destroyed', message: 'The device was destroyed.'}); } },
    createBuffer({label, size, usage}) {
      const data = new ArrayBuffer(size);
      let mapped = false, destroyed = false;
      return {label, size, usage, data, get mapState() { return mapped ? 'mapped' : 'unmapped'; },
        async mapAsync() { await null; if (lost) throw new Error('the device is lost'); if (destroyed) throw new Error('the buffer is destroyed'); mapped = true; },
        getMappedRange(offset = 0, length = size - offset) { if (!mapped) throw new Error('not mapped'); return data.slice(offset, offset + length); },
        unmap() { mapped = false; }, destroy() { destroyed = true; }};
    },
    createShaderModule: ({label, code}) => ({label, code, getCompilationInfo: async () => ({messages: []})}),
    createBindGroupLayout: descriptor => ({...descriptor}),
    createPipelineLayout: descriptor => ({...descriptor}),
    createRenderPipeline: ({label, fragment, multisample}) => ({label, entryPoint: fragment.entryPoint, samples: multisample?.count ?? 1}),
    createComputePipeline: ({label, compute}) => ({label, entryPoint: compute.entryPoint}),
    createComputePipelineAsync: async ({label, compute}) => ({label, entryPoint: compute.entryPoint}),
    createBindGroup: ({label, entries}) => ({label, buffers: entries.map(e => e.resource.buffer)}),
    createCommandEncoder() {
      const commands = [];
      return {
        beginComputePass() {
          let pipeline = null, group = null, offsets = [];
          return {setPipeline(p) { pipeline = p; }, setBindGroup(index, g, o = []) { if (index === 0) { group = g; offsets = [...o]; } },
            dispatchWorkgroups(x, y = 1, z = 1) { commands.push({type: 'dispatch', entryPoint: pipeline.entryPoint, group, offsets, workgroups: [x, y, z]}); }, end() {}};
        },
        copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) { commands.push({type: 'copy', source, sourceOffset, target, targetOffset, size}); },
        clearBuffer(buffer, offset = 0, size = buffer.size - offset) { commands.push({type: 'clear', buffer, offset, size}); },
        finish: () => ({commands}),
      };
    },
    queue: {
      writeBuffer(buffer, offset, data, dataOffset = 0, size) {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data, dataOffset, size ?? data.byteLength - dataOffset) : new Uint8Array(data.buffer, data.byteOffset + dataOffset, size ?? data.byteLength - dataOffset);
        new Uint8Array(buffer.data).set(bytes, offset);
      },
      submit(buffers) {
        if (lost) return;
        for (const {commands} of buffers) for (const c of commands) {
          submitted.push(c.type);
          if (c.type === 'copy') new Uint8Array(c.target.data).set(new Uint8Array(c.source.data, c.sourceOffset, c.size), c.targetOffset);
          else if (c.type === 'clear') new Uint8Array(c.buffer.data, c.offset, c.size).fill(0);
          else { dispatches.push({entryPoint: c.entryPoint, group: c.group.label, offsets: c.offsets, workgroups: c.workgroups}); execute?.(c); }
        }
      },
      onSubmittedWorkDone: async () => {},
    },
  };
  return device;
}
