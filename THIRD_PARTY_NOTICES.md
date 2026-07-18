# Third-Party Notices

This repository contains original integration, rendering, demonstration, and
tooling code for the Box3D WebGPU AAA Physics Lab. It also integrates or
expects the following third-party software.

## Box3D

- Project: Box3D
- Author: Erin Catto and contributors
- Upstream repository: `erincatto/box3d`
- Default integration revision: `v0.1.0`
- License: MIT

The upstream Box3D source is **not bundled in this repository**. The release
does bundle a reproducible WebAssembly binary built from Box3D `v0.1.0`
(commit `8441b4a06d6d09dcfb0b0f704df4d847d1437b92`) with Emscripten 4.0.23.
`npm run fetch:box3d` and `npm run build:wasm` reproduce that artifact. Box3D
remains subject to its own upstream copyright and license; a copy is shipped
beside the binary in `public/box3d/BOX3D_LICENSE.txt`.

## Dawn / node-webgpu validation dependency

- npm package: `webgpu` 0.4.x
- Project: `dawn-gpu/node-webgpu`
- Underlying implementation: Dawn and Tint
- Copyright: 2017-2025 The Dawn & Tint Authors
- License: BSD 3-Clause, as distributed by the installed package

This dependency is used only by the automated WebGPU validation scripts. It is
not included in the source archive; `npm ci` downloads the platform package and
its license text. The tests use Dawn's null backend, so shader, pipeline,
resource, and command validation do not require a physical GPU.

## Build and development dependencies

The package uses development tools including TypeScript and Vite. Those tools
and their transitive dependencies remain subject to the licenses distributed
with their respective packages. Run `npm install` to obtain them through npm.

## Browser platform APIs

WebGPU, WebAssembly, and browser APIs are platform interfaces and are not
redistributed by this repository.

## TurboQuant research references

The optional simulation-state codec in `src/compression/turboquant.ts` is an
independent implementation informed by the published algorithms in:

- “TurboQuant: Online Vector Quantization with Near-optimal Distortion Rate,”
  arXiv:2504.19874, by Amir Zandieh, Majid Daliri, Majid Hadian, and Vahab
  Mirrokni.
- “Fast-TurboQuant: A Multiplier-Free Online Vector Quantization Approach,”
  arXiv:2606.21448, by Pedro M. R. Pereira, Felipe A. P. de Figueiredo, and
  Rausley A. A. de Souza.

No source code from Google Research or any community TurboQuant implementation
is included. The research papers describe algorithms and remain subject to
their own publication terms.
