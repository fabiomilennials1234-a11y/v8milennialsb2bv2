import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";

// ─── O dublê PROJETA o que o `.select(...)` pediu ────────────────────────────
//
// Um dublê que devolve a linha inteira ignorando a lista de colunas transforma
// a suíte em teatro: nenhum teste consegue perceber uma coluna que o código
// esqueceu de pedir. Isto já custou caro nesta branch — o dublê do `call-plane`
// devolvia a linha toda, e um mutante que derrubava o atendimento inteiro
// passava com tudo verde.
//
// Aqui a projeção é ESTRITA: pedir coluna que a linha não tem é erro, e o que
// não foi pedido não volta. Os filtros também são aplicados de verdade, então
// esquecer um `.eq("status", "open")` quebra o teste em vez de passar batido.

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  whatsapp_instances: [],
  whatsapp_instance_allowed_members: [],
  voip_sessions: [],
};

function project(row: Row, cols: string[]): Row {
  const out: Row = {};
  for (const col of cols) {
    if (!(col in row)) {
      throw new Error(`select pediu a coluna "${col}", que não existe na linha do dublê`);
    }
    out[col] = row[col];
  }
  return out;
}

/** Toda consulta que chegou ao dublê, como `tabela:colunas`. */
let consultas: string[] = [];

function makeBuilder(table: string) {
  let cols: string[] | null = null;
  const filters: Array<(r: Row) => boolean> = [];
  let orderBy: string | null = null;

  function run() {
    if (!cols) throw new Error("consulta sem select");
    let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (orderBy) {
      const key = orderBy;
      rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    }
    return { data: rows.map((r) => project(r, cols!)), error: null };
  }

  const builder = {
    select(list: string) {
      cols = list.split(",").map((s) => s.trim());
      consultas.push(`${table}:${cols.join(",")}`);
      return builder;
    },
    eq(col: string, value: unknown) {
      filters.push((r) => r[col] === value);
      return builder;
    },
    neq(col: string, value: unknown) {
      filters.push((r) => r[col] !== value);
      return builder;
    },
    in(col: string, values: unknown[]) {
      filters.push((r) => values.includes(r[col]));
      return builder;
    },
    order(col: string) {
      orderBy = col;
      return builder;
    },
    then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
      return Promise.resolve()
        .then(run)
        .then(onOk, onErr);
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

let currentMember: { id: string; organization_id: string; role: string } | null = null;
/** `voip.call.start` — a mesma feature que `call-plane.ts` cobra no outbound. */
let podeLigar = true;

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: currentMember }),
  isVirtualTeamMember: (id: string | null | undefined) =>
    !!id && (id.startsWith("master-virtual-") || id.startsWith("gestor-virtual-")),
  useOrganization: () => ({
    organizationId: currentMember?.organization_id ?? null,
    teamMemberId: currentMember?.id ?? null,
  }),
  useCanDo: (acao: string) => ({
    allowed: acao === "voip.call.start" ? podeLigar : true,
    reason: "teste",
    isLoading: false,
  }),
}));

import { useCallableVoiceNumbers } from "./useVoipSession";

// JSX exige extensão .tsx neste projeto (o parser oxc do Vite rejeita `<Tag>`
// em `.ts`); createElement mantém o arquivo alinhado com useVoipSessions.test.ts.
const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

/** Instância da org, com todas as colunas que o produto lê. */
function instancia(over: Partial<Row> & { id: string; instance_name: string }): Row {
  return {
    organization_id: "org-1",
    status: "connected",
    provider: "uazapi",
    voice_calls_enabled: true,
    ...over,
  };
}

function sessao(over: Partial<Row> & { tc_session_id: string; whatsapp_instance_id: string }): Row {
  return { organization_id: "org-1", status: "open", ...over };
}

