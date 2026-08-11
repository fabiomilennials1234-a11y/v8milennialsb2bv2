// @vitest-environment node
/**
 * A guarda de ordem de deploy do `whatsapp-api-proxy`.
 *
 * O que está em jogo
 * ------------------
 * O DROP de `whatsapp_messages_instance_id_fkey` (migration
 * `20270811000000`) e o deploy desta função são DOIS passos manuais, em
 * qualquer ordem. Cada ordem tem um jeito próprio de dar errado:
 *
 *  - proxy novo com a FK ainda viva, e SEM limpar `whatsapp_messages`: o DELETE
 *    entrega ~155k linhas ao `ON DELETE SET NULL` num statement só e estoura o
 *    statement timeout — a falha que derrubou 34 de 95 exclusões;
 *  - proxy antigo... ou proxy novo que continue limpando DEPOIS do DROP: o
 *    nullify desliga o histórico do chip a cada exclusão, e como o chat filtra
 *    por `instance_id`, a conversa inteira some da tela (385.828 linhas órfãs).
 *
 * Por isso o proxy não supõe: pergunta ao catálogo a cada exclusão (com cache
 * no isolate) e monta a lista de alvos do nullify a partir da resposta.
 *
 * O que estes testes olham
 * ------------------------
 * O EFEITO no dado, não o texto da query: depois de uma exclusão, as linhas de
 * `whatsapp_messages` da instância ficaram com `instance_id` nulo ou intactas?
 * `scheduled_user_messages` esvaziou? Quantas vezes o catálogo foi consultado?
 *
 * A função de sondagem continua privada — nada aqui muda visibilidade de código
 * de produção. O handler real é capturado do `Deno.serve` e exercitado com uma
 * requisição `deleteInstance` de verdade, sobre um banco falso em memória.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Deno + mocks dos módulos vizinhos (hoisted — precisam existir antes do import)
// ---------------------------------------------------------------------------

const {
  getHandler,
  mockCreateClient,
  mockLogRuntime,
  mockGetWhatsAppProvider,
  mockAssertPlanFeature,
} = vi.hoisted(() => {
  let handler: unknown = null;

  const envStore: Record<string, string> = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ALLOWED_ORIGINS: "http://localhost:8080",
  };

  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => envStore[k] },
    // deno-lint-ignore no-explicit-any
    serve: (fn: any) => {
      handler = fn;
    },
  };

  return {
    getHandler: () => handler as (req: Request) => Promise<Response>,
    mockCreateClient: vi.fn(),
    mockLogRuntime: vi.fn().mockResolvedValue(undefined),
    mockGetWhatsAppProvider: vi.fn(),
    mockAssertPlanFeature: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: mockCreateClient,
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, handler: unknown) => handler,
  logError: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/cors.ts", () => ({
  getCorsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: mockLogRuntime,
}));

vi.mock("../../supabase/functions/_shared/plan-gate.ts", () => ({
  assertPlanFeature: mockAssertPlanFeature,
  PlanFeatureDeniedError: class PlanFeatureDeniedError extends Error {},
  planDeniedResponse: () => new Response("denied", { status: 403 }),
}));

vi.mock("../../supabase/functions/_shared/gestor-auth.ts", () => ({
  isActiveGestorForOrg: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: mockGetWhatsAppProvider,
}));

// Imports só-para-bundling na função real; irrelevantes aqui.
vi.mock(
  "../../supabase/functions/_shared/whatsapp-providers/evolution-provider.ts",
  () => ({})
);
vi.mock(
  "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts",
  () => ({})
);
vi.mock(
  "../../supabase/functions/_shared/whatsapp-providers/meta-cloud-provider.ts",
  () => ({})
);

// ---------------------------------------------------------------------------
// Banco falso em memória
// ---------------------------------------------------------------------------

const INSTANCE_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "org-1";

/**
 * Como o catálogo responde à sondagem.
 *
 *  - `fk_viva`        → o embed pelo nome da constraint resolve (200);
 *  - `fk_dropada`     → PostgREST devolve PGRST200;
 *  - `fk_dropada_sem_code` → mesma falha, sem o campo `code` no corpo;
 *  - `permissao_negada`    → erro REAL do banco, que NÃO prova nada sobre a FK;
 *  - `rede_caiu`      → a chamada nem chega a responder.
 */
