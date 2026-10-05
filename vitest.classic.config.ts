/**
 * Vitest da interface CLÁSSICA (`classic/`, servida às orgs com
 * `organizations.ui_v5_enabled = false` — a maioria em prod).
 *
 *   npm run test:classic
 *
 * Por que existe: `classic/` é snapshot congelado da main e o snapshot PODA os
 * testes (scripts/ui-classic/snapshot.mjs). Todo conserto portado para lá via
 * `classic.patch` chegava em prod sem um teste rodando contra o código que de
 * fato vai para a clássica. Os testes daqui ficam em `tests/classic/` e são
 * cópias dos testes da V5 para o mesmo comportamento, com `@` resolvendo para
 * `classic/src`.
 *
 * Os aliases espelham `classic/vite.config.ts` (o que vale em build): assets e
 * a decisão de troca de interface vêm da V5; o resto, da clássica.
 */
import path from "path";
import { defineConfig } from "vitest/config";

const RAIZ = __dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/assets\//, replacement: `${path.resolve(RAIZ, "src/assets")}/` },
      { find: "@torque/ui-version", replacement: path.resolve(RAIZ, "src/shared/ui-version/core.ts") },
      { find: "virtual:pwa-register", replacement: path.resolve(RAIZ, "tests/helpers/__pwa-register-stub.ts") },
      { find: /^@\//, replacement: `${path.resolve(RAIZ, "classic/src")}/` },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["tests/classic/**/*.{test,spec}.{ts,tsx}"],
  },
});
