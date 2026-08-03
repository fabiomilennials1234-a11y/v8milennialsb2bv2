/**
 * A partição das fases tem que cobrir a máquina de estados INTEIRA.
 *
 * O provider decide "a chamada saiu do ar" por complemento: fase que não está em
 * `FASES_EM_CURSO` é repouso, e chegar ao repouso vindo de uma chamada dispara a
 * atualização da conversa. Se alguém adicionar uma fase nova em `CallPhase` e
 * esquecer de classificá-la, ela cairia no repouso por omissão e uma chamada
 * ainda viva pareceria terminada.
 *
 * Este arquivo é o alarme. A lista abaixo é transcrita de `useVoiceCall.ts:117-127`.
 */
import { describe, expect, it } from "vitest";
import type { CallPhase } from "@/modules/communication/hooks/useVoiceCall";
import { FASES_EM_CURSO, FASES_DE_REPOUSO } from "./callPhases";

/**
 * Todas as fases de `CallPhase`.
 *
 * O `satisfies` sozinho NÃO basta, e a versão anterior deste comentário
 * afirmava que sim: ele só verifica que cada item É um `CallPhase`, nunca que
 * TODOS os `CallPhase` estão aqui. A rede que reprova a compilação é o
 * `FASE_NAO_CLASSIFICADA` de `callPhases.ts`; esta lista serve ao teste de
 * execução abaixo.
 */
const TODAS_AS_FASES = [
  "idle",
  "requesting_mic",
  "authorizing",
  "negotiating",
  "ringing",
  "active",
  "ending",
  "ended",
  "failed",
] as const satisfies readonly CallPhase[];

describe("partição das fases de chamada", () => {
  it("toda fase está classificada — nenhuma cai no repouso por omissão", () => {
    const naoClassificadas = TODAS_AS_FASES.filter(
      (f) => !FASES_EM_CURSO.has(f) && !FASES_DE_REPOUSO.has(f),
    );
    expect(naoClassificadas).toEqual([]);
  });

  it("nenhuma fase está nos dois conjuntos", () => {
    const emAmbos = TODAS_AS_FASES.filter((f) => FASES_EM_CURSO.has(f) && FASES_DE_REPOUSO.has(f));
    expect(emAmbos).toEqual([]);
  });

  it("os dois conjuntos juntos são exatamente a máquina de estados", () => {
    expect(FASES_EM_CURSO.size + FASES_DE_REPOUSO.size).toBe(TODAS_AS_FASES.length);
  });

  it("`ending` conta como chamada no ar — o `endCall` ainda está indo ao servidor", () => {
    expect(FASES_EM_CURSO.has("ending")).toBe(true);
    expect(FASES_DE_REPOUSO.has("ending")).toBe(false);
  });

  it("`idle` é repouso — é onde `hangup()` termina, e é o fim mais comum", () => {
    expect(FASES_DE_REPOUSO.has("idle")).toBe(true);
  });
});
