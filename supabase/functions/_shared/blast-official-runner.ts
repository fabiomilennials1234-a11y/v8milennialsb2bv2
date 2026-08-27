/**
 * blast-official-runner — o laço do Disparo pelo Canal Oficial (#1722).
 *
 * Um tique: reivindica destinatários pendentes, envia um a um por Template
 * aprovado, e marca cada linha com o que o fornecedor respondeu. É o motor
 * próprio do ADR-0028 — o canal oficial não tem endpoint de lote, e a unidade
 * passa a ser o destinatário em vez de um contador de job.
 *
 * ⚠️ ESTE MÓDULO NÃO GRAVA A MENSAGEM NA CONVERSA.
 *
 * O provider do canal oficial já escreve a própria linha, no mesmo instante do
 * envio (`whatsapp-providers/notificame-provider.ts:1297-1316`, upsert em
 * `channel_messages`). Gravar aqui de novo duplicaria a mensagem na thread do
 * vendedor — e o `external_id` do eco viria diferente, então nem a UNIQUE
 * protegeria. Mesma regra que `action-handlers/enviar-template.ts:103-105`
 * carrega para o nó de Workflow. É critério de aceite, não detalhe.
 *
 * ⚠️ O TRANSPORTE ENTRA POR INJEÇÃO, e o de produção é `sendTemplateViaInstance`
 * (`whatsapp-dispatch.ts:393`), que já traz o choke único: dedup, governor,
 * accounting e espelhamento da mídia de cabeçalho. Trocá-lo por uma chamada
 * direta ao provider sairia de todas essas guardas de uma vez.
 *
 * O relógio e o sono também entram por injeção — é o que torna o laço testável
 * sem esperar em tempo real e sem banco.
 */
import {
  decidirDisparoDoDestinatario,
  regimeDoProvedor,
  type TemplateDoDisparo,
} from "./decisao-do-disparo.ts";

/**
 * O `trackSource` do envio.
 *
 * ⚠️ NÃO TROQUE POR UM VALOR NOVO. `deriveSendSource` reconhece um vocabulário
 * FECHADO (`send-dedup.ts:65-77`); um valor fora do mapa faz o dedup ser pulado
 * FAIL-OPEN, com um único log — o envio sai do choke em silêncio. `mass_send`
 * está no mapa e é o que este Disparo é.
 */
export const TRACK_SOURCE_DO_DISPARO = "mass_send";

/** A linha reivindicada, como o RPC a devolve. */
export interface LinhaDoDisparo {
  id: string;
  plan_id: string;
  lead_id: string | null;
  phone: string | null;
  status: string;
  claimed_at: string | null;
  lot_index: number;
}

/** O Template do plano, já no formato que o transporte espera. */
export interface TemplateDoPlano extends TemplateDoDisparo {
  previewText: string;
  buttonLabels: string[];
}

