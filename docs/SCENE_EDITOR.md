# Scene editor

The Physics Lab can build and change a rigid-body scene in the page, without writing JSON, and change the rigid bodies of a coupled scene (water, cables, frames, cloths, grains, solids, heat, fluids) while keeping its other sections as they are ([Coupled scenes](#coupled-scenes)). The editor is a mode of the Scenes panel (bottom right of `lab.html`). What it edits is a scene in the [scene format](SCENE_FORMAT.md), version 1, in SI units; what it saves is that same format, as a file or a share link.

| How | What opens |
|---|---|
| `lab.html?edit=1` | A new, empty scene in the editor: gravity 9.81 m/s² down and the ground slab. |
| `lab.html?example=<name>&edit=1` | An example scene in the editor (`pendulum-wave`, `newtons-cradle`, `domino-run`, `terrain-car`, `ragdoll`, and the coupled ones, such as `sphere-settling` or `hopper-seesaw`). |
| `lab.html?scene=<share link>&edit=1` | A shared scene in the editor. |
| **New scene** in the Scenes panel | An empty scene in the editor. |
| **Edit** in the Scenes panel, with an SI scene loaded | That scene in the editor. **Stop editing** closes the editor and leaves the scene on screen. |
| **Open file…**, a dropped file, or an example, while the editor is open | That scene in the editor, as one undoable step. |

The code is `src/lab/scene-editor-model.ts` (the document and its commands; no DOM, runs in node), `src/lab/scene-editor.ts` (the panel, picking, dragging, drawing) and a few hooks in `src/main.ts`. The tests are `tests/physics/scene-editor.test.mjs` (21 tests, in the pull-request gate) and the browser check `scripts/scene-editor-browser-check.mjs` (needs a Chromium with WebGPU; not in a gate).

## How it works

**The document.** The editor holds one scene. Every change is a command: add body, delete, duplicate, rename, set transform, set shape, set type, set material, set colour, set velocity, set flags, set collision filter, add joint, edit joint, delete joint, world settings, scene details, open a scene. A command builds a candidate scene; the format's own `validateScene` checks it; the Lab then builds it once in a scratch physics world that is thrown away. Only a candidate that passes both replaces the scene. Otherwise the command is refused, the scene is unchanged, and the message is the validator's (for example `/bodies/1/shape/radius: must be >= 0.0001, got 0`) or the engine's (`Scene body "ramp": …`). The document therefore always validates.

**Undo and redo.** The last 100 commands can be undone. Undo and redo swap whole scenes, so they restore the exact canonical JSON (the tests compare the text after every command, back and forth). An arrow key held down nudges repeatedly, and the whole run is one undo step. Untouched bodies are shared between history states, so the history of a scene with a large mesh stays small.

**Editing is on the initial state.** After every command the world on screen is rebuilt from the document and stands at t = 0. **Play** runs it, **Pause** stops it, **Step** advances one tick of 1/60 s, **Reset** rebuilds the world from the document. Once the simulation has moved on, the inspector shows the selected body's live position, rotation, velocity and state, read-only, and editing commands are refused with "Press Reset" until the scene is reset. Copy share link and Download save the document, not the moment the simulation has reached.

**Numbers.** Every value the editor writes is rounded to the shortest decimal that reads back to the same float32, which is what the rigid solver stores. Rotations are entered as degrees about x, y and z (the format's `'XYZ'` order) and written as a quaternion. Joint angles are degrees in the editor and radians in the file.

## Bodies

**Add** puts a shape at the point the camera looks at (x and z snapped to the grid when grid snapping is on).

| Preset | Shape in the file | Editable sizes |
|---|---|---|
| Box | `box` | size x, y, z (m) |
| Sphere | `sphere` | radius (m) |
| Capsule | `capsule` | radius (m), length between the cap centres (m) |
| Wedge | `hull`, 6 points | size x, y, z (m): the slope rises along +x |
| Cylinder | `hull`, 32 points (16 sides) | radius, height (m) |
| Cone | `hull`, 17 points | radius, height (m) |
| Ramp | `mesh`, a closed prism of 8 triangles, static | length, height, width (m) |
| Terrain: flat, slope, hills | `heightfield`, static | samples along x and z, spacing (m), height (m), seed |

The three terrain functions are `flat` (all zero), `slope` (linear along +x from 0 to the height) and `hills` (two octaves of seeded value noise on lattices of 4 and 8 cells, smoothstep interpolation, scaled to span 0 to the height). They use only `+ − × ÷`, and the ring of a cylinder or cone is built by a rotation recurrence with literal constants, so the same settings give the same numbers on every machine; a test pins values. A generated hull, mesh or height field keeps its recipe in the body's `userData.editor`, which is why its sizes stay editable; an imported hull, mesh or height field has no recipe and its geometry is not editable here.

The **inspector** edits the selected body: name, type (static, kinematic, dynamic; a mesh or height field is always static), position (m), rotation (degrees), sizes, material, density (kg/m³), friction, restitution, colour, initial velocity (m/s) and angular velocity (rad/s), the flags `bullet`, `sensor`, `hitEvents`, `neverSleeps`, `lockRotation`, linear and angular damping (1/s), gravity scale, and the collision filter (category bits and mask bits as decimal integers, group index). It also shows the mass the engine computed (kg). Renaming a body renames it in every joint that names it. Deleting a body deletes its joints, and the message names each one. Ids stay unique among bodies and joints: a duplicate name is refused by the validator.

### Moving a body

There is **no 3D gizmo**. A body is moved in three ways:

- **Drag it in the view.** It slides on the horizontal plane through the point that was grabbed, so it follows the pointer; hold Shift to raise or lower it instead. The move is one command, applied when the pointer is released.
- **Arrow keys** nudge the selected bodies by one grid step (0.1 m with the grid off): Left and Right along x, Up and Down along z, Page Up and Page Down along y. Shift makes it ten steps. The axes are the world's, not the camera's.
- **Type** the coordinates, and the rotation in degrees. Rotation has no mouse or keyboard handle; it is numeric only.

**Snapping.** *Snap to grid* rounds x and z (and y, for vertical moves) to a multiple of the grid size (0.25 m by default). *Rest on the surface below* casts a ray straight down in the physics world and sets the height so the body's lowest point touches what it hits: it applies to a new body, to the end of a horizontal drag, and to the inspector's **Rest on surface below** button. Bodies added at the same spot therefore stack.

## Materials

Picking a named material writes it to the scene's `materials` table and makes the body refer to it. Changing density, friction or restitution afterwards makes the body's material custom (its own three numbers, no name).

The values come from the material library (`src/engine/materials.ts`, [MATERIALS.md](MATERIALS.md)), where each one has its conditions and a citation to a source that was opened. Before the library (until 2026-11-12) this table held typical handbook values, partly written from memory; the restitution column in particular was never checked against a source.

| Material | Library entry | Density, kg/m³ (range) | Friction (range) | Restitution (range) | What the numbers refer to |
|---|---|---|---|---|---|
| Steel | `structural-steel-s355` | 7850 | 0.6 (0.5–0.8) | 0.56 | EN 1993-1-1 density. Steel on steel, dry, static (0.3 kinetic). Restitution of a steel ball on a 10 mm steel plate at 3.1 to 4.4 m/s. |
| Aluminium | `aluminium-6061-t6` | 2700 | 0.61 | 0.5, **unverified** | 6061-T6. Aluminium on mild steel, clean and dry, static (0.47 kinetic; The Engineering ToolBox, last resort). No source for the restitution. |
| Concrete | `concrete-c30-37` | 2400 (2300–2500) | 0.6, **unverified** | 0.2, **unverified** | Normal-weight C30/37. No opened source for concrete on concrete. |
| Wood | `pine-loblolly` | 571.2 | 0.5 | 0.45, **unverified** | Loblolly pine at 12% moisture. Wood on wood, static (0.3 kinetic). |
| Rubber | `natural-rubber` | 921.7 | 1.0 | 0.8, **unverified** | Natural rubber hydrocarbon. Rubber on dry concrete, static (0.7 kinetic). |
| Ice | `ice` | 918.9 (916.2–920) | 0.1 (0.1–0.6) | 0.3, **unverified** | Ice at −10 °C. Ice on ice, static (0.03 kinetic); slow sliding of cold ice is far higher, see MATERIALS.md. |
| Glass | `soda-lime-glass` | 2500 | 0.95 (0.9–1.0) | 0.926 (0.926–0.94) | Soda-lime glass. Glass on glass, clean and dry, static (0.4 kinetic; ToolBox). Restitution of 2 mm glass beads on each other (speed not stated). |

What changed against the earlier table: steel restitution 0.6 → 0.56; aluminium friction 0.5 → 0.61; wood density 600 → 571.2 and friction 0.4 → 0.5; rubber density 1100 → 921.7 and friction 0.9 → 1.0; ice density 917 → 918.9 and friction 0.05 → 0.1; glass friction 0.5 → 0.95 and restitution 0.65 → 0.926. Concrete and aluminium's restitution are unchanged and still unsourced. The editor shows the library entry and the unverified values under the material; the UI is otherwise the same. Scenes that name a material carry its numbers in their own `materials` table, so saved scenes and the example scenes are unchanged; the editor's tests pin the new numbers, and the editor's scene hashes are not pinned.

Friction is the static coefficient because the rigid world has one coefficient for sticking and sliding: what holds still in reality holds still, and sliding dissipates more than it should (twice as much for steel on steel). The ranges are the library's; where the sources give one figure the range is that figure.

How the numbers are used: a body has one friction and one restitution value, while real coefficients belong to a pair of surfaces. Box3D combines the two touching bodies' values itself. Restitution is not applied to slow impacts ([SCENE_FORMAT.md](SCENE_FORMAT.md#example-scenes) measured 23% of the speed passed on at 0.44 m/s and 99.6% at 1.85 m/s in the cradle example), so a ball dropped a few centimetres does not bounce as its value suggests.

## Joints

Select two bodies (click one, Shift+click the other; or Enter and Shift+Enter in the outline; or turn on **Select several** under the outline, which makes every click or tap add to the selection) and press **Add joint** to join them; select one body to join it to the fixed world. The six types of the format are available: revolute, spherical, prismatic, distance, weld, wheel.

The joint's two frames are computed from an **anchor point** and an **axis** in world space, for the bodies as they stand, so the scene as drawn is the joint's zero position. The default anchor is the midpoint of the two bodies (the body's centre for a joint to the world; for a distance joint, the two centres, or a point 1 m above for the world end). The anchor can be typed, or picked: **Pick anchor in view**, then click a point on a body or the ground (a distance joint has a second button for its anchor on body B). The axis can be typed or set to a world axis with a button. It is the hinge axis of a revolute joint, the slide axis of a prismatic joint, the axle of a wheel joint (whose suspension is then kept as close to vertical as the axle allows) and the cone axis of a spherical joint.

Per type, the inspector offers what the format allows: limits (degrees, or metres for prismatic, distance and wheel), a motor (degrees/s and N m, or m/s and N), a spring (Hz, damping ratio, target), the cone half-angle of a spherical joint (degrees), the rest length of a distance joint (m), a custom stiffness (Hz, damping ratio; default 60 Hz and 2), and whether the two bodies collide. Changing the type keeps the anchor and axis and drops the settings the new type does not take.

Joints are drawn in the view as lines: a cross at each anchor, a line from each body's centre to its anchor, and the axis (cyan and magenta; yellow and white for the selected joint). They follow the bodies while the simulation runs.

## World and scene details

- **Gravity:** Earth (9.81 m/s², the project's value; standard gravity is 9.80665), Moon (1.62), Mars (3.72), zero, or any vector.
- **Ground slab** on or off.
- **Step rate** in Hz (the step is 1/rate, at least 30 Hz) and **sub-steps** (1 to 16), and the seed.
- **Title, author, description.**

The World section lists **step warnings**. They are rules of thumb, never refusals:

| Warning | Rule |
|---|---|
| Joint stiffness or spring too high | above a quarter of the sub-step rate (`subSteps / step`; 60 Hz at the defaults) |
| A fast body can pass through thin ones | its initial speed × step exceeds its thinnest dimension, and it is not a bullet |
| A falling body can pass through thin ones | g × 1 s × step exceeds its thinnest dimension, and it is not a bullet |
| A very small body | a dynamic body thinner than 2 cm |
| A very thin or long box | sides differing by more than a factor of 100 |

The Lab's frame loop ticks at 1/60 s and takes a whole number of scene steps per tick, so a step rate that is not a multiple of 60 Hz plays faster or slower than real time; the World section says by how much.

## Coupled scenes

A scene with coupled sections opens like any other (until 2026-11-12 the editor refused it). What changes:

- **Bodies and joints** are edited exactly as in a rigid scene: add, move, turn, resize, retype, give a material, duplicate, delete, join.
- **The sections are carried unchanged.** Every command builds the new scene from the old one with the sections as the same values, so their canonical text is the text they had, through edits, undo, redo, autosave, Download and Copy share link (`tests/physics/scene-editor.test.mjs` checks it on every coupled example: open, move a body, rename, undo, redo, save as a link, compare each section's canonical text).
- **The outline lists them read-only** under the bodies and joints, one box each: its id and kind (water basin, cable, frame, cloth, grains, solid, heat grid, fluid flow or free-surface tank) and its key values (grid and cell size, rest depth, node and element counts, material, grain count and contact law, mesh and model, viscosity and density) and the bodies it names.
- **A few values can be set** in that box, each one a command that goes through `validateScene` and the scratch build like any other, and is undone the same way:

| Section | Values |
|---|---|
| Water basin | water level (rest depth) |
| Cloth | areal density, Young's modulus, thickness |
| Grains | the grain count (keeps the first N; the editor does not add grains, because it does not know where they go), friction, restitution |
| Solid | Young's modulus, Poisson's ratio, density |
| Heat grid | conductivity, specific heat |
| Fluid | viscosity (a flow), density |
| Cable, frame | none |

  A value that makes the scene invalid is refused with the validator's message: for example a viscosity that puts the flow's step above the explicit viscous limit (`/fluids/0/substeps: the fluid step 0.008333 s is above the explicit viscous limit …`), or a negative rest depth.
- **Bodies a section names.** Moving, turning or retyping such a body keeps the reference (it is by id), and the scratch build checks the result like any edit; a shape the section cannot use (a hull in a fluid, for example) is refused by the validator. Renaming it renames it in every section that names it (the message says how many references followed). Deleting it is refused, with the sections that name it, because the editor cannot change those sections to do without it. A duplicate is not added to any section.
- **New ids** never take an id a section uses: bodies, joints and section entries share one namespace.
- While the editor is open on a coupled scene, the scene's own lines (the wire grid on water, the edges of a fluid box and its arrows) are drawn with the editor's selection frames and joint markers.

Not done: adding, removing or reshaping a section, editing its other values (meshes, supports, attachments, boundaries, grids, saved fields), or picking a section's parts in the view.

## Measuring

**Measure** records one body (the selected one, or one chosen by name) while the simulation runs: one sample per tick, up to 3,600 (a minute at 60 Hz), on a small plot of position (x, y, z in m), velocity (components and speed in m/s) or energy (J). **Export CSV** saves every recorded column:

```
time_s,x_m,y_m,z_m,vx_m_per_s,vy_m_per_s,vz_m_per_s,speed_m_per_s,kinetic_translational_J,kinetic_rotational_J,potential_J,total_J
```

RFC 4180, CRLF line ends, up to 9 significant digits, an empty field for a value that is not known. Energy is ½mv² + ½ω·Iω − m g·r, with the mass the engine reports and the inertia of a solid box, sphere or capsule; the rotational term is left out (empty in the file) for hulls, meshes, compounds and bodies with `massData`, whose tensor the editor does not read back. For a compound or a body with `massData` the potential term uses the body's origin, not its centre of mass. Potential energy is zero at the world origin. In the test a dropped sphere keeps its recorded total within 1% until it lands.

The **ruler** gives the straight-line distance between two points, with its components and its horizontal part: either two points clicked in the view (where the click's ray meets a body or the ground) or the centres of the two selected bodies.

## Keyboard

Everything is reachable without a pointer: the controls are native buttons, selects, inputs and `<details>` sections in tab order, the outline is a multi-select listbox (Up, Down, Home, End move; Enter or Space selects; with Shift it adds to the selection), every field has a label, and the focus ring is the Lab's (2 px cyan).

| Key | Does |
|---|---|
| Delete, Backspace | delete the selection (a body takes its joints with it) |
| Ctrl+Z, Cmd+Z | undo |
| Shift+Ctrl+Z, Shift+Cmd+Z, Ctrl+Y | redo |
| Ctrl+D, Cmd+D | duplicate the selected bodies |
| Arrow keys | nudge along x (Left, Right) and z (Up, Down) |
| Page Up, Page Down | nudge along y |
| Shift with a nudge | ten steps |
| Escape | leave a field; cancel a pick; deselect |

Inside a text or number field the keys belong to the field (its own undo, its arrows), and in the outline the arrows move through the list, so nudges work when the focus is on the view or on a button. While the editor is open the Lab's single-key shortcuts (R, P, arrows for the next recipe, digits, Space) are off, so typing a name cannot load another lab.

## Saving

- **Copy share link** copies `lab.html?scene=b3s1…` for the document and puts it in the address bar. The copied link has no `edit=1`: it opens the scene for viewing. The address is not rewritten on every edit; an edit after copying removes the now stale link from the address.
- **Download scene (.json)** saves the document.
- **Autosave.** The document is written to `localStorage` (key `box3d-lab-scene-editor-autosave-v1`) 0.4 s after each change, up to 1,000,000 characters of canonical JSON. When the editor opens and finds an autosaved scene that differs from the one being opened, it asks: **Recover it** (opens it as an undoable step) or **Discard it**. Autosave is paused while the question is open. Storage that is full, blocked or absent is ignored: nothing depends on it. An autosave is read back through `validateScene` like any other file.

Text from a scene (names, titles, descriptions) is only ever written to the page as text or as a form value. Nothing is evaluated. The page's Content-Security-Policy is unchanged.

## Checked in a browser

`node scripts/scene-editor-browser-check.mjs` drives the built page in headless Chromium with software WebGPU (SwiftShader). On 2026-11-11 it passed with no console errors:

- a new scene, three bodies and a hinge built with the panel's controls, sizes, rotation and materials edited by typing, an invalid radius refused with the validator's message;
- undo four times and redo four times back to the same scene hash;
- the hinge's anchor picked by a click on a body in the view;
- a click in the view selects the body under it, and the selection is tinted (measured as orange pixels in the canvas read back); a drag slides it on the ground plane, snapped to the grid;
- play, the live inspector, the plot, the CSV (also as a download), step, reset;
- the ruler, gravity presets, a step warning;
- **Copy share link**, opened in a fresh browser context: the same canonical scene hash, and the same replay hash and transform hash after 180 steps as the editor's page after Reset;
- the recovery prompt in a second tab;
- a keyboard-only pass (no pointer events): add, select in the outline, nudge, type a coordinate, delete, undo, redo, duplicate, deselect, play, reset;
- a 390 × 844 touch viewport: see below.

The editor with a coupled scene is checked by `scripts/coupled-scenes-browser-check.mjs` (on 2026-11-12, `lab.html?example=sphere-settling&edit=1`: the fluid section listed in the outline, the ball typed to a new position with the section unchanged, the viscosity set in the outline and a negative value refused with the validator's message, undo twice back to the opened scene hash, the copied link reopened with the edited scene's hash) and by `scripts/lab-webgl2-browser-check.mjs` (the same scene with the ball clicked and selected, drawn alike by the WebGPU and WebGL2 renderers).

## Limits

- **No gizmo and no rotation handle.** Translation is by dragging on a horizontal plane, by Shift-dragging vertically, by arrow keys and by typing; rotation is by typing.
- **The camera orbits and zooms; it does not pan.** **Look at** in the inspector points it at the selected body.
- **The editor makes one shape per body.** A scene with compound bodies or `massData` (scene version 2) opens: such a body can be selected, moved, turned, duplicated, renamed, given a material and deleted, and its bounds and resting height come from its children. Its children and its mass data cannot be edited here, and no preset creates one. Imported hulls, meshes and height fields can be moved, renamed and given materials, but their geometry cannot be edited.
- **Every command rebuilds the world** (twice: once in a scratch world, once on screen). That is immediate for scenes of tens of bodies and was not measured for thousands; dragging previews by moving one body and commits once.
- **Loads** are initial velocities, gravity, motors and springs. There are no applied forces or torques over time in the format, so the editor has none.
- **Multi-selection** is for joints, deletion, duplication, nudging and the ruler; the inspector edits one item at a time.
- **Coupled scenes** open, but only their rigid bodies and joints and the few section values above are edited; the rest of each section is kept as it is ([Coupled scenes](#coupled-scenes)). A body a section names cannot be deleted in the editor.
- **Selection highlight:** the selected body's instance colour is tinted and a line frame is drawn around it. Once the simulation has moved on, the frame stays and the tint is removed. No render pass was added. The lines are depth-tested like the rest of the scene, so the part of a joint marker that lies inside a body is hidden; the markers are sized to reach out of ordinary bodies, and a joint buried in a large body shows only its axis ends.
- **Phone (390 px wide):** the panel fits the width, nothing is cut off at the sides, and scenes can be edited by touch through the outline and the inspector. With the panel open it covers the lower part of the screen (62% of the height), so little of the view is visible while typing; **Hide** collapses it to reach the view, where a tap selects a body and a drag moves it. Shift-drag (the vertical move) needs a keyboard; by touch the height is typed. Selecting two bodies by touch needs **Select several** turned on. The Lab's own left and bottom panels still take most of a phone screen.
- **Seen in software rendering only** (SwiftShader in headless Chromium), not on a real GPU, and not in Safari or Firefox.
- The materials table comes from the material library ([MATERIALS.md](MATERIALS.md)): typical or nominal values of named grades with citations, six of them unverified (concrete's friction, and the restitution of aluminium, concrete, wood, rubber and ice). A body has one friction and one restitution, not a value per pair.
