/**
 * Instance Routing Policy — leitura e transição da política declarada no
 * WhatsApp Message Node (PRD #1331, fatia #1332).
 *
 * O nó declara de qual Instance a mensagem sai. Estes testes prendem a
 * leitura do nó legado (sem política gravada) e o que cada troca de política
 * limpa — um campo que não pertence mais à política ativa não pode sobrar no
 * `data`, senão ele volta a decidir escondido.
 */
import { describe, it, expect } from "vitest";
import {
  readRoutingPolicy,
  buildPolicyChange,
  buildFixedInstanceChange,
  buildFallbackChange,
  isInstanceRoutedAction,
} from "@/modules/workflows/lib/instance-routing";

describe("isInstanceRoutedAction — quem declara política", () => {
  it("cobre o nó unificado e os legados de envio WhatsApp", () => {
    for (const at of [
      "send_whatsapp_message",
      "send_whatsapp",
      "send_whatsapp_audio",
      "send_whatsapp_image",
      "send_whatsapp_video",
      "send_whatsapp_sticker",
      "send_whatsapp_document",
      "send_whatsapp_template",
      "send_to_number",
    ]) {
      expect(isInstanceRoutedAction(at)).toBe(true);
    }
  });

  // PRD #1331: o nó de mensagem de campanha é um dos pontos de envio do
  // Workflow. Fora da lista, ele voltaria a escolher número sozinho.
  it("cobre a mensagem de campanha", () => {
    expect(isInstanceRoutedAction("send_campaign_message")).toBe(true);
  });

  it("não cobre ação que não envia WhatsApp", () => {
    expect(isInstanceRoutedAction("move_stage")).toBe(false);
    expect(isInstanceRoutedAction("send_meta_message")).toBe(false);
    expect(isInstanceRoutedAction("generate_ai_message")).toBe(false);
  });
});

describe("readRoutingPolicy — nó legado", () => {
  it("nó sem política e sem instância fixa é 'seguir a conversa'", () => {
    expect(readRoutingPolicy({})).toBe("conversation");
  });

  it("nó sem política e com whatsappInstanceId vazio é 'seguir a conversa'", () => {
    expect(readRoutingPolicy({ whatsappInstanceId: "" })).toBe("conversation");
  });

  it("nó sem política e com whatsappInstanceId preenchido é 'número fixo'", () => {
    expect(readRoutingPolicy({ whatsappInstanceId: "inst-1" })).toBe("fixed");
  });

  it("política explícita ganha do legado", () => {
    expect(
      readRoutingPolicy({
        instanceRoutingPolicy: "conversation",
        whatsappInstanceId: "inst-1",
      }),
    ).toBe("conversation");
  });

  it("política desconhecida cai no padrão em vez de vazar", () => {
    expect(
      readRoutingPolicy({ instanceRoutingPolicy: "sorteio" as never }),
    ).toBe("conversation");
  });
});

describe("buildPolicyChange — o que cada troca limpa", () => {
  it("trocar para 'seguir a conversa' limpa a instância fixa", () => {
    const patch = buildPolicyChange("conversation");
    expect(patch.instanceRoutingPolicy).toBe("conversation");
    expect(patch.whatsappInstanceId).toBe("");
    expect(patch.whatsappInstanceName).toBe("");
  });

  it("trocar para 'instância do responsável' limpa a instância fixa", () => {
    const patch = buildPolicyChange("responsible");
    expect(patch.instanceRoutingPolicy).toBe("responsible");
    expect(patch.whatsappInstanceId).toBe("");
    expect(patch.whatsappInstanceName).toBe("");
  });

  // O recuo some da tela em `fixed`, mas apagá-lo faria um ida-e-volta
  // conversation → fixed → conversation destruir em silêncio o que o operador
  // declarou — ou o recuo semeado nas orgs multi-instância (#1333).
  it("trocar para 'número fixo' preserva o recuo declarado", () => {
    const patch = buildPolicyChange("fixed");
    expect(patch.instanceRoutingPolicy).toBe("fixed");
    expect(patch).not.toHaveProperty("fallbackInstanceId");
    expect(patch).not.toHaveProperty("fallbackInstanceName");
  });

  it("trocar para 'seguir a conversa' preserva o recuo já declarado", () => {
    const patch = buildPolicyChange("conversation");
    expect(patch).not.toHaveProperty("fallbackInstanceId");
  });
});

describe("buildFixedInstanceChange / buildFallbackChange", () => {
  it("escolher a instância fixa grava id e nome e fixa a política", () => {
    expect(buildFixedInstanceChange("inst-1", "Comercial 1")).toEqual({
      instanceRoutingPolicy: "fixed",
      whatsappInstanceId: "inst-1",
      whatsappInstanceName: "Comercial 1",
    });
  });

  it("escolher o recuo grava id e nome sem tocar na política", () => {
    const patch = buildFallbackChange("inst-2", "Comercial 2");
    expect(patch).toEqual({
      fallbackInstanceId: "inst-2",
      fallbackInstanceName: "Comercial 2",
    });
  });

  it("limpar o recuo grava vazio em vez de remover a chave", () => {
    expect(buildFallbackChange("", "")).toEqual({
      fallbackInstanceId: "",
      fallbackInstanceName: "",
    });
  });
});
