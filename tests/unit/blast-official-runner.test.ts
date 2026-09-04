// @vitest-environment node
/**
 * blast-official-runner — o laço do worker do Canal Oficial (#1722).
 *
 * Seam 3 da spec #1719: o que SÓ existe no laço. Módulo puro de decisão já tem
 * teste próprio (`decisao-do-disparo.test.ts`); aqui se prova o que só um laço
 * com remetente e relógio falsos consegue provar:
 *
 *   · a reivindicação não reprocessa quem já saiu (idempotência)
 *   · a retomada continua na próxima pendente
 *   · a mensagem NÃO é gravada duas vezes (critério 6)
 *   · o envio passa pelo choke de dedup, com o `trackSource` que ele conhece
 *   · falha de um destinatário não derruba o tique
 *
 * Dublagem no molde de `quick-blast-run.test.ts` (injeção direta de dependência)
 * e de `notificame-instagram-isolation.test.ts` (cliente que REGISTRA as tabelas
 * tocadas — é o registro que permite assertar AUSÊNCIA de escrita).
 */
import { describe, it, expect, vi } from "vitest";
import { processarTiqueDoDisparo } from "../../supabase/functions/_shared/blast-official-runner.ts";

const AGORA = new Date("2026-08-23T12:00:00.000Z");

const PLANO = {
  id: "plano-1",
  organization_id: "org-1",
  status: "active",
  instance_id: "inst-oficial",
  template: {
    name: "boas_vindas",
    language: "pt_BR",
    components: [],
    previewText: "Olá! Temos novidades.",
    buttonLabels: [],
  },
};

const INSTANCIA = {
  id: "inst-oficial",
  organization_id: "org-1",
  provider: "notificame",
  status: "connected",
};

function linha(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    plan_id: "plano-1",
    lead_id: "lead-1",
    phone: "5511999998888",
    lot_index: 0,
    status: "pending",
    claimed_at: AGORA.toISOString(),
    provider_message_id: null,
    sent_at: null,
    reason: null,
    created_at: "2026-08-23T11:00:00.000Z",
    ...over,
  };
}

/**
 * Cliente dublê indexado por tabela, que ANOTA toda tabela lida ou escrita.
 *
 * O registro não é conveniência: "a mensagem não é gravada duas vezes" só se
 * prova assertando que uma escrita NÃO aconteceu, e ausência não se observa sem
 * um instrumento que registre presença.
 */
