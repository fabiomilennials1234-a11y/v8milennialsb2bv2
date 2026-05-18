/**
 * `noRetryOnTimeout` — política de retry pra TanStack Query que NÃO retenta
 * em statement_timeout do Postgres (error code 57014).
 *
 * Motivação: retry cego em queries que estão batendo no statement_timeout
 * amplifica 3× a latência percebida e nunca cura — a query continua dando
 * timeout. Falha rápido, fallback decide o que fazer.
 */
import { describe, it, expect } from "vitest";
import { noRetryOnTimeout } from "@/integrations/supabase/noRetryOnTimeout";

describe("noRetryOnTimeout", () => {
  it("não retenta quando erro é Postgres statement_timeout (57014)", () => {
    expect(noRetryOnTimeout(0, { code: "57014", message: "timeout" })).toBe(false);
  });

  it("não retenta independentemente do failureCount em 57014", () => {
    expect(noRetryOnTimeout(2, { code: "57014" })).toBe(false);
  });

  it("retenta em outros erros até o limite padrão (3 tentativas)", () => {
    expect(noRetryOnTimeout(0, { code: "PGRST301" })).toBe(true);
    expect(noRetryOnTimeout(1, { code: "PGRST301" })).toBe(true);
    expect(noRetryOnTimeout(2, { code: "PGRST301" })).toBe(true);
    expect(noRetryOnTimeout(3, { code: "PGRST301" })).toBe(false);
  });

  it("trata erro sem code como retryable até limite", () => {
    expect(noRetryOnTimeout(0, new Error("network"))).toBe(true);
    expect(noRetryOnTimeout(3, new Error("network"))).toBe(false);
  });

  it("trata null/undefined error como retryable até limite", () => {
    expect(noRetryOnTimeout(0, null)).toBe(true);
    expect(noRetryOnTimeout(3, undefined)).toBe(false);
  });
});
