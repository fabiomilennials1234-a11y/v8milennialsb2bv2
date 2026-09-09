import { describe, it, expect } from "vitest";

import { PADROES, entregaDoTipo, resolverPreferencias } from "./preferencias-de-aviso";

describe("preferências de Aviso", () => {
  it("quem nunca configurou nada recebe os padrões", () => {
    expect(resolverPreferencias(null)).toEqual(PADROES);
  });

  it("o que a pessoa escolheu vence o padrão, campo a campo", () => {
    const resolvidas = resolverPreferencias({ volume: 20, sound_enabled: false });

    expect(resolvidas.volume).toBe(20);
    expect(resolvidas.sound_enabled).toBe(false);
    // não mexeu nisto: continua valendo o padrão
    expect(resolvidas.mute_active_conversation).toBe(PADROES.mute_active_conversation);
  });

  it("desligar o som de um tipo não desliga os outros nem o registro", () => {
    const resolvidas = resolverPreferencias({
      overrides: { workflow_alert: { som: false } },
    });

    expect(entregaDoTipo(resolvidas, "workflow_alert").som).toBe(false);
    expect(entregaDoTipo(resolvidas, "lead_message").som).toBe(true);
  });

  it("som mestre desligado cala todos os tipos, inclusive os que pediram som", () => {
    const resolvidas = resolverPreferencias({
      sound_enabled: false,
      overrides: { lead_message: { som: true } },
    });

    expect(entregaDoTipo(resolvidas, "lead_message").som).toBe(false);
  });
});
