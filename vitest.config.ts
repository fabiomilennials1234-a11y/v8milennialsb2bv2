import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Map Deno-style imports to npm packages for testing _shared/ files
      'https://esm.sh/@supabase/supabase-js@2': '@supabase/supabase-js',
      // Map Deno std library imports to Node equivalents
      'https://deno.land/std@0.177.0/node/crypto.ts': 'crypto',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['node_modules', 'dist', '.agent'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: [
        'src/lib/**',
        'src/hooks/**',
        'src/contexts/**',
        'supabase/functions/_shared/**',
      ],
    },
  },
});
