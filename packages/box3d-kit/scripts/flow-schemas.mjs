// Writes the JSON Schemas of the flow study and result documents (box3d-flow-study/1, box3d-flow-result/1) to
// packages/box3d-kit/schemas. docs/FLOW.md is the prose of the same contract; v24-flow.test.mjs validates real results
// against the result schema, so the schema cannot drift from what runFlowStudy writes.
//
//   node packages/box3d-kit/scripts/flow-schemas.mjs           write the two files
//   node packages/box3d-kit/scripts/flow-schemas.mjs --check   fail when the files differ from what would be written
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../schemas');
const BASE = 'https://nathansenn.github.io/box3d-WEBGPU/schemas/';

// ---- builders ----
const d = (schema, description) => description ? {...schema, description} : schema;
const num = (description, extra = {}) => d({type: 'number', ...extra}, description);
const pos = description => num(description, {exclusiveMinimum: 0});
const nonneg = description => num(description, {minimum: 0});
const int = (description, extra = {}) => d({type: 'integer', ...extra}, description);
const str = (description, extra = {}) => d({type: 'string', ...extra}, description);
const bool = description => d({type: 'boolean'}, description);
const oneOfConst = (values, description) => d({enum: values}, description);
const arr = (items, description, extra = {}) => d({type: 'array', items, ...extra}, description);
const nums = description => arr({type: 'number'}, description);
const nullable = schema => {
  const {description, ...rest} = schema;
  return d({anyOf: [rest, {type: 'null'}]}, description);
};
const ref = name => ({$ref: `#/$defs/${name}`});
const refd = (name, description) => d(ref(name), description);
/** An object with the given properties; `required` lists the keys that must be there; no other key is allowed. */
const obj = (properties, required = [], description, open = false) => d({type: 'object', properties, ...(required.length ? {required} : {}), additionalProperties: open}, description);
const map = (values, description) => d({type: 'object', additionalProperties: values}, description);

const VEC3 = {type: 'array', items: {type: 'number'}, minItems: 3, maxItems: 3};
const QUAT = {type: 'array', items: {type: 'number'}, minItems: 4, maxItems: 4};

