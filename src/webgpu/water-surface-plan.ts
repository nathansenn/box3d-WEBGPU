import type { GpuWaterSurfaceFrame } from '../types';
import { ExecutionGraph, type ExecutionStats } from '../runtime/execution-graph';

export type WaterSurfaceDescription = Pick<GpuWaterSurfaceFrame,
  'indices' | 'vertexCount' | 'indexCount' | 'topologyVersion' | 'frameVersion' |
  'cols' | 'rows' | 'width' | 'depth' | 'baseY'>;

type Layout = Pick<WaterSurfaceDescription, 'cols' | 'rows' | 'width' | 'depth' | 'baseY' | 'vertexCount'>;
type Topology = Pick<WaterSurfaceDescription, 'indices' | 'indexCount' | 'topologyVersion' | 'vertexCount'>;
export interface WaterSurfacePlan {
  readonly params: Uint8Array;
  readonly indexCount: number;
  readonly maxIndex: number;
}

/** Pure metadata planning; the renderer owns submission and publication of GPU state.
 * State buffers are intentionally absent: advancing water never rescans topology. */
export class WaterSurfacePlanner {
  private readonly graph = new ExecutionGraph(0);
  private generationValue = 0;
  private version = 0;
  private lastLayout: Layout | null = null;
  private lastTopology: Topology | null = null;
  private readonly layout = this.graph.input<Layout>('water-layout');
  private readonly topology = this.graph.input<Topology>('water-topology');
  private readonly params = this.graph.node<Uint8Array>({
    id: 'water-params', dependencies: [this.layout],
    contract: { shape: [64], precision: 'u8' },
    compute: (context) => {
      const layout = context.read(this.layout);
      if (!Number.isSafeInteger(layout.cols) || !Number.isSafeInteger(layout.rows) ||
          layout.cols < 2 || layout.rows < 2 ||
          layout.cols * layout.rows !== layout.vertexCount ||
          layout.vertexCount > 16384) throw new Error('Water surface has an invalid grid shape or exceeds renderer capacity.');
      if (![layout.width, layout.depth, layout.baseY].every(Number.isFinite) ||
          Math.fround(layout.width) <= 0 || Math.fround(layout.depth) <= 0 ||
          ![layout.width, layout.depth, layout.baseY].every((value) => Number.isFinite(Math.fround(value)))) {
        throw new Error('Water surface requires finite f32 extents and a finite elevation.');
      }
      const bytes = new Uint8Array(64);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, layout.cols, true);
      view.setUint32(4, layout.rows, true);
      view.setUint32(8, layout.vertexCount, true);
      view.setFloat32(16, layout.width, true);
      view.setFloat32(20, layout.depth, true);
      view.setFloat32(24, layout.baseY, true);
      return bytes;
    },
  });
  private readonly checkedTopology = this.graph.node<{ indexCount: number; maxIndex: number }>({
    id: 'water-checked-topology', dependencies: [this.topology],
    compute: (context) => {
      const topology = context.read(this.topology);
      if (!(topology.indices instanceof Uint16Array) ||
          !Number.isSafeInteger(topology.indexCount) || topology.indexCount <= 0 ||
          topology.indexCount > topology.indices.length || topology.indexCount > 98304 ||
          topology.indexCount % 3 !== 0) throw new Error('Water surface has invalid triangle indices.');
      let maxIndex = 0;
      for (let i = 0; i < topology.indexCount; i++) maxIndex = Math.max(maxIndex, topology.indices[i]);
      if (maxIndex >= topology.vertexCount) throw new Error('Water surface index exceeds the vertex count.');
      return { indexCount: topology.indexCount, maxIndex };
    },
  });
  private readonly plan = this.graph.node<WaterSurfacePlan>({
    id: 'water-plan', dependencies: [this.params, this.checkedTopology],
    compute: (context) => ({ params: context.read(this.params), ...context.read(this.checkedTopology) }),
  });

  get generation(): number { return this.generationValue; }
  stats(): ExecutionStats { return this.graph.stats(); }

  invalidate(): void {
    this.graph.setGeneration(++this.generationValue);
    this.lastLayout = null;
    this.lastTopology = null;
  }

  resolve(surface: WaterSurfaceDescription): WaterSurfacePlan {
    const oldLayout = this.lastLayout;
    if (!oldLayout || oldLayout.cols !== surface.cols || oldLayout.rows !== surface.rows ||
        oldLayout.width !== surface.width || oldLayout.depth !== surface.depth ||
        oldLayout.baseY !== surface.baseY || oldLayout.vertexCount !== surface.vertexCount) {
      const layout: Layout = { cols: surface.cols, rows: surface.rows, width: surface.width,
        depth: surface.depth, baseY: surface.baseY, vertexCount: surface.vertexCount };
      this.graph.setInput(this.layout, layout, { generation: this.generationValue, version: ++this.version });
      this.lastLayout = layout;
    }
    const oldTopology = this.lastTopology;
    if (!oldTopology || oldTopology.indices !== surface.indices ||
        oldTopology.indexCount !== surface.indexCount ||
        oldTopology.vertexCount !== surface.vertexCount ||
        oldTopology.topologyVersion !== surface.topologyVersion) {
      const topology: Topology = { indices: surface.indices, indexCount: surface.indexCount,
        topologyVersion: surface.topologyVersion, vertexCount: surface.vertexCount };
      this.graph.setInput(this.topology, topology, { generation: this.generationValue, version: ++this.version });
      this.lastTopology = topology;
    }
    return this.graph.evaluate(this.plan);
  }
}

