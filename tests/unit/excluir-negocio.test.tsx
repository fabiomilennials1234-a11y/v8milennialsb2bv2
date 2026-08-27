/**
 * Excluir o negócio pelo painel — os jeitos de "excluir" e o card continuar lá.
 *
 * O painel do Negócio não tinha exclusão nenhuma; `useExcluirNegocio` é a porta
 * nova. Este arquivo guarda os modos de falha que fazem a exclusão PARECER ter
 * funcionado (ou parecer ter falhado), que são os caros:
 *
 *   1. **a tabela errada.** `custom_pipe_entries` e `pipeline_entries` dividem
 *      a mesma primary key. Apagar o espelho de um card custom não apaga a
 *      linha custom, e o kanban custom lê a linha custom: o card some da tela
 *      e volta no refetch. Nenhum erro em lugar nenhum;
 *   2. **o discriminador errado.** Rotear por `pipeTable` (nome de VIEW, `null`
 *      em funil de sistema fora dos três slugs) manda funil de sistema para a
 *      tabela custom. Este é o ramo que a primeira versão do diff errava e
 *      NENHUM teste cobria, porque os testes já chamavam `excluir()` com a
 *      família resolvida;
 *   3. **o DELETE que a RLS recusa.** O PostgREST não devolve erro: devolve
 *      zero linhas. E zero linhas tem DOIS diagnósticos — acusar sempre o
 *      errado prende o usuário num painel que não fecha;
 *   4. **o erro que não é `Error`.** `PostgrestError` só é instanciado com
 *      `.throwOnError()`; sem ele o erro é objeto puro, e um `instanceof Error`
 *      esconde a mensagem real do banco atrás de um genérico.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

interface Chamada {
  tabela: string;
  op: string;
  filtros: string[];
}

const chamadas: Chamada[] = [];
let respostas: Record<string, { data: unknown; error: unknown }> = {};

vi.mock("@/integrations/supabase/client", () => {
  function construtor(tabela: string) {
    const estado = { op: "", filtros: [] as string[] };
    const resolver = () => {
      chamadas.push({ tabela, op: estado.op, filtros: [...estado.filtros] });
      const chave = `${estado.op}:${tabela}`;
      return respostas[chave] ?? { data: [{ id: "linha" }], error: null };
    };
    const no: Record<string, unknown> = {
      delete: () => {
        estado.op = "delete";
        return no;
      },
      select: () => {
        if (!estado.op) estado.op = "select";
        return no;
      },
      eq: (coluna: string, valor: unknown) => {
        estado.filtros.push(`${coluna}=${String(valor)}`);
        return no;
      },
      limit: () => no,
      /** `maybeSingle` devolve OBJETO ou `null`, não lista — como o real. */
      maybeSingle: () => {
        const r = resolver();
        const d = r.data;
        return Promise.resolve({
          data: Array.isArray(d) ? (d.length > 0 ? d[0] : null) : d,
          error: r.error,
        });
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolver()).then(resolve),
    };
    return no;
  }
  return { supabase: { from: (t: string) => construtor(t) } };
});

const toastErro = vi.fn();
const toastOk = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => toastErro(m),
    success: (m: string) => toastOk(m),
    info: (m: string) => toastInfo(m),
  },
}));

const registrou = vi.fn();
vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => registrou,
}));

import { useExcluirNegocio } from "@/modules/leads/components/deal-card/useExcluirNegocio";

