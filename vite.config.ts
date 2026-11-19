import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The optional local library server (server/). If it isn't running, the app stays browser-only.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
