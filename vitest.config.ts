import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Tests run in node, not a browser: what is worth testing here is the server
// side, where a record is published, withdrawn, or refused. The `@/` alias
// matches tsconfig so the tests import exactly what the routes import.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