function envolver({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const montar = () => renderHook(() => useExcluirNegocio(), { wrapper: envolver });

const NEGOCIO = {
  entryId: "e1",
  leadId: "lead-1",
  titulo: "Reposição trimestral",
  funil: "Orçamentos",
};

const apagados = () => chamadas.filter((c) => c.op === "delete");

beforeEach(() => {
  chamadas.length = 0;
  respostas = {};
  toastErro.mockClear();
  toastOk.mockClear();
  toastInfo.mockClear();
  registrou.mockClear();
});

describe("A tabela é escolhida pela FAMÍLIA do funil", () => {
  it("funil custom apaga a linha custom, e não o espelho", async () => {
    const { result } = montar();
    let r: string | undefined;
    await act(async () => {
      r = await result.current.excluir({ ...NEGOCIO, ehSystem: false });
    });

    expect(r).toBe("excluido");
    expect(apagados()).toHaveLength(1);
    expect(apagados()[0].tabela).toBe("custom_pipe_entries");
    expect(apagados()[0].filtros).toEqual(["id=e1"]);
    // O espelho sai pelo gatilho `TG_OP='DELETE'`, não por uma segunda chamada
    // daqui — tocar nele à mão é como as duas linhas divergem.
    expect(chamadas.some((c) => c.tabela === "pipeline_entries")).toBe(false);
  });

  it("funil de sistema apaga em pipeline_entries", async () => {
    const { result } = montar();
    await act(async () => {
      await result.current.excluir({ ...NEGOCIO, ehSystem: true });
    });

    expect(apagados()).toHaveLength(1);
    expect(apagados()[0].tabela).toBe("pipeline_entries");
    expect(chamadas.some((c) => c.tabela === "custom_pipe_entries")).toBe(false);
  });

  it("funil de sistema SEM view de compat (upsell e afins) não cai no ramo custom", async () => {
    // Este é o caso que `pipeTable` errava: slug fora de
    // whatsapp/confirmacao/propostas devolve `null` e seria lido como custom.
    // A família não depende de slug, então o alvo é o mesmo dos outros system.
    const { result } = montar();
    await act(async () => {
      await result.current.excluir({ ...NEGOCIO, ehSystem: true, funil: "Carteira" });
    });

    expect(apagados()[0].tabela).toBe("pipeline_entries");
  });
});

describe("Nada de `deals`: a exclusão não destrói o que o produto guarda em lixeira", () => {
  it("apaga a entry e mais NADA", async () => {
    const { result } = montar();
    await act(async () => {
      await result.current.excluir({ ...NEGOCIO, ehSystem: false });
    });

    // `deals` é soft-delete por decisão do produto (policy `deals_delete`), e
    // `deal_items.deal_id` nem FK tem — hard delete daqui seria irreversível.
    expect(chamadas.some((c) => c.tabela === "deals")).toBe(false);
    expect(chamadas.some((c) => c.tabela === "deal_items")).toBe(false);
    expect(chamadas).toHaveLength(1);
  });
});

describe("DELETE de 0 linhas: dois diagnósticos, não um", () => {
  it("linha ainda lá = sem permissão; não fecha o painel", async () => {
    respostas["delete:custom_pipe_entries"] = { data: [], error: null };
    respostas["select:custom_pipe_entries"] = { data: [{ id: "e1" }], error: null };

    const { result } = montar();
    let r: string | undefined;
    await act(async () => {
      r = await result.current.excluir({ ...NEGOCIO, ehSystem: false });
    });

    expect(r).toBe("sem-permissao");
    expect(toastOk).not.toHaveBeenCalled();
    expect(toastErro).toHaveBeenCalledWith(expect.stringContaining("permissão"));
    expect(registrou).not.toHaveBeenCalled();
  });

  it("linha já não existe = alguém chegou antes; NÃO acusa permissão", async () => {
    respostas["delete:custom_pipe_entries"] = { data: [], error: null };
    respostas["select:custom_pipe_entries"] = { data: [], error: null };

    const { result } = montar();
    let r: string | undefined;
    await act(async () => {
      r = await result.current.excluir({ ...NEGOCIO, ehSystem: false });
    });

    expect(r).toBe("ja-nao-existia");
    expect(toastErro).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining("já havia sido"));
  });
});

describe("O erro do PostgREST chega ao usuário", () => {
  it("objeto puro (o formato REAL do supabase-js) mostra a mensagem do banco", async () => {
    // Sem `.throwOnError()` o supabase-js devolve `{message, details, hint,
    // code}` — objeto puro. Um `err instanceof Error` é sempre falso aqui.
    respostas["delete:pipeline_entries"] = {
      data: null,
      error: { message: "JWT expired", code: "PGRST301", details: null, hint: null },
    };

    const { result } = montar();
    let r: string | undefined;
    await act(async () => {
      r = await result.current.excluir({ ...NEGOCIO, ehSystem: true });
    });

    expect(r).toBe("erro");
    expect(toastErro).toHaveBeenCalledWith("JWT expired");
    expect(toastOk).not.toHaveBeenCalled();
  });

  it("erro sem mensagem cai num texto que ainda diz o que falhou", async () => {
    respostas["delete:pipeline_entries"] = { data: null, error: { code: "XX000" } };

    const { result } = montar();
    await act(async () => {
      await result.current.excluir({ ...NEGOCIO, ehSystem: true });
    });

    expect(toastErro).toHaveBeenCalledWith(expect.stringContaining("Erro ao excluir"));
  });
});

describe("Exclusão irreversível deixa rastro", () => {
  it("grava no histórico do lead quem saiu e de qual funil", async () => {
    const { result } = montar();
    await act(async () => {
      await result.current.excluir({ ...NEGOCIO, ehSystem: false });
    });

    expect(registrou).toHaveBeenCalledTimes(1);
    const arg = registrou.mock.calls[0][0];
    expect(arg.leadId).toBe("lead-1");
    expect(arg.action).toBe("pipe_removed");
    expect(arg.description).toContain("Reposição trimestral");
    expect(arg.description).toContain("Orçamentos");
    expect(arg.metadata.entry_id).toBe("e1");
    expect(arg.metadata.familia).toBe("custom");
  });
});