// =====================================================================================================================
// The study
// =====================================================================================================================
const itemBase = {
  part: str('Name of the part the item belongs to (default "body"). Forces and surfaces are reported per part.', {minLength: 1}),
  role: oneOfConst(['solid', 'cavity'], 'solid (default), or cavity: the inside is fluid, and everything outside the union of the cavities is solid (pipes drawn by their bore, tanks, tunnels).'),
  id: d({type: ['string', 'number']}, 'Carried unchanged to setup.geometry.report (the element id in the model).'),
};
const axis = {
  from: refd('vec3', 'One end of the axis, m (with to).'),
  to: refd('vec3', 'The other end of the axis, m (with from).'),
  center: refd('vec3', 'Centre, m (with length or halfLength and rotation): the axis is the local +y.'),
  length: pos('FULL length along the local +y, m.'),
  halfLength: pos('Half the length along the local +y, m.'),
  rotation: refd('quat', 'Local-to-world rotation, unit quaternion [x, y, z, w]. Default identity.'),
};
const item = (kind, props, required, description) => obj({kind: {const: kind}, ...itemBase, ...props}, ['kind', ...required], description);
const studyDefs = {
  vec3: VEC3,
  quat: QUAT,
  item: {oneOf: ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'tube', 'beam', 'mesh', 'apex'].map(ref), description: 'A primitive or a triangle mesh. Metres, the frame of the study (any; +y up by default).'},
  box: item('box', {center: ref('vec3'), size: refd('vec3', 'FULL extents along the local x, y, z, m.'), halfExtents: refd('vec3', 'Half extents, m (instead of size).'), rotation: ref('quat')}, ['center'], 'A box; exactly one of size and halfExtents.'),
  sphere: item('sphere', {center: ref('vec3'), radius: pos('m')}, ['center', 'radius']),
  cylinder: item('cylinder', {...axis, radius: pos('m')}, ['radius'], 'A flat-ended cylinder: from and to, or center with length (or halfLength) along the local +y.'),
  capsule: item('capsule', {...axis, radius: pos('m')}, ['radius'], 'A segment swept by a sphere: the length is the segment between the centres of the end spheres.'),
  cone: item('cone', {...axis, radius: nonneg('Radius at the -y end (from), m.'), radiusTop: nonneg('Radius at the +y end (to), m.')}, ['radius', 'radiusTop'], 'A frustum; one radius may be 0.'),
  tube: item('tube', {...axis, radius: pos('Outer radius, m.'), innerRadius: pos('Inner radius, m.')}, ['radius', 'innerRadius'], 'A pipe wall, open at both ends.'),
  beam: item('beam', {from: ref('vec3'), to: ref('vec3'), up: refd('vec3', 'Direction of the depth. Default: the world axis least aligned with the member.'), section: oneOfConst(['rect', 'i']), width: pos('Across, m.'), depth: pos('Along up, m.'), flange: pos('Flange thickness of an I section, m.'), web: pos('Web thickness of an I section, m.')}, ['from', 'to', 'width', 'depth'], 'A straight member.'),
  mesh: item('mesh', {
    positions: nums('x, y, z per vertex, m.'),
    indices: arr({type: 'integer', minimum: 0}, 'Three vertex indices per triangle. Without it every three vertices are a triangle.'),
    file: str('A mesh file (.stl, .obj, or .json with positions and indices) resolved by the loadMesh option (the command line reads it relative to the study file). Instead of positions.'),
    thickness: nonneg('Thickness of an open surface, m (0: none given; it is a shell grown to the thinnest wall the lattice sees). A closed component ignores it. Without it an open component is filled by ray parity, with a warning.'),
    position: refd('vec3', 'Translation applied after rotation and scale.'),
    rotation: ref('quat'),
    scale: d({oneOf: [{type: 'number'}, ref('vec3')]}, 'Scale applied first.'),
    elements: arr(obj({element: d({type: ['string', 'number']}), triStart: int('First triangle.', {minimum: 0}), triCount: int('Number of triangles.', {minimum: 0}), closed: bool('true: a closed solid; false: an open surface.'), thickness: nonneg('Thickness of an open surface, m; 0 none.')}, ['triStart', 'triCount', 'closed']),
      'Runs of triangles from one model element (the layout of an apex-flow-geometry/1 mesh): each closed, or open with a thickness. Triangles in no run take the mesh thickness.'),
  }, [], 'Triangles. Give positions or file.'),
  apex: obj({kind: {const: 'apex'}, document: d({type: 'object'}, 'An apex-flow-geometry/1 document (metres, +y up, quaternions xyzw).'), file: str('A JSON file holding one, read by the loadDocument option (the command line: relative to the study).'), role: oneOfConst(['solid', 'cavity'], 'Of every item of the document. Default solid.'), partName: oneOfConst(['id', 'name'], 'Part names from the layer id (default) or name.'), parts: arr({type: 'integer', minimum: 0}, 'Part indices to keep. Default all.')}, ['kind'], 'The primitives and meshes of an apex-flow-geometry/1 document: boxes with FULL sizes, flat-ended cylinders and capsules along local +y with their full length, meshes with their per-element closed flags and thicknesses. Exactly one of document and file.'),
  shape: {oneOf: [
    obj({kind: {const: 'disc'}, center: ref('vec3'), normal: refd('vec3', 'OUTWARD normal of the fluid domain: out of the fluid through the opening.'), radius: pos('m')}, ['kind', 'center', 'normal', 'radius']),
    obj({kind: {const: 'rect'}, center: ref('vec3'), normal: refd('vec3', 'OUTWARD normal of the fluid domain.'), up: refd('vec3', 'Direction of halfHeight in the plane.'), halfWidth: pos('m'), halfHeight: pos('m')}, ['kind', 'center', 'normal', 'halfWidth', 'halfHeight']),
  ], description: 'An opening: a disc or a rectangle in a plane. The cells within 2.5 cells outside the plane and inside the shape become the opening.'},
  seed: {oneOf: [
    obj({kind: {const: 'rake'}, from: ref('vec3'), to: ref('vec3'), count: int('', {minimum: 1})}, ['kind', 'from', 'to', 'count']),
    obj({kind: {const: 'plane'}, origin: ref('vec3'), u: ref('vec3'), v: ref('vec3'), nu: int('', {minimum: 1}), nv: int('', {minimum: 1})}, ['kind', 'origin', 'u', 'v', 'nu', 'nv'], 'Points origin + s u + t v at the centres of an nu x nv grid.'),
    obj({kind: {const: 'points'}, points: arr(ref('vec3'))}, ['kind', 'points']),
  ]},
  profile: oneOfConst(['uniform', 'parabolic', 'developed'], 'uniform (default), or parabolic (= developed): 1 - (r/R)^2 on a disc, (1 - (x/a)^2)(1 - (y/b)^2) on a rectangle, scaled to the flow rate or mean speed given.'),
};
const study = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}flow-study.schema.json`,
  title: 'box3d-flow-study/1',
  description: 'A flow study for box3d-webgpu-kit/flow (runFlowStudy, the box3d-flow command). SI units: m, s, kg, N, Pa. Unknown fields are errors. See docs/FLOW.md.',
  $defs: studyDefs,
  type: 'object',
  required: ['format', 'mode'],
  additionalProperties: false,
  properties: {
    format: {const: 'box3d-flow-study/1'},
    name: str('Copied to the result.'),
    units: {const: 'SI'},
    geometry: arr(ref('item'), 'The solids (and cavities). Required for an external study.'),
    fluid: {oneOf: [oneOfConst(['air', 'water']), obj({name: str(), density: pos('kg/m^3'), viscosity: pos('Kinematic, m^2/s.'), dynamicViscosity: pos('Pa s.')}, ['density'], 'Exactly one of viscosity and dynamicViscosity.')], description: 'air: 1.204 kg/m^3, 1.825e-5 Pa s; water: 998.207 kg/m^3, 1.0016e-3 Pa s (20 C).'},
    mode: oneOfConst(['external', 'internal']),
    external: obj({
      speed: pos('Free-stream speed, m/s.'),
      direction: refd('vec3', 'Direction the fluid moves toward (normalised). Default [1, 0, 0].'),
      up: refd('vec3', 'Lift axis, along one coordinate axis. Default [0, 1, 0].'),
      ground: d({oneOf: [{type: 'boolean'}, obj({height: num('Coordinate along up, m. Default: the lowest point of the geometry.'), type: oneOfConst(['fixed', 'moving', 'slip'], 'fixed (default): a no-slip floor; moving: slides with the stream; slip: a symmetry plane.')})]}, 'A ground plane normal to up; the geometry below it is removed. Default false.'),
      margins: obj({upstream: nonneg('Default 3.'), downstream: nonneg('Default 6.'), side: nonneg('Default 2.5.'), top: nonneg('Default 2.5.'), bottom: nonneg('Default: top (without a ground).'), length: pos('The length the margins are multiples of, m. Default: referenceLength when given, else the body size across the flow.')}, [], 'Free space around the bounding box of the geometry, in multiples of length.'),
      domain: obj({min: ref('vec3'), max: ref('vec3')}, ['min', 'max'], 'The box itself, instead of margins.'),
      referenceLength: pos('m: the Reynolds number, the moment coefficients and (by default) the length of the margins. Default: largest extent of the geometry.'),
      referenceArea: pos('m^2. Default: the shadow of the solid cells along the flow.'),
      momentCenter: refd('vec3', 'Default: the centre of the bounding box.'),
    }, ['speed']),
    internal: obj({
      inlets: arr(obj({name: str('', {minLength: 1}), shape: ref('shape'), flowRate: nonneg('Volume flow INTO the fluid, m^3/s.'), speed: nonneg('Mean speed into the fluid, m/s.'), velocity: refd('vec3', 'A velocity vector, m/s.'), profile: ref('profile')}, ['name', 'shape'], 'Exactly one of flowRate, speed and velocity.')),
      outlets: arr(obj({name: str('', {minLength: 1}), shape: ref('shape'), pressure: num('Gauge pressure, Pa (default 0).'), flowRate: nonneg('Volume flow OUT of the fluid, m^3/s, instead of a pressure.'), speed: nonneg('Mean speed out of the fluid, m/s, instead of a pressure.'), profile: ref('profile')}, ['name', 'shape'], 'A pressure, or a flow rate or speed. At least one outlet must be given by a pressure.')),
      domain: obj({min: ref('vec3'), max: ref('vec3')}, ['min', 'max']),
      padding: nonneg('Metres added around the bounds of the geometry.'),
      referenceSpeed: pos('m/s; sets the time step. Default: the fastest opening.'),
      referenceLength: pos('m, for the Reynolds number. Default: the diameter of the circle with the area of the first inlet.'),
      acceleration: refd('vec3', 'Body force per unit mass, m/s^2 (a duct driven by a pressure gradient, with periodic sides).'),
      periodic: arr(oneOfConst(['x', 'y', 'z']), 'Axes whose two sides are joined.'),
      initialVelocity: ref('vec3'),
    }),
    motion: map(obj({velocity: ref('vec3'), angularVelocity: refd('vec3', 'rad/s about center.'), center: ref('vec3')}), 'Surface velocity of a part, by part name. The solid does not move.'),
    actuators: arr(obj({name: str('', {minLength: 1}), center: ref('vec3'), axis: ref('vec3'), radius: pos('m'), thickness: pos('m; at least two cells.'), force: num('N on the fluid along axis.'), pressureJump: num('Pa; force = pressureJump pi radius^2.')}, ['name', 'center', 'axis', 'radius'], 'An actuator disc: exactly one of force and pressureJump.')),
    resolution: obj({cells: num('Budget of fluid cells. Default 400000.', {minimum: 1000}), cellSize: pos('m; used when it fits the budget.'), latticeSpeed: pos('Reference speed in cells per step. Default 0.06.')}),
    model: obj({turbulence: oneOfConst(['auto', 'none', 'smagorinsky', 'wale'], 'auto (default): smagorinsky when the cell Reynolds number exceeds 10 and the Reynolds number exceeds 2000, else none.'), smagorinsky: pos('Default 0.16.'), wale: pos('WALE constant. Default 0.5.'), wallFunction: bool('With the sub-grid model: walls take a power-law wall function. Default true.'), walls: oneOfConst(['interpolated', 'halfway']), spongeCells: nonneg('Cells in front of pressure sides over which the viscosity rises. Default 0.'), thicken: bool('Grow walls thinner than 1.44 cells so that they do not leak. Default true.')}),
    run: obj({transits: pos('Longest run, in transits. Default 8 external, 12 internal.'), startupTransits: nonneg('Default 1.'), windowTransits: pos('Averaging window. Default 1.5.'), tolerance: nonneg('Default 0.02.'), maxSteps: int('', {minimum: 1}), monitorEvery: int('', {minimum: 1}), sampleEvery: int('', {minimum: 1})}),
    outputs: obj({
      streamlines: d({oneOf: [{type: 'boolean'}, obj({seeds: d({oneOf: [{const: 'auto'}, arr(ref('seed'))]}), from: arr(str(), 'Internal, automatic seeds: the inlets to seed (default all).'), count: int('Automatic seeds. Default 64.', {minimum: 1}), field: oneOfConst(['mean', 'instant']), step: pos('Integration step, cells. Default 0.5.'), maxPoints: int('Default 400.', {minimum: 2}), stride: int('Keep every n-th point. Default 2.', {minimum: 1}), direction: oneOfConst(['forward', 'backward', 'both'])})]}),
      slices: arr(obj({axis: oneOfConst(['x', 'y', 'z']), position: num('m'), fraction: num('0 to 1 of the box.'), field: oneOfConst(['mean', 'instant'])}, ['axis'], 'Exactly one of position and fraction.')),
      surface: bool('Pressure and pressure coefficient at the vertices of the surface of every part.'),
      lines: arr(obj({name: str(), from: ref('vec3'), to: ref('vec3'), samples: int('Default 101.', {minimum: 2}), along: ref('vec3')}, ['from', 'to'])),
      sections: arr(obj({name: str(), axis: oneOfConst(['x', 'y', 'z']), position: num('m'), min: ref('vec3'), max: ref('vec3')}, ['axis', 'position'])),
      history: bool('false leaves the convergence history out. Default true.'),
    }),
  },
};

// =====================================================================================================================
// The result
// =====================================================================================================================
const vec = refd;
const series = nums;
const resultDefs = {
  vec3: VEC3,
  bounds: obj({min: ref('vec3'), max: ref('vec3')}, ['min', 'max']),
  forceMoment: obj({force: vec('vec3', 'N'), moment: vec('vec3', 'N m about forces.about')}, ['force', 'moment']),
  extreme: obj({value: num(), cp: num(), at: ref('vec3')}, ['value', 'at'], undefined, true),
};
const result = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${BASE}flow-result.schema.json`,
  title: 'box3d-flow-result/1',
  description: 'The result of a box3d-flow-study/1 run. SI units, the frame of the study. Numbers rounded to six significant digits. See docs/FLOW.md.',
  $defs: resultDefs,
  type: 'object',
  additionalProperties: false,
  required: ['format', 'name', 'solver', 'setup', 'run', 'forces', 'extremes', 'flow', 'actuators', 'wake', 'warnings', 'limits'],
  properties: {
    format: {const: 'box3d-flow-result/1'},
    name: str(),
    solver: obj({id: str('flow-lbm-d3q19-regularized-les-js-f64-v1'), version: str(), statement: str('What the solver is, in one paragraph.'), provenance: nullable(map({type: ['string', 'number', 'boolean', 'null']}, 'The provenance option: where the solver came from (a commit, a package version, a bundle hash).'))}, ['id', 'version', 'statement', 'provenance']),
    setup: obj({
      mode: oneOfConst(['external', 'internal']),
      fluid: obj({density: num('kg/m^3'), viscosity: num('m^2/s')}, ['density', 'viscosity']),
      grid: obj({origin: ref('vec3'), cell: num('m'), nx: int(), ny: int(), nz: int(), min: ref('vec3'), max: ref('vec3')}, ['origin', 'cell', 'nx', 'ny', 'nz', 'min', 'max'], 'The box of fluid cells.'),
      lattice: obj({origin: ref('vec3'), cell: num(), nx: int(), ny: int(), nz: int(), cells: int(), fluidCells: int(), solidCells: int(), enclosedCells: int(), boundaryLinks: int()}, ['origin', 'cell', 'nx', 'ny', 'nz', 'cells', 'fluidCells', 'solidCells', 'enclosedCells', 'boundaryLinks'], 'The box plus its boundary layers.'),
      timeStep: num('s'), latticeSpeed: num(), latticeMach: num(), relaxationTime: num(), cellReynolds: num(),
      turbulence: obj({model: oneOfConst(['none', 'smagorinsky', 'wale']), constant: nullable(num('Cs or Cw')), wallFunction: bool(), rule: str()}, ['model', 'constant', 'wallFunction', 'rule']),
      walls: oneOfConst(['interpolated', 'halfway']),
      referenceSpeed: num('m/s'),
      referenceLength: obj({value: num('m'), source: str()}, ['value', 'source']),
      reynolds: num(), transitTime: num('s'),
      external: nullable(obj({speed: num(), direction: ref('vec3'), up: ref('vec3'), side: ref('vec3'), ground: nullable(obj({height: num(), type: oneOfConst(['fixed', 'moving', 'slip'])}, ['height', 'type'])),
        bodySize: num('m across the flow'), bodyCells: num(), bodyBounds: ref('bounds'), blockage: num(), referenceArea: obj({value: num('m^2'), source: str()}, ['value', 'source']), dynamicPressure: num('Pa'), momentCenter: ref('vec3'),
        margins: obj({upstream: num(), downstream: num(), side: num(), top: num(), bottom: num(), length: num('m')}, ['upstream', 'downstream', 'side', 'top', 'bottom', 'length'], 'As used, in multiples of length.'),
        referencePressure: obj({value: num('Pa above the outlet pressure'), source: str()}, ['value', 'source'], 'The static pressure of the free stream: the mean pressure on the inlet. Every pressure, cp and force of an external result is gauge to it.')},
      ['speed', 'direction', 'up', 'side', 'ground', 'bodySize', 'bodyCells', 'bodyBounds', 'blockage', 'referenceArea', 'dynamicPressure', 'momentCenter', 'margins', 'referencePressure'])),
      internal: nullable(obj({inlets: arr(str()), outlets: arr(str()), fluidFraction: num()}, ['inlets', 'outlets', 'fluidFraction'])),
      sides: obj(Object.fromEntries(['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'].map(k => [k, oneOfConst(['wall', 'slip', 'periodic', 'velocity', 'pressure'])])), ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax']),
      patches: arr(obj({name: str(), kind: oneOfConst(['inlet', 'outlet']), area: num('m^2 the lattice gives the opening'), normal: vec('vec3', 'outward'), velocity: nullable(ref('vec3')), pressure: nullable(num()), cells: int()}, ['name', 'kind', 'area', 'normal', 'velocity', 'pressure', 'cells'])),
      parts: arr(str(), 'Names of the parts that take force: those of the geometry (the first geometryParts), then the walls of the box (the ground, the sides).'),
      geometryParts: int(),
      geometry: obj({items: int(), thinCells: num(), thinSize: num('m'), thickened: int('Items grown so that they do not leak.'), largestThickening: num('m'), closedCells: int('Cells made solid to close thin closed meshes.'), slender: int('Items thinner than a cell in two directions.'),
        report: arr(obj({index: int(), id: d({type: ['string', 'number']}), part: str(), role: oneOfConst(['solid', 'cavity']), kind: str(), smallestDimension: nullable(num('m')), thickened: num('m added'), thickenedCells: int(), triangles: int(), components: int(), closedComponents: int(), surfaceArea: num('m^2'), unresolvedFraction: num()},
          ['index', 'part', 'role', 'kind', 'smallestDimension', 'thickened', 'surfaceArea', 'unresolvedFraction']), 'Every item when there are at most 100, else those the grid changed or could not hold; at most 200.'),
        reportTruncated: bool()}, ['items', 'thinCells', 'thinSize', 'thickened', 'largestThickening', 'closedCells', 'slender', 'report', 'reportTruncated']),
      controls: obj({maxSteps: int(), startupSteps: int(), windowSteps: int(), monitorEvery: int(), sampleEvery: int(), tolerance: num()}, ['maxSteps', 'startupSteps', 'windowSteps', 'monitorEvery', 'sampleEvery', 'tolerance']),
    }, ['mode', 'fluid', 'grid', 'lattice', 'timeStep', 'latticeSpeed', 'latticeMach', 'relaxationTime', 'cellReynolds', 'turbulence', 'walls', 'referenceSpeed', 'referenceLength', 'reynolds', 'transitTime', 'external', 'internal', 'sides', 'patches', 'parts', 'geometryParts', 'geometry', 'controls']),
    run: obj({steps: int(), time: num('s simulated'), wallTime: num('s'), cellUpdatesPerSecond: num(), converged: bool(), reason: oneOfConst(['tolerance', 'max-steps']), windows: int(),
      averaged: nullable(obj({fromStep: int(), steps: int(), time: num(), samples: int()}, ['fromStep', 'steps', 'time', 'samples'])), maxSpeed: num('m/s')}, ['steps', 'time', 'wallTime', 'cellUpdatesPerSecond', 'converged', 'reason', 'windows', 'averaged', 'maxSpeed']),
    convergence: obj({tolerance: num(), startupSteps: int(), windowSteps: int(), monitorEvery: int(),
      history: obj({step: arr({type: 'integer'}), time: series(), residual: series('rms change of the velocity over an interval over the reference speed'), maxSpeed: series(), cd: series(), cl: series(), cs: series(),
        massBalance: series(), bulkSpeed: series(), flowRates: map(series(), 'By opening name, m^3/s into the box.'), patchPressure: map(series(), 'By opening name, Pa.')}, ['step', 'time', 'residual', 'maxSpeed'])}, ['tolerance', 'startupSteps', 'windowSteps', 'monitorEvery', 'history']),
    forces: obj({about: ref('vec3'), total: ref('forceMoment'), parts: arr(obj({name: str(), force: ref('vec3'), moment: ref('vec3')}, ['name', 'force', 'moment'])),
      coefficients: nullable(obj({cd: num(), cl: num(), cs: num(), cdRms: num(), clRms: num(), csRms: num(), cm: ref('vec3'), referenceArea: num(), referenceLength: num(), dynamicPressure: num(), axes: obj({drag: ref('vec3'), lift: ref('vec3'), side: ref('vec3')}, ['drag', 'lift', 'side'])},
        ['cd', 'cl', 'cs', 'cdRms', 'clRms', 'csRms', 'cm', 'referenceArea', 'referenceLength', 'dynamicPressure', 'axes']))}, ['about', 'total', 'parts', 'coefficients']),
    extremes: obj({pressureMax: ref('extreme'), pressureMin: ref('extreme'), speedMax: ref('extreme'), dynamicPressure: num('Pa: rho U^2 / 2 of the reference speed; cp = pressure / dynamicPressure.')}, ['pressureMax', 'pressureMin', 'speedMax', 'dynamicPressure'], 'Of the averaged field over the fluid cells.'),
    flow: obj({
      patches: arr(obj({name: str(), kind: oneOfConst(['inlet', 'outlet']), flowRate: num('m^3/s into the box'), area: num(), meanSpeed: num(), meanPressure: num('Pa, area mean over the fluid cells touching the opening'), meanDynamicPressure: num(), meanTotalPressure: num()},
        ['name', 'kind', 'flowRate', 'area', 'meanSpeed', 'meanPressure', 'meanDynamicPressure', 'meanTotalPressure'])),
      inflow: num(), outflow: num(), massBalance: num('(inflow - outflow) / inflow'),
      splits: arr(obj({name: str(), fraction: num()}, ['name', 'fraction'])),
      pressureDrops: arr(obj({from: str(), to: str(), static: num(), total: num()}, ['from', 'to', 'static', 'total'])),
      sections: arr(obj({name: str(), axis: oneOfConst(['x', 'y', 'z']), position: num(), area: num(), flowRate: num(), meanSpeed: num(), maxSpeed: num(), maxNormalSpeed: num(), meanPressure: num(), meanTotalPressure: num(), momentumFactor: num()},
        ['name', 'axis', 'position', 'area', 'flowRate', 'meanSpeed', 'maxSpeed', 'maxNormalSpeed', 'meanPressure', 'meanTotalPressure', 'momentumFactor'])),
    }, ['patches', 'inflow', 'outflow', 'massBalance', 'splits', 'pressureDrops', 'sections']),
    actuators: arr(obj({name: str(), cells: int(), force: num(), axis: ref('vec3'), area: num(), pressureJump: num(), meanSpeed: num(), flowRate: num(), power: num()}, ['name', 'cells', 'force', 'axis', 'area', 'pressureJump', 'meanSpeed', 'flowRate', 'power'])),
    wake: nullable(obj({shedding: nullable(obj({frequency: num('Hz'), strouhal: num(), length: num('m'), periods: num(), amplitude: num(), axis: oneOfConst(['lift', 'side'])}, ['frequency', 'strouhal', 'length', 'periods', 'amplitude', 'axis'])),
      recirculationLength: nullable(num('m from the rear of the bounding box')), recirculationFrom: ref('vec3')}, ['shedding', 'recirculationLength', 'recirculationFrom'])),
    streamlines: obj({field: oneOfConst(['mean', 'instant']), speedRange: arr({type: 'number'}, '', {minItems: 2, maxItems: 2}),
      lines: arr(obj({seed: ref('vec3'), termination: oneOfConst(['opening', 'wall', 'outside', 'stagnation', 'length']), points: nums('x, y, z per vertex, m'), speed: nums('m/s per vertex'), pressure: nums('Pa gauge per vertex')}, ['seed', 'termination', 'points', 'speed', 'pressure']))}, ['field', 'speedRange', 'lines']),
    slices: arr(obj({axis: oneOfConst(['x', 'y', 'z']), position: num(), axes: arr(oneOfConst(['x', 'y', 'z']), '', {minItems: 2, maxItems: 2}), nu: int(), nv: int(), origin: arr({type: 'number'}, '', {minItems: 2, maxItems: 2}), cell: num(),
      speed: nums(), pressure: nums(), u: nums(), v: nums(), fluid: arr({enum: [0, 1]})}, ['axis', 'position', 'axes', 'nu', 'nv', 'origin', 'cell', 'speed', 'pressure', 'u', 'v', 'fluid'])),
    surface: arr(obj({part: str(), positions: nums(), indices: arr({type: 'integer'}), pressure: nums('Pa per vertex'), cp: nums(), pressureMin: num(), pressureMax: num(), cpMin: num(), cpMax: num()}, ['part', 'positions', 'indices', 'pressure', 'cp', 'pressureMin', 'pressureMax', 'cpMin', 'cpMax'])),
    lines: arr(obj({name: str(), from: ref('vec3'), to: ref('vec3'), s: nums(), ux: nums(), uy: nums(), uz: nums(), speed: nums(), pressure: nums(), distance: nums(), zeroCrossings: nums()}, ['name', 'from', 'to', 's', 'ux', 'uy', 'uz', 'speed', 'pressure', 'distance', 'zeroCrossings'])),
    warnings: arr(str()),
    limits: arr(str()),
  },
};

const files = {'flow-study.schema.json': study, 'flow-result.schema.json': result};
const check = process.argv.includes('--check');
let stale = 0;
for (const [name, schema] of Object.entries(files)) {
  const text = JSON.stringify(schema, null, 1) + '\n', path = join(out, name);
  if (check) {
    let old = '';
    try { old = readFileSync(path, 'utf8'); } catch {}
    if (old !== text) { console.error(`${name} differs from what scripts/flow-schemas.mjs writes; run it.`); stale++; }
  } else writeFileSync(path, text);
}
if (check && stale) process.exit(1);
if (!check) console.log(`wrote ${Object.keys(files).join(', ')}`);
