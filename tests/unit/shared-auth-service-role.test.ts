/**
 * isServiceRoleRequest — porta das funções que só servidor chama (ex.: evaluate-agent-conversation).
 * O gateway aceita qualquer JWT válido, a anon key inclusive; esta checagem é o que separa
 * chamada interna de "qualquer um com a chave pública".
 */
import { describe, it, expect, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { isServiceRoleRequest } from "../../supabase/functions/_shared/auth";

const SERVICE = "service-role-key-123";
const req = (authorization?: string) =>
  new Request("http://test.com", authorization ? { headers: { Authorization: authorization } } : undefined);

describe("isServiceRoleRequest", () => {
  beforeEach(() => clearDenoEnv());

  it("aceita Bearer com a service role", () => {
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE);
    expect(isServiceRoleRequest(req(`Bearer ${SERVICE}`))).toBe(true);
  });

  it("recusa a anon key", () => {
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE);
    setDenoEnv("SUPABASE_ANON_KEY", "anon-key-456");
    expect(isServiceRoleRequest(req("Bearer anon-key-456"))).toBe(false);
  });

  it("recusa sem cabeçalho Authorization", () => {
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE);
    expect(isServiceRoleRequest(req())).toBe(false);
  });

  it("recusa a chave certa sem o prefixo Bearer", () => {
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE);
    expect(isServiceRoleRequest(req(SERVICE))).toBe(false);
  });

  it("falha fechada quando a service role não está no ambiente", () => {
    expect(isServiceRoleRequest(req("Bearer "))).toBe(false);
    expect(isServiceRoleRequest(req(`Bearer ${SERVICE}`))).toBe(false);
  });
});
