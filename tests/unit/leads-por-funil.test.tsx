/**
 * `useLeadsPorFunil` — o recorte "leads DESTE funil", com busca no servidor.
 *
 * ESTE É O TESTE QUE PROVA O BUG. O seletor de lead da Agenda chamava
 * `useLeads()` sem argumento: primeira página de 50 leads da organização,
 * filtro em memória, dez na tela. Quem procurasse o 51º lead recebia lista
 * vazia — e não havia recorte por funil nenhum.
 *
 * Os dois casos que falhariam contra o código antigo são
 * `so devolve leads do funil pedido` e `acha lead fora da primeira pagina`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";
import { createMockSupabase } from "../helpers/supabase-mock";

const ORG = "org-a";
const FUNIL_COMERCIAL = "funil-comercial";
const FUNIL_REATIVACAO = "funil-reativacao";

const { sb, mockTable, mockSelectError } = createMockSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return sb;
  },
}));

const organizacao = { organizationId: ORG as string | null, isReady: true };

vi.mock("@/modules/identity", () => ({
  useOrganization: () => organizacao,
}));

const { useLeadsPorFunil, LEADS_POR_FUNIL_PAGE_SIZE } = await import(
  "@/modules/leads/hooks/useLeadsPorFunil"
);

/** Um lead como o PostgREST devolve: entries do funil vêm embutidas. */
function lead(
  id: string,
  name: string,
  funis: string[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    company: null,
    phone: null,
    email: null,
    organization_id: ORG,
    deleted_at: null,
    is_shadow: false,
    pipeline_entries: funis.map((pipeline_id) => ({ pipeline_id })),
    ...extra,
  };
}

function render(params: { pipelineId?: string | null; search?: string }) {
  return renderHook(() => useLeadsPorFunil(params), { wrapper: createWrapper() });
}

beforeEach(() => {
  organizacao.organizationId = ORG;
});

describe("useLeadsPorFunil", () => {
  it("so devolve leads do funil pedido — trocar de funil troca a lista", async () => {
    mockTable("leads", [
      lead("l1", "Ana Comercial", [FUNIL_COMERCIAL]),
      lead("l2", "Bruno Comercial", [FUNIL_COMERCIAL]),
      lead("l3", "Carla Reativacao", [FUNIL_REATIVACAO]),
    ]);

    const comercial = render({ pipelineId: FUNIL_COMERCIAL });
    await waitFor(() =>
      expect(comercial.result.current.data?.leads).toHaveLength(2),
    );
    expect(comercial.result.current.data?.leads.map((l) => l.name)).toEqual([
      "Ana Comercial",
      "Bruno Comercial",
    ]);

    const reativacao = render({ pipelineId: FUNIL_REATIVACAO });
    await waitFor(() =>
      expect(reativacao.result.current.data?.leads).toHaveLength(1),
    );
    expect(reativacao.result.current.data?.leads[0].name).toBe(
      "Carla Reativacao",
    );
  });

  it("acha lead fora da primeira pagina — a busca acontece no SERVIDOR", async () => {
    // 200 leads no funil. Com o filtro em memória sobre as 50 primeiras
    // linhas (o comportamento antigo), este nome nunca apareceria.
    const muitos = Array.from({ length: 200 }, (_, i) =>
      lead(`l${i}`, `Lead ${String(i).padStart(3, "0")}`, [FUNIL_COMERCIAL]),
    );
    muitos.push(lead("agulha", "Zulmira Palheiro", [FUNIL_COMERCIAL]));
    mockTable("leads", muitos);

    const { result } = render({
      pipelineId: FUNIL_COMERCIAL,
      search: "zulmira",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.leads.map((l) => l.id)).toEqual(["agulha"]);
  });

  it("a busca casa por nome, empresa, e-mail e telefone", async () => {
    mockTable("leads", [
      lead("por-nome", "Fabrica Aurora", [FUNIL_COMERCIAL]),
      lead("por-empresa", "Contato sem pista", [FUNIL_COMERCIAL], {
        company: "Aurora Distribuidora",
      }),
      lead("por-email", "Outro contato", [FUNIL_COMERCIAL], {
        email: "compras@aurora.com.br",
      }),
      lead("de-fora", "Nada a ver", [FUNIL_COMERCIAL]),
    ]);

    const { result } = render({
      pipelineId: FUNIL_COMERCIAL,
      search: "aurora",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.leads.map((l) => l.id).sort()).toEqual([
      "por-email",
      "por-empresa",
      "por-nome",
    ]);
  });

  it("nao duplica o lead que tem duas entradas no MESMO funil", async () => {
    // Os uniques de (funil, lead) caíram em `20270730000050`; um lead pode ter
    // N entries no mesmo funil. Com a raiz da consulta em `pipeline_entries` a
    // pessoa apareceria duas vezes no seletor.
    mockTable("leads", [
      lead("repetido", "Lead Com Dois Negocios", [
        FUNIL_COMERCIAL,
        FUNIL_COMERCIAL,
      ]),
    ]);

    const { result } = render({ pipelineId: FUNIL_COMERCIAL });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.leads).toHaveLength(1);
  });

  it("nao devolve lead na lixeira nem lead-sombra", async () => {
    mockTable("leads", [
      lead("vivo", "Lead Vivo", [FUNIL_COMERCIAL]),
      lead("lixeira", "Lead Na Lixeira", [FUNIL_COMERCIAL], {
        deleted_at: "2026-08-01T00:00:00Z",
      }),
      lead("sombra", "Lead Sombra", [FUNIL_COMERCIAL], { is_shadow: true }),
    ]);

    const { result } = render({ pipelineId: FUNIL_COMERCIAL });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.leads.map((l) => l.id)).toEqual(["vivo"]);
  });

  it("corta na pagina e avisa que ha mais", async () => {
    mockTable(
      "leads",
      Array.from({ length: LEADS_POR_FUNIL_PAGE_SIZE + 5 }, (_, i) =>
        lead(`l${i}`, `Lead ${String(i).padStart(3, "0")}`, [FUNIL_COMERCIAL]),
      ),
    );

    const { result } = render({ pipelineId: FUNIL_COMERCIAL });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.leads).toHaveLength(LEADS_POR_FUNIL_PAGE_SIZE);
    expect(result.current.data?.temMais).toBe(true);
  });

  it("nao avisa que ha mais quando cabe tudo", async () => {
    mockTable("leads", [lead("l1", "Unico", [FUNIL_COMERCIAL])]);

    const { result } = render({ pipelineId: FUNIL_COMERCIAL });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.temMais).toBe(false);
  });

  it("nao consulta nada sem funil escolhido", async () => {
    mockTable("leads", [lead("l1", "Ana", [FUNIL_COMERCIAL])]);

    const { result } = render({ pipelineId: null });

    // `enabled: false` — a query nem sai do estado inicial.
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("propaga o erro da consulta em vez de fingir lista vazia", async () => {
    mockTable("leads", [lead("l1", "Ana", [FUNIL_COMERCIAL])]);
    mockSelectError("leads", { code: "PGRST301", message: "boom" });

    const { result } = render({ pipelineId: FUNIL_COMERCIAL });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
