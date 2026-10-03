import { defineConfig } from 'vite';

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
  base: process.env.VITE_BASE_PATH ?? './',
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
