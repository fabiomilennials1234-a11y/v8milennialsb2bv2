/**
 * O CONTRATO dos hooks de etiqueta — medido no hook, não no componente.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE, SEPARADO ─────────────────────────────────
 * `lead-card-etiquetas.test.tsx` mocka `useAddLeadTag`/`useRemoveLeadTag` no
 * nível do módulo, então o corpo real deles nunca roda ali. Isso foi medido, e
 * não suposto: mutei o hook de volta para `if (count === 0) throw` e a suíte do
 * componente continuou VERDE. Um teste que não morre com a regressão que ele
 * diz guardar não guarda nada.
 *
 * As duas coisas que este arquivo prende são as duas que já deram errado:
 *   1. DELETE que casa zero linhas RESOLVE (com a contagem), não lança. Zero é
 *      o resultado correto quando a etiqueta já saiu por outra tela; lançar
 *      pularia o `onSuccess` e prenderia a pílula fantasma na tela.
 *   2. A invalidação alcança os QUADROS, não só a ficha. As pílulas do card do
 *      funil vêm de carona no select da entrada (`pipeline_entries` /
 *      `custom_pipe_entries`) — e o painel do Negócio é aberto de cima delas.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const resposta = vi.hoisted(() => ({
  del: { error: null as unknown, count: 1 as number | null },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      delete: () => ({ eq: async () => resposta.del }),
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: "lt-1", tag_id: "t-1" }, error: null }) }),
      }),
    }),
  },
}));

import {
  useAddLeadTag,
  useRemoveLeadTag,
} from "@/modules/leads/hooks/lead/useLeadTagsAttached";

function montar<T>(hook: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const espiao = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), espiao };
}

/** As chaves invalidadas, achatadas para o primeiro segmento. */
function chaves(espiao: ReturnType<typeof vi.spyOn>): string[] {
  return espiao.mock.calls
    .map((c) => (c[0] as { queryKey?: unknown[] })?.queryKey?.[0])
    .filter((k): k is string => typeof k === "string");
}

beforeEach(() => {
  resposta.del = { error: null, count: 1 };
});

describe("useRemoveLeadTag — zero linhas não é erro", () => {
  it("resolve com a contagem quando o DELETE casa zero linhas", async () => {
    resposta.del = { error: null, count: 0 };
    const { result } = montar(() => useRemoveLeadTag());

    const r = await result.current.mutateAsync({ leadTagId: "lt-9", leadId: "lead-1" });

    expect(r).toEqual({ leadId: "lead-1", removidas: 0 });
  });

  /**
   * A parte que importa: zero linhas ainda dispara o `onSuccess`. É ele que
   * refaz a leitura e faz a pílula que já não existe sumir da tela.
   */
  it("zero linhas AINDA invalida — é o que apaga a pílula fantasma", async () => {
    resposta.del = { error: null, count: 0 };
    const { result, espiao } = montar(() => useRemoveLeadTag());

    await result.current.mutateAsync({ leadTagId: "lt-9", leadId: "lead-1" });

    await waitFor(() => expect(espiao).toHaveBeenCalled());
    expect(chaves(espiao)).toContain("lead-tags");
  });

  it("erro de verdade do banco continua sendo erro", async () => {
    resposta.del = { error: new Error("boom"), count: null };
    const { result } = montar(() => useRemoveLeadTag());

    await expect(
      result.current.mutateAsync({ leadTagId: "lt-9", leadId: "lead-1" }),
    ).rejects.toThrow(/boom/);
  });

  it("a remoção normal devolve a contagem que apagou", async () => {
    const { result } = montar(() => useRemoveLeadTag());

    const r = await result.current.mutateAsync({ leadTagId: "lt-9", leadId: "lead-1" });

    expect(r).toEqual({ leadId: "lead-1", removidas: 1 });
  });
});

describe("A invalidação cobre TODAS as telas que desenham etiqueta", () => {
  /**
   * `lead-tags` é a chave de quem edita; `lead-detail` é de onde saem as pílulas
   * da coluna e o `lead.etiquetas` do card do Negócio; `pipeline_entries` e
   * `custom_pipe_entries` são os QUADROS, cujo card é o ponto de partida do
   * painel. Deixar qualquer uma de fora põe duas listas diferentes da mesma
   * coisa na mesma tela.
   *
   * 🚨 `pipeline-page` e `pipeline-stage-counts` (com HÍFEN) não são variação
   * de nome das duas acima: são a RPC `get_pipeline_page`, que é de onde o
   * quadro de funil de sistema lê os cards HOJE. `pipeline_entries` (com
   * underscore) é o hook antigo, que a tela do funil não usa mais — invalidar
   * só ele deixa o card com a lista velha até um F5, e etiquetar a partir do
   * próprio card foi exatamente a superfície que este trabalho abriu.
   */
  const ESPERADAS = [
    "lead-tags",
    "lead-detail",
    "leads",
    "lead-timeline",
    "pipeline_entries",
    "custom_pipe_entries",
    "pipeline-page",
    "pipeline-stage-counts",
    "custom_pipe_stage_counts",
  ];

  it("ao adicionar", async () => {
    const { result, espiao } = montar(() => useAddLeadTag());

    await result.current.mutateAsync({ leadId: "lead-1", tagId: "t-1" });

    await waitFor(() => expect(espiao).toHaveBeenCalled());
    for (const k of ESPERADAS) expect(chaves(espiao)).toContain(k);
  });

  it("ao remover", async () => {
    const { result, espiao } = montar(() => useRemoveLeadTag());

    await result.current.mutateAsync({ leadTagId: "lt-9", leadId: "lead-1" });

    await waitFor(() => expect(espiao).toHaveBeenCalled());
    for (const k of ESPERADAS) expect(chaves(espiao)).toContain(k);
  });
});
