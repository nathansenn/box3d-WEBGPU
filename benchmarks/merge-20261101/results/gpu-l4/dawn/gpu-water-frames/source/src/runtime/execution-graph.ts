/** Typed synchronous incremental DAG. Versions track mutations; fresh generations track lifetimes.
 * Resource aliases must share handles. Effects validate ordering, not GPU completion.
 * Failed nodes do not publish; callers must stage external side effects themselves. */
export type GenerationIdentity = string | number | symbol | object;
export type NumericPrecision = 'f16' | 'f32' | 'f64' | 'i32' | 'u32' | 'u16' | 'u8' | 'bool' | 'exact';
export interface ValueContract { readonly shape?: readonly number[]; readonly units?: string; readonly precision?: NumericPrecision; }
export interface BufferResourceDescriptor extends ValueContract { readonly kind: 'buffer'; readonly byteLength: number; }
export interface TextureResourceDescriptor extends ValueContract {
  readonly kind: 'texture'; readonly width: number; readonly height: number;
  readonly depthOrArrayLayers?: number; readonly format: string; readonly sampleCount: 1 | 4;
}
export type ResourceDescriptor = BufferResourceDescriptor | TextureResourceDescriptor;
export type ResourceRequirement =
  | ({ readonly kind: 'buffer' } & Partial<Omit<BufferResourceDescriptor, 'kind'>>)
  | ({ readonly kind: 'texture' } & Partial<Omit<TextureResourceDescriptor, 'kind'>>);
export interface GraphHandle<T> { readonly id: string; readonly contract?: ValueContract; readonly __valueType?: T; }
export interface ResourceHandle { readonly id: string; readonly descriptor: ResourceDescriptor; }
export interface DependencyRequirement { readonly input: GraphHandle<unknown>; readonly expects: ValueContract; }
export type GraphDependency = GraphHandle<unknown> | DependencyRequirement;
export type ResourceAccess = ResourceHandle | { readonly resource: ResourceHandle; readonly expects: ResourceRequirement };
export interface ExecutionContext { readonly generation: GenerationIdentity; read<T>(handle: GraphHandle<T>): T; }
export interface NodeDefinition<T> {
  readonly id: string; readonly dependencies: readonly GraphDependency[];
  readonly compute: (context: ExecutionContext) => T; readonly contract?: ValueContract;
  readonly reads?: readonly ResourceAccess[]; readonly writes?: readonly ResourceAccess[];
}
export interface SourceVersion { readonly generation: GenerationIdentity; readonly version: number; }
export interface ExecutionStats {
  sourceUpdates: number; invalidations: number; generationChanges: number; evaluations: number;
  nodesAttempted: number; nodesComputed: number; cacheHits: number; failures: number;
}
interface BaseEntry {
  handle: GraphHandle<unknown>; value: unknown; revision: number; published: boolean; dependents: Set<NodeEntry>;
}
interface InputEntry extends BaseEntry { kind: 'input'; sourceVersion: number; }
interface NodeEntry extends BaseEntry {
  kind: 'node'; dirty: boolean; dependencies: readonly Entry[];
  allowedReads: ReadonlySet<GraphHandle<unknown>>; compute: (context: ExecutionContext) => unknown;
  reads: ReadonlySet<ResourceHandle>; writes: ReadonlySet<ResourceHandle>;
}
type Entry = InputEntry | NodeEntry;
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('Execution graph: ' + message);
}
function validateGeneration(generation: GenerationIdentity): void {
  requireCondition(typeof generation === 'string' || typeof generation === 'symbol' ||
    (typeof generation === 'number' && Number.isFinite(generation)) ||
    (typeof generation === 'object' && generation !== null),
    'generation must be a string, symbol, finite number or non-null object');
}
function validateShape(shape: readonly number[] | undefined): void {
  if (shape === undefined) return;
  requireCondition(Array.isArray(shape), 'shape must be an array');
  let count = 1;
  for (const n of shape) {
    requireCondition(Number.isSafeInteger(n) && n >= 0, 'shape dimensions must be nonnegative safe integers');
    count *= n;
    requireCondition(Number.isSafeInteger(count), 'shape size exceeds the safe integer range');
  }
}
function frozenContract(contract: ValueContract | undefined): ValueContract | undefined {
  if (!contract) return undefined;
  validateShape(contract.shape);
  return Object.freeze({ ...contract, shape: contract.shape ? Object.freeze([...contract.shape]) : undefined });
}

