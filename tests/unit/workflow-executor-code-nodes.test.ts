/**
 * Os 3 `case` de nó de código do `workflow-executor.ts` (SPEC §8.2):
 * `code_json`, `code_javascript` e `code_https`.
 *
 * Mesmo desenho de `workflow-executor-branches.test.ts`: `baseMock()` +
 * `vi.mock` dos vizinhos do executor no topo. Duas diferenças:
 * `workflow-action-handler.ts` entra com `importOriginal` — só
 * `executeWorkflowAction` é substituído, porque `resolveVariables` precisa
 * rodar de verdade (é ela que aplica o `jsonEscape`, e um dublê aqui provaria
 * apenas que o dublê funciona) —, e `fetch-utils.ts` é dublado inteiro, para o
 * nó HTTPS ser observável sem rede: quem prova o clamp do `timeoutMs` é o
 * TERCEIRO argumento de `fetchWithTimeout`, invisível por um spy em `fetch`.
 *
 * O teste que mais importa é o transversal: `workflow_execution_steps` é
 * legível por QUALQUER membro da org, e o `data` de um nó de código carrega o
 * fonte escrito pelo usuário — no HTTPS, o `Authorization` junto. Nenhum dos 3
 * pode gravar isso em `input_data`: nem no caminho feliz, nem quando o nó
 * falha, nem quando uma exceção inesperada escapa e cai no catch genérico do
 * executor (que grava `node.data` inteiro).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "../../tests/helpers/deno-mock";

vi.mock("../../supabase/functions/_shared/workflow-condition-evaluator.ts", () => ({
  evaluateCondition: vi.fn().mockResolvedValue(true),
  getLeadTags: vi.fn().mockResolvedValue(""),
}));

const mockAction = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, data: {} }));
vi.mock("../../supabase/functions/_shared/workflow-action-handler.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeWorkflowAction: mockAction,
}));

vi.mock("../../supabase/functions/_shared/followupSchedule.ts", () => ({
  getNextSendTime: vi.fn(() => new Date()),
}));

/** O `fetchWithTimeout` do nó HTTPS — `(url, opts, timeoutMs)`. */
const mockFetch = vi.hoisted(() => vi.fn());
vi.mock("../../supabase/functions/_shared/fetch-utils.ts", () => ({
  fetchWithTimeout: mockFetch,
}));

import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
// A REAL — o `vi.mock` acima só troca `executeWorkflowAction`. É ela que prova o que o
// nó de mensagem seguinte renderiza depois de um nó de código falhar.
import { resolveVariables } from "../../supabase/functions/_shared/workflow-action-handler";
import { createMockSupabase } from "../helpers/supabase-mock";

// ─── Fixtures ─────────────────────────────────────────────────────────────

/** Marcador que NUNCA pode aparecer em `workflow_execution_steps.input_data`. */
const SEGREDO = "TOKEN-QUE-NAO-PODE-VAZAR";

interface StepRow {
  node_id: string;
  node_type: string;
  status: string;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error: string | null;
}

const baseMock = (leadName = "Ada Lovelace") => {
  const { sb, mockTable, getInserted } = createMockSupabase();
  mockTable("workflow_execution_steps", []);
  mockTable("workflow_executions", [{ id: "exec-1", status: "processing" }]);
  mockTable("leads", [
    {
      id: "lead-1",
      name: leadName,
      company: "Acme",
      email: "ada@acme.com",
      phone: "5511999999999",
      organization_id: "org-1",
    },
  ]);
  const steps = () => getInserted("workflow_execution_steps") as unknown as StepRow[];
  return { sb, steps, mockTable };
};

/** Corpo fresco a cada chamada — `Response.text()` só pode ser lido uma vez. */
function respondeCom(body: string, status = 200) {
  mockFetch.mockImplementation(() => Promise.resolve(new Response(body, { status })));
}

/** Os argumentos da última chamada de `fetchWithTimeout`. */
function ultimaRequisicao(): { url: URL; opts: RequestInit; timeoutMs: number } {
  const call = mockFetch.mock.calls.at(-1) as [URL, RequestInit, number];
  return { url: call[0], opts: call[1], timeoutMs: call[2] };
}

/**
 * Captura o payload de cada `.update()` em `workflow_executions`.
 *
 * O heartbeat guarda a REFERÊNCIA do `context`, que segue mutando durante a
 * execução — por isso as asserções olham a PRESENÇA da chave, nunca o valor
 * congelado no momento do UPDATE.
 */