type ModoDaSondagem =
  | "fk_viva"
  | "fk_dropada"
  | "fk_dropada_sem_code"
  | "permissao_negada"
  | "rede_caiu";

interface QueryGravada {
  table: string;
  op: "select" | "update" | "delete" | "insert";
  columns?: string;
  filters: Array<{ kind: "eq" | "in"; column: string; value: unknown }>;
  limit?: number;
  patch?: Record<string, unknown>;
}

type Linha = Record<string, unknown>;

/** Tabela em memória com índice por `id`, para aguentar 100k+ linhas. */
interface Tabela {
  rows: Linha[];
  porId: Map<string, Linha>;
}

interface BancoFalso {
  mensagens: Tabela;
  agendadas: Tabela;
  instanciaApagada: boolean;
}

let db: BancoFalso;
let modoDaSondagem: ModoDaSondagem;
let queries: QueryGravada[];
let sondagens: QueryGravada[];

/** Quais linhas a query REALMENTE alcança — é o que os testes observam. */
function selecionar(q: QueryGravada, tabela: Tabela): Linha[] {
  const filtroIn = q.filters.find((f) => f.kind === "in");
  if (filtroIn) {
    const out: Linha[] = [];
    for (const id of filtroIn.value as string[]) {
      const r = tabela.porId.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  const eqs = q.filters.filter((f) => f.kind === "eq");
  const out: Linha[] = [];
  for (const r of tabela.rows) {
    if (eqs.every((f) => r[f.column] === f.value)) out.push(r);
    if (typeof q.limit === "number" && out.length >= q.limit) break;
  }
  return out;
}

function valores(tabela: Tabela, coluna: string): unknown[] {
  return tabela.rows.map((r) => r[coluna]);
}

function ehSondagemDoCatalogo(q: QueryGravada): boolean {
  return (
    q.table === "whatsapp_messages" &&
    q.op === "select" &&
    (q.columns ?? "").includes("whatsapp_messages_instance_id_fkey")
  );
}

// deno-lint-ignore no-explicit-any
function rodar(q: QueryGravada): any {
  queries.push(q);

  if (ehSondagemDoCatalogo(q)) {
    sondagens.push(q);
    switch (modoDaSondagem) {
      case "fk_viva":
        return { data: selecionar(q, db.mensagens), error: null };
      case "fk_dropada":
        return {
          data: null,
          error: {
            code: "PGRST200",
            message:
              "Could not find a relationship between 'whatsapp_messages' and 'whatsapp_instances' in the schema cache",
          },
        };
      case "fk_dropada_sem_code":
        return {
          data: null,
          error: {
            message:
              "Could not find a relationship between 'whatsapp_messages' and 'whatsapp_instances' in the schema cache",
          },
        };
      case "permissao_negada":
        return {
          data: null,
          error: {
            code: "42501",
            // Mensagem com PII de propósito: o log da guarda não pode ecoá-la.
            message:
              "permission denied for table whatsapp_messages (remote_jid 5562996115735@s.whatsapp.net)",
          },
        };
      case "rede_caiu":
        throw new TypeError(
          "error sending request for url (https://test.supabase.co/rest/v1/whatsapp_messages)"
        );
    }
  }

  if (q.table === "master_users") return { data: null, error: null };
  if (q.table === "team_members")
    return { data: { organization_id: ORG_ID }, error: null };

  if (q.table === "whatsapp_instances") {
    if (q.op === "delete") {
      db.instanciaApagada = true;
      return { data: null, error: null };
    }
    return {
      data: db.instanciaApagada
        ? null
        : {
            id: INSTANCE_ID,
            organization_id: ORG_ID,
            provider: "uazapi",
            instance_name: "chip-1",
          },
      error: null,
    };
  }

  if (q.table === "whatsapp_conversations") return { data: null, error: null };

  const tabela =
    q.table === "whatsapp_messages"
      ? db.mensagens
      : q.table === "scheduled_user_messages"
        ? db.agendadas
        : null;

  if (tabela) {
    if (q.op === "select") {
      return {
        data: selecionar(q, tabela).map((r) => ({ id: r.id })),
        error: null,
      };
    }
    if (q.op === "update") {
      for (const row of selecionar(q, tabela)) Object.assign(row, q.patch);
      return { data: null, error: null };
    }
  }

  return { data: null, error: null };
}

// deno-lint-ignore no-explicit-any
function builder(table: string): any {
  const q: QueryGravada = { table, op: "select", filters: [] };
  // deno-lint-ignore no-explicit-any
  const b: any = {
    select(cols?: string) {
      q.op = "select";
      q.columns = cols;
      return b;
    },
    update(patch: Record<string, unknown>) {
      q.op = "update";
      q.patch = patch;
      return b;
    },
    delete() {
      q.op = "delete";
      return b;
    },
    insert(row: Record<string, unknown>) {
      q.op = "insert";
      q.patch = row;
      return b;
    },
    eq(column: string, value: unknown) {
      q.filters.push({ kind: "eq", column, value });
      return b;
    },
    in(column: string, value: unknown) {
      q.filters.push({ kind: "in", column, value });
      return b;
    },
    limit(n: number) {
      q.limit = n;
      return b;
    },
    maybeSingle: () => b,
    single: () => b,
    // deno-lint-ignore no-explicit-any
    then: (res: any, rej: any) =>
      Promise.resolve()
        .then(() => rodar(q))
        .then(res, rej),
  };
  return b;
}

function fazerTabela(rows: Linha[]): Tabela {
  return { rows, porId: new Map(rows.map((r) => [r.id as string, r])) };
}

function semearBanco(qtdMensagens: number, qtdAgendadas: number) {
  db = {
    mensagens: fazerTabela(
      Array.from({ length: qtdMensagens }, (_, i) => ({
        id: `msg-${i}`,
        instance_id: INSTANCE_ID,
      }))
    ),
    agendadas: fazerTabela(
      Array.from({ length: qtdAgendadas }, (_, i) => ({
        id: `sched-${i}`,
        whatsapp_instance_id: INSTANCE_ID,
      }))
    ),
    instanciaApagada: false,
  };
}

// ---------------------------------------------------------------------------
// Carregar o proxy (isolate novo = cache da sondagem zerado)
// ---------------------------------------------------------------------------

async function carregarProxyNovo(): Promise<(req: Request) => Promise<Response>> {
  vi.resetModules();
  await import("../../supabase/functions/whatsapp-api-proxy/index.ts");
  return getHandler();
}

function requisicaoDeExclusao(): Request {
  return new Request("http://localhost/whatsapp-api-proxy", {
    method: "POST",
    headers: {
      Authorization: "Bearer jwt-do-usuario",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "deleteInstance", instance_id: INSTANCE_ID }),
  });
}

async function excluirInstancia(
  handler: (req: Request) => Promise<Response>
): Promise<Response> {
  const res = await handler(requisicaoDeExclusao());
  // A instância "volta" para a próxima exclusão do mesmo isolate.
  db.instanciaApagada = false;
  return res;
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));

  queries = [];
  sondagens = [];
  modoDaSondagem = "fk_viva";
  semearBanco(3, 2);

  mockLogRuntime.mockClear();
  mockAssertPlanFeature.mockClear().mockResolvedValue(undefined);
  mockGetWhatsAppProvider.mockReset().mockResolvedValue({
    logoutInstance: vi.fn().mockResolvedValue(undefined),
  });

  mockCreateClient.mockReset().mockImplementation((_url: string, key: string) =>
    key === "service-role-key"
      ? { from: (table: string) => builder(table) }
      : {
          auth: {
            getUser: async () => ({
              data: { user: { id: "user-1" } },
              error: null,
            }),
          },
        }
  );

  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("guarda de ordem de deploy — quem entra na limpeza antes do DELETE", () => {
  it("com a FK viva, limpa whatsapp_messages em lotes: sem isso o cascade vira um statement só e estoura o timeout", async () => {
    modoDaSondagem = "fk_viva";
    const handler = await carregarProxyNovo();

    const res = await excluirInstancia(handler);

    expect(res.status).toBe(200);
    expect(valores(db.mensagens, "instance_id")).toEqual([null, null, null]);
  });

  it("com a FK dropada, NÃO toca whatsapp_messages: limpar ali é justamente o bug das órfãs", async () => {
    modoDaSondagem = "fk_dropada";
    const handler = await carregarProxyNovo();

    const res = await excluirInstancia(handler);

    expect(res.status).toBe(200);
    // O `instance_id` sobrevive à instância — é o que mantém a conversa no chat.
    expect(valores(db.mensagens, "instance_id")).toEqual([
      INSTANCE_ID,
      INSTANCE_ID,
      INSTANCE_ID,
    ]);
    expect(
      queries.some((q) => q.table === "whatsapp_messages" && q.op === "update")
    ).toBe(false);
  });

  it("scheduled_user_messages continua sendo limpo nas duas ordens — a FK dele não mudou", async () => {
    for (const modo of ["fk_viva", "fk_dropada"] as const) {
      modoDaSondagem = modo;
      semearBanco(3, 2);
      const handler = await carregarProxyNovo();

      await excluirInstancia(handler);

      expect(
        valores(db.agendadas, "whatsapp_instance_id"),
        `modo ${modo}`
      ).toEqual([null, null]);
    }
  });
});