/** Metadata checks do not prove a callback's physical units or precision. */
export function assertValueContract(actual: ValueContract | undefined, expected: ValueContract, label = 'value'): void {
  validateShape(expected.shape);
  for (const key of ['units', 'precision'] as const) {
    if (expected[key] !== undefined) requireCondition(actual?.[key] === expected[key], label + ' ' + key + ' mismatch');
  }
  if (expected.shape) requireCondition(actual?.shape && actual.shape.length === expected.shape.length &&
    actual.shape.every((n, i) => n === expected.shape![i]), label + ' shape mismatch');
}
export function validateResourceDescriptor(descriptor: ResourceDescriptor): void {
  validateShape(descriptor.shape);
  if (descriptor.kind === 'buffer') {
    requireCondition(Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength >= 0,
      'buffer byteLength must be a nonnegative safe integer');
  } else {
    requireCondition(descriptor.kind === 'texture', 'unknown resource kind');
    for (const [name, size] of [['width', descriptor.width], ['height', descriptor.height],
      ['depthOrArrayLayers', descriptor.depthOrArrayLayers ?? 1]] as const) {
      requireCondition(Number.isSafeInteger(size) && size > 0, 'texture ' + name + ' must be a positive safe integer');
    }
    requireCondition(typeof descriptor.format === 'string' && descriptor.format.length > 0, 'texture format is required');
    requireCondition(descriptor.sampleCount === 1 || descriptor.sampleCount === 4, 'texture sampleCount must be 1 or 4');
    requireCondition(descriptor.sampleCount === 1 || (descriptor.depthOrArrayLayers ?? 1) === 1,
      'multisampled texture must have one array layer');
  }
}
/** Check only declared fields; no device capability support is inferred. */
export function assertResourceContract(actual: ResourceDescriptor, expected: ResourceRequirement, label = 'resource'): void {
  validateResourceDescriptor(actual);
  requireCondition(actual.kind === expected.kind, label + ' kind mismatch');
  assertValueContract(actual, expected, label);
  if (expected.kind === 'buffer' && actual.kind === 'buffer') {
    if (expected.byteLength !== undefined) requireCondition(actual.byteLength === expected.byteLength, label + ' byteLength mismatch');
  } else if (expected.kind === 'texture' && actual.kind === 'texture') {
    for (const key of ['width', 'height', 'format', 'sampleCount'] as const) {
      if (expected[key] !== undefined) requireCondition(actual[key] === expected[key], label + ' ' + key + ' mismatch');
    }
    if (expected.depthOrArrayLayers !== undefined) requireCondition(
      (actual.depthOrArrayLayers ?? 1) === expected.depthOrArrayLayers, label + ' depthOrArrayLayers mismatch');
  }
}
function validateValue(value: unknown, contract: ValueContract | undefined, label: string): void {
  if (!contract?.shape) return;
  if (contract.shape.length === 0) {
    requireCondition(typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean',
      label + ' requires a scalar value');
    return;
  }
  const count = contract.shape.reduce((a, b) => a * b, 1);
  requireCondition((Array.isArray(value) || ArrayBuffer.isView(value)) &&
    'length' in value && value.length === count, label + ' flat array length must be ' + count);
}
function emptyStats(): ExecutionStats {
  return { sourceUpdates: 0, invalidations: 0, generationChanges: 0, evaluations: 0,
    nodesAttempted: 0, nodesComputed: 0, cacheHits: 0, failures: 0 };
}

export class ExecutionGraph {
  private readonly entries = new Map<string, Entry>();
  private readonly resources = new Map<string, ResourceHandle>();
  private readonly nodes: NodeEntry[] = [];
  private counters = emptyStats();
  private nextRevision = 0;
  private evaluating = false;
  private generationIdentity: GenerationIdentity;
  private readonly retiredPrimitiveGenerations = new Set<string | number | symbol>();
  private readonly retiredObjectGenerations = new WeakSet<object>();