function captureExecutionUpdates(sb: { from: (t: string) => Record<string, unknown> }) {
  const payloads: Record<string, unknown>[] = [];
  const originalFrom = sb.from.bind(sb);
  sb.from = (table: string) => {
    const chain = originalFrom(table) as { update: (v: Record<string, unknown>) => unknown };
    if (table === "workflow_executions") {
      const originalUpdate = chain.update.bind(chain);
      chain.update = (vals: Record<string, unknown>) => {
        payloads.push(vals);
        return originalUpdate(vals);
      };
    }
    return chain as Record<string, unknown>;
  };
  /** Só os heartbeats — `updateExecution` não carrega `updated_at`. */
  return () => payloads.filter((p) => "updated_at" in p);
}

type NodeSpec = { id: string; type: string; data: Record<string, unknown> };

function run(
  sb: unknown,
  nodes: NodeSpec[],
  edges: { id: string; source: string; target: string }[],
  context: Record<string, unknown> = {},
) {
  return executeWorkflow({
    supabase: sb as never,
    executionId: "exec-1",
    workflowId: "wf-1",
    organizationId: "org-1",
    leadId: "lead-1",
    definition: { nodes, edges } as never,
    loopLimit: 10,
    context,
  });
}

/** trigger → nó de código → action, para provar se o fluxo seguiu ou parou. */
function chain(codeNode: NodeSpec): {
  nodes: NodeSpec[];
  edges: { id: string; source: string; target: string }[];
} {
  return {
    nodes: [
      { id: "t1", type: "trigger", data: {} },
      codeNode,
      { id: "depois", type: "action", data: { actionType: "add_tag" } },
    ],
    edges: [
      { id: "e1", source: "t1", target: codeNode.id },
      { id: "e2", source: codeNode.id, target: "depois" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAction.mockResolvedValue({ success: true, data: {} });
  respondeCom("ok");
});

// ─── code_json ────────────────────────────────────────────────────────────

describe("executeWorkflow — code_json", () => {
  it("resolve {{nome}}, grava a string compacta e as chaves achatadas", async () => {
    const { sb, steps } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: {
        outputVariable: "payload",
        code: '{"nome":"{{nome}}","total":1234,"itens":[{"sku":"A-1"}]}',
      },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("completed");
    // A string compacta é o que `{{payload}}` interpola no body de um webhook.
    expect(context.payload).toBe('{"nome":"Ada Lovelace","total":1234,"itens":[{"sku":"A-1"}]}');
    // As folhas achatadas são o que faz `{{payload.total}}` funcionar —
    // `resolveVariables` pula valores `typeof === "object"`.
    expect(context["payload.nome"]).toBe("Ada Lovelace");
    expect(context["payload.total"]).toBe(1234);
    expect(context["payload.itens.0.sku"]).toBe("A-1");

    // `output_data` é o que o operador lê na tela de execuções.
    const step = steps().find((s) => s.node_id === "cj1");
    expect(step?.status).toBe("success");
    expect(step?.output_data?.top_keys).toEqual(["nome", "total", "itens"]);
    expect(step?.output_data?.preview).toBe(context.payload);
  });

  it("nome de lead com aspas não quebra o JSON.parse (prova o escape)", async () => {
    const { sb } = baseMock('Pneus "Bom Preço" Ltda');
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: '{"empresa":"{{nome}}"}' },
    });

    const result = await run(sb, nodes, edges, context);

    // Sem o `{ escape: jsonEscape }` a interpolação crua produziria
    // `{"empresa":"Pneus "Bom Preço" Ltda"}` e o parse morreria aqui.
    expect(result.status).toBe("completed");
    expect(JSON.parse(context.payload as string)).toEqual({ empresa: 'Pneus "Bom Preço" Ltda' });
  });

  // ── `$` no valor do lead ────────────────────────────────────────────────
  //
  // Estes três provam que o valor substituído entra LITERAL. `replaceAll(alvo, "texto")`
  // roda GetSubstitution e interpreta `$$`, `$&`, "$`" e `$'` dentro do VALOR — e
  // `jsonEscape` não escapa `$`, então o hook de escape era atravessado por dado real.
  // A defesa é o replacement de FUNÇÃO em `resolveVariables`; sem ele os três falham.

  it("`$'` no nome do lead não quebra a estrutura do JSON", async () => {
    const { sb } = baseMock("cliente disse: 'paguei US$' ontem");
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: '{"obs":"{{nome}}","fixo":"ok"}' },
    });

    const result = await run(sb, nodes, edges, context);

    // Com replacement de string, `$'` vira "tudo depois do match": o `"fixo":"ok"}`
    // era reinjetado no meio do valor e o JSON.parse morria — derrubando a execução
    // inteira, porque o default de `onError` é "fail".
    expect(result.status).toBe("completed");
    expect(JSON.parse(context.payload as string)).toEqual({
      obs: "cliente disse: 'paguei US$' ontem",
      fixo: "ok",
    });
  });

  it("`$$` no nome do lead não perde caractere em silêncio", async () => {
    const { sb } = baseMock("promo $$$ imperdivel");
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: '{"titulo":"{{nome}}"}' },
    });

    const result = await run(sb, nodes, edges, context);

    // `$$` colapsava para `$` — JSON válido, nenhum erro, e o payload que chega
    // na API do cliente sai diferente do que está no CRM.
    expect(result.status).toBe("completed");
    expect(JSON.parse(context.payload as string).titulo).toBe("promo $$$ imperdivel");
  });

  it("`$&` no nome do lead não reinjeta o placeholder cru", async () => {
    const { sb } = baseMock("total $& parcial");
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: '{"titulo":"{{nome}}"}' },
    });

    const result = await run(sb, nodes, edges, context);

    // `$&` é o próprio trecho casado: o valor virava `total {{nome}} parcial`,
    // e o `{{nome}}` literal seguia para o payload.
    expect(result.status).toBe("completed");
    const titulo = JSON.parse(context.payload as string).titulo as string;
    expect(titulo).toBe("total $& parcial");
    expect(titulo).not.toContain("{{");
  });

  it("nome-placeholder de WhatsApp não faz a limpeza de copy reescrever o JSON", async () => {
    // `tidyEmptyVarGaps` come o espaço antes da vírgula e colapsa espaço duplo —
    // certo para mensagem de WhatsApp, errado para um documento JSON, onde
    // reescreveria o texto DENTRO das strings a caminho da API do cliente.
    // O gatilho é o nome-placeholder (`WhatsApp <digitos>`) de lead auto-criado.
    const { sb } = baseMock("WhatsApp 2952");
    const context: Record<string, unknown> = {};
    // `{{nome}}` é essencial: sem uma variável que exija a busca do lead, o primeiro
    // passe resolve tudo e a função sai pelo early-return antes da limpeza — o teste
    // passaria mesmo com o defeito presente.
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: {
        outputVariable: "payload",
        code: '{"obs":"entregar dia 12 , conferir  quantidade","quem":"{{nome}}"}',
      },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("completed");
    expect(JSON.parse(context.payload as string).obs).toBe("entregar dia 12 , conferir  quantidade");
  });

  it("preview não parte par surrogate (o passo precisa caber no jsonb)", async () => {
    const { sb, steps } = baseMock();
    const context: Record<string, unknown> = {};
    // Empurra um emoji para a fronteira do corte em 500: com `slice(0, 500)` o
    // preview terminaria num surrogate alto órfão, o PostgREST mandaria `\ud83d`
    // solto e o Postgres recusaria o INSERT do passo — que `recordStep` não confere.
    // `{"a":"` são 6 chars, então 493 x's colocam o surrogate ALTO exatamente no
    // índice 499 — o último que `slice(0, 500)` mantém.
    const enche = "x".repeat(493);
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: `{"a":"${enche}😀${"y".repeat(60)}"}` },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("completed");
    const preview = steps().find((s) => s.node_id === "cj1")?.output_data?.preview as string;
    // Nenhum surrogate solto: `JSON.stringify` de string mal formada emite `\udXXX`.
    expect(JSON.stringify(preview)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
    expect(preview.length).toBeLessThanOrEqual(500);
  });

  it("JSON malformado com onError fail mata a execução e não segue para o próximo nó", async () => {
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: '{"a": }', onError: "fail" },
    });

    const result = await run(sb, nodes, edges);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("JSON inválido");
    expect(steps().map((s) => s.node_id)).not.toContain("depois");
  });

  it("JSON malformado com onError continue registra o passo e segue o fluxo", async () => {
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: '{"a": }', onError: "continue" },
    });

    const result = await run(sb, nodes, edges);

    expect(result.status).toBe("completed");
    expect(steps().find((s) => s.node_id === "cj1")?.status).toBe("failed");
    expect(steps().map((s) => s.node_id)).toContain("depois");
  });

  it("requiredKeys ausente falha com a chave no texto do erro", async () => {
    const { sb } = baseMock();
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: {
        outputVariable: "payload",
        code: '{"nome":"x"}',
        requiredKeys: ["total", "itens"],
      },
    });

    const result = await run(sb, nodes, edges);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Chave obrigatória ausente no JSON");
    expect(result.error).toContain("total");
  });

  it("resultado que não é objeto nem array falha", async () => {
    const { sb } = baseMock();
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: '"só uma string"' },
    });

    const result = await run(sb, nodes, edges);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("objeto ou array JSON");
  });

  it("código vazio falha antes de tentar parsear", async () => {
    const { sb } = baseMock();
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: "   " },
    });

    const result = await run(sb, nodes, edges);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Nenhum código configurado");
  });

  it("sem outputVariable o nó roda e segue, mas não grava no context", async () => {
    const { sb } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "", code: '{"a":1}' },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("completed");
    expect(Object.keys(context)).toEqual([]);
  });
});

