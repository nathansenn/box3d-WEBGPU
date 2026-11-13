/**
 * A calibrated material library with sources (SI units): structural and
 * stainless steel, aluminium 6061-T6, copper, grey cast iron, soda-lime glass,
 * concrete, granite, oak and pine along the grain, PMMA, ABS, nylon 66, PTFE,
 * natural rubber, ice, water and air at 20 °C, glass beads and quartz sand.
 * Each value carries its conditions, the figure read in its source and the
 * citation; values no opened source gave are marked unverified and refused
 * unless asked for. Helpers build the inputs of the solid, fracture, heat,
 * granular and rigid solvers (`solidMaterial`, `fractureLaw`, `heatMaterial`,
 * `grainMaterial`, `contactPair`, `rigidMaterial`). See docs/MATERIALS.md in
 * the repository for the table and the citations.
 */
export * from './core/materials.js';
