import { defineConfig, loadEnv, type Plugin, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";

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

/**
 * Source maps para o Sentry (ADR-0038, S6). Só existe com `SENTRY_AUTH_TOKEN`
 * no ambiente do build — e o token só existe no estágio builder do Docker, nunca
 * no bundle nem na imagem servida.
 *
 * Com token: o plugin injeta um debug id em cada chunk, sobe os `.map` e os
 * apaga do `dist/` logo depois. Sem token (dev, CI de teste, build local): não
 * roda, os maps ficam no `dist/` do builder e o Dockerfile os apaga da imagem.
 * Nos dois caminhos `/assets/*.map` nunca é servido.
 *
 * `release.inject: false` porque o `main.tsx` já passa o release ao SDK
 * (`__APP_VERSION__`, o sha do build). O casamento do map com o chunk é pelo
 * debug id, não pelo release.
 */
function sentrySourceMaps(env: Record<string, string>): PluginOption {
  const authToken = env.SENTRY_AUTH_TOKEN?.trim();
  if (!authToken) return null;
  return sentryVitePlugin({
    authToken,
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    // Organização na região EU: a API é outra (de.sentry.io).
    url: env.SENTRY_URL || "https://de.sentry.io",
    release: { name: env.VITE_APP_VERSION || undefined, inject: false },
    sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
    telemetry: false,
  });
}

/**
 * Nome do componente React no rastro de clique e no replay (ADR-0038, S6):
 * `data-sentry-component="KanbanCard"` em cada elemento renderizado. O passo a
 * passo no Sentry passa de `div > button` para `KanbanCard > BotaoExcluir` —
 * legível, e sem dado de lead (o nome vem do código, não da tela; o rótulo
 * visível continua fora do rastro, ver `sentry-event.ts`).
 *
 * Plugin à parte, com `enforce: 'pre'` e ANTES do `react()`: o SWC também é
 * `pre` e compila o JSX; o plugin do Sentry no fim da fila receberia JS sem JSX e
 * não marcaria nada, em silêncio. Daqui só o `transform` de marcação — sem
 * upload, sem release, sem debug id (isso é do `sentrySourceMaps`).
 *
 * Só no build: o dev do time não paga o passe extra de Babel por arquivo, e o
 * dev não manda nada ao Sentry.
 */
function sentryComponentNames(): Plugin {
  const [sentry] = sentryVitePlugin({
    telemetry: false,
    reactComponentAnnotation: { enabled: true },
    sourcemaps: { disable: true },
    release: { create: false, finalize: false, inject: false },
  }) as Plugin[];
  return {
    name: "torque-sentry-component-names",
    enforce: "pre",
    apply: "build",
    transform: sentry.transform,
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
    // Antes do react(): precisa ver o JSX antes do SWC compilá-lo.
    sentryComponentNames(),
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
    // Por último: o plugin do Sentry precisa ver o bundle já final.
    mode === "production" && sentrySourceMaps(env),
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
    // `hidden`: o map é gerado, mas o bundle não aponta para ele (sem
    // `//# sourceMappingURL`). Ele existe para ser enviado ao Sentry e nunca é
    // servido — o Dockerfile o apaga da imagem do nginx. Com `true`, o código-fonte
    // inteiro ficava público em /assets/*.js.map. Ver docs/adr/0038.
    sourcemap: 'hidden',
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
    // Tree-shaking do SDK do Sentry (ADR-0038, S6) — valem com ou sem o plugin,
    // para o bundle não depender de haver token no build: sem logger de debug,
    // sem tracing (não usamos), sem gravar iframe nem shadow DOM no replay.
    __SENTRY_DEBUG__: false,
    __SENTRY_TRACING__: false,
    __RRWEB_EXCLUDE_IFRAME__: true,
    __RRWEB_EXCLUDE_SHADOW_DOM__: true,
    // Identifica o build, não o produto. A imagem Docker é taggeada com o sha
    // curto; sem isto o Support Context de um Chamado apontaria para a versao
    // do package.json, que nao muda entre deploys.
    __APP_VERSION__: JSON.stringify(
      process.env.VITE_APP_VERSION || process.env.npm_package_version || "dev",
    ),
  },
};
});
