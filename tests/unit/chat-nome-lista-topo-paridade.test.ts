/**
 * Chamados 83b5639e + e261b64b (Café Jurerê): com a flag `chat_nome_do_lead`, a
 * MESMA conversa tem o mesmo nome na lista, no cabeçalho e no painel lateral.
 * A mesma tabela de casos alimenta os três consumidores. Nomes fictícios.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { contactLabel, type ChatContact } from "@/modules/communication/hooks/chat/types";
import { nomeDaConversa } from "@/modules/communication/lib/nomeDaConversa";

const base: ChatContact = {
  channel: "whatsapp",
  instance_id: "11111111-1111-1111-1111-111111111111",
  phone_number: "5548999998888",
  push_name: null,
  last_message: null,
  last_message_time: "2026-10-06T10:00:00Z",
  last_message_direction: null,
  last_message_sent_source: null,
  unread_count: 0,
  lead_id: null,
  lead_name: null,
  conversation_id: null,
  archived_at: null,
  tags: [],
  is_group: false,
};

// Espelha o que o painel lateral faz: `lead?.name || nomeDaConversa || ...`.
const painel = (c: ChatContact, topo: string) => c.lead_name?.trim() || topo;

const casos: Array<[string, Partial<ChatContact>, string]> = [
  ["lead vence salvo e perfil", { lead_name: "0001-EMPRESA FICTICIA LTDA", push_name: "Ana", saved_contact_name: "Ana Agenda" }, "0001-EMPRESA FICTICIA LTDA"],
  ["lead vence perfil", { lead_name: "0001-EMPRESA FICTICIA LTDA", push_name: "Ana" }, "0001-EMPRESA FICTICIA LTDA"],
  ["sem lead: salvo", { push_name: "Ana", saved_contact_name: "Ana Agenda" }, "Ana Agenda"],
  ["sem lead: perfil", { push_name: "Ana" }, "Ana"],
  ["sem lead nem nomes: telefone", {}, "5548999998888"],
  ["lead só espaços: perfil", { lead_name: "   ", push_name: "Ana" }, "Ana"],
  ["LID vira rótulo", { phone_number: "210028246085780" }, "Contato sem número · 085780"],
];

describe("paridade lista × topo × painel (flag ligada)", () => {
  it.each(casos)("%s", (_nome, over, esperado) => {
    const c = { ...base, ...over };
    const lista = contactLabel(c, { nomeDoLeadPrimeiro: true });
    const topo = nomeDaConversa(
      {
        pushName: c.push_name,
        savedContactName: c.saved_contact_name,
        nomeDoLead: c.lead_name,
        telefone: c.phone_number,
      },
      { nomeDoLeadPrimeiro: true },
    );
    expect(lista).toBe(esperado);
    expect(topo).toBe(esperado);
    expect(painel(c, topo)).toBe(esperado);
  });

  it("o painel lê a prop nova logo depois de lead.name", () => {
    const src = readFileSync(
      "src/modules/communication/components/chat/context-panel/ContextPanel.tsx",
      "utf8",
    );
    expect(src).toContain("lead?.name || nomeDaConversa || pushName");
  });

  it("a chave da flag mora só no hook", () => {
    const hook = readFileSync("src/modules/communication/hooks/chat/useNomeDoLeadPrimeiro.ts", "utf8");
    expect(hook).toContain('useFeatureFlag("chat_nome_do_lead")');
  });
});
