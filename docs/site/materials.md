# Materials

`box3d-webgpu-kit/materials` holds engineering materials in SI units. Every value carries the conditions it holds for,
the figure as read in its source, and a citation; values that could not be verified are marked.

```js
import {solidMaterial, fractureLaw, heatMaterial, grainMaterial, rigidMaterial, contactPair, materialValue} from 'box3d-webgpu-kit/materials';

new SolidBody({mesh, material: solidMaterial('structural-steel-s355')});       // E, nu, density, expansion
new HeatSolver({/* grid */ materials: [heatMaterial('copper-c11000')], temperature: 293.15, dt: 0.01});
new Granular({material: grainMaterial('glass-beads'), config: {dt: 1e-6, capacity: 1000}});
world.createBody({shape, position, ...rigidMaterial('structural-steel-s355')}); // density, friction, restitution
contactPair('ptfe', 'structural-steel-s355');                                   // friction between two materials
materialValue('aluminium-6061-t6', 'fractureToughness');                        // {value, conditions, source, read}
```

- `materialIds()` lists the materials; `material(id)` gives the whole entry; `materialAudit()` counts values and
  flags the unverified ones.
- The helpers build exactly the input each solver takes, so a material is stated once.
- A rigid body's `friction` and `restitution` are per body: Box3D combines the two bodies of a contact itself.
  `contactPair` gives measured pair values when you want to set them from data.

The library, its sources and what each number was checked against are in the
[materials page](../../solvers/materials.html). The values are typical ones for the stated conditions, not design
values: a certified analysis needs the figures of the actual material and standard.
