// Integration, browser, SVWS and mail tests against real systems (see Makefile).
// Files run one after another: they share the SharePoint test site and the app ports.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    root: fileURLToPath(new URL('..', import.meta.url)),
    test: {
        include: ['tests/**/*.test.ts'],
        fileParallelism: false,
        testTimeout: 120_000,
        // first start builds the Rust server and signs in through Microsoft
        hookTimeout: 600_000,
    },
});