export interface ResultadoDoEnvio {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * O erro do supabase-js, no recorte que este worker lê.
 *
 * `unknown` seria mais defensivo e é o que estava aqui — mas o worker lê
 * `.message` cru nos dois pontos que tratam erro (o `claim` em
 * `processarTiqueDoDisparo`, e `marcar`), e `unknown` não tem `.message`. Ou o
 * tipo descreve a leitura, ou a leitura precisa de um helper de
 * estreitamento; descrever é o que `gestor-auth.ts:29-32` faz, e é o mínimo
 * honesto: `PostgrestError` é um objeto plano que sempre traz `message`.
 */
interface ErroDaConsulta {
  message: string;
  /**
   * O SQLSTATE, quando o erro vem do Postgres.
   *
   * OPCIONAL de propósito: `PostgrestError` sempre traz `message`, mas `code`
   * some quando o erro nasce no transporte (rede, timeout do PostgREST) em vez
   * do banco. Declará-lo obrigatório seria descrever um objeto que nem sempre
   * chega assim — e a #1724 depende de distinguir 23505 de qualquer outro erro
   * (`marcar()`), então o campo tem de existir no tipo e poder faltar no valor.
   */
  code?: string;
}

/** O resultado terminal de qualquer consulta deste worker. */
interface ResultadoDaConsulta {
  data: unknown[] | null;
  error: ErroDaConsulta | null;
}

/**
 * O encadeamento de filtro que este worker usa, e nada além dele.
 *
 * Ele `extends PromiseLike` de propósito: é o que faz `.update(patch).eq(...)`
 * ser encadeável E aguardável ao mesmo tempo, que é exatamente como `marcar()`
 * o chama. Cada método devolve o próprio filtro, como o builder do postgrest-js
 * faz — mesma forma de `GestorAuthFilter` (`gestor-auth.ts:35-39`).
 */
interface FiltroDoWorker extends PromiseLike<ResultadoDaConsulta> {
  eq(coluna: string, valor: unknown): FiltroDoWorker;
  in(coluna: string, valores: readonly unknown[]): FiltroDoWorker;
}

/**
 * O recorte do cliente Supabase que este worker usa — nada além disto.
 * Tipar o recorte em vez de `any` faz o compilador conferir as chamadas e deixa
 * o dublê do teste ter de implementar exatamente o que a produção usa.
 *
 * ⚠️ PRECISA LISTAR TODA CHAMADA QUE O WORKER FAZ. Nasceu (#1722) descrevendo só
 * `select().in()` e `rpc()`, enquanto o código também chamava `.update().eq()` e
 * lia `error.message` — e o `deno check` reprovou com quatro erros que estavam
 * ali, mudos, desde o começo (#1851). Precisou de um método novo? ESTENDA AQUI.
 * Não volte para `any`: foi o `any` que escondeu os quatro.
 *
 * O portão que prova isto é `deno check _shared/` (`npm run typecheck:edge-shared`),
 * e só ele: `typecheck:ratchet` roda sobre `tsconfig.app.json`, que inclui apenas
 * `src/` e nunca enxergou este arquivo.
 */
export interface ClienteAdminDoWorker {
  from(tabela: string): {
    select(colunas: string): FiltroDoWorker;
    update(patch: Record<string, unknown>): FiltroDoWorker;
  };
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: ErroDaConsulta | null }>;
}

/**
 * Linha de `blast_plans` como o worker a lê — só as colunas do select.
 *
 * `template` é a forma que ESTE módulo consome e repassa ao transporte, então é
 * declarada; `post_send_target` continua `unknown` porque aqui ele é opaco de
 * propósito — quem o entende é o movedor (ver `ContextoDoPlano`). A assimetria é
 * a regra, não descuido: descreva o que você lê, deixe opaco o que só carrega.
 */
interface LinhaDePlano {
  id: string;
  organization_id: string;
  status: string;
  instance_id: string | null;
  template: TemplateDoPlano | null;
  post_send_target: unknown;
}

/** Instância como o worker a usa: opaca, exceto o id que indexa o mapa. */
interface LinhaDeInstancia {
  id: string;
  [coluna: string]: unknown;
}

export interface DepsDoWorker {
  supabaseAdmin: ClienteAdminDoWorker;
  /** Em produção: `sendTemplateViaInstance`, com o choke dentro. */
  enviarTemplate(params: {
    instance: Record<string, unknown>;
    phone: string;
    template: TemplateDoPlano;
    trackSource: string;
    trackId: string;
  }): Promise<ResultadoDoEnvio>;
  esperar(ms: number): Promise<void>;
  agora(): Date;
  /**
   * O "Destino" do wizard: mover o lead quando A MENSAGEM DELE sai.
   *
   * No Chip isso acontece na criação do plano, porque despachar já É enviar. No
   * Canal Oficial quem envia é este laço, um a um — então é aqui, e só depois de
   * a mensagem realmente ter saído. Em produção: `buildPostSendMover`.
   *
   * Best-effort, de propósito: a mensagem já saiu, e transformar falha de
   * movimentação em erro faria o tique seguinte reprocessar quem já recebeu.
   */
  aposEnviar?(params: {
    orgId: string;
    postSendTarget: unknown;
    leadIds: string[];
  }): Promise<void>;
}

