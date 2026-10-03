/**
 * Build da interface CLÁSSICA (a cópia congelada em `classic/`).
 *
 *   npm run build:classic   → dist-classic/   (mesclada em dist/ por scripts/ui-classic/merge-dist.mjs)
 *   npm run dev:classic     → http://localhost:8081
 *
 * Herda o vite.config.ts da raiz (PWA, CSP, chunks, define) e troca só o que é
 * da pasta: raiz, aliases, saída e PostCSS. Ver docs/ui-v5/interface-por-organizacao.md.
 */
import path from "path";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig, mergeConfig, type UserConfig } from "vite";
import baseConfig from "../vite.config";

const RAIZ = path.resolve(__dirname, "..");

export default defineConfig(async (env) => {
  const base = (typeof baseConfig === "function" ? await baseConfig(env) : baseConfig) as UserConfig;
  return mergeConfig(base, {
    root: __dirname,
    envDir: RAIZ,
    publicDir: path.resolve(RAIZ, "public"),
    cacheDir: path.resolve(RAIZ, "node_modules/.vite-classic"),
    server: { port: 8081 },
    resolve: {
      // Array, não objeto: o `mergeConfig` põe estas ANTES do `@` da raiz, e a
      // primeira que casa vence.
      alias: [
        // Logos e mapas são os mesmos — a clássica lê os da V5 (snapshot.mjs não os copia).
        { find: /^@\/assets\//, replacement: `${path.resolve(RAIZ, "src/assets")}/` },
        // A decisão de troca é uma só para as duas builds.
        { find: "@torque/ui-version", replacement: path.resolve(RAIZ, "src/shared/ui-version/core.ts") },
        { find: /^@\//, replacement: `${path.resolve(__dirname, "src")}/` },
      ],
    },
    // PostCSS inline: deixado ao Vite, ele sobe até o postcss.config.js da raiz
    // e o Tailwind carrega a config da V5.
    css: {
      postcss: {
        plugins: [tailwindcss({ config: path.resolve(__dirname, "tailwind.config.ts") }), autoprefixer()],
      },
    },
    build: {
      outDir: path.resolve(RAIZ, "dist-classic"),
      emptyOutDir: true,
    },
  } satisfies UserConfig);
});
