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

The upstream Box3D source is **not bundled in this archive**. The command
`npm run fetch:box3d` clones the pinned revision into `third_party/box3d`, and
`npm run build:wasm` links it into the WebAssembly bridge. Box3D remains
subject to its own upstream copyright and license notices.

## Build and development dependencies

The package uses development tools including TypeScript and Vite. Those tools
and their transitive dependencies remain subject to the licenses distributed
with their respective packages. Run `npm install` to obtain them through npm.

## Browser platform APIs

WebGPU, WebAssembly, and browser APIs are platform interfaces and are not
redistributed by this repository.
