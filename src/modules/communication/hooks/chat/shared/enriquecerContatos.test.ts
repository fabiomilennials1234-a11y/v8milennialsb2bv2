/**
 * `enriquecerContatos` com etiquetas já resolvidas pela RPC.
 *
 * A lista multi passou a receber as etiquetas DENTRO de
 * `get_whatsapp_conversation_list_multi` (migration 20271203000000). Quando a
 * linha já traz as etiquetas, o fan-out a `lead_tags` e
 * `whatsapp_conversation_tags` é requisição jogada fora — duas idas por refetch
 * no pool do PostgREST. Sem a opção, o comportamento é o de sempre: a caixa
 * isolada (`useWhatsAppContacts`) e o banco antigo continuam no fan-out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromMock, rpcMock, respostas } = vi.hoisted(() => {
  const respostas: Record<string, unknown[]> = {};
  const fromMock = vi.fn((tabela: string) => {
    const builder = {
      select: () => builder,
      in: () => Promise.resolve({ data: respostas[tabela] ?? [], error: null }),
    };
    return builder;
  });
  const rpcMock = vi.fn(async () => ({ data: [], error: null }));
  return { fromMock, rpcMock, respostas };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => fromMock(t),
    rpc: (...a: unknown[]) => rpcMock(...(a as [])),
  },
}));
vi.mock("./savedContactNames", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enrichSavedContactNames: vi.fn(async () => undefined),
}));

import { enriquecerContatos } from "./enriquecerContatos";
import type { ChatContact, ChatContactTag } from "../types";

const VIP: ChatContactTag = { id: "t-vip", name: "VIP", color: "#f00" };
const QUENTE: ChatContactTag = { id: "t-quente", name: "Quente", color: "#0f0" };

function contato(over: Partial<ChatContact> = {}): ChatContact {
  return {
    channel: "whatsapp",
    instance_id: "cx-a",
    phone_number: "5548900000001",
    push_name: "Cliente",
    last_message: "oi",
    last_message_time: "2026-10-19T12:00:00Z",
    last_message_direction: "incoming",
    last_message_sent_source: null,
    unread_count: 0,
    lead_id: "lead-1",
    lead_name: null,
    conversation_id: "conv-1",
    archived_at: null,
    tags: [],
    is_group: false,
    funnels: [],
    qualification_tier: null,
    ...over,
  } as ChatContact;
}

const tabelasConsultadas = () => fromMock.mock.calls.map(([t]) => t);

beforeEach(() => {
  fromMock.mockClear();
  rpcMock.mockClear();
  for (const k of Object.keys(respostas)) delete respostas[k];
  respostas.leads = [{ id: "lead-1", name: "Lead Um", erp_code: null }];
  respostas.lead_tags = [{ lead_id: "lead-1", tags: VIP }];
  respostas.whatsapp_conversation_tags = [
    { conversation_id: "conv-1", tags: VIP },
    { conversation_id: "conv-1", tags: QUENTE },
  ];
});

describe("enriquecerContatos", () => {
  it("etiquetas já resolvidas: não consulta lead_tags nem whatsapp_conversation_tags e preserva c.tags", async () => {
    const daRpc = [QUENTE, VIP];
    const contatos = [contato({ tags: daRpc })];

    await enriquecerContatos(contatos, { tagsCriticas: false, etiquetasJaResolvidas: true });

    expect(tabelasConsultadas()).not.toContain("lead_tags");
    expect(tabelasConsultadas()).not.toContain("whatsapp_conversation_tags");
    // A ordem e o conteúdo são os da RPC — o merge do front não roda por cima.
    expect(contatos[0].tags).toEqual([QUENTE, VIP]);
    // O resto do enriquecimento segue: nome do lead continua vindo de `leads`.
    expect(tabelasConsultadas()).toContain("leads");
    expect(contatos[0].lead_name).toBe("Lead Um");
  });

  it("etiquetas já resolvidas valem também com filtro de etiqueta ativo (tagsCriticas)", async () => {
    const contatos = [contato({ tags: [VIP] })];

    await enriquecerContatos(contatos, { tagsCriticas: true, etiquetasJaResolvidas: true });

    expect(tabelasConsultadas()).not.toContain("lead_tags");
    expect(tabelasConsultadas()).not.toContain("whatsapp_conversation_tags");
    expect(contatos[0].tags).toEqual([VIP]);
  });

  it("sem a opção: fan-out de sempre, lead primeiro e dedupe por id", async () => {
    const contatos = [contato()];

    await enriquecerContatos(contatos, { tagsCriticas: false });

    expect(tabelasConsultadas()).toEqual(
      expect.arrayContaining(["leads", "lead_tags", "whatsapp_conversation_tags"]),
    );
    expect(contatos[0].tags).toEqual([VIP, QUENTE]);
  });
});