// ─── code_https ───────────────────────────────────────────────────────────

describe("executeWorkflow — code_https", () => {
  it("monta a requisição a partir do JSON e dispara", async () => {
    respondeCom('{"id":"ped-1","itens":[{"sku":"A-1"}]}');
    const { sb, steps } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({
          method: "post", // case-insensitive de propósito
          url: "https://api.cliente.com/pedidos",
          headers: { Authorization: "Bearer tok-123" },
          body: { lead: "{{nome}}" },
          timeoutMs: 10_000,
        }),
      },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("completed");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const { url, opts, timeoutMs } = ultimaRequisicao();
    // `validateExternalUrl` devolve uma URL já parseada — é ela que vai ao fetch.
    expect(String(url)).toBe("https://api.cliente.com/pedidos");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    // Corpo vindo de objeto ganha Content-Type: sem ele a maioria das APIs
    // devolve 415 e o usuário não tem como adivinhar olhando o que escreveu.
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(opts.body).toBe('{"lead":"Ada Lovelace"}');
    expect(timeoutMs).toBe(10_000);

    // A resposta crua vai na variável, e o JSON também achatado — é o que faz
    // `{{resposta.id}}` funcionar num nó posterior.
    expect(context.resposta).toBe('{"id":"ped-1","itens":[{"sku":"A-1"}]}');
    expect(context["resposta.id"]).toBe("ped-1");
    expect(context["resposta.itens.0.sku"]).toBe("A-1");

    const step = steps().find((s) => s.node_id === "ch1");
    expect(step?.status).toBe("success");
    expect(step?.output_data).toEqual({
      status: 200,
      bytes: '{"id":"ped-1","itens":[{"sku":"A-1"}]}'.length,
      preview: '{"id":"ped-1","itens":[{"sku":"A-1"}]}',
    });
  });

  it("http:// é recusado ANTES de qualquer fetch", async () => {
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({
          url: "http://api.cliente.com/pedidos",
          headers: { Authorization: `Bearer ${SEGREDO}` },
        }),
      },
    });

    const result = await run(sb, nodes, edges);

    // Em http:// o header Authorization viajaria em texto claro — o nó nem
    // chega a abrir a conexão.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toContain("só aceita https://");
    expect(steps().find((s) => s.node_id === "ch1")?.status).toBe("failed");
  });

  it("sem `method` a requisição sai GET, com o timeout padrão de 15000 ms", async () => {
    const { sb } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/status" }),
      },
    });

    const result = await run(sb, nodes, edges);

    expect(result.status).toBe("completed");
    const { opts, timeoutMs } = ultimaRequisicao();
    expect(opts.method).toBe("GET");
    expect(timeoutMs).toBe(15_000);
  });

  it("o body é ignorado em GET", async () => {
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({
          method: "GET",
          url: "https://api.cliente.com/status",
          body: { nao: "vai" },
        }),
      },
    });

    await run(sb, nodes, edges);

    expect(ultimaRequisicao().opts.body).toBeUndefined();
    // E o passo diz a verdade sobre isso, para o operador não caçar um corpo
    // que nunca saiu.
    expect(steps().find((s) => s.node_id === "ch1")?.input_data?.has_body).toBe(false);
  });

  it("timeoutMs acima de 30000 é aparado no teto, não recusado", async () => {
    const { sb } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({
          url: "https://api.cliente.com/lento",
          timeoutMs: 120_000,
        }),
      },
    });

    const result = await run(sb, nodes, edges);

    // Aparar e seguir, em vez de reprovar: o teto é do runtime da edge function,
    // não uma opinião sobre o que o usuário quis.
    expect(result.status).toBe("completed");
    expect(ultimaRequisicao().timeoutMs).toBe(30_000);
  });

  it("HTTP 500 com onError continue: passo falho, fluxo segue, variável não gravada", async () => {
    respondeCom("upstream caiu", 500);
    const { sb, steps } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/pedidos" }),
        onError: "continue",
      },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("completed");
    expect(steps().map((s) => s.node_id)).toContain("depois");

    const step = steps().find((s) => s.node_id === "ch1");
    expect(step?.status).toBe("failed");
    expect(step?.error).toBe("HTTP 500");
    expect(step?.output_data).toEqual({ status: 500, bytes: 13, preview: "upstream caiu" });
    // Corpo de erro não é resultado — mas a chave fica VAZIA, não ausente. Ausente,
    // `resolveVariables` não a reconhece e `{{resposta}}` sairia literal na mensagem.
    expect(context.resposta).toBe("");
  });

  it("HTTP 500 com onError fail derruba a execução e grava UM passo só", async () => {
    respondeCom("upstream caiu", 500);
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/pedidos" }),
        onError: "fail",
      },
    });

    const result = await run(sb, nodes, edges);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("HTTP 500");
    expect(steps().map((s) => s.node_id)).not.toContain("depois");
    // O passo com status/preview já foi gravado no ramo do não-2xx; o bloco de
    // erro genérico não pode gravar uma segunda linha por cima.
    expect(steps().filter((s) => s.node_id === "ch1")).toHaveLength(1);
  });

  it("resposta que não é JSON fica só como string na variável", async () => {
    respondeCom("pong");
    const { sb } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/ping" }),
      },
    });

    await run(sb, nodes, edges, context);

    expect(context.resposta).toBe("pong");
    expect(Object.keys(context)).toEqual(["resposta"]);
  });

  it("resposta gigante: variável cortada em 16.000 e preview do passo em 500", async () => {
    const gigante = "x".repeat(20_000);
    respondeCom(gigante);
    const { sb, steps } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/relatorio" }),
      },
    });

    await run(sb, nodes, edges, context);

    // O context viaja no heartbeat a cada nó de cada lead — daí o teto.
    expect((context.resposta as string).length).toBe(16_000);
    expect(context.resposta as string).toMatch(/…$/);

    const step = steps().find((s) => s.node_id === "ch1");
    // `bytes` conta a resposta INTEIRA; o preview é só o que cabe na tela.
    expect(step?.output_data?.bytes).toBe(20_000);
    expect((step?.output_data?.preview as string).length).toBe(500);
    expect(step?.output_data?.preview as string).toMatch(/…$/);
  });

  it("código vazio falha sem abrir conexão", async () => {
    const { sb } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: { outputVariable: "resposta", code: "  " },
    });

    const result = await run(sb, nodes, edges);

    expect(result.error).toBe("Nenhum código configurado");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("URL de destino interno é bloqueada pelo validateExternalUrl", async () => {
    const { sb } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        // Passa no https:// obrigatório, mas é a metadata da nuvem.
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://169.254.169.254/latest/meta-data/" }),
      },
    });

    const result = await run(sb, nodes, edges);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toContain("URL bloqueada");
  });
});

