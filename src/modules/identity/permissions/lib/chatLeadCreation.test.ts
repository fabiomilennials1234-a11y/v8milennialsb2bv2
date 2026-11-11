import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  userId: "karine" as string | null,
  rows: {} as Record<string, Record<string, unknown>>,
  error: null as Error | null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }) },
  from: () => ({ select: () => ({ eq: (_key: string, org: string) => ({ single: async () => ({
    data: { feature_flags: state.rows[org] }, error: state.error,
  }) }) }) }),
} }));
import { assertChatLeadCreationAllowed, readChatLeadCreationAllowed } from "./chatLeadCreation";

describe("criação pelo chat restrita por organização e usuário", () => {
  beforeEach(() => {
    state.userId = "karine";
    state.rows = { jrtex: { chat_lead_creation_user_ids: ["karine"] }, outra: {} };
    state.error = null;
  });
  it("libera Karine na organização configurada", async () => {
    await expect(assertChatLeadCreationAllowed("jrtex")).resolves.toBeUndefined();
  });
  it("bloqueia outro usuário, inclusive sem exceção de administrador", async () => {
    state.userId = "outro-admin";
    await expect(assertChatLeadCreationAllowed("jrtex")).rejects.toThrow("permissão");
  });
  it("mantém outra organização liberada para o mesmo usuário", async () => {
    state.userId = "outro-admin";
    expect(await readChatLeadCreationAllowed("jrtex")).toBe(false);
    expect(await readChatLeadCreationAllowed("outra")).toBe(true);
  });
  it("revalida revogação antes do envio", async () => {
    expect(await readChatLeadCreationAllowed("jrtex")).toBe(true);
    state.rows.jrtex.chat_lead_creation_user_ids = [];
    await expect(assertChatLeadCreationAllowed("jrtex")).rejects.toThrow("permissão");
  });
  it("recusa configuração inválida", async () => {
    state.rows.jrtex.chat_lead_creation_user_ids = "karine";
    expect(await readChatLeadCreationAllowed("jrtex")).toBe(false);
  });
  it("não libera quando a leitura falha", async () => {
    state.error = new Error("read failed");
    await expect(assertChatLeadCreationAllowed("jrtex")).rejects.toThrow("read failed");
  });
  it("recusa sessão ausente", async () => {
    state.userId = null;
    expect(await readChatLeadCreationAllowed("outra")).toBe(false);
  });
});
