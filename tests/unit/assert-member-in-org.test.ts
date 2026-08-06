/**
 * `assertMemberInOrg` — a guarda que recusa dono de OUTRA organização ao abrir
 * negócio (`inv:H1-07`, SCRUM-51, commit dbdf3411).
 *
 * Por que este arquivo existe:
 *
 *   1. O modal de novo negócio passou a mandar `ownerId`. Antes disso o dono
 *      era sempre o usuário atual, então não havia nada para injetar. Com o
 *      campo, um uuid de membro de outra org entra numa linha desta org e a FK
 *      não reclama: a FK garante que o uuid EXISTE, não de quem ele é.
 *   2. Foi medido no banco que nenhuma policy fecha esse buraco — as de
 *      `custom_pipe_entries` validam só o `organization_id` da LINHA, e os
 *      `pipe_*` são views sem policy própria. Nenhuma compara o org do membro
 *      referenciado em `responsible_id`/`sdr_id`/`closer_id`/`assigned_to`.
 *      Prod já tem 1.091 linhas de `pipeline_entries` da org Maria Bonita
 *      apontando para um membro da Mapila Alimentos (import de 2026-05-06).
 *   3. Logo esta é, hoje, a ÚNICA barreira no caminho do produto. O conserto
 *      definitivo é no banco (M6), mas enquanto ele não sobe, remover ou
 *      afrouxar esta função reabre atribuição cross-tenant silenciosa.
 *
 * O que se prova aqui não é que a função "chama o supabase": é que a consulta
 * carrega o filtro de organização (sem ele o dono de fora é ACEITO), que o
 * erro de leitura falha fechado, e — o mais importante — que a guarda roda
 * ANTES da escrita, nos dois caminhos que gravam. Guarda que roda depois do
 * `INSERT` não é guarda.
 *
 * O supabase aqui não é um `vi.fn()` que devolve constante: é uma tabela falsa
 * que APLICA os filtros que o código de produção declarou. É isso que faz o
 * teste morder quando alguém apaga o `.eq("organization_id", ...)`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// ── Banco falso ─────────────────────────────────────────────────────────────

const ORG_DESTA = "org-desta-casa";
const ORG_VIZINHA = "org-da-casa-ao-lado";

const MEMBRO_DE_CASA = "tm-membro-desta-org";
const MEMBRO_DE_FORA = "tm-membro-da-org-vizinha";

/** As duas linhas existem — é exatamente por isso que a FK não protege nada. */
const TEAM_MEMBERS = [
  { id: MEMBRO_DE_CASA, organization_id: ORG_DESTA },
  { id: MEMBRO_DE_FORA, organization_id: ORG_VIZINHA },
];

interface ConsultaRegistrada {
  tabela: string;
  filtros: Array<[string, unknown]>;
}

const consultas: ConsultaRegistrada[] = [];
const insercoes: Array<{ tabela: string; linha: unknown }> = [];
const rpcCalls: Array<{ nome: string; args: Record<string, unknown> }> = [];

/** Liga para provar que erro de leitura não é interpretado como "pode". */
let erroDeLeitura: { message: string } | null = null;

function fakeFrom(tabela: string) {
  const filtros: Array<[string, unknown]> = [];
  const registro: ConsultaRegistrada = { tabela, filtros };

  const chain = {
    select: () => chain,
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return chain;
    },
    maybeSingle: async () => {
      consultas.push(registro);
      if (erroDeLeitura) return { data: null, error: erroDeLeitura };
      const linhas = TEAM_MEMBERS.filter((linha) =>
        filtros.every(([coluna, valor]) => (linha as Record<string, unknown>)[coluna] === valor),
      );
      return { data: linhas[0] ?? null, error: null };
    },
    insert: async (linha: unknown) => {
      insercoes.push({ tabela, linha });
      return { error: null };
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => fakeFrom(tabela),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcCalls.push({ nome, args });
      return { data: null, error: null };
    },
  },
}));

// ── Identidade (barril mockado de propósito: o real arrasta grafo grande) ────

const teamMemberAtual: { value: { id: string; organization_id: string } | null } = {
  value: { id: MEMBRO_DE_CASA, organization_id: ORG_DESTA },
};

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: teamMemberAtual.value }),
  isVirtualTeamMember: (id: string | null | undefined) =>
    typeof id === "string" && id.startsWith("master-virtual-"),
}));

vi.mock("@/modules/leads/pipe-ops", () => ({
  usePipeOps: () => ({ useCustomPipelines: () => ({ data: [] }) }),
}));

import {
  assertMemberInOrg,
  useAddLeadToStandardPipe,
} from "@/modules/leads/hooks/useLeadAllPipelines";

beforeEach(() => {
  consultas.length = 0;
  insercoes.length = 0;
  rpcCalls.length = 0;
  erroDeLeitura = null;
  teamMemberAtual.value = { id: MEMBRO_DE_CASA, organization_id: ORG_DESTA };
});

// ── A guarda, sozinha ───────────────────────────────────────────────────────

