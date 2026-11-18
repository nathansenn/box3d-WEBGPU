type Face = { nodes: readonly number[]; links: readonly number[] };

/** Connectivity is rebuilt on fracture/replay changes, never on intact motion. */
export class SurfaceTopology {
  readonly indices: Uint32Array;
  exposed: Uint32Array = new Uint32Array();
  count = 0;
  revision = 0;
  private identity: string | undefined;
  private readonly faces: readonly Face[];

  constructor(faces: readonly Face[]) {
    this.faces = faces;
    this.indices = new Uint32Array(faces.length * 3);
  }

  update(broken: Uint8Array, identity: string): boolean {
    if (this.identity === identity) return false;
    const edges = new Map<string, { a: number; b: number; uses: number }>();
    let count = 0;
    for (const face of this.faces) {
      if (face.links.some(i => i >= 0 && broken[i] !== 0)) continue;
      for (let i = 0; i < 3; i++) {
        const a = face.nodes[i], b = face.nodes[(i + 1) % 3];
        this.indices[count++] = a;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const edge = edges.get(key);
        if (edge) edge.uses++;
        else edges.set(key, { a, b, uses: 1 });
      }
    }
    const boundary: number[] = [];
    for (const { a, b, uses } of edges.values()) if (uses === 1) boundary.push(a, b);
    this.exposed = Uint32Array.from(boundary);
    this.count = count;
    this.identity = identity;
    this.revision++;
    return true;
  }
}

export function gridBorderPairs(cols: number, rows: number): Uint32Array {
  const pairs: number[] = [];
  for (let x = 0; x < cols - 1; x++) pairs.push(x, x + 1, (rows - 1) * cols + x, (rows - 1) * cols + x + 1);
  for (let y = 0; y < rows - 1; y++) pairs.push(y * cols, (y + 1) * cols, y * cols + cols - 1, (y + 1) * cols + cols - 1);
  return Uint32Array.from(pairs);
}

/** Respect the live draw count: unused index capacity must not contribute normals. */
export function updateSurfaceNormals(positions: Float32Array, indices: ArrayLike<number>, count: number, normals: Float32Array): void {
  normals.fill(0);
  for (let i = 0; i < count; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const cbx = positions[c] - positions[b], cby = positions[c + 1] - positions[b + 1], cbz = positions[c + 2] - positions[b + 2];
    const abx = positions[a] - positions[b], aby = positions[a + 1] - positions[b + 1], abz = positions[a + 2] - positions[b + 2];
    const x = cby * abz - cbz * aby, y = cbz * abx - cbx * abz, z = cbx * aby - cby * abx;
    normals[a] += x; normals[a + 1] += y; normals[a + 2] += z;
    normals[b] += x; normals[b + 1] += y; normals[b + 2] += z;
    normals[c] += x; normals[c + 1] += y; normals[c + 2] += z;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length > 0) { normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length; }
  }
}