export interface ConfigDoTique {
  batchSize: number;
  perOrgCap: number;
  /** Pausa entre envios. FIXA e conservadora — o adaptativo é #1728. */
  pausaMs: number;
}

export interface ResultadoDoTique {
  reivindicados: number;
  enviados: number;
  falhas: number;
  pulados: number;
  recusados: number;
}

export async function processarTiqueDoDisparo(
  deps: DepsDoWorker,
  cfg: ConfigDoTique,
): Promise<ResultadoDoTique> {
  const r: ResultadoDoTique = {
    reivindicados: 0,
    enviados: 0,
    falhas: 0,
    pulados: 0,
    recusados: 0,
  };

  // A reivindicação É a idempotência (ADR-0028 §5): o RPC marca `claimed_at`
  // sob `FOR UPDATE SKIP LOCKED`, então dois tiques nunca pegam a mesma linha.
  const { data: linhas, error } = await deps.supabaseAdmin.rpc(
    "claim_blast_recipients",
    { batch_size: cfg.batchSize, per_org_cap: cfg.perOrgCap },
  );
  if (error) throw new Error(`claim_blast_recipients: ${error.message}`);

  const reivindicadas: LinhaDoDisparo[] = (linhas ?? []) as LinhaDoDisparo[];
  r.reivindicados = reivindicadas.length;
  if (reivindicadas.length === 0) return r;

  const contexto = await carregarContexto(deps, reivindicadas);

  let primeiro = true;
  for (const linha of reivindicadas) {
    const ctx = contexto.get(linha.plan_id);

    const decisao = decidirDisparoDoDestinatario({
      // Sem contexto do plano não há regime a afirmar. `chip` é a resposta
      // fail-closed: faz a regra recusar, e recusar não toca na linha.
      regime: ctx?.regime ?? "chip",
      plano: {
        status: ctx?.plano.status ?? "unknown",
        template: ctx?.plano.template ?? null,
      },
      destinatario: {
        status: linha.status,
        phone: linha.phone,
        claimedAt: linha.claimed_at,
      },
    });

    if (decisao.acao === "recusar") {
      // A linha fica INTACTA — volta no próximo tique. Não é ela que está
      // errada; é o Disparo que não pode partir agora.
      r.recusados += 1;
      continue;
    }

    if (decisao.acao === "pular") {
      await marcar(deps, linha.id, { status: "skipped", reason: decisao.motivo });
      r.pulados += 1;
      continue;
    }

    // Ritmo fixo: a pausa fica ENTRE envios, não antes do primeiro — um tique
    // que manda uma mensagem só não deve pagar espera nenhuma.
    if (!primeiro) await deps.esperar(cfg.pausaMs);
    primeiro = false;

    const envio = await deps.enviarTemplate({
      instance: ctx!.instance,
      phone: linha.phone!,
      template: ctx!.plano.template!,
      trackSource: TRACK_SOURCE_DO_DISPARO,
      trackId: linha.id,
    });

    if (envio.success) {
      await marcar(deps, linha.id, {
        status: "sent",
        sent_at: deps.agora().toISOString(),
        // ⚠️ LEIA ANTES DE USAR ISTO NA #1724.
        //
        // Este é o id da RESPOSTA DO ENVIO, e ele é o `external_id` da linha que
        // o provider grava em `channel_messages`. Ele NÃO é o `providerMessageId`
        // estável que o callback de status carrega.
        //
        // Medido em produção em 2026-08-24, 747 linhas de saída com os dois ids
        // preenchidos: `provider_message_id = external_id` em ZERO delas. São
        // espaços de identificador diferentes — o do envio é UUID
        // (`610d05f8-2efd-…`), o estável é base64 longo (`dGg3ZzQwYnh3…`),
        // 747/747 de cada lado.
        //
        // Consequência: casar o callback DIRETO contra esta coluna pelo id
        // estável não acha nada, nunca. O caminho que funciona é o que o webhook
        // já faz certo — ele resolve o callback até a linha de `channel_messages`
        // por DUAS chaves (`notificame-webhook/index.ts:1139-1174`); de lá,
        // `external_id` casa com este valor. Reusar aquele casamento é melhor do
        // que duplicar a dança de duas chaves numa segunda tabela.
        //
        // O que esta coluna É, e continua sendo: a chave de idempotência do
        // envio. A UNIQUE parcial do #1721 impede a mesma resposta de fechar
        // duas linhas, e para isso o UUID serve tão bem quanto o base64.
        provider_message_id: envio.messageId ?? null,
        reason: null,
      });
      await moverAposEnvio(deps, ctx!, linha.lead_id);
      r.enviados += 1;
    } else {
      // Falha de UM destinatário não derruba o tique: a fila é por pessoa
      // justamente para que o defeito de uma não vire o silêncio de todas.
      await marcar(deps, linha.id, {
        status: "failed",
        reason: envio.error ?? "Falha no envio, sem motivo do fornecedor.",
      });
      r.falhas += 1;
    }
  }

  return r;
}