function makeAdmin(
  tabelas: Record<string, Record<string, unknown>[]>,
  /**
   * Erros a devolver nos UPDATEs de `blast_plan_recipients`, na ordem — um por
   * tentativa, `null` para "essa passou". Existe porque o caminho de recuperação
   * do 23505 (#1724) SÓ é alcançável com o banco recusando, e um dublê que nunca
   * recusa deixa esse ramo inalcançável: o teste ficaria verde afirmando uma
   * recuperação que nunca rodou.
   */
  errosDeEscrita: ({ code: string; message: string } | null)[] = [],
) {
  const tocadas: string[] = [];
  const escritas: { tabela: string; payload: Record<string, unknown>; id?: unknown }[] = [];
  let tentativa = 0;

  function builder(tabela: string) {
    tocadas.push(tabela);
    let linhas = [...(tabelas[tabela] ?? [])];
    let patch: Record<string, unknown> | null = null;
    let alvo: unknown;

    const api: Record<string, unknown> = {
      select: () => api,
      update(p: Record<string, unknown>) {
        patch = p;
        return api;
      },
      insert(p: Record<string, unknown>) {
        escritas.push({ tabela, payload: p });
        return Promise.resolve({ data: null, error: null });
      },
      upsert(p: Record<string, unknown>) {
        escritas.push({ tabela, payload: p });
        return Promise.resolve({ data: null, error: null });
      },
      eq(col: string, val: unknown) {
        if (patch) alvo = val;
        linhas = linhas.filter((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        linhas = linhas.filter((r) => vals.includes(r[col] as never));
        return api;
      },
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
      then(resolve: (v: unknown) => unknown) {
        if (patch) {
          escritas.push({ tabela, payload: patch, id: alvo });
          patch = null;
          const erro = tabela === "blast_plan_recipients"
            ? (errosDeEscrita[tentativa++] ?? null)
            : null;
          return Promise.resolve({ data: null, error: erro }).then(resolve);
        }
        return Promise.resolve({ data: linhas, error: null }).then(resolve);
      },
    };
    return api;
  }

  const rpc = vi.fn(async (_nome: string, _args: unknown) => ({
    data: tabelas.__claim ?? [],
    error: null,
  }));

  return {
    client: { from: builder, rpc } as never,
    tocadas,
    escritas,
    rpc,
  };
}

function deps(over: Record<string, unknown> = {}) {
  const admin = makeAdmin({
    __claim: [linha()],
    blast_plans: [PLANO],
    whatsapp_instances: [INSTANCIA],
  });
  const enviarTemplate = vi.fn(async () => ({ success: true, messageId: "prov-123" }));
  const esperar = vi.fn(async () => {});
  return {
    admin,
    d: {
      supabaseAdmin: admin.client,
      enviarTemplate,
      esperar,
      agora: () => AGORA,
      ...over,
    },
    enviarTemplate,
    esperar,
  };
}

describe("processarTiqueDoDisparo", () => {
  it("reivindica, envia uma a uma e marca a linha como enviada", async () => {
    const { d, admin, enviarTemplate } = deps();

    const r = await processarTiqueDoDisparo(d as never, { batchSize: 20, perOrgCap: 5, pausaMs: 1000 });

    expect(r.enviados).toBe(1);
    expect(enviarTemplate).toHaveBeenCalledTimes(1);

    // A linha guarda o id da RESPOSTA DO ENVIO — o mesmo valor que o transporte
    // devolveu, e o mesmo que vira `channel_messages.external_id`. NÃO é o
    // `providerMessageId` estável: medido em prod (2026-08-24), os dois nunca
    // coincidem em 747 linhas. Esta asserção é o que impede alguém de "corrigir"
    // o worker para gravar outra coisa sem entender a diferença.
    const marca = admin.escritas.find((e) => e.tabela === "blast_plan_recipients");
    expect(marca?.payload).toMatchObject({
      status: "sent",
      provider_message_id: "prov-123",
      sent_at: AGORA.toISOString(),
    });
    expect(marca?.id).toBe("r1");
  });

  it("NÃO grava a mensagem na conversa — quem grava é o provider, no envio", async () => {
    // CRITÉRIO 6, e o modo de falha clássico: o envio grava, o webhook de
    // retorno grava de novo, e a mesma mensagem aparece duas vezes na thread do
    // vendedor. O provider do canal oficial JÁ escreve a linha dentro do envio
    // (`notificame-provider.ts:1297-1316`), e o handler do nó de Workflow já
    // carrega essa regra em comentário (`enviar-template.ts:103-105`).
    //
    // A prova é por AUSÊNCIA observada: o dublê registra toda tabela tocada.
    const { d, admin } = deps();

    await processarTiqueDoDisparo(d as never, { batchSize: 20, perOrgCap: 5, pausaMs: 0 });

    expect(admin.tocadas).not.toContain("channel_messages");
    expect(admin.tocadas).not.toContain("conversation_messages");
    expect(admin.escritas.map((e) => e.tabela)).not.toContain("channel_messages");
  });

  it("envia com o trackSource que o dedup conhece", async () => {
    // `deriveSendSource` reconhece um vocabulário FECHADO (`send-dedup.ts:65-77`)
    // e um valor fora do mapa faz o dedup ser pulado FAIL-OPEN, com um único log.
    // `mass_send` está no mapa. Inventar um source novo tiraria este caminho do
    // choke em silêncio — e silêncio, aqui, é mensagem repetida e cobrada.
    const { d, enviarTemplate } = deps();

    await processarTiqueDoDisparo(d as never, { batchSize: 20, perOrgCap: 5, pausaMs: 0 });

    expect(enviarTemplate.mock.calls[0][0]).toMatchObject({ trackSource: "mass_send" });
  });

  it("falha do fornecedor marca a linha e não derruba o tique", async () => {
    const { admin } = deps();
    const enviarTemplate = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: "NotificaMe recusou" })
      .mockResolvedValueOnce({ success: true, messageId: "prov-2" });

    const adminDuas = makeAdmin({
      __claim: [linha({ id: "r1" }), linha({ id: "r2", lead_id: "lead-2" })],
      blast_plans: [PLANO],
      whatsapp_instances: [INSTANCIA],
    });

    const r = await processarTiqueDoDisparo(
      {
        supabaseAdmin: adminDuas.client,
        enviarTemplate,
        esperar: async () => {},
        agora: () => AGORA,
      } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    expect(r.enviados).toBe(1);
    expect(r.falhas).toBe(1);

    const marcas = adminDuas.escritas.filter((e) => e.tabela === "blast_plan_recipients");
    expect(marcas.find((m) => m.id === "r1")?.payload).toMatchObject({ status: "failed" });
    expect(marcas.find((m) => m.id === "r2")?.payload).toMatchObject({ status: "sent" });
    void admin;
  });

  it("linha sem reivindicação não é enviada", async () => {
    // A regra composta recusa (`decisao-do-disparo.ts`), e o laço obedece: sem
    // `claimed_at` não há garantia de envio único, e o fornecedor não tem chave
    // de idempotência (ADR-0028 §5).
    const admin = makeAdmin({
      __claim: [linha({ claimed_at: null })],
      blast_plans: [PLANO],
      whatsapp_instances: [INSTANCIA],
    });
    const enviarTemplate = vi.fn(async () => ({ success: true, messageId: "x" }));

    const r = await processarTiqueDoDisparo(
      { supabaseAdmin: admin.client, enviarTemplate, esperar: async () => {}, agora: () => AGORA } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    expect(enviarTemplate).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
  });

  it("ritmo fixo: espera entre um envio e o seguinte", async () => {
    // Fixo e conservador NESTA fatia. O ritmo adaptativo — sobe em entrega
    // limpa, recua em 5xx — é #1728, e depende deste laço existir primeiro.
    const admin = makeAdmin({
      __claim: [linha({ id: "r1" }), linha({ id: "r2" })],
      blast_plans: [PLANO],
      whatsapp_instances: [INSTANCIA],
    });
    const esperar = vi.fn(async () => {});

    await processarTiqueDoDisparo(
      {
        supabaseAdmin: admin.client,
        enviarTemplate: vi.fn(async () => ({ success: true, messageId: "p" })),
        esperar,
        agora: () => AGORA,
      } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 1500 },
    );

    expect(esperar).toHaveBeenCalledWith(1500);
  });

  it("fila vazia: tique sem trabalho não envia nada e não escreve nada", async () => {
    // CONTROLE VAZIO. Sem ele, todo teste acima passaria num laço que nunca
    // entra — verde por ausência.
    const admin = makeAdmin({ __claim: [], blast_plans: [PLANO], whatsapp_instances: [INSTANCIA] });
    const enviarTemplate = vi.fn();

    const r = await processarTiqueDoDisparo(
      { supabaseAdmin: admin.client, enviarTemplate, esperar: async () => {}, agora: () => AGORA } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    expect(r).toMatchObject({ reivindicados: 0, enviados: 0, falhas: 0 });
    expect(enviarTemplate).not.toHaveBeenCalled();
    expect(admin.escritas).toHaveLength(0);
  });
});

// ── Destino pós-envio (o "Destino" do wizard) ───────────────────────────────

describe("post_send_target — mover o lead quando A MENSAGEM DELE sai", () => {
  const PLANO_COM_DESTINO = {
    ...PLANO,
    post_send_target: { funnelKind: "system", pipelineType: "pipe_propostas", stageKey: "enviada" },
  };

  function comDestino(over: Record<string, unknown> = {}) {
    const admin = makeAdmin({
      __claim: [linha()],
      blast_plans: [PLANO_COM_DESTINO],
      whatsapp_instances: [INSTANCIA],
      ...over,
    });
    const aposEnviar = vi.fn(async () => {});
    return { admin, aposEnviar };
  }

  it("move o lead depois de um envio bem-sucedido", async () => {
    // No Chip isso acontece na criação, porque despachar já É enviar. No Canal
    // Oficial o envio é do worker, um a um — então é AQUI que o lead se move, e
    // só depois de a mensagem dele realmente sair.
    const { admin, aposEnviar } = comDestino();

    await processarTiqueDoDisparo(
      {
        supabaseAdmin: admin.client,
        enviarTemplate: vi.fn(async () => ({ success: true, messageId: "prov-1" })),
        esperar: async () => {},
        agora: () => AGORA,
        aposEnviar,
      } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    expect(aposEnviar).toHaveBeenCalledTimes(1);
    expect(aposEnviar.mock.calls[0][0]).toMatchObject({
      orgId: "org-1",
      leadIds: ["lead-1"],
      postSendTarget: PLANO_COM_DESTINO.post_send_target,
    });
  });

  it("NÃO move quando o envio falhou", async () => {
    // Mover um lead cuja mensagem foi recusada afirmaria um envio que não houve —
    // e o funil passaria a mentir sobre onde a pessoa está.
    const { admin, aposEnviar } = comDestino();

    await processarTiqueDoDisparo(
      {
        supabaseAdmin: admin.client,
        enviarTemplate: vi.fn(async () => ({ success: false, error: "recusado" })),
        esperar: async () => {},
        agora: () => AGORA,
        aposEnviar,
      } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    expect(aposEnviar).not.toHaveBeenCalled();
  });

  it("plano sem Destino não chama o movedor", async () => {
    // CONTROLE: o Destino é opcional ("manter onde estão" é o default do wizard).
    const admin = makeAdmin({
      __claim: [linha()],
      blast_plans: [PLANO],
      whatsapp_instances: [INSTANCIA],
    });
    const aposEnviar = vi.fn(async () => {});

    await processarTiqueDoDisparo(
      {
        supabaseAdmin: admin.client,
        enviarTemplate: vi.fn(async () => ({ success: true, messageId: "p" })),
        esperar: async () => {},
        agora: () => AGORA,
        aposEnviar,
      } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    expect(aposEnviar).not.toHaveBeenCalled();
  });

  it("falha do movedor não derruba o tique nem desfaz o envio", async () => {
    // Best-effort, mesma assimetria de `notifyRecipientsSent` no Chip: a mensagem
    // JÁ SAIU. Transformar falha de movimentação em erro faria o tique seguinte
    // reprocessar quem já recebeu — e a duplicata é cobrada.
    const { admin } = comDestino();
    const aposEnviar = vi.fn(async () => {
      throw new Error("funil sumiu");
    });

    const r = await processarTiqueDoDisparo(
      {
        supabaseAdmin: admin.client,
        enviarTemplate: vi.fn(async () => ({ success: true, messageId: "p" })),
        esperar: async () => {},
        agora: () => AGORA,
        aposEnviar,
      } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    expect(r.enviados).toBe(1);
    const marca = admin.escritas.find((e) => e.tabela === "blast_plan_recipients");
    expect(marca?.payload).toMatchObject({ status: "sent" });
  });
});

/**
 * O 23505 — e por que ele é caro.
 *
 * O índice único de `provider_message_id` é GLOBAL: `blast_plan_recipients` não
 * tem `organization_id` (#1721, HANDOFF item B). Se o fornecedor repetir um id
 * entre organizações, o carimbo estoura 23505 — e a mensagem JÁ SAIU.
 *
 * O que acontecia antes: o erro virava log, a linha ficava `pending` com
 * `claimed_at`, e dez minutos depois o stale a devolvia à fila. Ela era
 * REENVIADA. Duplicata cobrada, que é o que o ADR-0028 §5 manda evitar.
 *
 * O que a #1724 faz: fecha a linha como `sent` sem o id. Perde-se a correlação
 * do callback — a linha vira `unconfirmed` no fim do prazo —, e é a troca certa:
 * "uma entrega sem confirmação" custa zero; "uma mensagem paga duas vezes" custa
 * dinheiro e incomoda o cliente.
 *
 * Esta fatia é a que torna a coluna carregável de peso (ela vira a chave do
 * casamento do callback), então é aqui que a conta se paga.
 */
describe("colisão de provider_message_id (23505)", () => {
  it("fecha a linha como enviada SEM o id, em vez de devolvê-la à fila", async () => {
    const admin = makeAdmin(
      {
        __claim: [linha({ id: "r1" })],
        blast_plans: [PLANO],
        whatsapp_instances: [INSTANCIA],
      },
      // 1ª tentativa: o carimbo colide. 2ª: a que sai sem o id.
      [{ code: "23505", message: "duplicate key value violates unique constraint" }],
    );
    const enviarTemplate = vi.fn(async () => ({ success: true, messageId: "prov-colidente" }));
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});

    await processarTiqueDoDisparo(
      { supabaseAdmin: admin.client, enviarTemplate, esperar: async () => {}, agora: () => AGORA } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    const naLinha = admin.escritas.filter((e) => e.tabela === "blast_plan_recipients");
    expect(naLinha).toHaveLength(2);

    // A segunda tentativa mantém o estado e a marca de tempo, e larga só o id.
    expect(naLinha[1].payload).toMatchObject({ status: "sent" });
    expect(naLinha[1].payload).toHaveProperty("sent_at");
    expect(naLinha[1].payload).not.toHaveProperty("provider_message_id");

    // E o operador fica sabendo: silêncio aqui esconderia a colisão que motivou
    // a saída de emergência registrada no HANDOFF-1721.
    expect(console_).toHaveBeenCalledTimes(1);
    expect(String(console_.mock.calls[0][0])).toContain("23505");
    console_.mockRestore();
  });

  it("erro que NÃO é colisão não vira segunda tentativa", async () => {
    // Retentar um deadlock ou um timeout com o mesmo payload não conserta nada e
    // esconde o problema numa segunda linha de log. Só o 23505 tem saída.
    const admin = makeAdmin(
      {
        __claim: [linha({ id: "r1" })],
        blast_plans: [PLANO],
        whatsapp_instances: [INSTANCIA],
      },
      [{ code: "40P01", message: "deadlock detected" }],
    );
    const enviarTemplate = vi.fn(async () => ({ success: true, messageId: "prov-1" }));
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});

    await processarTiqueDoDisparo(
      { supabaseAdmin: admin.client, enviarTemplate, esperar: async () => {}, agora: () => AGORA } as never,
      { batchSize: 20, perOrgCap: 5, pausaMs: 0 },
    );

    expect(admin.escritas.filter((e) => e.tabela === "blast_plan_recipients")).toHaveLength(1);
    expect(console_).toHaveBeenCalledTimes(1);
    console_.mockRestore();
  });
});
