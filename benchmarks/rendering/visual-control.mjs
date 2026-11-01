// Control baseline for comparing a renderer that changed its colour pipeline.
// The merged renderer replaced the pow(2.2) gamma approximations with the exact sRGB transfer functions and added a
// static +-0.5/255 interleaved-gradient dither in the post pass. Those are intended visual changes, so pixel parity
// against the unmodified pinned baseline cannot hold. This applies exactly those shader edits (and nothing else) to
// the pinned baseline source, so a parity run against the result checks that every other change is pixel-exact.
// The result is a constructed control, not a historical commit; prepare.mjs records its hash separately.

const SRGB_FUNCTIONS = `
fn srgbToLinear(c : vec3<f32>) -> vec3<f32> {
  return select(pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)), c / 12.92, c <= vec3<f32>(0.04045));
}

fn linearToSrgb(c : vec3<f32>) -> vec3<f32> {
  return select(1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055), c * 12.92, c <= vec3<f32>(0.0031308));
}
`;

const POST_ENCODE = '  color = pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));\n';
const POST_ENCODE_CONTROL = `  color = linearToSrgb(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)));
  let ign = fract(52.9829189 * fract(dot(floor(input.clipPosition.xy), vec2<f32>(0.06711056, 0.00583715))));
  color = clamp(color + vec3<f32>((ign - 0.5) / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));
`;

export const COLOR_PIPELINE_CONTROL = {
  id: 'color-pipeline-control',
  description: 'Pinned baseline with only the exact sRGB transfer functions and the post-pass dither applied',
  decodeSites: 7,
  encodeSites: 1,
};

export function applyColorPipelineControl(source) {
  const structEnd = '  qualityModes : vec4<f32>,\n};\n`;';
  if (source.split(structEnd).length !== 2) throw new Error('Control patch: scene uniform struct end not found exactly once');
  let out = source.replace(structEnd, '  qualityModes : vec4<f32>,\n};\n' + SRGB_FUNCTIONS + '`;');
  let decodes = 0;
  out = out.replace(/pow\(([^\n]*), vec3<f32>\(2\.2\)\)/g, (_, inner) => { decodes++; return `srgbToLinear(${inner})`; });
  if (decodes !== COLOR_PIPELINE_CONTROL.decodeSites) throw new Error(`Control patch: expected ${COLOR_PIPELINE_CONTROL.decodeSites} gamma decodes, found ${decodes}`);
  if (out.split(POST_ENCODE).length !== 2) throw new Error('Control patch: post-pass gamma encode not found exactly once');
  out = out.replace(POST_ENCODE, POST_ENCODE_CONTROL);
  if (/vec3<f32>\(2\.2\)|1\.0 \/ 2\.2/.test(out)) throw new Error('Control patch: a gamma approximation remains');
  return out;
}
