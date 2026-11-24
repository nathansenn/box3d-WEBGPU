import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// The pthread Box3D artifact (public/box3d/box3d-mt.*) needs SharedArrayBuffer, which browsers expose only to
// cross-origin isolated pages. Every subresource of the app is same-origin, so require-corp blocks nothing.
// Without these headers the page loads the single-threaded artifact instead (docs/THREADED_ENGINE.md).
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Relative asset paths make the build work from localhost, file previews,
// and GitHub Pages project URLs such as /box3d-WEBGPU/.
export default defineConfig({
  plugins: [{
    name: 'box3d-license-notices',
    generateBundle() {
      for (const [fileName, sourceFile] of [['licenses/project.txt', 'LICENSE'], ['licenses/third-party.txt', 'THIRD_PARTY_NOTICES.md'], ['licenses/box3d.txt', 'public/box3d/BOX3D_LICENSE.txt']]) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL('./' + sourceFile, import.meta.url), 'utf8') });
      }
    },
  }],
  base: process.env.VITE_BASE_PATH ?? './',
  build: {
    rolldownOptions: {
      input: {
        studio: fileURLToPath(new URL('./index.html', import.meta.url)),
        lab: fileURLToPath(new URL('./lab.html', import.meta.url)),
        // The GPU compute check (docs/GPU_COMPUTE.md): validation and timings of the compute backends on the visitor's device.
        gpu: fileURLToPath(new URL('./gpu-probe.html', import.meta.url)),
        // Flow studies (docs/FLOW.md): four lattice-Boltzmann studies run in a worker and drawn with box3d-webgpu-kit/flow-three.
        flow: fileURLToPath(new URL('./flow-demo.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    headers: crossOriginIsolation,
    // Generated benchmark runtimes are not application source. Their repeatedly
    // written tsconfigs must not reset a user's running studio experiment.
    watch: { ignored: ['**/benchmarks/experiments/**/runtime/**'] },
  },
  preview: {
    host: '127.0.0.1',
    headers: crossOriginIsolation,
  },
});
