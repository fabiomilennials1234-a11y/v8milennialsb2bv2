/**
 * Ciclo de vida da sessão de conexão NotificaMe.
 *
 * O DANO QUE ESTE ARQUIVO GUARDA é caro e silencioso: o canal criado no
 * NotificaMe é FATURÁVEL e IRREMOVÍVEL. Se a sessão for consumida ANTES de o
 * canal estar vinculado no banco, a primeira tentativa do finish queima a sessão,
 * `/v1/channels` (eventualmente consistente) ainda não mostra o canal recém-
 * nascido, o servidor responde retentável — e a retentativa, com o MESMO
 * `session_id`, não acha mais sessão 'open' e morre em `session_invalid` antes de
 * listar coisa alguma. Desfecho: canal vivo, cobrado, vinculado a ninguém,
 * inalcançável por qualquer tela.
 *
 * Por isso o caso central aqui não olha o valor de retorno: olha o STATUS DA
 * LINHA depois da leitura. Um teste que só conferisse a baseline devolvida
 * passaria verde em cima da implementação defeituosa.
 *
 * O FAKE DE BANCO aplica os filtros de verdade (`eq`/`gt`/`lt`) e devolve as
 * linhas afetadas do UPDATE — é o que permite provar atomicidade (duas
 * consumações, só uma vence) em vez de descrevê-la.
 *
 * O módulo é importado DINAMICAMENTE: se ele sumir ou perder uma export, cada
 * caso falha com o motivo legível em vez de a coleta abortar e o arquivo inteiro
 * contar como zero testes.
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const OTHER_ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

const BASELINE = ["chan-a", "chan-b"];

// ═════════════════════════════════════════════════════════════════════════════
// Fake de banco — filtros reais, linhas afetadas reais
// ═════════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "lt" | "gt"; val: unknown };

class FakeDb {
  tables: Record<string, Row[]> = { notificame_connect_sessions: [] };
  writes: string[] = [];

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  session(): Row {
    const row = this.rows("notificame_connect_sessions")[0];
    if (!row) throw new Error("nenhuma sessão no fake");
    return row;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: "select" | "insert" | "update" = "select";
  private payload: Row = {};
  private filters: Filter[] = [];
  private mode: "many" | "single" | "maybe" = "many";

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) {
    return this;
  }
  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ col, op: "eq", val });
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push({ col, op: "lt", val });
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push({ col, op: "gt", val });
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.col];
      if (f.op === "eq") return v === f.val;
      // Timestamps são ISO-8601 UTC de formato fixo: comparação lexicográfica é
      // a mesma ordem da cronológica.
      if (f.op === "lt") return String(v) < String(f.val);
      return String(v) > String(f.val);
    });
  }

  private exec(): { data: unknown; error: unknown } {
    const rows = this.db.rows(this.table);

    if (this.op === "insert") {
      const row: Row = { id: SESSION_ID, created_at: new Date().toISOString(), ...this.payload };
      rows.push(row);
      this.db.writes.push(`insert:${this.table}`);
      return this.shape([row]);
    }

    if (this.op === "update") {
      const hit = rows.filter((r) => this.matches(r));
      for (const r of hit) Object.assign(r, this.payload);
      this.db.writes.push(`update:${this.table}(${hit.length})`);
      return this.shape(hit);
    }

    return this.shape(rows.filter((r) => this.matches(r)));
  }

  private shape(rows: Row[]): { data: unknown; error: unknown } {
    if (this.mode === "single") {
      if (rows.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: "no/multiple rows" } };
      }
      return { data: rows[0], error: null };
    }
    if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  then<TR1 = { data: unknown; error: unknown }, TR2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((r: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): PromiseLike<TR1 | TR2> {
    // Um tick de microtask entre decisão e resposta — é o que permite intercalar
    // duas execuções e cobrar concorrência de verdade.
    return Promise.resolve()
      .then(() => this.exec())
      .then(onfulfilled ?? undefined, onrejected ?? undefined) as PromiseLike<TR1 | TR2>;
  }
}

// ── import dinâmico do choke ─────────────────────────────────────────────────

const MODULE_PATH = "../../supabase/functions/_shared/notificame-sessions";
let mod: Record<string, unknown> | null = null;
let importError: unknown = null;

beforeAll(async () => {
  try {
    mod = (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch (e) {
    importError = e;
  }
});

function fnOf<T>(name: string): T {
  if (!mod) {
    throw new Error(
      `AUSENTE: _shared/notificame-sessions.ts não pôde ser importado. ` +
        `Causa: ${(importError as Error)?.message ?? importError}`,
    );
  }
  const f = mod[name];
  if (typeof f !== "function") {
    throw new Error(
      `AUSENTE: \`${name}\` não é exportada por _shared/notificame-sessions.ts. ` +
        `Exports encontradas: ${Object.keys(mod).join(", ") || "(nenhuma)"}`,
    );
  }
  return f as T;
}

type OpenFn = (admin: unknown, params: Record<string, unknown>) => Promise<string | null>;
type ReadFn = (
  admin: unknown,
  params: Record<string, unknown>,
) => Promise<{
  state: string;
  baselineChannelIds?: string[];
  /**
   * Fatia 1.1. Declarado AQUI, e não só assertado lá embaixo, porque `OpenFn` e
   * `ReadFn` são tipos LOCAIS e frouxos (`Record<string, unknown>` na entrada):
   * o módulo é importado dinamicamente, e `tests/` nem sequer entra no
   * `tsconfig.json` do app. Nenhum compilador vai reclamar por nós se o campo
   * sumir — só uma asserção de runtime vai.
   */
  requestedChannelType?: string;
}>;
type FinalizeFn = (admin: unknown, params: Record<string, unknown>) => Promise<boolean>;