  constructor(generation: GenerationIdentity = 0) {
    validateGeneration(generation);
    this.generationIdentity = generation;
  }
  get generation(): GenerationIdentity { return this.generationIdentity; }
  private assertEditable(): void {
    requireCondition(!this.evaluating, 'graph mutations or nested evaluation are not allowed during compute; declare dependencies and use context.read');
  }
  private makeHandle<T>(id: string, contract?: ValueContract): GraphHandle<T> {
    requireCondition(typeof id === 'string' && id.length > 0 && !this.entries.has(id), 'duplicate or empty node id ' + id);
    return Object.freeze({ id, contract: frozenContract(contract) });
  }
  private entry(handle: GraphHandle<unknown>): Entry {
    const found = this.entries.get(handle.id);
    requireCondition(found && found.handle === handle, 'foreign or unknown handle ' + handle.id);
    return found;
  }
  input<T>(id: string, contract?: ValueContract): GraphHandle<T> {
    this.assertEditable();
    const handle = this.makeHandle<T>(id, contract);
    this.entries.set(id, { kind: 'input', handle, value: undefined, revision: 0,
      published: false, dependents: new Set(), sourceVersion: -1 });
    return handle;
  }
  resource(id: string, descriptor: ResourceDescriptor): ResourceHandle {
    this.assertEditable();
    requireCondition(typeof id === 'string' && id.length > 0 && !this.resources.has(id), 'duplicate or empty resource id ' + id);
    validateResourceDescriptor(descriptor);
    const frozen = Object.freeze({ ...descriptor, shape: descriptor.shape ? Object.freeze([...descriptor.shape]) : undefined });
    const resource = Object.freeze({ id, descriptor: frozen });
    this.resources.set(id, resource);
    return resource;
  }
  private resolveAccesses(accesses: readonly ResourceAccess[] | undefined): ReadonlySet<ResourceHandle> {
    const result = new Set<ResourceHandle>();
    for (const access of accesses ?? []) {
      const resource = 'resource' in access ? access.resource : access;
      requireCondition(this.resources.get(resource.id) === resource, 'foreign or unknown resource ' + resource.id);
      if ('resource' in access) assertResourceContract(resource.descriptor, access.expects, resource.id);
      result.add(resource);
    }
    return result;
  }
  node<T>(definition: NodeDefinition<T>): GraphHandle<T> {
    this.assertEditable();
    const handle = this.makeHandle<T>(definition.id, definition.contract);
    const dependencies = definition.dependencies.map(dependency => {
      const value = 'input' in dependency ? dependency.input : dependency;
      if ('input' in dependency) assertValueContract(value.contract, dependency.expects, value.id);
      return this.entry(value);
    });
    requireCondition(new Set(dependencies).size === dependencies.length, 'duplicate dependency in ' + definition.id);
    const reads = this.resolveAccesses(definition.reads);
    const writes = this.resolveAccesses(definition.writes);
    // Referencing only already registered handles makes cycles impossible.
    const ancestors = new Set<Entry>();
    const stack = [...dependencies];
    while (stack.length) {
      const ancestor = stack.pop()!;
      if (ancestors.has(ancestor)) continue;
      ancestors.add(ancestor);
      if (ancestor.kind === 'node') stack.push(...ancestor.dependencies);
    }
    for (const prior of this.nodes) {
      if (ancestors.has(prior)) continue;
      for (const resource of writes) requireCondition(!prior.reads.has(resource) && !prior.writes.has(resource),
        'unordered resource conflict on ' + resource.id + ' between ' + prior.handle.id + ' and ' + definition.id + '; declare a dependency');
      for (const resource of reads) requireCondition(!prior.writes.has(resource),
        'unordered resource conflict on ' + resource.id + ' between ' + prior.handle.id + ' and ' + definition.id + '; declare a dependency');
    }
    const entry: NodeEntry = { kind: 'node', handle, value: undefined, revision: 0,
      published: false, dependents: new Set(), dirty: true, dependencies,
      allowedReads: new Set(dependencies.map(dependency => dependency.handle)),
      compute: definition.compute, reads, writes };
    this.entries.set(handle.id, entry);
    this.nodes.push(entry);
    for (const dependency of dependencies) dependency.dependents.add(entry);
    return handle;
  }

