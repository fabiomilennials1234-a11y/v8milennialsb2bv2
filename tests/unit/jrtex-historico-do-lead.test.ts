import { describe, expect, it } from "vitest";
import { priorizarHistoricoDoLead, chaveDoHistoricoDoLead } from "@/modules/communication/lib/historicoDoLeadJrtex";
import { computeNeedsDeepLinkResolve } from "@/modules/communication/lib/computeNeedsDeepLinkResolve";
import { regimeDaConversaAberta } from "@/modules/communication/lib/regimeDaConversaAberta";
import type { InboxBox } from "@/modules/communication/hooks/chat/types";

const jrtex = "30bb5c27-88f4-4f91-9493-835405ae2e11";
const boxes = ["principal", "izadora"].map(id => ({ id, kind: "whatsapp", provider: "uazapi", status: "connected" })) as InboxBox[];
const link = { hasDeepLinkPhone: true, deepLinkProcessed: false, instancesCount: 2, deepLinkInstance: "izadora", allowedInstanceIds: boxes.map(b => b.id) };

describe("abertura de lead da Jrtex", () => {
  it("consulta histórico mesmo se o link do lead aponta para Izadora", () => {
    expect(computeNeedsDeepLinkResolve({ ...link, preferHistory: priorizarHistoricoDoLead(jrtex, "lead") })).toBe(true);
  });
  it.each([null, undefined, "outra-org"])("mantém a escolha explícita em %s", org => {
    expect(computeNeedsDeepLinkResolve({ ...link, preferHistory: priorizarHistoricoDoLead(org, "lead") })).toBe(false);
  });
  it("não redireciona abertura de inbox/notificação sem lead", () => {
    expect(priorizarHistoricoDoLead(jrtex, null)).toBe(false);
  });
  it("abre Principal com histórico apesar da caixa anteriormente marcada ser Izadora", () => {
    const chave = chaveDoHistoricoDoLead({ instanceId: "principal", phoneNumber: "5562981123676" }, link.allowedInstanceIds);
    expect(chave).toBe("whatsapp:principal:5562981123676");
    expect(regimeDaConversaAberta({ chave, caixas: boxes, marcadas: ["izadora"] }).instanciaDeChip).toBe("principal");
  });
  it("não abre caixa fora das permitidas", () => {
    expect(chaveDoHistoricoDoLead({ instanceId: "principal", phoneNumber: "62981123676" }, ["izadora"])).toBeNull();
  });
  it("não abre interlocutor vazio", () => {
    expect(chaveDoHistoricoDoLead({ instanceId: "principal", phoneNumber: "" }, ["principal"])).toBeNull();
  });
  it("não reabre após consumir o link, permitindo troca manual de caixa", () => {
    expect(computeNeedsDeepLinkResolve({ ...link, preferHistory: true, deepLinkProcessed: true })).toBe(false);
  });
});
