import { describe, it, expect } from "vitest";
import { resolveEffectiveLead } from "./resolveEffectiveLead";

const leadByPhone = { id: "lead-phone", name: "Antônia Richele" };

describe("resolveEffectiveLead", () => {
  it("usa o lead_id do contato quando presente (vínculo direto vence)", () => {
    const contact = { lead_id: "lead-contact", lead_name: "Do contato" };
    expect(resolveEffectiveLead(contact, leadByPhone)).toEqual({
      leadId: "lead-contact",
      leadName: "Do contato",
    });
  });

  it("REGRESSÃO: contato com mensagens órfãs (lead_id null) cai no match por telefone", () => {
    const contact = { lead_id: null, lead_name: null };
    expect(resolveEffectiveLead(contact, leadByPhone)).toEqual({
      leadId: "lead-phone",
      leadName: "Antônia Richele",
    });
  });

  it("REGRESSÃO: lead sem nenhuma mensagem (sem contato) resolve por telefone", () => {
    expect(resolveEffectiveLead(null, leadByPhone)).toEqual({
      leadId: "lead-phone",
      leadName: "Antônia Richele",
    });
  });

  it("sem contato e sem match por telefone → Sem lead (null)", () => {
    expect(resolveEffectiveLead(null, null)).toEqual({
      leadId: null,
      leadName: null,
    });
  });

  it("preserva o nome do contato mesmo quando o lead_id vem do telefone", () => {
    const contact = { lead_id: null, lead_name: "Nome do contato" };
    expect(resolveEffectiveLead(contact, leadByPhone)).toEqual({
      leadId: "lead-phone",
      leadName: "Nome do contato",
    });
  });
});