  private markDirty(entry: Entry, includeSelf: boolean): void {
    const stack: NodeEntry[] = includeSelf && entry.kind === 'node' ? [entry] : [...entry.dependents];
    const seen = new Set<NodeEntry>();
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      if (!node.dirty) this.counters.invalidations++;
      node.dirty = true;
      for (const dependent of node.dependents) stack.push(dependent);
    }
  }
  setInput<T>(handle: GraphHandle<T>, value: T, source: SourceVersion): boolean {
    this.assertEditable();
    const entry = this.entry(handle);
    requireCondition(entry.kind === 'input', handle.id + ' is not an input');
    requireCondition(Object.is(source.generation, this.generationIdentity), 'stale generation for ' + handle.id);
    requireCondition(Number.isSafeInteger(source.version) && source.version >= 0, 'source version must be a nonnegative safe integer');
    requireCondition(!entry.published || source.version >= entry.sourceVersion, 'stale version for ' + handle.id);
    validateValue(value, handle.contract, handle.id);
    if (entry.published && source.version === entry.sourceVersion && Object.is(value, entry.value)) return false;
    entry.value = value;
    entry.sourceVersion = source.version;
    entry.revision = ++this.nextRevision;
    entry.published = true;
    this.counters.sourceUpdates++;
    this.markDirty(entry, false);
    return true;
  }
  setGeneration(generation: GenerationIdentity): boolean {
    this.assertEditable();
    validateGeneration(generation);
    if (Object.is(generation, this.generationIdentity)) return false;
    const retired = typeof generation === 'object'
      ? this.retiredObjectGenerations.has(generation) : this.retiredPrimitiveGenerations.has(generation);
    requireCondition(!retired, 'generation identities cannot be reused after retirement');
    if (typeof this.generationIdentity === 'object') this.retiredObjectGenerations.add(this.generationIdentity);
    else this.retiredPrimitiveGenerations.add(this.generationIdentity);
    this.generationIdentity = generation;
    this.counters.generationChanges++;
    for (const entry of this.entries.values()) {
      entry.value = undefined; entry.published = false; entry.revision = 0;
      if (entry.kind === 'input') entry.sourceVersion = -1;
      else {
        if (!entry.dirty) this.counters.invalidations++;
        entry.dirty = true;
      }
    }
    return true;
  }

  invalidate(handle?: GraphHandle<unknown>): void {
    this.assertEditable();
    if (handle) {
      const entry = this.entry(handle);
      if (entry.kind === 'input' && entry.published) entry.revision = ++this.nextRevision;
      this.markDirty(entry, true);
    } else {
      for (const node of this.nodes) {
        if (!node.dirty) this.counters.invalidations++;
        node.dirty = true;
      }
    }
  }
  evaluate<T>(handle: GraphHandle<T>): T {
    this.assertEditable();
    const entry = this.entry(handle);
    this.counters.evaluations++;
    this.evaluating = true;
    try { return this.evaluateEntry(entry) as T; }
    finally { this.evaluating = false; }
  }
  private evaluateEntry(entry: Entry): unknown {
    if (entry.kind === 'input') {
      requireCondition(entry.published, 'input ' + entry.handle.id + ' has not been published for the current generation');
      return entry.value;
    }
    if (!entry.dirty && entry.published) {
      this.counters.cacheHits++;
      return entry.value;
    }
    for (const dependency of entry.dependencies) this.evaluateEntry(dependency);
    this.counters.nodesAttempted++;
    try {
      const context: ExecutionContext = {
        generation: this.generationIdentity,
        read: <T>(handle: GraphHandle<T>): T => {
          requireCondition(entry.allowedReads.has(handle), entry.handle.id + ' read undeclared dependency ' + handle.id);
          return this.entry(handle).value as T;
        },
      };
      const value = entry.compute(context);
      requireCondition(value === null || (typeof value !== 'object' && typeof value !== 'function') ||
        !('then' in value && typeof value.then === 'function'), entry.handle.id + ' returned a Promise; compute must be synchronous');
      validateValue(value, entry.handle.contract, entry.handle.id);
      // Publish only after computation and validation succeed. Failed nodes stay dirty.
      entry.value = value;
      entry.revision = ++this.nextRevision;
      entry.published = true;
      entry.dirty = false;
      this.counters.nodesComputed++;
      return value;
    } catch (error) {
      this.counters.failures++;
      throw error;
    }
  }
  revision(handle: GraphHandle<unknown>): number { return this.entry(handle).revision; }
  stats(): ExecutionStats { return { ...this.counters }; }
  resetStats(): void { this.assertEditable(); this.counters = emptyStats(); }
}
