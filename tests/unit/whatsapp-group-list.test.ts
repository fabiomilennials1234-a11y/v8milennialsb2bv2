// @vitest-environment node
/**
 * listInstanceGroups — a lista de grupos que o painel do nó `send_to_group`
 * oferece. Lógica pura sobre `provider.listChats("group")`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  GROUP_LIST_CAP,
  authorizeGroupListing,
  listInstanceGroups,
} from "../../supabase/functions/_shared/whatsapp-group-list.ts";

type Chat = { id: string; name?: string; isGroup?: boolean };

function provider(chats: Chat[]) {
  return { listChats: vi.fn(async (_type?: string) => chats) };
}

describe("listInstanceGroups", () => {
  it("pede só grupos ao provider", async () => {
    const p = provider([]);
    await listInstanceGroups(p);
    expect(p.listChats).toHaveBeenCalledWith("group");
  });

  it("devolve só JIDs de grupo válidos (descarta telefone, LID, lixo)", async () => {
    const r = await listInstanceGroups(provider([
      { id: "120363041234567890@g.us", name: "Comercial" },
      { id: "5548999998888@s.whatsapp.net", name: "Pessoa" },
      { id: "210028246085780@lid", name: "LID" },
      { id: "120363041234567890@g.us.evil", name: "Injeção" },
      { id: "", name: "Vazio" },
    ]));
    expect(r.groups).toEqual([{ jid: "120363041234567890@g.us", name: "Comercial" }]);
    expect(r.truncated).toBe(false);
  });

  it("deduplica por JID, mantendo o primeiro nome não-vazio", async () => {
    const r = await listInstanceGroups(provider([
      { id: "120363000000000001@g.us", name: "" },
      { id: "120363000000000001@g.us", name: "Suporte" },
    ]));
    expect(r.groups).toEqual([{ jid: "120363000000000001@g.us", name: "Suporte" }]);
  });

  it("ordena por nome em pt-BR, sem acento e sem caixa", async () => {
    const r = await listInstanceGroups(provider([
      { id: "120363000000000001@g.us", name: "Vendas" },
      { id: "120363000000000002@g.us", name: "Ágape" },
      { id: "120363000000000003@g.us", name: "abacate" },
      { id: "120363000000000004@g.us", name: "Écran" },
      { id: "120363000000000005@g.us", name: "banana" },
    ]));
    expect(r.groups.map((g) => g.name)).toEqual(["abacate", "Ágape", "banana", "Écran", "Vendas"]);
  });

  it("nome vazio cai num fallback legível com o fim do JID", async () => {
    const r = await listInstanceGroups(provider([
      { id: "120363041234567890@g.us" },
      { id: "120363000000000009@g.us", name: "   " },
    ]));
    for (const g of r.groups) {
      expect(g.name.trim()).not.toBe("");
      expect(g.name).toMatch(/^Grupo sem nome/);
    }
  });

  it("corta em GROUP_LIST_CAP e sinaliza truncated", async () => {
    const chats: Chat[] = Array.from({ length: GROUP_LIST_CAP + 5 }, (_, i) => ({
      id: `120363${String(i).padStart(12, "0")}@g.us`,
      name: `G${String(i).padStart(5, "0")}`,
    }));
    const r = await listInstanceGroups(provider(chats));
    expect(GROUP_LIST_CAP).toBe(1000);
    expect(r.groups).toHaveLength(GROUP_LIST_CAP);
    expect(r.truncated).toBe(true);
  });

  it("provider sem listChats lança NotSupported-like (o proxy traduz em 422)", async () => {
    await expect(listInstanceGroups({} as never)).rejects.toThrow(/listChats/);
  });
});

describe("authorizeGroupListing (gate extra da action listGroups)", () => {
  const allow = vi.fn(async () => ({ data: true, error: null }));
  const deny = vi.fn(async () => ({ data: false, error: null }));
  const broken = vi.fn(async () => ({ data: null, error: { message: "boom" } }));

  it("membro com workflows.edit em instância uazapi → ok", async () => {
    expect(await authorizeGroupListing({ isMaster: false, isGestor: false, provider: "uazapi", canEditWorkflows: allow }))
      .toEqual({ ok: true });
  });

  it("membro SEM workflows.edit → 403 com a mensagem do contrato", async () => {
    expect(await authorizeGroupListing({ isMaster: false, isGestor: false, provider: "uazapi", canEditWorkflows: deny }))
      .toEqual({ ok: false, status: 403, body: { error: "Sem permissão para editar automações" } });
  });

  it("falha ao checar permissão → 503 (fail-closed)", async () => {
    const r = await authorizeGroupListing({ isMaster: false, isGestor: false, provider: "uazapi", canEditWorkflows: broken });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it.each([
    ["master", { isMaster: true, isGestor: false }],
    ["gestor", { isMaster: false, isGestor: true }],
  ])("%s não consulta a permissão", async (_n, who) => {
    const spy = vi.fn(async () => ({ data: false, error: null }));
    const r = await authorizeGroupListing({ ...who, provider: "uazapi", canEditWorkflows: spy });
    expect(r).toEqual({ ok: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(["evolution", "notificame", "meta_cloud", null])("provider %s → 422 groups_not_supported", async (provider) => {
    const r = await authorizeGroupListing({ isMaster: false, isGestor: false, provider, canEditWorkflows: allow });
    expect(r).toMatchObject({ ok: false, status: 422, body: { code: "groups_not_supported" } });
  });

  it("permissão é checada ANTES do provider (sem vazar se o número tem grupo)", async () => {
    const r = await authorizeGroupListing({ isMaster: false, isGestor: false, provider: "evolution", canEditWorkflows: deny });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});