// ─── code_javascript (fase 1 — não executa) ───────────────────────────────

describe("executeWorkflow — code_javascript", () => {
  it("grava o passo como skipped e o fluxo segue", async () => {
    const { sb, steps } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cjs1",
      type: "code_javascript",
      data: { outputVariable: "resultado", code: "return { ok: true }" },
    });

    const result = await run(sb, nodes, edges, context);

    // Fail-open deliberado: um nó salvo mas não executável nunca pode matar um
    // workflow de produção.
    expect(result.status).toBe("completed");
    const step = steps().find((s) => s.node_id === "cjs1");
    expect(step?.status).toBe("skipped");
    expect(step?.error).toBe(
      "Nó JavaScript ainda não executa (fase 1). O fluxo seguiu sem rodar o código.",
    );
    expect(steps().map((s) => s.node_id)).toContain("depois");
    // Nada foi executado, então nada de resultado no context — mas a chave existe
    // VAZIA, não ausente: o fluxo segue, e quem lê `{{resultado}}` embaixo tem de
    // receber vazio em vez do texto cru do placeholder.
    expect(context.resultado).toBe("");
  });

  it("onError fail não muda nada — a fase 1 nunca falha o workflow", async () => {
    const { sb } = baseMock();
    const { nodes, edges } = chain({
      id: "cjs1",
      type: "code_javascript",
      data: { outputVariable: "resultado", code: "", onError: "fail" },
    });

    expect((await run(sb, nodes, edges)).status).toBe("completed");
  });
});