let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

/** Semeia uma sessão 'open' com prazo folgado, como o start deixaria. */
function seedOpenSession(overrides: Row = {}): void {
  db.rows("notificame_connect_sessions").push({
    id: SESSION_ID,
    organization_id: ORG,
    created_by: USER,
    baseline_channel_ids: [...BASELINE],
    status: "open",
    expires_at: new Date(Date.now() + 7 * 60_000).toISOString(),
    consumed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  });
}

function readParams(overrides: Record<string, unknown> = {}) {
  return { sessionId: SESSION_ID, organizationId: ORG, userId: USER, ...overrides };
}

// ═════════════════════════════════════════════════════════════════════════════

describe("readConnectSession NÃO consome a sessão", () => {
  it("deixa a linha 'open' depois de ler — é o que salva o canal faturável", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession();

    const first = await read(db, readParams());

    expect(first.state).toBe("open");
    expect(first.baselineChannelIds).toEqual(BASELINE);
    // O ponto do arquivo inteiro: o status NÃO mudou.
    expect(db.session().status).toBe("open");
    expect(db.session().consumed_at).toBeNull();
  });

  it("a retentativa do finish reencontra a MESMA foto (o bloqueante original)", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession();

    // Tentativa 1: `/v1/channels` ainda não mostrou o canal → desfecho retentável,
    // nada é vinculado, nada é consumido.
    const attempt1 = await read(db, readParams());
    // Tentativa 2, com o MESMO session_id.
    const attempt2 = await read(db, readParams());
    const attempt3 = await read(db, readParams());

    for (const attempt of [attempt1, attempt2, attempt3]) {
      expect(attempt.state).toBe("open");
      expect(attempt.baselineChannelIds).toEqual(BASELINE);
    }
  });
});

describe("teto de tentativas — prazo armado na primeira leitura", () => {
  it("encurta expires_at do TTL do popup para a janela de retry", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession();
    const ttlDeadline = String(db.session().expires_at);

    await read(db, readParams({ finishWindowMs: 30_000 }));

    const armed = String(db.session().expires_at);
    expect(armed < ttlDeadline).toBe(true);
    expect(Date.parse(armed)).toBeGreaterThan(Date.now());
  });

  it("a janela NÃO desliza: retentativas não estendem o prazo", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession();

    await read(db, readParams({ finishWindowMs: 30_000 }));
    const armed = String(db.session().expires_at);

    await read(db, readParams({ finishWindowMs: 30_000 }));
    await read(db, readParams({ finishWindowMs: 30_000 }));

    expect(String(db.session().expires_at)).toBe(armed);
  });

  it("passado o prazo, a sessão é inválida", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession();

    // Janela zero: o prazo passa a ser "agora" e a leitura seguinte já está fora.
    await read(db, readParams({ finishWindowMs: 0 }));
    const after = await read(db, readParams({ finishWindowMs: 0 }));

    expect(after.state).toBe("invalid");
  });
});