describe("guarda de ordem de deploy — na dúvida, mantém o nullify", () => {
  it("erro de permissão no catálogo não conta como FK ausente: continua limpando", async () => {
    modoDaSondagem = "permissao_negada";
    const handler = await carregarProxyNovo();

    const res = await excluirInstancia(handler);

    expect(res.status).toBe(200);
    expect(valores(db.mensagens, "instance_id")).toEqual([null, null, null]);
  });

  it("sondagem que nem responde (rede) não aborta a exclusão nem pula a limpeza", async () => {
    modoDaSondagem = "rede_caiu";
    const handler = await carregarProxyNovo();

    const res = await excluirInstancia(handler);

    expect(res.status).toBe(200);
    expect(valores(db.mensagens, "instance_id")).toEqual([null, null, null]);
  });

  it("a dúvida é barulhenta: registra delete_instance_fk_probe_failed, porque unknown permanente depois da migration inverte o sinal", async () => {
    modoDaSondagem = "permissao_negada";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);

    const alertas = mockLogRuntime.mock.calls
      .map((c) => c[0])
      .filter((p) => p.action === "delete_instance_fk_probe_failed");

    expect(alertas).toHaveLength(1);
    expect(alertas[0].status).toBe("error");
  });

  it("o log da dúvida carrega o code, não a mensagem do PostgREST — que pode ecoar conteúdo da linha", async () => {
    modoDaSondagem = "permissao_negada";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);

    const alerta = mockLogRuntime.mock.calls
      .map((c) => c[0])
      .find((p) => p.action === "delete_instance_fk_probe_failed");

    expect(alerta.errorMessage).toContain("42501");
    expect(alerta.errorMessage).not.toContain("5562996115735");
    expect(alerta.errorMessage).not.toContain("permission denied for table");
  });

  it("PostgREST que reporta o relacionamento ausente sem `code` ainda conta como FK dropada", async () => {
    // Se só o `code` fosse aceito, a guarda ficaria presa em 'dúvida' PARA
    // SEMPRE depois da migration — e dúvida significa continuar apagando
    // histórico a cada exclusão.
    modoDaSondagem = "fk_dropada_sem_code";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);

    expect(valores(db.mensagens, "instance_id")).toEqual([
      INSTANCE_ID,
      INSTANCE_ID,
      INSTANCE_ID,
    ]);
  });
});

