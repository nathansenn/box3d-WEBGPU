import {defineConfig} from 'vite';

export default defineConfig({
  // Keep the kit out of dependency pre-bundling so its wasm/ files stay next to it.
  optimizeDeps: {exclude: ['box3d-webgpu-kit']},
  server: {host: '127.0.0.1'},
  preview: {host: '127.0.0.1'},
});