describe("readConnectSession — autorização mora no predicado", () => {
  it("sessão de OUTRA org é inválida", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession();
    expect((await read(db, readParams({ organizationId: OTHER_ORG }))).state).toBe("invalid");
  });

  it("sessão de OUTRO usuário é inválida", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession();
    expect((await read(db, readParams({ userId: OTHER_USER }))).state).toBe("invalid");
  });

  it("session_id que não é uuid morre sem tocar o banco", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession();
    expect((await read(db, readParams({ sessionId: "'; drop--" }))).state).toBe("invalid");
    expect(db.writes).toEqual([]);
  });

  it("sessão já vencida é inválida", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession({ expires_at: new Date(Date.now() - 1_000).toISOString() });
    expect((await read(db, readParams())).state).toBe("invalid");
  });

  it("sessão marcada 'expired' pelo prune é inválida, não 'finished'", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession({ status: "expired" });
    expect((await read(db, readParams())).state).toBe("invalid");
  });
});

describe("finalizeConnectSession — fecha uma vez só", () => {
  it("fecha e devolve a foto para o replay idempotente", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    const finalize = fnOf<FinalizeFn>("finalizeConnectSession");
    seedOpenSession();

    expect(await finalize(db, readParams())).toBe(true);
    expect(db.session().status).toBe("consumed");
    expect(db.session().consumed_at).toBeTruthy();

    // A foto SOBREVIVE ao fechamento: é ela que identifica, no replay, qual canal
    // esta sessão vinculou.
    const replay = await read(db, readParams());
    expect(replay.state).toBe("finished");
    expect(replay.baselineChannelIds).toEqual(BASELINE);
  });

  it("duas execuções concorrentes: só uma fecha", async () => {
    const finalize = fnOf<FinalizeFn>("finalizeConnectSession");
    seedOpenSession();

    const [a, b] = await Promise.all([finalize(db, readParams()), finalize(db, readParams())]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("fecha mesmo com o prazo vencido — o vínculo já aconteceu", async () => {
    const finalize = fnOf<FinalizeFn>("finalizeConnectSession");
    seedOpenSession({ expires_at: new Date(Date.now() - 1_000).toISOString() });

    // Recusar aqui deixaria uma sessão 'open' com foto velha viva para vincular um
    // SEGUNDO canal.
    expect(await finalize(db, readParams())).toBe(true);
    expect(db.session().status).toBe("consumed");
  });

  it("não fecha sessão de outra org nem de outro usuário", async () => {
    const finalize = fnOf<FinalizeFn>("finalizeConnectSession");
    seedOpenSession();

    expect(await finalize(db, readParams({ organizationId: OTHER_ORG }))).toBe(false);
    expect(await finalize(db, readParams({ userId: OTHER_USER }))).toBe(false);
    expect(db.session().status).toBe("open");
  });
});

describe("openConnectSession grava a foto E o tipo pedido", () => {
  it("grava a foto verbatim e devolve o id", async () => {
    const open = fnOf<OpenFn>("openConnectSession");

    const id = await open(db, {
      organizationId: ORG,
      userId: USER,
      baselineChannelIds: BASELINE,
      requestedChannelType: "whatsapp",
    });

    expect(id).toBe(SESSION_ID);
    expect(db.session().baseline_channel_ids).toEqual(BASELINE);
    expect(db.session().status).toBe("open");
  });

  /**
   * O TIPO PEDIDO PRECISA CHEGAR NA COLUNA.
   *
   * É ele — e só ele — que decide, no finish, em QUAL TABELA a linha nasce
   * (`whatsapp_instances` ou `messaging_channels`) e quais candidatos entram no
   * diff. Se ele não for persistido, o finish lê o DEFAULT do banco (`'whatsapp'`)
   * e uma conexão de Instagram termina como um NÚMERO: rótulo "WhatsApp Oficial",
   * visível em treze telas que só sabem falar de número, e comendo uma vaga PAGA
   * de `max_whatsapp_instances`. O canal do outro lado é faturável e irremovível.
   *
   * Este caso é o que faltava: até aqui o arquivo provava a foto e ignorava o
   * tipo, e o defeito acima passaria VERDE.
   */
  it("carimba requested_channel_type='instagram' na linha", async () => {
    const open = fnOf<OpenFn>("openConnectSession");

    await open(db, {
      organizationId: ORG,
      userId: USER,
      baselineChannelIds: BASELINE,
      requestedChannelType: "instagram",
    });

    expect(db.session().requested_channel_type).toBe("instagram");
  });

  // CONTROLE POSITIVO do caso acima: a asserção distingue os dois valores em vez
  // de casar com qualquer coisa que apareça na coluna.
  it("carimba requested_channel_type='whatsapp' quando é esse o pedido", async () => {
    const open = fnOf<OpenFn>("openConnectSession");

    await open(db, {
      organizationId: ORG,
      userId: USER,
      baselineChannelIds: BASELINE,
      requestedChannelType: "whatsapp",
    });

    expect(db.session().requested_channel_type).toBe("whatsapp");
  });
});

describe("o tipo pedido sobrevive à ida e volta pelo banco", () => {
  it("readConnectSession devolve 'instagram' para a sessão que pediu Instagram", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession({ requested_channel_type: "instagram" });

    const state = await read(db, readParams());

    expect(state.state).toBe("open");
    expect(state.requestedChannelType).toBe("instagram");
  });

  /**
   * O REPLAY TAMBÉM PRECISA DO TIPO. A rota idempotente do finish (sessão já
   * consumida) devolve a linha existente ao cliente, e é `channel_kind` que diz
   * ao hook qual queryKey invalidar e qual id ler. Uma sessão 'finished' que
   * perdesse o tipo faria o replay de uma conexão de Instagram responder como se
   * fosse de WhatsApp.
   */
  it("sobrevive à sessão já consumida (rota idempotente)", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession({
      requested_channel_type: "instagram",
      status: "consumed",
      consumed_at: new Date().toISOString(),
    });

    const state = await read(db, readParams());

    expect(state.state).toBe("finished");
    expect(state.requestedChannelType).toBe("instagram");
  });

  /**
   * SESSÕES VIVAS EM PROD, abertas pela fatia 1 ANTES da migration `…093000`:
   * a coluna não existia, então a linha chega aqui sem o campo. Elas são, por
   * definição, de WhatsApp — era o único tipo que existia quando nasceram.
   *
   * Degradar para `null`/`undefined` aqui tiraria o filtro de tipo de uma sessão
   * viva; degradar para 'instagram' as reclassificaria. 'whatsapp' é o único
   * desfecho que não mente, e é o mesmo default que o banco aplica.
   */
  it("linha PRÉ-migration (coluna ausente) lê como 'whatsapp', não como nulo", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    seedOpenSession(); // sem `requested_channel_type` — como as linhas antigas

    const state = await read(db, readParams());

    expect(state.state).toBe("open");
    expect(state.requestedChannelType).toBe("whatsapp");
  });

  it("valor desconhecido na coluna NÃO vira canal social — cai em 'whatsapp'", async () => {
    const read = fnOf<ReadFn>("readConnectSession");
    // O CHECK do banco recusa isto hoje; a asserção guarda o dia em que a
    // allowlist crescer (p.ex. 'facebook') sem que o leitor seja atualizado
    // junto. Fail-closed: o tipo novo não pode ser tratado como Instagram.
    seedOpenSession({ requested_channel_type: "facebook" });

    const state = await read(db, readParams());

    expect(state.requestedChannelType).toBe("whatsapp");
  });
});
