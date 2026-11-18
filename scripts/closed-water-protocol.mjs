/** Predeclared physical accuracy workload and acceptance bounds. */
export function closedWaterProtocol() {
const base={cols:32,rows:24,dt:1/120,gravity:9.81,meanDepth:1.5,drag:0,dx:12/32,dz:9/24};
const mode={m:2,n:1,amplitude:.03,offset:.02};
const cases=[
  ...[[3,3],[31,17]].map(([cols,rows])=>({name:`rest-${cols}-${rows}`,kind:'rest',config:{...base,cols,rows,drag:.28},ticks:24000,sampleEvery:2400})),
  ...[[1,0],[0,1],[2,1]].map(([m,n])=>({name:`mode-${m}-${n}`,kind:'mode',mode:{...mode,m,n},config:base,ticks:24000,sampleEvery:1200})),
  {name:'drag-mode',kind:'mode',mode,config:{...base,drag:.28},ticks:12000,sampleEvery:1200},
  {name:'mixed-high-courant',kind:'mixed',config:{...base,cols:53,rows:41,dx:.12,dz:.19,dt:.799/(Math.sqrt(base.gravity*base.meanDepth)*Math.hypot(1/.12,1/.19))},ticks:120000,sampleEvery:2400},
  ...[0,.28].flatMap(drag=>[1,2,4,8].map(scale=>({name:`convergence-${drag}-${scale}`,kind:'convergence',mode,config:{...base,cols:16*scale,rows:12*scale,dx:12/(16*scale),dz:9/(12*scale),dt:1/(60*scale),drag},ticks:600*scale,sampleEvery:600*scale,scale}))),
  {name:'million-cells',kind:'mode',mode:{...mode,m:5,n:3},config:{...base,cols:1024,rows:1024,dt:1/240,dx:.5,dz:.6},ticks:120,sampleEvery:120}
];
return {schema:'box3d.closed-water-accuracy-protocol/2',backend:'linear-water-closed-cgrid-webgpu-f32-v1',cases,
  continuumError:'RMS of eta error/amplitude and u/v error/(amplitude*sqrt(gravity/meanDepth)); dimensionless, using each field at its own time level',
  thresholds:{discreteMaxAbsolute:5e-6,cpuGpuAbsolute:5e-5,cpuGpuRelative:5e-5,massRelativeToInitialL1:1e-4,undampedModifiedEnergyRelative:5e-4,continuumFineNormalizedRms:.003,convergenceRatio:[3.5,4.5],telemetryAbsolute:1e-4,telemetryRelative:1e-4},
  scopes:['Closed rectangular flat-bottom linear shallow water','eta at cell centers; face velocities at previous half-time','Analytic standing waves and independent discrete modal solution','No-flow walls and mass conservation up to float32 roundoff','Undamped leapfrog modified energy, not exact continuum energy','Physical Metal and same-adapter complete checkpoint continuation'],
  exclusions:['Nonlinear wave advection or breaking','Wetting/drying, bathymetry, obstacles or rigid coupling','Physical material calibration','Cross-adapter guarantees','Qualified performance or interactive capacity']};
}