// ─── Transversal: input_data nunca carrega o fonte ────────────────────────

describe("executeWorkflow — nós de código não vazam o fonte no input_data", () => {
  it.each([
    ["code_json", `{"chave":"${SEGREDO}"}`],
    ["code_javascript", `const t = "${SEGREDO}";`],
    [
      "code_https",
      JSON.stringify({
        url: `https://api.cliente.com/pedidos?token=${SEGREDO}`,
        headers: { Authorization: `Bearer ${SEGREDO}` },
      }),
    ],
  ])("%s — caminho feliz", async (type, code) => {
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({ id: "cn1", type, data: { outputVariable: "saida", code } });

    await run(sb, nodes, edges);

    const step = steps().find((s) => s.node_id === "cn1");
    expect(step).toBeDefined();
    // Âncora positiva antes das negativas: um `input_data` nulo passaria calado
    // por todo `not.toContain` abaixo.
    expect(step!.input_data).toHaveProperty("output_variable", "saida");
    // `input_data` é jsonb legível por qualquer membro da org (RLS
    // workflow_execution_steps_select) — o fonte não pode estar lá.
    expect(step!.input_data).not.toHaveProperty("code");
    expect(JSON.stringify(step!.input_data)).not.toContain(SEGREDO);
  });

  it("code_https — nem os headers nem a query string entram no passo", async () => {
    const { sb, steps } = baseMock();
    const code = JSON.stringify({
      method: "POST",
      url: `https://api.cliente.com/pedidos?token=${SEGREDO}&debug=1`,
      headers: { Authorization: `Bearer ${SEGREDO}`, "X-Api-Key": SEGREDO },
      body: { total: 10 },
    });
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: { outputVariable: "saida", code },
    });

    await run(sb, nodes, edges);

    const step = steps().find((s) => s.node_id === "ch1");
    expect(step?.status).toBe("success");
    // Asserção pelo VALOR inteiro, não por chave a chave: é a única forma de o
    // teste falhar quando alguém acrescentar um campo novo ao `input_data`.
    expect(step?.input_data).toEqual({
      method: "POST",
      url_host: "api.cliente.com",
      url_path: "/pedidos",
      has_body: true,
      output_variable: "saida",
      bytes: code.length,
    });
    expect(step!.input_data).not.toHaveProperty("headers");
    expect(step!.input_data).not.toHaveProperty("code");
    const serializado = JSON.stringify(step!.input_data);
    expect(serializado).not.toContain(SEGREDO);
    expect(serializado).not.toContain("token=");
    expect(serializado).not.toContain("Authorization");
  });

  it("code_https — o passo de ERRO tem a mesma forma dura, com os campos nulos", async () => {
    const { sb, steps } = baseMock();
    // `url` faltando: a falha acontece ANTES de haver spec, e é justamente aí
    // que um `input_data` improvisado costuma vazar o fonte inteiro.
    const code = JSON.stringify({ headers: { Authorization: `Bearer ${SEGREDO}` } });
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: { outputVariable: "saida", code, onError: "continue" },
    });

    await run(sb, nodes, edges);

    const step = steps().find((s) => s.node_id === "ch1");
    expect(step?.status).toBe("failed");
    expect(step?.input_data).toEqual({
      method: null,
      url_host: null,
      url_path: null,
      has_body: false,
      output_variable: "saida",
      bytes: code.length,
    });
    expect(JSON.stringify(step!.input_data)).not.toContain(SEGREDO);
  });

  it("code_json — o caminho de ERRO também só grava metadado", async () => {
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({
      id: "cn1",
      type: "code_json",
      data: {
        outputVariable: "saida",
        code: `{ "quebrado": ${SEGREDO} }`,
        onError: "continue",
      },
    });

    await run(sb, nodes, edges);

    const step = steps().find((s) => s.node_id === "cn1");
    expect(step?.status).toBe("failed");
    expect(step!.input_data).not.toHaveProperty("code");
    expect(JSON.stringify(step!.input_data)).not.toContain(SEGREDO);
  });

  it("o input_data seguro do code_json carrega só os 2 metadados", async () => {
    const { sb, steps } = baseMock();
    const code = '{"a":1}';
    const { nodes, edges } = chain({
      id: "cn1",
      type: "code_json",
      data: { outputVariable: "saida", code },
    });

    await run(sb, nodes, edges);

    expect(steps().find((s) => s.node_id === "cn1")?.input_data).toEqual({
      bytes: code.length,
      output_variable: "saida",
    });
  });

  it("um throw inesperado dentro do case não cai no catch genérico (que grava node.data)", async () => {
    const { sb, steps } = baseMock();
    // `requiredKeys` explode ao ser lido, simulando qualquer throw imprevisto
    // dentro do case. Sem o try/catch local, o catch genérico do executor
    // gravaria `node.data` — com o fonte dentro — no `input_data`.
    // Não-enumerável de propósito: só o acesso direto dispara o getter.
    const data: Record<string, unknown> = {
      outputVariable: "saida",
      code: `{"chave":"${SEGREDO}"}`,
      onError: "continue",
    };
    Object.defineProperty(data, "requiredKeys", {
      get() {
        throw new Error("boom inesperado");
      },
    });
    const { nodes, edges } = chain({ id: "cn1", type: "code_json", data });

    const result = await run(sb, nodes, edges);

    expect(result.status).toBe("completed"); // onError: continue
    const step = steps().find((s) => s.node_id === "cn1");
    expect(step?.status).toBe("failed");
    expect(step?.error).toContain("boom inesperado");
    expect(step!.input_data).not.toHaveProperty("code");
    expect(JSON.stringify(step!.input_data)).not.toContain(SEGREDO);
  });

  it("code_https — falha de rede não repete a URL crua na coluna `error`", async () => {
    // A mensagem nativa do Deno embute a URL INTEIRA, query string junto, e ela
    // terminaria em `workflow_execution_steps.error` — legível por qualquer
    // membro da org, igual ao `input_data`.
    const alvo = `https://api.cliente.com/pedidos?token=${SEGREDO}`;
    mockFetch.mockRejectedValue(
      new Error(`error sending request for url (${alvo}): connection refused`),
    );
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "saida",
        code: JSON.stringify({ url: alvo }),
        onError: "continue",
      },
    });

    const result = await run(sb, nodes, edges);

    expect(result.status).toBe("completed");
    const step = steps().find((s) => s.node_id === "ch1");
    expect(step?.status).toBe("failed");
    expect(step?.error).toBe("Falha de rede ao chamar api.cliente.com");
    expect(step?.error).not.toContain(SEGREDO);
    expect(result.error).toBeUndefined();
  });

  it("code_https — o timeout também só cita o host", async () => {
    const alvo = `https://api.cliente.com/pedidos?token=${SEGREDO}`;
    const abort = new Error(`The signal has been aborted: ${alvo}`);
    abort.name = "AbortError";
    mockFetch.mockRejectedValue(abort);
    const { sb, steps } = baseMock();
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "saida",
        code: JSON.stringify({ url: alvo, timeoutMs: 5_000 }),
        onError: "continue",
      },
    });

    await run(sb, nodes, edges);

    const step = steps().find((s) => s.node_id === "ch1");
    expect(step?.error).toBe("A requisição para api.cliente.com não respondeu em 5000 ms");
    expect(step?.error).not.toContain(SEGREDO);
  });
});

