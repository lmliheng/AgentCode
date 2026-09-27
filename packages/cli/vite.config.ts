// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueTui from '@vue-tui/vite';

export default defineConfig({
    plugins: [vue(), vueTui()],
    build: {
        outDir: 'src/cli/dist',
        rollupOptions: {
            input: 'src/cli/main.ts',
        },
    },
    
});