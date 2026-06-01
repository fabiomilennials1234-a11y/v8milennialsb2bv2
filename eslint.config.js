import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import noBrittleSupabaseMocks from "./eslint-rules/no-brittle-supabase-mocks.js";

export default tseslint.config(
  {
    ignores: [
      "dist",
      // Auto-gerado pelo Supabase CLI — regen via `supabase gen types typescript`.
      // Editar manualmente é proibido (ver CLAUDE.md). Parsing errors aqui
      // indicam drift de versão CLI ou schema; corrigir é regen, não fix manual.
      "src/integrations/supabase/types.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "boundaries": boundaries,
      "custom": { rules: { "no-brittle-supabase-mocks": noBrittleSupabaseMocks } },
    },
    settings: {
      // Boundary enforcement em error mode (slice 17 — 2026-05-28).
      // Estrutura modular consolidada (slices 1-16). Cross-module só via barrel
      // `@/modules/<bc>` (deep-import apenas para pages/* — preserva React.lazy).
      // Ver: .specs/features/modularizacao/SPEC.md
      "boundaries/elements": [
        { type: "module", pattern: "src/modules/*", mode: "folder" },
        { type: "ui", pattern: "src/components/ui/**" },
        { type: "shared", pattern: "src/shared/**" },
        { type: "core", pattern: "src/core/**" },
      ],
      "boundaries/include": ["src/**/*"],
      "boundaries/ignore": [
        "src/integrations/supabase/types.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.stories.{ts,tsx}",
      ],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Pre-existing violations downgraded to warn — enforce progressively
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
      "no-useless-escape": "warn",
      "no-misleading-character-class": "warn",
      "no-control-regex": "warn",
      "no-self-assign": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "custom/no-brittle-supabase-mocks": "warn",
      // Boundary rules (slice 17 — 2026-05-28: flip warn → error).
      "boundaries/element-types": ["error", {
        default: "allow",
        rules: [
          { from: "module", allow: ["ui", "shared", "core", "module"] },
          { from: "ui", allow: ["ui", "shared", "core"] },
          { from: "shared", allow: ["shared", "core"] },
          { from: "core", allow: ["core"] },
        ],
      }],
      "boundaries/no-private": ["error", { allowUncles: false }],
      "boundaries/no-unknown": "off",
      "boundaries/no-unknown-files": "off",
    },
  },
  // Grandfathered files — pre-existing brittle Supabase chain mocks.
  // New test files MUST use createMockSupabase from tests/helpers/supabase-mock.ts.
  {
    files: [
      "tests/unit/use-workflows.test.ts",
      "tests/unit/use-tags.test.ts",
      "tests/unit/use-copilot-prompt-builder.test.ts",
      "tests/unit/use-commissions.test.ts",
      "tests/unit/hooks-batch-8-tags.test.ts",
      "tests/unit/use-products.test.ts",
      "tests/unit/hooks-batch-1.test.ts",
      "tests/unit/hooks-sprint2-master-users.test.ts",
      "tests/unit/hooks-sprint2-stage-workflows.test.ts",
      "tests/unit/use-webhooks.test.ts",
      "tests/unit/hooks-sprint2-small.test.ts",
      "tests/unit/hooks-batch-8-workflows.test.ts",
      "tests/unit/hooks-batch-8-channel-chat.test.ts",
      "tests/unit/hooks-batch-8-goals.test.ts",
      "tests/unit/use-custom-pipelines.test.ts",
      "tests/unit/hooks-sprint2-pipeline-stages.test.ts",
      "tests/unit/subscription.test.ts",
      "tests/unit/hooks-sprint2-team-members.test.ts",
      "tests/unit/use-follow-ups.test.ts",
      "tests/unit/hooks-batch-8-commissions.test.ts",
      "tests/unit/hooks-sprint2-leads.test.ts",
      "tests/unit/use-whatsapp-chat.test.ts",
      "tests/unit/use-goals.test.ts",
      "tests/unit/use-permissions-hooks.test.ts",
      "tests/unit/hooks-sprint2-campaign-templates.test.ts",
      "tests/unit/use-organization.test.ts",
      "tests/unit/use-campanhas.test.ts",
      "tests/unit/hooks-batch-8-products.test.ts",
      "tests/unit/hooks-batch-8-followups.test.ts",
      "tests/unit/use-copilot-agents.test.ts",
      "tests/unit/permissions.test.ts",
      "tests/unit/use-master-auth.test.ts",
      "tests/unit/use-resolve-chat-deep-link.test.ts",
      "tests/unit/hooks-batch-8-checkout.test.ts",
      "tests/helpers/hook-test-utils.ts",
    ],
    rules: {
      "custom/no-brittle-supabase-mocks": "off",
    },
  },
);
