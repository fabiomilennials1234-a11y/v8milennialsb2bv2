import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatContact } from "../types";
import { contactLabel } from "../types";

const { from, calls, stored } = vi.hoisted(() => ({
  from: vi.fn(), calls: [] as Array<Record<string, unknown>>,
  stored: [] as Array<{ organization_id: string; instance_id: string; phone_number: string; saved_contact_name: string }>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
import { enrichSavedContactNames } from "./savedContactNames";

beforeEach(() => {
  calls.length = 0;
  stored.length = 0;
  from.mockImplementation(() => {
    const scope: Record<string, unknown> = {};
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { scope[key] = value; return query; },
      in: async (_key: string, phones: string[]) => {
        calls.push({ ...scope, phones });
        return { data: stored.filter(row => row.organization_id === scope.organization_id && row.instance_id === scope.instance_id && phones.includes(row.phone_number)), error: null };
      },
    };
    return query;
  });
});

describe("nomes salvos de grupos", () => {
  it("usa o nome do WhatsApp na lista sem misturar instâncias ou organizações", async () => {
    const phone = "120363000000000000@g.us";
    stored.push(
      { organization_id: "org", instance_id: "a", phone_number: phone, saved_contact_name: "Pedidos Café" },
      { organization_id: "org", instance_id: "b", phone_number: phone, saved_contact_name: "Equipe Café" },
      { organization_id: "outra", instance_id: "a", phone_number: phone, saved_contact_name: "Não pode aparecer" },
    );
    const contacts = ["a", "b"].map(instance_id => ({ channel: "whatsapp", instance_id, phone_number: phone, is_group: true, push_name: "Participante" }) as ChatContact);
    await enrichSavedContactNames(contacts, "org");
    expect(contacts.map(contactLabel)).toEqual(["Pedidos Café", "Equipe Café"]);
    expect(calls).toHaveLength(2);
  });

  it("mantém a identificação existente quando o nome salvo não está disponível", async () => {
    const c = { channel: "whatsapp", phone_number: "group@g.us", is_group: true, push_name: "Grupo existente" } as ChatContact;
    await enrichSavedContactNames([c], "org", "a");
    expect(contactLabel(c)).toBe("Grupo existente");
  });
});
