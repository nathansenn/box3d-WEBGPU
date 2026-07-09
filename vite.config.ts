import { defineConfig } from 'vite';

// Relative asset paths make the build work from localhost, file previews,
// and GitHub Pages project URLs such as /box3d-WEBGPU/.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? './',
  server: {
    host: '0.0.0.0',
  },
  preview: {
    host: '0.0.0.0',
  },
});