// ─── Heartbeat: persistência do context ───────────────────────────────────

describe("executeWorkflow — context no heartbeat", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("o UPDATE por nó inclui o context", async () => {
    const { sb } = baseMock();
    const heartbeats = captureExecutionUpdates(sb);
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "payload", code: '{"a":1}' },
    });

    await run(sb, nodes, edges, context);

    // Sem isto, o valor gravado por um nó só chega ao banco se o workflow
    // pausar num caminho que persiste o context — e o `{{payload}}` de um
    // webhook depois de um delay chegaria literal.
    expect(heartbeats().length).toBeGreaterThan(0);
    for (const hb of heartbeats()) {
      expect(hb).toHaveProperty("context");
    }
    expect(heartbeats()[0].context).toBe(context);
  });

  it("não inclui o context acima de 128 KB, e avisa uma vez só", async () => {
    const { sb } = baseMock();
    const heartbeats = captureExecutionUpdates(sb);
    // Um context inflado viajaria em TODO tick de TODO lead.
    const context: Record<string, unknown> = { gigante: "x".repeat(140_000) };
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/status" }),
      },
    });

    await run(sb, nodes, edges, context);

    expect(heartbeats().length).toBeGreaterThan(1);
    for (const hb of heartbeats()) {
      expect(hb).not.toHaveProperty("context");
      expect(hb).toHaveProperty("current_node_id"); // o heartbeat continua batendo
    }
    const avisos = warnSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("não persistido no heartbeat"),
    );
    expect(avisos).toHaveLength(1);
  });
});

