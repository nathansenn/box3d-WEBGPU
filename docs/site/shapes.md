# Shapes

A body has one shape, or a compound of up to 64 convex shapes.

```js
world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.25, 0.5]}, position: [0, 1, 0]});
world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [1, 1, 0]});
world.createBody({shape: {kind: 'capsule', radius: 0.2, halfLength: 0.5}, position: [2, 1, 0]});   // axis along local Y
world.createBody({shape: {kind: 'hull', points: [x0, y0, z0, x1, y1, z1 /* ... */]}, position: [3, 1, 0]});
world.createBody({shape: {kind: 'compound', shapes: [
  {shape: {kind: 'box', halfExtents: [0.4, 0.05, 0.4]}, position: [0, 0.4, 0]},
  {shape: {kind: 'capsule', radius: 0.04, halfLength: 0.2}, position: [0.3, 0.2, 0.3], density: 700},
]}, position: [4, 1, 0]});
world.createBody({shape: {kind: 'mesh', vertices, indices}, position: [0, 0, 0]});                 // always static
world.createBody({shape: {kind: 'heightfield', heights, countX, countZ, spacing: [1, 1]}, position: [-10, 0, -10]});   // always static
```

| Kind | Body types | Notes |
| --- | --- | --- |
| `box`, `sphere`, `capsule` | static, kinematic, dynamic | sizes from 0.1 mm (capsule half length from 2.5 mm) to 1 km |
| `hull` | static, kinematic, dynamic | 4 or more points with volume; Box3D keeps at most 64 hull vertices |
| `compound` | static, kinematic, dynamic | 1 to 64 convex shapes; mass, centre of mass and inertia are summed |
| `mesh` | static | counter-clockwise triangles; for scenery |
| `heightfield` | static | `countX` by `countZ` heights on a grid, extending along +x and +z from the position |

## Body options

`type` is `'dynamic'` (default), `'kinematic'` (moved by you with `moveKinematic`, pushes dynamic bodies) or
`'static'`. `density` (default 1000 kg/m^3), `friction` (0.6) and `restitution` (0) set the material; a compound's
shapes may each have their own. `massData: {mass, center, inertia}` replaces the mass the shapes give.
`bullet: true` adds continuous collision against other moving bodies, for small fast objects. `sensor: true` reports
overlaps instead of colliding. `filter: {categoryBits, maskBits, groupIndex}` decides who collides with whom.

## From files

```js
import {parseOBJ, toHullShape, toMeshShape, convexDecompose, createBodiesFromMesh} from 'box3d-webgpu-kit/geometry';

const [mesh] = parseOBJ(text);                       // also parseSTL, parseGLTF, parseGLB
world.createBody({shape: toHullShape(mesh), position: [0, 2, 0]});          // one convex hull
world.createBody({shape: toMeshShape(mesh), position: [0, 0, 0]});          // static triangles
createBodiesFromMesh(world, mesh);                                          // decomposed into convex pieces
```

The parsers read only the text or bytes you give them and refuse anything malformed with an `EngineError`
([robustness](../../reference/robustness.html)).