describe("guarda de ordem de deploy — a sondagem não lê mensagem de ninguém", () => {
  it("qualquer que seja o filtro montado, ele casa com zero linhas da tabela", async () => {
    modoDaSondagem = "fk_viva";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);

    expect(sondagens.length).toBeGreaterThan(0);
    for (const s of sondagens) {
      // O banco falso tem 3 mensagens reais; a sondagem não pode alcançar
      // nenhuma delas — ela pergunta pelo relacionamento, não pelo dado.
      expect(selecionar(s, db.mensagens)).toHaveLength(0);
    }
  });
});

describe("guarda de ordem de deploy — cache por isolate", () => {
  it("duas exclusões seguidas consultam o catálogo UMA vez", async () => {
    modoDaSondagem = "fk_viva";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);
    semearBanco(3, 2);
    await excluirInstancia(handler);

    expect(sondagens).toHaveLength(1);
  });

  it("o cache guarda a decisão, não só a economia: a segunda exclusão se comporta igual à primeira", async () => {
    modoDaSondagem = "fk_dropada";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);
    semearBanco(3, 2);
    // Se a segunda exclusão re-sondasse e o catálogo mentisse, o teste pegaria.
    modoDaSondagem = "fk_viva";
    await excluirInstancia(handler);

    expect(sondagens).toHaveLength(1);
    expect(valores(db.mensagens, "instance_id")).toEqual([
      INSTANCE_ID,
      INSTANCE_ID,
      INSTANCE_ID,
    ]);
  });

  it("sondagem inconclusiva não entra no cache: a exclusão seguinte pergunta de novo", async () => {
    modoDaSondagem = "permissao_negada";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);
    semearBanco(3, 2);
    await excluirInstancia(handler);

    expect(sondagens).toHaveLength(2);
  });
});