// ─── Saída de nó que não produziu resultado ───────────────────────────────

/**
 * O nó de código falha (ou, no JavaScript, nem executa), o `onError` manda seguir, e
 * um nó de baixo lê a variável de saída dele.
 *
 * A regra "corpo de erro não é resultado" era cumprida NÃO GRAVANDO a variável — e é
 * justamente isso que vazava: `resolveVariables` só substitui chave PRESENTE no
 * context, então a chave ausente atravessava intacta e o lead recebia `{{resposta}}`
 * escrito na mensagem. A chave passa a existir VAZIA.
 */
describe("nós de código — saída de nó que não produziu resultado", () => {
  it("o placeholder do nó de baixo NÃO sai literal na mensagem ao lead", async () => {
    const { sb } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "resposta", code: "{isso não é json", onError: "continue" },
    });

    await run(sb, nodes, edges, context);

    // A prova que interessa é esta: o texto que o nó de mensagem seguinte renderiza.
    // `resolveVariables` aqui é a REAL (o vi.mock preserva via importOriginal).
    const renderizado = await resolveVariables(
      sb as never,
      "lead-1",
      "Olá, seu pedido: {{resposta}}",
      context,
    );

    expect(renderizado).not.toContain("{{resposta}}");
    expect(renderizado).toBe("Olá, seu pedido: ");
  });

  it("code_json com onError continue esvazia a saída em vez de deixá-la ausente", async () => {
    const { sb } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "resposta", code: "{quebrado", onError: "continue" },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("completed");
    expect(context).toHaveProperty("resposta");
    expect(context.resposta).toBe("");
  });

  it("code_https: falha de REDE também esvazia, não só o não-2xx", async () => {
    const { sb } = baseMock();
    mockFetch.mockRejectedValue(new Error("socket hang up"));
    // Saída viva de uma volta anterior do mesmo nó (goto, wait_response).
    const context: Record<string, unknown> = { resposta: '{"pedido":"ped-1"}' };
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/pedidos" }),
        onError: "continue",
      },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("completed");
    // Sem isto, o nó de baixo leria "ped-1" como se fosse a resposta DESTA chamada.
    expect(context.resposta).toBe("");
  });

  it("code_https: o erro varre as folhas achatadas da volta anterior", async () => {
    const { sb } = baseMock();
    const context: Record<string, unknown> = {
      resposta: '{"status":"ok","pedido":"ped-1"}',
      "resposta.status": "ok",
      "resposta.pedido": "ped-1",
      outra: "não é minha, fica",
    };
    respondeCom('{"erro":"indisponível"}', 500);
    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/pedidos" }),
        onError: "continue",
      },
    });

    await run(sb, nodes, edges, context);

    expect(context.resposta).toBe("");
    // Folhas são APAGADAS (não há conjunto para zerar — ver clearCodeOutput).
    expect(context["resposta.status"]).toBeUndefined();
    expect(context["resposta.pedido"]).toBeUndefined();
    // E o varrimento é por prefixo: variável de outro nó não pode ser levada junto.
    expect(context.outra).toBe("não é minha, fica");
  });

  it("com onError fail a saída também é limpa — o heartbeat já persistiu o context", async () => {
    const { sb } = baseMock();
    const context: Record<string, unknown> = { resposta: '{"pedido":"ped-1"}' };
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "resposta", code: "{quebrado", onError: "fail" },
    });

    const result = await run(sb, nodes, edges, context);

    expect(result.status).toBe("failed");
    // A execução para, mas uma retomada parte do context persistido: se a saída velha
    // sobrevivesse ali, ela reapareceria viva depois do erro.
    expect(context.resposta).toBe("");
  });

  it("sem outputVariable não inventa chave nenhuma no context", async () => {
    const { sb } = baseMock();
    const context: Record<string, unknown> = {};
    const { nodes, edges } = chain({
      id: "cj1",
      type: "code_json",
      data: { outputVariable: "", code: "{quebrado", onError: "continue" },
    });

    await run(sb, nodes, edges, context);

    expect(Object.keys(context)).toEqual([]);
  });
});