interface ContextoDoPlano {
  plano: { status: string; template: TemplateDoPlano | null };
  instance: Record<string, unknown>;
  regime: "chip" | "oficial";
  orgId: string;
  /** `blast_plans.post_send_target` — opaco aqui; quem o entende é o movedor. */
  postSendTarget: unknown;
}

/**
 * Carrega plano e instância das linhas reivindicadas, em DUAS consultas — não
 * uma por destinatário. Um tique com 20 linhas de um plano só faria 40 idas ao
 * banco para reler a mesma coisa.
 */
async function carregarContexto(
  deps: DepsDoWorker,
  linhas: LinhaDoDisparo[],
): Promise<Map<string, ContextoDoPlano>> {
  const planIds = [...new Set(linhas.map((l) => l.plan_id))];

  const { data: planos } = await deps.supabaseAdmin
    .from("blast_plans")
    .select("id, organization_id, status, instance_id, template, post_send_target")
    .in("id", planIds);

  const instanceIds = [
    ...new Set(((planos ?? []) as LinhaDePlano[]).map((p) => p.instance_id).filter(Boolean)),
  ];

  const { data: instancias } = await deps.supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .in("id", instanceIds);

  const porInstancia = new Map(
    ((instancias ?? []) as LinhaDeInstancia[]).map((i) => [i.id, i]),
  );

  const mapa = new Map<string, ContextoDoPlano>();
  for (const p of (planos ?? []) as LinhaDePlano[]) {
    // `instance_id` é anulável na tabela, e o mapa é chaveado pela PK de
    // `whatsapp_instances` (nunca nula) — então `get(null)` já devolvia
    // `undefined` e caía no `continue` abaixo. A guarda só diz isso ao
    // compilador; o efeito em runtime é o mesmo.
    const instance = p.instance_id ? porInstancia.get(p.instance_id) : undefined;
    if (!instance) continue;
    mapa.set(p.id, {
      plano: { status: p.status, template: p.template ?? null },
      instance,
      // O regime vem da FONTE ÚNICA do servidor. Comparar o provedor à mão aqui
      // criaria uma terceira cópia da regra — e ela ficaria FORA do teste gêmeo,
      // que é justamente o que impede front e servidor de divergirem.
      regime: regimeDoProvedor(instance.provider as string | null) ?? "chip",
      orgId: p.organization_id,
      postSendTarget: p.post_send_target ?? null,
    });
  }
  return mapa;
}

