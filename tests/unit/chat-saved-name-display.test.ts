import { describe, it, expect, vi } from "vitest";
import { contactLabel, type ChatContact } from "@/modules/communication/hooks/chat/types";
import { nomeDaConversa } from "@/modules/communication/lib/nomeDaConversa";
import { enrichSavedContactNames } from "@/modules/communication/hooks/chat/shared/savedContactNames";
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
describe("nome salvo na lista e cabeçalho", () => {
  it("agenda vence CRM e perfil em ambas as superfícies, mesmo após mensagem nova", () => {
    const contact = { channel: "whatsapp", saved_contact_name: "João — Mercado", lead_name: "Empresa LTDA", push_name: "Novo perfil", phone_number: "5548999998888" } as ChatContact;
    expect(contactLabel(contact)).toBe("João — Mercado");
    expect(nomeDaConversa({ savedContactName: contact.saved_contact_name, nomeDoLead: contact.lead_name, pushName: contact.push_name, telefone: contact.phone_number })).toBe("João — Mercado");
  });
  it("sem agenda preserva as quedas existentes", () => {
    expect(nomeDaConversa({ savedContactName: "  ", nomeDoLead: "CRM", pushName: "Perfil", telefone: null })).toBe("CRM");
    expect(contactLabel({ channel: "whatsapp", saved_contact_name: null, push_name: "Perfil" } as ChatContact)).toBe("Perfil");
  });
  it("mesmo telefone usa nomes separados por instância e query filtra organização", async () => {
    const filters: Record<string, string>[] = [];
    from.mockImplementation(() => {
      const values: Record<string, string> = {}; filters.push(values);
      const q = { select: () => q, eq: (k: string, v: string) => { values[k] = v; return q; }, in: () => Promise.resolve({ data: [{ phone_number: "5511", saved_contact_name: values.instance_id === "a" ? "Agenda A" : "Agenda B" }], error: null }) }; return q;
    });
    const contacts = ["a", "b"].map(instance_id => ({ channel: "whatsapp", instance_id, phone_number: "5511" } as ChatContact));
    await enrichSavedContactNames(contacts, "org");
    expect(contacts.map(c => c.saved_contact_name)).toEqual(["Agenda A", "Agenda B"]);
    expect(filters).toEqual([{ organization_id: "org", instance_id: "a" }, { organization_id: "org", instance_id: "b" }]);
  });
});
