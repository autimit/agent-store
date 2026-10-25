import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath, URL} from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  build: {
    outDir: 'web/dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/')) return 'react';
          if (id.includes('/node_modules/@base-ui/') || id.includes('/node_modules/@floating-ui/')) return 'controls';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8093',
      '/healthz': 'http://127.0.0.1:8093',
      '/openapi.json': 'http://127.0.0.1:8093',
      '/llms.txt': 'http://127.0.0.1:8093',
      '/assets/t-shirt.png': 'http://127.0.0.1:8093',
    },
  },
});
