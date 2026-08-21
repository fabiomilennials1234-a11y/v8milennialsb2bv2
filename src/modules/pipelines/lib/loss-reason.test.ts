import { describe, it, expect } from "vitest";
import { exigeTextoLivre, resolverMotivoDaPerda, type MotivoDePerda } from "./loss-reason";

/**
 * SCRUM-369 — a captura do motivo da perda.
 *
 * O defeito que estes testes existem para não deixar voltar: a tela escrevia o
 * ID do motivo numa chave (`loss_reason`) que a allowlist de
 * `useUpdatePipeProposta` não conhecia, e o valor era descartado em silêncio.
 * Medido em produção em 2026-08-21: 72 negócios perdidos, ZERO com motivo.
 */

const DO_CATALOGO: MotivoDePerda[] = [
  { value: "0f0f0f0f-0000-4000-8000-000000000001", label: "Preço", doCatalogo: true },
  { value: "0f0f0f0f-0000-4000-8000-000000000002", label: "Outros", doCatalogo: true },
];

const FALLBACK: MotivoDePerda[] = [
  { value: "sem_budget", label: "Sem budget", doCatalogo: false },
  { value: "outro", label: "Outro", doCatalogo: false },
];

describe("resolverMotivoDaPerda", () => {
  it("motivo do catálogo grava id E rótulo snapshotado", () => {
    // O texto não é redundante: `loss_reasons` é editável por org, e um motivo
    // renomeado depois mudaria o passado se só o id fosse guardado.
    expect(resolverMotivoDaPerda(DO_CATALOGO[0].value, "", DO_CATALOGO)).toEqual({
      id: "0f0f0f0f-0000-4000-8000-000000000001",
      texto: "Preço",
    });
  });

  it("motivo do FALLBACK não vira id — só texto", () => {
    // A lista de fallback é hardcoded; gravar `sem_budget` em `loss_reason_id`
    // criaria uma FK apontando para linha que não existe.
    expect(resolverMotivoDaPerda("sem_budget", "", FALLBACK)).toEqual({
      id: null,
      texto: "Sem budget",
    });
  });

  it("sem escolha é INCOMPLETO — nada a gravar", () => {
    expect(resolverMotivoDaPerda("", "", DO_CATALOGO)).toBeNull();
  });

  it("escolha que não está na lista é incompleta (lista trocou sob os pés)", () => {
    expect(resolverMotivoDaPerda("id-que-sumiu", "", DO_CATALOGO)).toBeNull();
  });

  it("'Outros' SEM texto é incompleto — é o mesmo vazio com outro nome", () => {
    expect(resolverMotivoDaPerda(DO_CATALOGO[1].value, "", DO_CATALOGO)).toBeNull();
    expect(resolverMotivoDaPerda(DO_CATALOGO[1].value, "  ", DO_CATALOGO)).toBeNull();
    expect(resolverMotivoDaPerda(DO_CATALOGO[1].value, "ok", DO_CATALOGO)).toBeNull();
  });

  it("'Outros' COM texto grava o texto livre, não o rótulo", () => {
    expect(
      resolverMotivoDaPerda(DO_CATALOGO[1].value, "  fechou com o cunhado  ", DO_CATALOGO),
    ).toEqual({
      id: "0f0f0f0f-0000-4000-8000-000000000002",
      texto: "fechou com o cunhado",
    });
  });

  it("'Outro' do fallback também exige texto, e não vira id", () => {
    expect(resolverMotivoDaPerda("outro", "", FALLBACK)).toBeNull();
    expect(resolverMotivoDaPerda("outro", "sumiu do mapa", FALLBACK)).toEqual({
      id: null,
      texto: "sumiu do mapa",
    });
  });

  it("o texto livre NÃO contamina motivo normal", () => {
    // Usuário escolhe "Outros", digita, muda de ideia e escolhe "Preço": o que
    // vai para o banco é "Preço".
    expect(resolverMotivoDaPerda(DO_CATALOGO[0].value, "texto antigo", DO_CATALOGO)).toEqual({
      id: "0f0f0f0f-0000-4000-8000-000000000001",
      texto: "Preço",
    });
  });
});

describe("exigeTextoLivre", () => {
  it.each([
    ["Outro", true],
    ["Outros", true],
    ["outro motivo", true],
    ["Preço", false],
    ["Sem budget", false],
  ])("%s → %s", (label, esperado) => {
    const lista: MotivoDePerda[] = [{ value: "x", label, doCatalogo: true }];
    expect(exigeTextoLivre("x", lista)).toBe(esperado);
  });

  it("escolha inexistente não pede texto", () => {
    expect(exigeTextoLivre("nao-existe", DO_CATALOGO)).toBe(false);
  });
});
