/** C-grid leapfrog/centered-drag update. Dispatch boundaries order all face writes
 * before continuity reads them; workgroups never race on a destination element.
 */
export const closedWaterShader=/* wgsl */ `
struct Params { cols:u32, rows:u32, count:u32, padding:u32, decay:f32, px:f32, pz:f32, cx:f32, cz:f32, pad0:f32, pad1:f32, pad2:f32 };
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> eta:array<f32>;
@group(0) @binding(2) var<storage,read> u:array<f32>;
@group(0) @binding(3) var<storage,read> v:array<f32>;
@group(0) @binding(4) var<storage,read_write> nextEta:array<f32>;
@group(0) @binding(5) var<storage,read_write> nextU:array<f32>;
@group(0) @binding(6) var<storage,read_write> nextV:array<f32>;
@compute @workgroup_size(64)
fn velocity(@builtin(global_invocation_id) global:vec3<u32>) {
  let i=global.x;if(i>=params.count){return;}
  let x=i%params.cols;let z=i/params.cols;
  var east=0.0;var north=0.0;
  if(x+1u<params.cols){east=u[i]*params.decay-(eta[i+1u]-eta[i])*params.px;}
  if(z+1u<params.rows){north=v[i]*params.decay-(eta[i+params.cols]-eta[i])*params.pz;}
  nextU[i]=east;nextV[i]=north;
}
@compute @workgroup_size(64)
fn continuity(@builtin(global_invocation_id) global:vec3<u32>) {
  let i=global.x;if(i>=params.count){return;}
  let x=i%params.cols;let z=i/params.cols;
  var west=0.0;var south=0.0;
  if(x>0u){west=nextU[i-1u];}
  if(z>0u){south=nextV[i-params.cols];}
  nextEta[i]=eta[i]-(nextU[i]-west)*params.cx-(nextV[i]-south)*params.cz;
}
`;