describe("guarda de ordem de deploy — TTL assimétrico do cache", () => {
  it("'FK viva' expira: um isolate anterior ao apply enxerga o DROP sem esperar reciclagem", async () => {
    modoDaSondagem = "fk_viva";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);
    expect(sondagens).toHaveLength(1);

    // Dentro da janela: nada de nova pergunta.
    vi.advanceTimersByTime(59_000);
    semearBanco(3, 2);
    await excluirInstancia(handler);
    expect(sondagens).toHaveLength(1);

    // Passada a janela, a migration já aplicada é percebida.
    vi.advanceTimersByTime(2_000);
    semearBanco(3, 2);
    modoDaSondagem = "fk_dropada";
    await excluirInstancia(handler);

    expect(sondagens).toHaveLength(2);
    expect(valores(db.mensagens, "instance_id")).toEqual([
      INSTANCE_ID,
      INSTANCE_ID,
      INSTANCE_ID,
    ]);
  });

  it("'FK dropada' é terminal: horas depois continua sem perguntar e sem limpar", async () => {
    modoDaSondagem = "fk_dropada";
    const handler = await carregarProxyNovo();

    await excluirInstancia(handler);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    semearBanco(3, 2);
    // A FK não volta — recriá-la exigiria validar 2,3M linhas já órfãs.
    await excluirInstancia(handler);

    expect(sondagens).toHaveLength(1);
    expect(valores(db.mensagens, "instance_id")).toEqual([
      INSTANCE_ID,
      INSTANCE_ID,
      INSTANCE_ID,
    ]);
  });
});

describe("guarda de ordem de deploy — o chip grande, que é o caso que dói", () => {
  it("com a FK viva o teto de lotes trava a exclusão em 503; dropada, a mesma instância sai de primeira", async () => {
    // Alamaster carrega ~155k mensagens numa instância só. O teto do teardown
    // é 500 lotes × 200 = 100k linhas por chamada — de propósito: mais que isso
    // ocuparia a conexão indefinidamente (já houve incidente de pool esgotado
    // parando a ingestão por 42 min). Então, ENQUANTO A FK EXISTE, esse chip
    // não é excluível numa tacada: o proxy para honestamente e pede repetição.
    semearBanco(120_000, 1);
    modoDaSondagem = "fk_viva";
    const comFk = await (await carregarProxyNovo())(requisicaoDeExclusao());

    expect(comFk.status).toBe(503);
    expect(db.instanciaApagada).toBe(false);

    // Depois do DROP, o histórico deixa de ser problema da exclusão: nada é
    // varrido, nada é anulado, e a instância morre na primeira tentativa.
    semearBanco(120_000, 1);
    queries = [];
    modoDaSondagem = "fk_dropada";
    const semFk = await (await carregarProxyNovo())(requisicaoDeExclusao());

    expect(semFk.status).toBe(200);
    expect(db.instanciaApagada).toBe(true);
    expect(
      queries.some((q) => q.table === "whatsapp_messages" && q.op === "update")
    ).toBe(false);
  });
});
