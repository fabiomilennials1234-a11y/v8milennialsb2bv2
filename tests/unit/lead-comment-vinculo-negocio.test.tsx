/**
 * O comentário grava em QUAL negócio foi escrito.
 *
 * `lead_comments` sempre teve só `lead_id`. A coluna `pipeline_entry_id`
 * (migration `20270829000000`) é o que separa "comentário desta venda" de
 * "comentário desta pessoa" — e é o que o selo do painel lê para não afirmar
 * que algo dito no upsell de dezembro foi dito sobre a proposta de setembro.
 *
 * ── Por que existe um caminho de repetição, e por que ele é testado ───────
 * Merge em `main` publica o front SOZINHO; migration é passo manual (CLAUDE.md
 * raiz). Na janela entre os dois, mandar a coluna faria o INSERT falhar inteiro
 * e o comentário não salvar — que é exatamente o defeito que esta entrega veio
 * consertar. O `useCreateLeadComment` repete o INSERT sem o vínculo quando o
 * banco diz que a coluna não existe, e SÓ nesse caso: engolir erro de RLS aqui
 * transformaria "você não tem permissão" em "salvou" silencioso.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** O que o hook mandou para o banco, INSERT a INSERT. */
const gravados: Array<Record<string, unknown>> = [];
/** Fila de erros: um por chamada de INSERT. `null` = deu certo. */
let errosDoInsert: Array<{ code: string; message: string } | null> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: (tabela: string) => {
      if (tabela === "team_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: "membro-1" }, error: null }) }),
            }),
          }),
        };
      }
      return {
        insert: (linha: Record<string, unknown>) => {
          gravados.push(linha);
          const erro = errosDoInsert.shift() ?? null;
          return {
            select: () => ({
              single: async () => ({ data: erro ? null : { id: "c1", ...linha }, error: erro }),
            }),
          };
        },
      };
    },
  },
}));

import { useCreateLeadComment } from "@/modules/leads/components/lead-detail/hooks/useLeadComments";

function envolver({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const BASE = { leadId: "lead-1", organizationId: "org-1", body: "  texto  " };

describe("Comentário guarda o negócio em que foi escrito", () => {
  beforeEach(() => {
    gravados.length = 0;
    errosDoInsert = [];
  });

  it("manda pipeline_entry_id quando o painel do Negócio está aberto", async () => {
    const { result } = renderHook(() => useCreateLeadComment(), { wrapper: envolver });

    await result.current.mutateAsync({ ...BASE, pipelineEntryId: "entrada-9" });

    expect(gravados).toHaveLength(1);
    expect(gravados[0]).toMatchObject({
      lead_id: "lead-1",
      organization_id: "org-1",
      author_user_id: "user-1",
      author_team_member_id: "membro-1",
      body: "texto",
      pipeline_entry_id: "entrada-9",
    });
  });

  it("omite a chave — não manda null — quando não há negócio", async () => {
    const { result } = renderHook(() => useCreateLeadComment(), { wrapper: envolver });

    await result.current.mutateAsync({ ...BASE });

    expect(gravados).toHaveLength(1);
    expect("pipeline_entry_id" in gravados[0]).toBe(false);
  });

  it("repete sem o vínculo quando a coluna ainda não existe no banco", async () => {
    errosDoInsert = [{ code: "PGRST204", message: "could not find the 'pipeline_entry_id' column" }];
    const { result } = renderHook(() => useCreateLeadComment(), { wrapper: envolver });

    const salvo = await result.current.mutateAsync({ ...BASE, pipelineEntryId: "entrada-9" });

    expect(gravados).toHaveLength(2);
    expect(gravados[0]).toHaveProperty("pipeline_entry_id", "entrada-9");
    expect("pipeline_entry_id" in gravados[1]).toBe(false);
    // O que importa para quem escreveu: o comentário SALVOU.
    expect(salvo).toMatchObject({ id: "c1", body: "texto" });
  });

  it("também repete no 42703 cru do Postgres", async () => {
    errosDoInsert = [{ code: "42703", message: 'column "pipeline_entry_id" of relation does not exist' }];
    const { result } = renderHook(() => useCreateLeadComment(), { wrapper: envolver });

    await result.current.mutateAsync({ ...BASE, pipelineEntryId: "entrada-9" });

    expect(gravados).toHaveLength(2);
  });

  /**
   * O contraexemplo que dá sentido ao caminho de cima. Se a repetição fosse
   * cega, uma recusa de RLS viraria "comentário publicado" sem comentário
   * nenhum — o pior desfecho possível para esta tela.
   */
  it("NÃO repete quando o erro é outro — recusa de RLS continua sendo recusa", async () => {
    errosDoInsert = [{ code: "42501", message: "new row violates row-level security policy" }];
    const { result } = renderHook(() => useCreateLeadComment(), { wrapper: envolver });

    await expect(
      result.current.mutateAsync({ ...BASE, pipelineEntryId: "entrada-9" }),
    ).rejects.toMatchObject({ code: "42501" });

    expect(gravados).toHaveLength(1);
  });

  it("não repete quando nem havia vínculo para tirar", async () => {
    errosDoInsert = [{ code: "PGRST204", message: "coluna sumida qualquer" }];
    const { result } = renderHook(() => useCreateLeadComment(), { wrapper: envolver });

    await expect(result.current.mutateAsync({ ...BASE })).rejects.toMatchObject({ code: "PGRST204" });

    expect(gravados).toHaveLength(1);
  });

  it("invalida a lista do lead para o histórico aparecer sem recarregar a tela", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateLeadComment(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await result.current.mutateAsync({ ...BASE, pipelineEntryId: "entrada-9" });

    await waitFor(() =>
      expect(invalidar).toHaveBeenCalledWith({ queryKey: ["lead-comments", "lead-1"] }),
    );
  });
});
