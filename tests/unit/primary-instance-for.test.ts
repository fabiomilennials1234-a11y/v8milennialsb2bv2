/**
 * `primaryInstanceFor` — resolve qual instância default abrir quando o usuário
 * dispara um deep-link de chat (Kanban → /chat-whatsapp).
 *
 * Contrato puro, sem React, sem rede. Chamado pelo hook que monta
 * `LeadCardData` para enriquecer cada card com `primaryInstanceId`.
 * Quando preenchido, evita query `useResolveChatDeepLink` no servidor.
 */
import { describe, it, expect } from "vitest";
import { primaryInstanceFor } from "@/lib/primaryInstanceFor";
import type { WhatsAppInstanceForUser } from "@/hooks/chat/types";

const inst = (id: string): WhatsAppInstanceForUser => ({
  id,
  instance_name: `inst-${id}`,
  status: "connected",
});

describe("primaryInstanceFor", () => {
  it("retorna primeiro candidato que está na lista de instâncias permitidas", () => {
    const got = primaryInstanceFor({
      candidates: ["i2"],
      allowedInstances: [inst("i1"), inst("i2"), inst("i3")],
    });
    expect(got).toBe("i2");
  });

  it("ignora candidatos fora das permitidas (defesa em profundidade)", () => {
    const got = primaryInstanceFor({
      candidates: ["FORBIDDEN"],
      allowedInstances: [inst("i1"), inst("i2")],
    });
    expect(got).toBeNull();
  });

  it("ignora null/undefined nos candidatos", () => {
    const got = primaryInstanceFor({
      candidates: [null, undefined, "i1"],
      allowedInstances: [inst("i1")],
    });
    expect(got).toBe("i1");
  });

  it("retorna null quando não há candidatos válidos", () => {
    expect(
      primaryInstanceFor({
        candidates: [],
        allowedInstances: [inst("i1")],
      }),
    ).toBeNull();
  });

  it("retorna null quando não há instâncias permitidas", () => {
    expect(
      primaryInstanceFor({
        candidates: ["i1"],
        allowedInstances: [],
      }),
    ).toBeNull();
  });

  it("preserva ordem — primeiro match em allowed ganha", () => {
    const got = primaryInstanceFor({
      candidates: ["i3", "i1", "i2"],
      allowedInstances: [inst("i1"), inst("i2"), inst("i3")],
    });
    expect(got).toBe("i3");
  });
});