// ─── {{tag.X}} e saneamento, ponta a ponta ────────────────────────────────

describe("nós de código — variáveis e context", () => {
  it("{{tag.X}} é resolvida: a que o lead tem ecoa o nome, a que não tem sai vazia", async () => {
    // Os painéis novos oferecem os chips de tag (VariableInserter sem filtro), mas o
    // `resolveVariables` destes nós é o gêmeo que NÃO tinha bloco de tag: o literal
    // `{{tag.Ouro}}` chegava à API do cliente com o passo `success` e HTTP 200.
    const { sb, mockTable } = baseMock();
    mockTable("lead_tags", [{ lead_id: "lead-1", tags: { name: "Ouro" } }]);
    respondeCom("{}");

    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({
          method: "POST",
          url: "https://api.cliente.com/pedidos",
          body: { faixa: "{{tag.Ouro}}", ausente: "{{tag.Bronze}}" },
        }),
      },
    });

    await run(sb, nodes, edges, {});

    const body = JSON.parse(String(ultimaRequisicao().opts.body));
    expect(body.faixa).toBe("Ouro");
    expect(body.ausente).toBe("");
  });

  it("U+0000 vindo do corpo da API não entra no context", async () => {
    const { sb } = baseMock();
    const context: Record<string, unknown> = {};
    respondeCom(JSON.stringify({ nota: "a\u0000b" }));

    const { nodes, edges } = chain({
      id: "ch1",
      type: "code_https",
      data: {
        outputVariable: "resposta",
        code: JSON.stringify({ url: "https://api.cliente.com/pedidos" }),
      },
    });

    await run(sb, nodes, edges, context);

    // O Postgres recusa U+0000 dentro de jsonb (22P05). Como nem o heartbeat nem o
    // `recordStep` conferiam o `error` do retorno, o UPDATE falhava calado, `updated_at`
    // congelava e o reclaim re-executava a partir deste nó a cada 10 min — refazendo o
    // POST. Sanear na entrada é o que impede o replay.
    expect(String(context.resposta)).not.toContain("\u0000");
    expect(context["resposta.nota"]).toBe("ab");
  });
});