describe("assertMemberInOrg", () => {
  it("recusa membro que pertence a OUTRA organização", async () => {
    await expect(assertMemberInOrg(MEMBRO_DE_FORA, ORG_DESTA)).rejects.toThrow(
      /não pertence a esta organização/i,
    );
  });

  it("aceita membro da própria organização", async () => {
    await expect(assertMemberInOrg(MEMBRO_DE_CASA, ORG_DESTA)).resolves.toBeUndefined();
  });

  it("consulta team_members filtrando id E organização — o filtro de org é o que protege", async () => {
    await assertMemberInOrg(MEMBRO_DE_CASA, ORG_DESTA);

    expect(consultas).toHaveLength(1);
    expect(consultas[0].tabela).toBe("team_members");
    expect(consultas[0].filtros).toContainEqual(["id", MEMBRO_DE_CASA]);
    expect(consultas[0].filtros).toContainEqual(["organization_id", ORG_DESTA]);
  });

  it("uuid que não existe em lugar nenhum também é recusado", async () => {
    await expect(
      assertMemberInOrg("00000000-0000-0000-0000-000000000000", ORG_DESTA),
    ).rejects.toThrow();
  });

  it("erro de leitura falha FECHADO — indisponibilidade não vira permissão", async () => {
    erroDeLeitura = { message: "timeout" };
    await expect(assertMemberInOrg(MEMBRO_DE_CASA, ORG_DESTA)).rejects.toBeTruthy();
  });
});

// ── A guarda no caminho que grava ───────────────────────────────────────────

function abrirNegocio() {
  return renderHook(() => useAddLeadToStandardPipe(), { wrapper: createWrapper() });
}

describe("abrir negócio (pipe do sistema)", () => {
  it("NÃO grava quando o dono escolhido é de outra organização", async () => {
    const { result } = abrirNegocio();
    await waitFor(() => expect(result.current).toBeTruthy());

    await expect(
      result.current.mutateAsync({
        leadId: "lead-1",
        pipeType: "propostas",
        stageId: "orcamento",
        ownerId: MEMBRO_DE_FORA,
      }),
    ).rejects.toThrow(/não pertence a esta organização/i);

    // A prova que importa é a AUSÊNCIA de escrita: guarda que roda depois do
    // insert não impede nada.
    expect(rpcCalls).toHaveLength(0);
    expect(insercoes).toHaveLength(0);
  });

  it("grava com o dono escolhido quando ele é da própria organização", async () => {
    const { result } = abrirNegocio();
    await waitFor(() => expect(result.current).toBeTruthy());

    await result.current.mutateAsync({
      leadId: "lead-1",
      pipeType: "propostas",
      stageId: "orcamento",
      ownerId: MEMBRO_DE_CASA,
      saleValue: 1500,
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].nome).toBe("abrir_negocio");
    expect(rpcCalls[0].args.p_owner_id).toBe(MEMBRO_DE_CASA);
  });

  it("sem dono escolhido não consulta team_members e o negócio nasce com quem criou", async () => {
    const { result } = abrirNegocio();
    await waitFor(() => expect(result.current).toBeTruthy());

    await result.current.mutateAsync({
      leadId: "lead-1",
      pipeType: "qualificacao",
      stageId: "novo_lead",
    });

    expect(consultas).toHaveLength(0);
    expect(rpcCalls[0].args.p_owner_id).toBe(MEMBRO_DE_CASA);
  });

  it("master virtual escolhido como dono não é consultado nem gravado como FK", async () => {
    const { result } = abrirNegocio();
    await waitFor(() => expect(result.current).toBeTruthy());

    await result.current.mutateAsync({
      leadId: "lead-1",
      pipeType: "qualificacao",
      stageId: "novo_lead",
      ownerId: "master-virtual-abc",
    });

    // `master-virtual-<uuid>` não é uuid: iria estourar a coluna FK.
    expect(consultas).toHaveLength(0);
    expect(rpcCalls[0].args.p_owner_id).toBe(MEMBRO_DE_CASA);
  });

  it("master virtual OPERANDO (sem membro real) abre negócio sem dono, não com id inválido", async () => {
    teamMemberAtual.value = { id: "master-virtual-xyz", organization_id: ORG_DESTA };
    const { result } = abrirNegocio();
    await waitFor(() => expect(result.current).toBeTruthy());

    await result.current.mutateAsync({
      leadId: "lead-1",
      pipeType: "qualificacao",
      stageId: "novo_lead",
    });

    expect(rpcCalls[0].args.p_owner_id).toBeNull();
  });

  it("sem organização no contexto, nada é gravado", async () => {
    teamMemberAtual.value = null;
    const { result } = abrirNegocio();
    await waitFor(() => expect(result.current).toBeTruthy());

    await expect(
      result.current.mutateAsync({
        leadId: "lead-1",
        pipeType: "qualificacao",
        stageId: "novo_lead",
      }),
    ).rejects.toThrow(/Organização não encontrada/i);

    expect(rpcCalls).toHaveLength(0);
  });
});

describe("abrir negócio na Carteira (upsell)", () => {
  it("a guarda também roda antes do insert de upsell", async () => {
    const { result } = abrirNegocio();
    await waitFor(() => expect(result.current).toBeTruthy());

    await expect(
      result.current.mutateAsync({
        leadId: "lead-1",
        pipeType: "upsell",
        stageId: "ativo",
        ownerId: MEMBRO_DE_FORA,
      }),
    ).rejects.toThrow(/não pertence a esta organização/i);

    expect(insercoes).toHaveLength(0);
  });

  it("upsell não passa pela RPC abrir_negocio — Carteira entra por regra própria", async () => {
    const { result } = abrirNegocio();
    await waitFor(() => expect(result.current).toBeTruthy());

    await result.current.mutateAsync({
      leadId: "lead-1",
      pipeType: "upsell",
      stageId: "ativo",
      ownerId: MEMBRO_DE_CASA,
    });

    expect(rpcCalls).toHaveLength(0);
    expect(insercoes).toHaveLength(1);
    expect(insercoes[0].tabela).toBe("upsell");
    expect(insercoes[0].linha).toMatchObject({
      lead_id: "lead-1",
      organization_id: ORG_DESTA,
    });
  });
});
