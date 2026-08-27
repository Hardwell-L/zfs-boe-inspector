import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        devtools: 'devtools.html',
        panel: 'panel.html',
        background: 'src/background.ts',
      },
      output: {
        entryFileNames: 'assets/[name].js',
      },
    },
  },
});
