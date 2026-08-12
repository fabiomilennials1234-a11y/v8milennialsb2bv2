import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

/**
 * A CSP de `index.html` é estática e lista `https://*.supabase.co`. Isso cobre
 * produção e NÃO cobre o Supabase local (`http://localhost:54321`), que é o
 * alvo do build do job E2E (`.github/workflows/test.yml`). Como a app é servida
 * em `localhost:8080`, `'self'` também não cobre a 54321 — porta diferente é
 * outra origem.
 *
 * Consequência medida na rodada 31527130124: o navegador barra o POST de
 * `/auth/v1/token` antes de ele sair, `tests/e2e/auth.setup.ts` estoura em
 * `waitForURL`, e os 114 testes que dependem do projeto `setup` aparecem como
 * "did not run". O sintoma (timeout) não se parece nada com a causa (CSP).
 *
 * Este plugin acrescenta a origem do `VITE_SUPABASE_URL` do build ao
 * `connect-src`, e só quando ela ainda não estiver coberta. Em produção
 * (`https://<ref>.supabase.co`) o wildcard já cobre e o HTML sai byte-idêntico
 * ao de hoje — a CSP de produção não muda.
 */
function cspComOrigemDoSupabase(supabaseUrl: string): Plugin {
  return {
    name: "torque-csp-supabase-origin",
    transformIndexHtml(html) {
      if (!supabaseUrl) return html;

      let origem: URL;
      try {
        origem = new URL(supabaseUrl);
      } catch {
        return html; // URL inválida não é problema da CSP; o build falha adiante
      }

      return html.replace(/connect-src ([^;]+);/, (bloco, fontes: string) => {
        const lista = fontes.trim().split(/\s+/);
        const http = origem.origin;
        const ws = `${origem.protocol === "https:" ? "wss:" : "ws:"}//${origem.host}`;

        // Cobre literal e wildcard de subdomínio (`https://*.supabase.co`).
        const jaCoberto = (alvo: string) =>
          lista.some((fonte) => {
            if (fonte === alvo) return true;
            const m = /^(\w+:)\/\/\*\.(.+)$/.exec(fonte);
            if (!m) return false;
            const [, esquema, sufixo] = m;
            const a = new URL(alvo);
            return a.protocol === esquema && a.hostname.endsWith(`.${sufixo}`);
          });

        const novas = [http, ws].filter((alvo) => !jaCoberto(alvo));
        if (novas.length === 0) return bloco;

        return `connect-src ${fontes.trim()} ${novas.join(" ")};`;
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // `loadEnv` porque o valor pode vir do ambiente (CI) OU de um `.env` local —
  // `process.env` sozinho só enxerga o primeiro.
  const env = loadEnv(mode, process.cwd(), "");

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
    cspComOrigemDoSupabase(env.VITE_SUPABASE_URL),
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
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Configurações de build para produção (esbuild não exige dependência terser)
  build: {
    minify: 'esbuild',
    // O worklet de captura de áudio da chamada de voz PRECISA sair como arquivo
    // próprio. Ele é pequeno (~3 KB) e o limite padrão de 4 KB o transformava
    // num `data:text/javascript,...` — que a CSP de produção
    // (`script-src 'self' 'unsafe-inline'`) BLOQUEIA, porque `'unsafe-inline'`
    // não libera `data:`. O sintoma seria o pior possível: funciona no dev
    // server, e em produção a chamada conecta e fica muda.
    // `undefined` devolve o resto dos assets ao comportamento padrão.
    assetsInlineLimit: (filePath: string) =>
      filePath.includes('pcm-capture-processor') ? false : undefined,
    ...(mode === 'production' && {
      esbuild: {
        drop: ['console', 'debugger'],
      },
    }),
    // Source maps em produção para stack traces legíveis, em dev para debugging
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
    // Identifica o build, não o produto. A imagem Docker é taggeada com o sha
    // curto; sem isto o Support Context de um Chamado apontaria para a versao
    // do package.json, que nao muda entre deploys.
    __APP_VERSION__: JSON.stringify(
      process.env.VITE_APP_VERSION || process.env.npm_package_version || "dev",
    ),
  },
};
});
