import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {

  return {
  server: {
    host: "localhost",
    port: 8080,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    proxy: {
      "/api/calendar-service": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/calendar-service/, ""),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt' é obrigatório com este sw.ts: ele só chama skipWaiting() ao
      // receber SKIP_WAITING, que apenas o build 'prompt' de registerSW envia
      // (via updateSW no toast). Com 'autoUpdate' o updateSW compila como
      // no-op, onNeedRefresh nunca dispara e o update fica waiting pra sempre
      // enquanto houver aba aberta.
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'favicon.svg'],
      manifest: {
        name: 'Torque CRM',
        short_name: 'Torque',
        description: 'CRM de vendas de alta performance para times comerciais',
        theme_color: '#E8922A',
        background_color: '#0a0a0a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        // NEVER cache WebSocket / Realtime connections
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      devOptions: {
        enabled: false, // Don't run SW in dev
      },
    }),
    mode === "development" && componentTagger(),
    mode === "production" && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Configurações de build para produção (esbuild não exige dependência terser)
  build: {
    minify: 'esbuild',
    ...(mode === 'production' && {
      esbuild: {
        drop: ['console', 'debugger'],
      },
    }),
    // Source maps em produção para Sentry, em dev para debugging
    sourcemap: true,
    // Dividir chunks para melhor cache
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          query: ['@tanstack/react-query'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          // date-fns é compartilhado por chat, kanban, agenda, follow-ups.
          // Isolá-lo em chunk próprio permite cache cross-rota e evita
          // duplicação no bundle do chat (que importa muitos formatters).
          'date-fns': ['date-fns'],
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
};
});
