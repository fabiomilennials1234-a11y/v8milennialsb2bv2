/**
 * Criar etapa não pode colidir na `position` — nem culpar o NOME quando colide.
 *
 * ── O DEFEITO (medido no PROD, 2026-09-04) ──────────────────────────────────
 * Funil "Condomínio" (org Pesco Automação & Controle), etapas:
 *
 *   novo          position 0   is_active=true
 *   em_andamento  position 1   is_active=FALSE   ← excluída, mas continua ali
 *   concluido     position 2   is_active=true
 *
 * O editor mostra 2 etapas (só as ativas) e criava com `position = 2`, que o
 * `concluido` já ocupava → violava
 * `pipeline_stages_pipeline_id_position_key UNIQUE (pipeline_id, position)`.
 *
 * E o erro chegava ao usuário como **"Já existe uma etapa com esse nome"**,
 * porque o tratamento fazia `message.includes("duplicate")` sem olhar QUAL
 * unique quebrou. Daí a leitura de que "o sistema não deixa repetir nome de
 * etapa entre funis" — regra que o banco nunca teve: nos funis personalizados
 * o `pipeline_type` é NULL e a unique legada por (org, pipeline_type,
 * stage_key) sequer se aplica.
 *
 * Três funis em duas orgs estavam nesse estado, incapazes de criar etapa.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Linhas que o SELECT de posição devolve, já ordenadas desc pelo mock. */
let posicoes: Array<{ position: number }> = [];
let erroDeLeitura: { message: string } | null = null;

// O builder do PostgREST é encadeável ATÉ o await — `.limit()` devolve o
// builder, não a promise, e o `.eq()` do filtro vem depois dele. Um mock que
// resolvesse no `.limit()` testaria uma API que não existe.
const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
["select", "eq", "order", "limit"].forEach((m) => {
  chain[m] = vi.fn().mockReturnValue(chain);
});
chain.then = ((resolve: (v: unknown) => unknown) =>
  Promise.resolve({
    data: erroDeLeitura ? null : posicoes,
    error: erroDeLeitura,
  }).then(resolve)) as unknown as ReturnType<typeof vi.fn>;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => chain },
}));

import {
  proximaPosicaoDeEtapa,
  mensagemDeConflitoDeEtapa,
} from "@/modules/pipelines/lib/proxima-posicao-de-etapa";

beforeEach(() => {
  vi.clearAllMocks();
  posicoes = [];
  erroDeLeitura = null;
});

describe("proximaPosicaoDeEtapa", () => {
  it("pula a posição da etapa EXCLUÍDA — o caso do Condomínio", () => {
    // max(position) = 2 (`concluido`), então a nova vai para 3. A regra antiga
    // (nº de ativas = 2) apontava para cima do `concluido`.
    posicoes = [{ position: 2 }];
    return expect(
      proximaPosicaoDeEtapa({ pipelineId: "594e3c9f-8cee-43fc-91d7-cbfaef8feae7" }),
    ).resolves.toBe(3);
  });

  it("respeita o headroom 1000+ que a migration reservou para inativas", async () => {
    // Qualificação da Café Jurerê: posições 0..14 e 1000..1004 no mesmo funil.
    // Contar ativas (6) daria 6, que está ocupado.
    posicoes = [{ position: 1004 }];
    await expect(
      proximaPosicaoDeEtapa({ organizationId: "org-1", pipelineType: "whatsapp" }),
    ).resolves.toBe(1005);
  });

  it("funil vazio começa em 0", async () => {
    posicoes = [];
    await expect(proximaPosicaoDeEtapa({ pipelineId: "p1" })).resolves.toBe(0);
  });

  it("falha de leitura não impede criar — cai em 0 e deixa o banco decidir", async () => {
    erroDeLeitura = { message: "network" };
    await expect(proximaPosicaoDeEtapa({ pipelineId: "p1" })).resolves.toBe(0);
  });

  it("consulta por funil quando há pipeline_id, e por família quando não há", async () => {
    posicoes = [{ position: 0 }];
    await proximaPosicaoDeEtapa({ pipelineId: "p1" });
    expect(chain.eq).toHaveBeenCalledWith("pipeline_id", "p1");

    vi.clearAllMocks();
    await proximaPosicaoDeEtapa({ organizationId: "org-1", pipelineType: "propostas" });
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chain.eq).toHaveBeenCalledWith("pipeline_type", "propostas");
  });
});

describe("mensagemDeConflitoDeEtapa", () => {
  it("colisão de POSITION não é acusada como nome duplicado", () => {
    const msg = mensagemDeConflitoDeEtapa({
      message:
        'duplicate key value violates unique constraint "pipeline_stages_pipeline_id_position_key"',
    });
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/nome/i);
    expect(msg).toMatch(/posicionar/i);
  });

  it("colisão de stage_key continua sendo nome duplicado — e diz NESTE FUNIL", () => {
    const msg = mensagemDeConflitoDeEtapa({
      message:
        'duplicate key value violates unique constraint "pipeline_stages_pipeline_id_stage_key_key"',
    });
    expect(msg).toBe("Já existe uma etapa com esse nome neste funil");
  });

  it("erro que não é de unicidade não vira mensagem de conflito", () => {
    expect(mensagemDeConflitoDeEtapa({ message: "permission denied" })).toBeNull();
    expect(mensagemDeConflitoDeEtapa(null)).toBeNull();
    expect(mensagemDeConflitoDeEtapa(undefined)).toBeNull();
  });
});
