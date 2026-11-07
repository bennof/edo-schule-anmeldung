import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [svelte()],
    // relative paths: the page also works under a sub-path (nginx location /anmeldung/)
    base: './',
    server: {
        port: 8954,
        strictPort: true,
        // the Rust public server
        proxy: { '/api': 'http://localhost:23180' },
    },
});