/**
 * Move o lead para o Destino do plano, depois de a mensagem DELE ter saído.
 *
 * Best-effort e nunca lança: mesma assimetria de `notifyRecipientsSent` no
 * caminho do Chip. A mensagem já saiu; um funil que não aceitou a movimentação é
 * ruído no log, não motivo para reenviar.
 */
async function moverAposEnvio(
  deps: DepsDoWorker,
  ctx: ContextoDoPlano,
  leadId: string | null,
): Promise<void> {
  if (!deps.aposEnviar || !ctx.postSendTarget || !leadId) return;
  try {
    await deps.aposEnviar({
      orgId: ctx.orgId,
      postSendTarget: ctx.postSendTarget,
      leadIds: [leadId],
    });
  } catch (e) {
    console.warn(
      `[blast-official] destino pós-envio falhou para lead=${leadId} (best-effort, ignorado): ${(e as Error)?.message ?? e}`,
    );
  }
}

async function marcar(
  deps: DepsDoWorker,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await deps.supabaseAdmin
    .from("blast_plan_recipients")
    .update(patch)
    .eq("id", id);
  if (!error) return;

  // ─── A COLISÃO DE `provider_message_id` (23505) ─────────────────────────
  //
  // O índice único dessa coluna é GLOBAL: a tabela não tem `organization_id` (o
  // tenant vem de `plan_id → blast_plans`), então o precedente de
  // `channel_messages` — chave `(organization_id, provider_message_id)` — não é
  // copiável aqui. O risco está registrado no #1721 (HANDOFF item B).
  //
  // Se o fornecedor repetir um id entre organizações, este UPDATE estoura 23505
  // com a mensagem JÁ ENVIADA. Sem tratamento, a linha fica `pending` com
  // `claimed_at`, o stale de 10 minutos a devolve à fila, e ela é REENVIADA:
  // duplicata cobrada, que é exatamente o que o ADR-0028 §5 manda evitar.
  //
  // A saída é largar o id e fechar a linha assim mesmo. Perde-se a correlação do
  // callback — a linha termina como `unconfirmed` no fim do prazo (#1724) —, e a
  // troca é claramente favorável: "uma entrega sem confirmação" custa zero;
  // "uma mensagem paga duas vezes" custa dinheiro e incomoda o cliente.
  //
  // Só o 23505. Retentar deadlock ou timeout com o mesmo payload não conserta
  // nada e esconderia o problema numa segunda linha de log.
  const ehColisao = error.code === "23505" ||
    (error.message ?? "").includes("23505");

  if (ehColisao && "provider_message_id" in patch) {
    const { provider_message_id: colidente, ...semOId } = patch;
    const segunda = await deps.supabaseAdmin
      .from("blast_plan_recipients")
      .update(semOId)
      .eq("id", id);

    if (!segunda.error) {
      // UM log, e ele nomeia a saída de emergência: se isto aparecer em
      // produção, a resposta é acrescentar `organization_id` à tabela e
      // reescopar o índice — NÃO remover a unicidade, que é o que torna a
      // idempotência real (HANDOFF-1721, "saída de emergência").
      console.error(
        `[blast-official] provider_message_id colidente (23505): linha fechada ` +
          `como enviada SEM o id — a entrega não terá confirmação. id=${id} ` +
          `valor=${String(colidente)}`,
      );
      return;
    }

    console.error(
      `[blast-official] envio feito, colisão 23505 E a segunda tentativa falhou: ` +
        `id=${id} err=${segunda.error.message}`,
    );
    return;
  }

  // A mensagem JÁ SAIU. Transformar falha de banco em exceção faria o tique
  // seguinte reprocessar quem já recebeu — e a duplicata é cobrada. Barulho
  // no log, e a linha fica reivindicada até o stale de 10 minutos.
  console.error(
    `[blast-official] envio feito mas linha NÃO marcada: id=${id} err=${error.message}`,
  );
}
