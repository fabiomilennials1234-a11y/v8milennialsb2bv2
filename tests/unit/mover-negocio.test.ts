/**
 * `moverNegocio` e `invalidateAfterMove` — o caminho único do move.
 *
 * Fecha a parte do "move" de `inv:H8-32`. A suíte que existia
 * (`useCrossPipeMove.test.tsx`) cobre o hook do modal; este módulo, que é o que
 * as quatro telas de transição passaram a chamar (ADR-0023 decisão 4), subiu
 * sem teste próprio.
 *
 * As três regras que custam caro se quebrarem:
 *
 *   1. **`stageOrigem` viaja como está, inclusive `null`.** É a etapa de
 *      sucesso da origem, e é a TRANSIÇÃO por ela que produz `meeting_booked`
 *      e `meeting_held`. Perder esse parâmetro faz 71 orgs pararem de contar
 *      reunião no dia do deploy — sem erro em tela;
 *   2. **erro do banco tem que subir.** `mover_negocio` recusa destino em
 *      funil customizado de propósito. Engolir a recusa faz a tela dizer que
 *      moveu enquanto o card continua onde estava;
 *   3. **o move atravessa DOIS funis.** Invalidar só o board da tela deixa o
 *      outro mentindo até a janela perder e recuperar o foco, e o contador da
 *      coluna erra por mais 30s porque não tem realtime.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { moverNegocio, invalidateAfterMove } from "@/modules/pipelines/lib/moverNegocio";

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ error: null });
});

describe("moverNegocio — o que chega na RPC", () => {
  it("manda os cinco parâmetros com os nomes que a função espera", async () => {
    await moverNegocio({
      entryId: "e1",
      targetPipelineId: "p2",
      targetStageKey: "marcar_compromisso",
      stageOrigem: "compareceu",
      assignedTo: "tm9",
    });

    expect(rpc).toHaveBeenCalledWith("mover_negocio", {
      p_entry_id: "e1",
      p_target_pipeline_id: "p2",
      p_target_stage_key: "marcar_compromisso",
      p_stage_origem: "compareceu",
      p_assigned_to: "tm9",
    });
  });

  it("stageOrigem omitido vira null explícito — o banco não pode receber undefined", async () => {
    await moverNegocio({ entryId: "e1", targetPipelineId: "p2", targetStageKey: "s" });

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_stage_origem: null, p_assigned_to: null });
  });

  it("stageOrigem null é passado adiante, não confundido com ausente", async () => {
    await moverNegocio({
      entryId: "e1",
      targetPipelineId: "p2",
      targetStageKey: "s",
      stageOrigem: null,
    });

    expect(rpc.mock.calls[0][1].p_stage_origem).toBeNull();
  });

  it("preserva a etapa de origem que produz meeting_booked/meeting_held", async () => {
    await moverNegocio({
      entryId: "e1",
      targetPipelineId: "p2",
      targetStageKey: "reuniao_marcada",
      stageOrigem: "agendado",
    });

    expect(rpc.mock.calls[0][1].p_stage_origem).toBe("agendado");
  });
});

describe("moverNegocio — a recusa do banco tem que chegar na tela", () => {
  it("lança quando a RPC devolve erro", async () => {
    rpc.mockResolvedValue({ error: { message: "destino em funil customizado" } });

    await expect(
      moverNegocio({ entryId: "e1", targetPipelineId: "p2", targetStageKey: "s" }),
    ).rejects.toMatchObject({ message: "destino em funil customizado" });
  });

  it("não lança no caminho feliz", async () => {
    await expect(
      moverNegocio({ entryId: "e1", targetPipelineId: "p2", targetStageKey: "s" }),
    ).resolves.toBeUndefined();
  });
});

describe("invalidateAfterMove — os dois lados do move recarregam", () => {
  function espiao() {
    const invalidateQueries = vi.fn();
    return {
      client: { invalidateQueries } as never,
      chaves: () => invalidateQueries.mock.calls.map((c) => JSON.stringify(c[0].queryKey)),
    };
  }

  it("recarrega as três views de compatibilidade, os boards e os contadores", () => {
    const { client, chaves } = espiao();

    invalidateAfterMove(client);

    const k = chaves();
    for (const esperada of [
      ["pipe_whatsapp"],
      ["pipe_confirmacao"],
      ["pipe_propostas"],
      ["pipeline-page"],
      ["pipeline-stage-counts"],
      ["pipeline_entries"],
    ]) {
      expect(k).toContain(JSON.stringify(esperada));
    }
  });

  it("recarrega a camada de negócio que a aba de Leads lê", () => {
    const { client, chaves } = espiao();

    invalidateAfterMove(client);

    expect(chaves()).toContain(JSON.stringify(["leads-deals"]));
    expect(chaves()).toContain(JSON.stringify(["leads-sales-metrics"]));
  });

  it("com leadId, recarrega também o que é do lead", () => {
    const { client, chaves } = espiao();

    invalidateAfterMove(client, "l1");

    const k = chaves();
    expect(k).toContain(JSON.stringify(["lead_all_pipelines", "l1"]));
    expect(k).toContain(JSON.stringify(["lead-pipes", "l1"]));
    expect(k).toContain(JSON.stringify(["lead-timeline", "l1"]));
  });

  it("sem leadId não inventa chave de lead", () => {
    const { client, chaves } = espiao();

    invalidateAfterMove(client);

    expect(chaves().some((c) => c.includes("lead_all_pipelines"))).toBe(false);
    expect(chaves().some((c) => c.includes("lead-timeline"))).toBe(false);
  });

  it("invalida por prefixo — a chave real carrega org e filtros que não dá para reconstruir", () => {
    const { client } = espiao();

    invalidateAfterMove(client, "l1");

    // Nenhuma chamada pode fixar mais que o prefixo, senão o match parcial do
    // TanStack v5 não pega as variantes montadas com filtro.
    const calls = (client as unknown as { invalidateQueries: { mock: { calls: [{ queryKey: unknown[] }][] } } })
      .invalidateQueries.mock.calls;
    for (const [arg] of calls) {
      expect(arg.queryKey.length).toBeLessThanOrEqual(2);
    }
  });
});
