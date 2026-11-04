import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Logic tests run in node; component tests opt into jsdom with a
    // `@vitest-environment jsdom` comment at the top of the file.
    globals: true, // lets @testing-library/react clean up after each test
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
