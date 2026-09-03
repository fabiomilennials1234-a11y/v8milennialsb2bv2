import { describe, it, expect } from "vitest";
import {
  degrauDoSlot,
  alturaDaNavegacao,
  PISO_DA_NAVEGACAO,
} from "./slot-do-oraculo";

describe("degrauDoSlot", () => {
  it("sobra ampla com briefing entrega o card completo", () => {
    expect(
      degrauDoSlot({
        alturaDaLateral: 900,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 320,
        colapsada: false,
        temBriefing: true,
      }),
    ).toBe("card");
  });

  it("sobra que não comporta o card degrada para uma linha", () => {
    expect(
      degrauDoSlot({
        alturaDaLateral: 700,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 374,
        colapsada: false,
        temBriefing: true,
      }),
    ).toBe("linha");
  });

  it("recolhida vira ícone mesmo com sobra de card — a preferência de layout não tira o acesso", () => {
    expect(
      degrauDoSlot({
        alturaDaLateral: 900,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 320,
        colapsada: true,
        temBriefing: true,
      }),
    ).toBe("icone");
  });

  it("sobra apertada demais para a linha ainda entrega o ícone", () => {
    expect(
      degrauDoSlot({
        alturaDaLateral: 620,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 306,
        colapsada: false,
        temBriefing: true,
      }),
    ).toBe("icone");
  });

  it("menu longo não apaga o Oráculo: o ícone é garantido enquanto a navegação mantiver o piso", () => {
    // A navegação quer 400px e só há 284px. Card e linha não negociam espaço
    // com o menu, mas o degrau mínimo é garantido — a navegação rola por baixo.
    expect(
      degrauDoSlot({
        alturaDaLateral: 560,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 400,
        colapsada: false,
        temBriefing: true,
      }),
    ).toBe("icone");
  });

  it("some quando até o ícone empurraria a navegação abaixo do piso", () => {
    expect(
      degrauDoSlot({
        alturaDaLateral: 420,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 400,
        colapsada: false,
        temBriefing: true,
      }),
    ).toBe("ausente");
  });

  it("recolhida não é passe livre: sem espaço acima do piso, o ícone também some", () => {
    expect(
      degrauDoSlot({
        alturaDaLateral: 420,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 400,
        colapsada: true,
        temBriefing: true,
      }),
    ).toBe("ausente");
  });

  it("sem briefing o card degrada para linha — a porta de entrada não desaparece", () => {
    // Mesma medida do primeiro caso, que rendia "card". O único que muda é o
    // briefing: sem conteúdo não há card, mas a porta continua alcançável.
    expect(
      degrauDoSlot({
        alturaDaLateral: 900,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 320,
        colapsada: false,
        temBriefing: false,
      }),
    ).toBe("linha");
  });

  it.each([900, 700, 560])(
    "a %ipx: a navegação nunca encolhe abaixo do piso, qualquer que seja o degrau",
    (altura) => {
      const medida = {
        alturaDaLateral: altura,
        alturaDoTopo: 96,
        alturaDoRodape: 180,
        alturaNaturalDaNavegacao: 400,
        colapsada: false,
        temBriefing: true,
      };
      expect(alturaDaNavegacao(medida)).toBeGreaterThanOrEqual(
        PISO_DA_NAVEGACAO,
      );
    },
  );
});