async function listar() {
  const { result } = renderHook(() => useCallableVoiceNumbers(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
}

beforeEach(() => {
  currentMember = { id: "tm-1", organization_id: "org-1", role: "membro" };
  podeLigar = true;
  consultas = [];
  tables.whatsapp_instances = [];
  tables.whatsapp_instance_allowed_members = [];
  tables.voip_sessions = [];
});

/** Um número perfeito: ao alcance de todos, com voz e com sessão aberta. */
function umNumeroPronto() {
  tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
  tables.voip_sessions = [sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" })];
}

/** Só a consulta que monta a lista de instâncias permitidas. */
const CONSULTA_DA_REGRA = "whatsapp_instances:id,instance_name,status,provider";

describe("useCallableVoiceNumbers — a regra de acesso é a do inbox, não uma nova", () => {
  it("sem nenhum número com voz ao alcance, a lista é vazia (o botão some)", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial", voice_calls_enabled: false })];
    const result = await listar();
    expect(result.current.numbers).toEqual([]);
  });

  it("instância SEM allowed_members aparece para membro comum — é o caso de toda a base hoje", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
    tables.voip_sessions = [sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" })];
    const result = await listar();
    expect(result.current.numbers).toEqual([
      { tcSessionId: "tc-1", instanceId: "i-1", instanceName: "Comercial" },
    ]);
  });

  it("instância COM lista não aparece para quem está fora dela", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
    tables.voip_sessions = [sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" })];
    tables.whatsapp_instance_allowed_members = [
      { whatsapp_instance_id: "i-1", team_member_id: "tm-outro" },
    ];
    const result = await listar();
    expect(result.current.numbers).toEqual([]);
  });

  it("quem está NA lista continua vendo o número", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
    tables.voip_sessions = [sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" })];
    tables.whatsapp_instance_allowed_members = [
      { whatsapp_instance_id: "i-1", team_member_id: "tm-1" },
    ];
    const result = await listar();
    expect(result.current.numbers.map((n) => n.instanceName)).toEqual(["Comercial"]);
  });

  // ESTE é o caso que prende a interseção, e ele não é o mesmo do teste acima.
  // Com um único número restrito, a lista permitida fica VAZIA e qualquer
  // implementação que devolva cedo por lista vazia passa — inclusive uma que
  // ignore a regra de acesso por completo. Com DOIS números, um ao alcance e
  // outro não, a lista permitida é não-vazia e o filtro precisa acontecer de
  // verdade. Medido: o mutante que soma "toda instância com voz" à lista
  // sobrevive sem este teste e morre com ele.
  it("com dois números, só entra o que está ao alcance dele", async () => {
    tables.whatsapp_instances = [
      instancia({ id: "i-1", instance_name: "Comercial" }),
      instancia({ id: "i-2", instance_name: "Do colega" }),
    ];
    tables.voip_sessions = [
      sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" }),
      sessao({ tc_session_id: "tc-2", whatsapp_instance_id: "i-2" }),
    ];
    tables.whatsapp_instance_allowed_members = [
      { whatsapp_instance_id: "i-2", team_member_id: "tm-outro" },
    ];
    const result = await listar();
    expect(result.current.numbers).toEqual([
      { tcSessionId: "tc-1", instanceId: "i-1", instanceName: "Comercial" },
    ]);
  });

  it("admin bypassa a lista, como no inbox", async () => {
    currentMember = { id: "tm-1", organization_id: "org-1", role: "admin" };
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
    tables.voip_sessions = [sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" })];
    tables.whatsapp_instance_allowed_members = [
      { whatsapp_instance_id: "i-1", team_member_id: "tm-outro" },
    ];
    const result = await listar();
    expect(result.current.numbers.map((n) => n.instanceName)).toEqual(["Comercial"]);
  });
});

describe("useCallableVoiceNumbers — só oferece o que o servidor aceitaria", () => {
  // `fn_voip_call_reserve` recusa com `voice_calls_disabled`. Oferecer o botão
  // aqui seria oferecer uma recusa.
  it("instância com sessão aberta mas voz desligada NÃO entra", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial", voice_calls_enabled: false })];
    tables.voip_sessions = [sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" })];
    const result = await listar();
    expect(result.current.numbers).toEqual([]);
  });

  // O servidor recusa com `session_not_open`. `pending` é a sessão que ainda
  // espera o QR; `closed` é a deslogada.
  it.each(["pending", "pairing", "closed", "quarantined"])(
    "sessão %s não é número para ligar",
    async (status) => {
      tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
      tables.voip_sessions = [sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1", status })];
      const result = await listar();
      expect(result.current.numbers).toEqual([]);
    },
  );

  it("instância sem sessão nenhuma não entra, mesmo com a voz ligada", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
    const result = await listar();
    expect(result.current.numbers).toEqual([]);
  });
});

describe("useCallableVoiceNumbers — a permissão de ligar, a mesma do servidor", () => {
  // `_shared/voip/call-plane.ts` cobra `voip.call.start` no outbound e recusa
  // com `permission_denied`. A feature nasce com `default_value = true`, então
  // um front sem esta checagem só fica errado no dia em que um admin desliga o
  // toggle — que é o único dia em que o toggle importa.
  it("sem a permissão de ligar, nenhum número aparece", async () => {
    podeLigar = false;
    umNumeroPronto();
    const result = await listar();
    expect(result.current.numbers).toEqual([]);
  });

  it("com a permissão, o mesmo dado devolve o número", async () => {
    podeLigar = true;
    umNumeroPronto();
    const result = await listar();
    expect(result.current.numbers.map((n) => n.instanceName)).toEqual(["Comercial"]);
  });

  it("sem a permissão, nem chega a consultar sessão de voz", async () => {
    podeLigar = false;
    umNumeroPronto();
    await listar();
    expect(consultas.filter((c) => c.startsWith("voip_sessions"))).toEqual([]);
  });
});

describe("useCallableVoiceNumbers — o provider vive na raiz e não pode custar caro", () => {
  // Sem sessão de voz aberta não existe número, e as outras duas consultas não
  // teriam o que responder. Em ~29 das ~30 organizações é sempre este caso — e
  // este provider está fora das rotas, então o custo cairia em toda página de
  // todo usuário.
  it("organização sem sessão aberta: uma consulta, e só", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
    const result = await listar();
    expect(result.current.numbers).toEqual([]);
    expect(consultas).toEqual(["voip_sessions:tc_session_id,whatsapp_instance_id"]);
  });

  it("organização sem sessão aberta não monta a lista de instâncias permitidas", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
    await listar();
    expect(consultas).not.toContain(CONSULTA_DA_REGRA);
  });

  it("com sessão aberta, a regra de acesso é consultada normalmente", async () => {
    umNumeroPronto();
    const result = await listar();
    expect(result.current.numbers).toHaveLength(1);
    expect(consultas).toContain(CONSULTA_DA_REGRA);
  });

  // Um `useQuery` desligado fica em `pending` para sempre. Somá-lo ao
  // `isLoading` prenderia o botão em "carregando" em quase toda a base.
  it("sem voz na organização, o hook termina de carregar", async () => {
    tables.whatsapp_instances = [instancia({ id: "i-1", instance_name: "Comercial" })];
    const { result } = renderHook(() => useCallableVoiceNumbers(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.numbers).toEqual([]);
  });
});

describe("useCallableVoiceNumbers — a ordem é decidida, não sorteada", () => {
  // O defeito original: `.limit(1)` sem ordenação. Com dois números, qual
  // atendia dependia do que o Postgres devolvesse primeiro.
  it("ordena por nome, e o mesmo dado devolve sempre a mesma lista", async () => {
    tables.whatsapp_instances = [
      instancia({ id: "i-2", instance_name: "Suporte" }),
      instancia({ id: "i-1", instance_name: "Comercial" }),
    ];
    tables.voip_sessions = [
      sessao({ tc_session_id: "tc-2", whatsapp_instance_id: "i-2" }),
      sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" }),
    ];
    const result = await listar();
    expect(result.current.numbers.map((n) => n.instanceName)).toEqual(["Comercial", "Suporte"]);
  });

  // O que barra a outra organização EM PRODUÇÃO é a RLS `voip_sessions_select_org`,
  // que filtra por `organization_id` — o mesmo campo do `.eq()` da consulta. O
  // dublê não tem RLS, então aqui quem barra é a lista de instâncias.
  //
  // NÃO conclua daí que o `.eq("organization_id", ...)` da consulta de sessões
  // é dispensável. Isso pressuporia que `voip_sessions.organization_id` sempre
  // concorda com a organização da instância apontada, e o schema não garante
  // isso: são dois FKs soltos, sem FK composta, sem CHECK e sem trigger que os
  // amarre. O filtro fica, e é ele também que faz a consulta usar
  // `idx_voip_sessions_org (organization_id, status)`.
  it("número de outra organização nunca entra na lista", async () => {
    tables.whatsapp_instances = [
      instancia({ id: "i-1", instance_name: "Comercial" }),
      instancia({ id: "i-9", instance_name: "De outra empresa", organization_id: "org-9" }),
    ];
    tables.voip_sessions = [
      sessao({ tc_session_id: "tc-1", whatsapp_instance_id: "i-1" }),
      sessao({ tc_session_id: "tc-9", whatsapp_instance_id: "i-9", organization_id: "org-9" }),
    ];
    const result = await listar();
    expect(result.current.numbers.map((n) => n.tcSessionId)).toEqual(["tc-1"]);
  });
});
