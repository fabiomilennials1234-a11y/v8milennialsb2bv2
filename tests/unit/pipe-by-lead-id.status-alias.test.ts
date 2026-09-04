/**
 * Regressão SCRUM-639: os hooks `usePipe{Confirmacao,Proposta}ByLeadId` leem a
 * projeção canônica `negocio_projetado`, onde a coluna que o espelho chamava
 * `status` chama `stage_key`. Os consumidores continuam lendo `.status`.
 *
 * Por que o teste vive AQUI e não no componente: `MeetingFieldBlock.test.tsx`
 * monta `pipeData` na mão, com `status` preenchido, então a suíte de componente
 * fica verde mesmo com o hook devolvendo `undefined`. E o cast para o tipo do
 * espelho (`as PipeConfirmacaoRow`) desliga o `tsc`. Sem este teste, o defeito
 * não tem nenhum gate.
 *
 * O dano concreto que ele previne: com `status` indefinido, o select de etapa do
 * MeetingFieldBlock cai no default "reuniao_marcada", `dirty` fica preso em true
 * (o botão Salvar nunca desabilita) e um clique grava `stage_key` de volta em
 * "reuniao_marcada" — rebaixando no banco um card que estava em "compareceu",
 * sem o usuário ter tocado no campo de etapa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// O dublê espelha a projeção real: devolve `stage_key` e NUNCA `status`. Quem
// quiser `status` tem que pedir o alias no `.select()` — que é exatamente o que
// os hooks precisam fazer.
const selectSpy = vi.fn<[string], void>();

function projecao(linha: Record<string, unknown>) {
  const nó = {
    select: (colunas: string) => {
      selectSpy(colunas);
      const pediuAlias = /(^|,)\s*status\s*:\s*stage_key\s*(,|$)/.test(colunas);
      const dados = pediuAlias ? { ...linha, status: linha.stage_key } : { ...linha };
      const cadeia = {
        eq: () => cadeia,
        order: () => cadeia,
        limit: () => cadeia,
        maybeSingle: () => Promise.resolve({ data: dados, error: null }),
      };
      return cadeia;
    },
  };
  return nó;
}

const LINHA = {
  id: "entry-1",
  lead_id: "lead-1",
  organization_id: "org-1",
  stage_key: "compareceu",
  meeting_date: "2026-09-01T12:00:00Z",
  created_at: "2026-09-01T10:00:00Z",
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => projecao(LINHA) },
}));

import { usePipeConfirmacaoByLeadId } from "@/modules/pipelines/hooks/legacy/usePipeConfirmacaoByLeadId";
import { usePipePropostaByLeadId } from "@/modules/pipelines/hooks/legacy/usePipePropostaByLeadId";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("hooks legados por lead — a projeção precisa entregar `status`", () => {
  beforeEach(() => selectSpy.mockClear());

  it("usePipeConfirmacaoByLeadId entrega `status` com o valor da etapa real", async () => {
    const { result } = renderHook(() => usePipeConfirmacaoByLeadId("lead-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // É este campo que o MeetingFieldBlock lê. `undefined` aqui é o bug.
    expect(result.current.data?.status).toBe("compareceu");
    expect(result.current.data?.status).not.toBeUndefined();
  });

  it("usePipePropostaByLeadId entrega `status` com o valor da etapa real", async () => {
    const { result } = renderHook(() => usePipePropostaByLeadId("lead-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe("compareceu");
  });

  it("os dois pedem o alias `status:stage_key` — sem ele a projeção não devolve `status`", async () => {
    const { result } = renderHook(() => usePipeConfirmacaoByLeadId("lead-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Controle da própria montagem: o dublê só fabrica `status` quando o alias é
    // pedido, então esta asserção e a de cima medem a mesma coisa por caminhos
    // diferentes. Se alguém trocar o alias por um `select("*")`, as duas caem.
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining("status:stage_key"));
  });
});
