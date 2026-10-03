import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [svelte()],
    server: {
        port: 5174,
        strictPort: true,
        // the Rust public server
        proxy: { '/api': 'http://localhost:8080' },
    },
});
