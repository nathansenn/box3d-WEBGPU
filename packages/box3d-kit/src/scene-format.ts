/**
 * The scene format alone, for tools that read, check, hash and link scenes without simulating them: an editor, a
 * server that validates uploads, a build step. It loads none of the solvers (about 63 KiB of gzip against about
 * 390 KiB for `box3d-webgpu-kit/scene`, which builds coupled scenes and therefore needs all of them).
 *
 * Everything here is also exported by `box3d-webgpu-kit/scene`, with one difference: this entry's `loadScene` builds
 * rigid bodies and joints only, and refuses a scene with coupled sections (water, cables, cloth, ...) with
 * `INVALID_STATE` and a message that names `box3d-webgpu-kit/scene`.
 */
export * from './core/scene-format.js';
