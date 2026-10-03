import { defineConfig } from 'vite';

// Relative asset paths make the build work from localhost, file previews,
// and GitHub Pages project URLs such as /box3d-WEBGPU/.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? './',
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
});
