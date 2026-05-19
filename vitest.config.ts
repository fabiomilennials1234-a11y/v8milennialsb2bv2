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
      // PWA virtual module — resolved by vite-plugin-pwa in build,
      // needs a stub in test so vi.mock can intercept it.
      'virtual:pwa-register': path.resolve(__dirname, 'tests/helpers/__pwa-register-stub.ts'),
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
        'supabase/functions/lead-webhook/**',
      ],
      // Ratchet baseline: numbers just below current state block regressions
      // without breaking the build today. Raise on every Fase 1+ landing.
      thresholds: {
        // Global floor — ratcheted after Fase 1 (was 68/63/65/55).
        // Current: 73.53 / 60.04 / 67.15 / 68.58. Baseline trava regressão.
        lines: 72,
        statements: 68,
        functions: 67,
        branches: 59,

        // Near-complete file — keep the bar high (fragile area, CLAUDE.md).
        // Current: 100 / 95.58 / 100 / 98.68
        'src/lib/permissions.ts': {
          lines: 98,
          statements: 95,
          functions: 100,
          branches: 90,
        },

        // Backend permission engine — fragile area, now heavily tested.
        // Current: 95.31 / 97.72 / 85.71 / 95.83 (Fase 1 bump).
        'supabase/functions/_shared/permission_engine.ts': {
          lines: 95,
          statements: 95,
          functions: 85,
          branches: 95,
        },

        // user-auth — auth middleware shared by 78 edge functions.
        // Current: 98.48 / 94.52 / 100 / 98.61 (Fase 1 bump).
        'supabase/functions/_shared/user-auth.ts': {
          lines: 98,
          statements: 98,
          functions: 100,
          branches: 90,
        },

        // workflow-executor — DAG engine for all automations.
        // Current: 92.6 / 80.64 / 90.47 / 91.84 (Fase 1 bump).
        'supabase/functions/_shared/workflow-executor.ts': {
          lines: 92,
          statements: 91,
          functions: 90,
          branches: 80,
        },

        // workflow-trigger — fires workflow executions from edge functions + pg_cron.
        // Current: 100 / 92.97 / 100 / 94.95 (Fase 1 bump).
        'supabase/functions/_shared/workflow-trigger.ts': {
          lines: 100,
          statements: 94,
          functions: 100,
          branches: 92,
        },

        // workflow-action-handler — 30 action types executed inside DAG.
        // Current: 95.82 / 82.1 / 100 / 92.99 (Fase 1 bump).
        'supabase/functions/_shared/workflow-action-handler.ts': {
          lines: 95,
          statements: 92,
          functions: 100,
          branches: 82,
        },

        // lead-webhook — main public ingress for all leads (n8n, Meta Ads).
        // Current: 83.76 / 71.47 / 55.55 / 82.78. Low funcs % is the
        // background-task arrow fns that only fire after HTTP response.
        'supabase/functions/lead-webhook/index.ts': {
          lines: 83,
          statements: 82,
          functions: 55,
          branches: 70,
        },

        // followup-sender — copilot outbound message path (fragile area).
        // Current: 100 / 100 / 100 / 100 (Fase 1 bump).
        'supabase/functions/_shared/followup-sender.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },

        // workflow-condition-evaluator — pure compare() + lead lookup helpers.
        // Current: 100 / 100 / 100 / 100 (Fase 1 bump).
        'supabase/functions/_shared/workflow-condition-evaluator.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },

        // lead-service — get-or-create lead + shadow promotion + search.
        // Core of lead-webhook ingestion. Current: 100 / 94.05 / 100 / 100.
        'supabase/functions/_shared/lead-service.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 94,
        },

        // outbound-sender — whatsapp outbound dispatch (text + audio).
        // Current: 96.77 / 93.54 / 80 / 95.87 (Fase 1 bump).
        'supabase/functions/_shared/outbound-sender.ts': {
          lines: 96,
          statements: 95,
          functions: 80,
          branches: 93,
        },

        // google-calendar-utils — AES-GCM + OAuth state + token refresh.
        // Current: 100 / 91.66 / 93.33 / 98.55 (Fase 1 bump).
        'supabase/functions/_shared/google-calendar-utils.ts': {
          lines: 100,
          statements: 98,
          functions: 93,
          branches: 91,
        },

        // tts-elevenlabs — voice generation for copilot audio replies.
        // Current: 100 / 100 / 66.66 / 98. Low funcs is supabase storage
        // helper arrows mocked away. Threshold freezes real coverage.
        'supabase/functions/_shared/tts-elevenlabs.ts': {
          lines: 100,
          statements: 97,
          functions: 66,
          branches: 100,
        },

        // tinyerp-utils — ERP integration (orders + products + tokens).
        // Current: 100 / 96.87 / 100 / 98.3 (Fase 1 bump).
        'supabase/functions/_shared/tinyerp-utils.ts': {
          lines: 100,
          statements: 98,
          functions: 100,
          branches: 96,
        },

        // meta-api — Meta Graph API (OAuth, pages, lead ads, webhooks).
        // Current: 100 / 93.15 / 100 / 100 (Fase 1 bump).
        'supabase/functions/_shared/meta-api.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 93,
        },

        // asaas — payment gateway (customers, payments, PIX, subscriptions).
        // Current: 100 / 100 / 100 / 100.
        'supabase/functions/_shared/asaas.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },

        // embeddings — Gemini Embedding 2 + RAG chunking (pgvector 1536d).
        // Current: 100 / 92.85 / 100 / 100.
        'supabase/functions/_shared/embeddings.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 92,
        },

        // auth (webhook/api-key auth) — per-org tq_live_ + legacy + HMAC.
        // Current: 98.93 / 98.59 / 92.85 / 98.94.
        'supabase/functions/_shared/auth.ts': {
          lines: 98,
          statements: 98,
          functions: 92,
          branches: 98,
        },

        // ai-queue — copilot action queue with idempotency.
        // Current: 100 / 100 / 100 / 100.
        'supabase/functions/_shared/ai-queue.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },

        // audio-sender — WhatsApp voice note dispatch via Evolution API.
        // Current: 100 / 100 / 100 / 100.
        'supabase/functions/_shared/audio-sender.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },

        // natural-messaging — smart message splitting (LLM + heuristic fallback).
        // Current: 94.31 / 75.75 / 100 / 93.93.
        'supabase/functions/_shared/natural-messaging.ts': {
          lines: 94,
          statements: 93,
          functions: 100,
          branches: 75,
        },

        // ai-action-executor — Copilot action dispatcher (1,323 LOC).
        // Remaining gap: dead-code descriptionFn arrows in
        // ACTION_HISTORY_MAP (unreachable due to STAGE_AI_ACTIONS skip
        // check) + best-effort error catches. Threshold freezes current.
        // Current: 94.27 / 85.52 / 88.37 / 93.91.
        'supabase/functions/_shared/ai-action-executor.ts': {
          lines: 94,
          statements: 93,
          functions: 88,
          branches: 85,
        },
      },
    },
  },
});
