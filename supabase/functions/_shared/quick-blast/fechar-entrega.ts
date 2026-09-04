/**
 * fechar-entrega — o callback de status fecha a linha do destinatário do Disparo
 * e transforma custo previsto em custo realizado (#1724).
 *
 * ── POR QUE ESTE MÓDULO EXISTE ──────────────────────────────────────────────
 * A Meta cobra NA ENTREGA, não no envio (ADR-0029). O worker do Canal Oficial
 * marca `sent`, que quer dizer "aceito pela fila"; sem alguém fechando o ciclo, o
 * produto nunca sabe quem recebeu e o custo realizado nunca existe.
 *
 * ── O CASAMENTO, E POR QUE ELE NÃO É O ÓBVIO ────────────────────────────────
 * `blast_plan_recipients.provider_message_id` guarda o id da RESPOSTA DO ENVIO
 * (`blast-official-runner.ts:288`), que é o `channel_messages.external_id`. O id
 * que volta nos callbacks é OUTRO — o `providerMessageId` estável. Medido em
 * produção em 2026-08-24, 747 linhas de saída com os dois preenchidos:
 * `provider_message_id = external_id` em ZERO delas. Espaços de identificador
 * diferentes: o do envio é UUID, o estável é base64 longo.
 *
 * Logo casar o callback DIRETO contra esta tabela pelo id estável não acha linha
 * nenhuma, nunca — e o modo de falha é SILÊNCIO, não erro.
 *
 * O caminho que funciona é reusar o que o webhook já faz certo: ele resolve o
 * callback até a linha de `channel_messages` por DUAS chaves — `external_id`
 * primeiro, `provider_message_id` como fallback (`notificame-webhook/index.ts:
 * 1140-1163`) —, e de lá o `external_id` casa com o que o worker gravou.
 *
 * ⚠️ `docs/adr/0028…:23` descreve essa ordem AO CONTRÁRIO ("casa pelo
 * provider_message_id, com fallback por external_id"). O código faz o inverso, e
 * tem de fazer: `channel_messages.provider_message_id` nasce NULL, então o
 * PRIMEIRO callback de uma mensagem só pode casar por `external_id` — e é o
 * primeiro que importa para fechar a entrega. Errata registrada, ADR é imutável.
 *
 * ── O GUARDA DE TENANT ──────────────────────────────────────────────────────
 * `blast_plan_recipients` NÃO tem `organization_id` (o tenant vem de
 * `plan_id → blast_plans`) e o índice único de `provider_message_id` é GLOBAL,
 * sem escopo de org (#1721, e o risco está registrado no HANDOFF-1721 item B).
 * Casar só pela coluna deixaria um callback da org A fechar a linha da org B se o
 * fornecedor repetisse id. Por isso a busca leva a org NO JOIN, e a escrita vai
 * por `id`.
 */

import type { OutboundStatus } from "../notificame-inbound.ts";
import { logRuntime } from "../logger.ts";

/** Os seis valores do CHECK (`20270823000000_blast_recipient_delivery_state.sql:46`). */
export type StatusDaLinha =
  | "pending"
  | "sent"
  | "skipped"
  | "failed"
  | "delivered"
  | "unconfirmed";

/**
 * O motivo gravado quando o canal recusa.
 *
 * Sai do vocabulário canônico que a tela já traduz — `invalid_number |
 * instance_disconnected | provider_rejected | provider_error`
 * (`src/modules/campaigns/lib/blast-recipient-view.ts:74-86`), cujo default nunca
 * vaza código cru para a UI.
 *
 * Traduzir os códigos da Meta (131050, 131049, 132015, 132016, 131042) em
 * DECISÕES — suprimir, esperar 24h, interromper o Disparo — é a #1726. O código
 * cru não se perde no meio tempo: o próprio webhook o persiste em
 * `channel_messages.raw_payload.status_event` (`index.ts:1209-1220`).
 */
export const MOTIVO_DE_RECUSA_DO_CANAL = "provider_rejected";

/** O pedaço da linha de que a decisão precisa. Nada além disto é lido. */
export interface LinhaParaFechar {
  status: StatusDaLinha;
  /**
   * `numeric(12,4)`. O PostgREST devolve numeric como STRING para não perder
   * precisão, e é assim que ele é copiado — sem passar por `Number`, que é
   * exatamente onde R$ 0,0350 viraria outra coisa.
   */
  estimated_cost: string | number | null;
}

export type Fechamento =
  | { acao: "ignorar" }
  | { acao: "escrever"; patch: Record<string, unknown> };

/**
 * A regra, pura: dado o estado da linha e o callback, o que escrever.
 *
 * | callback              | linha está           | vira        |
 * |-----------------------|----------------------|-------------|
 * | `delivered` \| `read` | `sent`               | `delivered` |
 * | `failed`              | `sent` \| `delivered` | `failed`   |
 * | qualquer outro par    | —                    | nada        |
 */
export function decidirFechamento(
  linha: LinhaParaFechar,
  callback: { status: OutboundStatus; agora: Date },
): Fechamento {
  // `read` É entrega. Callbacks chegam fora de ordem e se perdem; uma mensagem
  // lida foi entregue por definição, e ignorar o READ deixaria a linha viva até a
  // varredura do TTL a encerrar como `unconfirmed` — afirmando ausência de
  // informação sobre uma mensagem que o cliente leu.
  if (callback.status === "delivered" || callback.status === "read") {
    // Só avança a partir de `sent`. `delivered` de novo é o mesmo envio chegando
    // duas vezes — não recobra. `failed` NÃO volta atrás: a recusa vale sempre.
    if (linha.status !== "sent") return { acao: "ignorar" };
    return {
      acao: "escrever",
      patch: {
        status: "delivered",
        delivered_at: callback.agora.toISOString(),
        // Cópia, não cálculo: a Meta cobra na entrega o preço da categoria
        // vigente no ENVIO, e é esse o valor carimbado na linha. Enquanto
        // ninguém carimba preço (a tabela versionada é #1725), a cópia é
        // null → null — e o realizado fica DESCONHECIDO, não zero. Zero
        // afirmaria "esta entrega foi de graça".
        actual_cost: linha.estimated_cost ?? null,
      },
    };
  }

  if (callback.status === "failed") {
    // Recusa vale mesmo depois de "entregue" — foi a sequência que a Meta
    // produziu de verdade (SENT e, 2s depois, ERROR 131053, em 19/08). É a mesma
    // assimetria que o webhook aplica em `channel_messages`: `failed` fica fora
    // da escala de progressão de propósito.
    if (linha.status !== "sent" && linha.status !== "delivered") {
      return { acao: "ignorar" };
    }
    return {
      acao: "escrever",
      patch: {
        status: "failed",
        reason: MOTIVO_DE_RECUSA_DO_CANAL,
        // O canal está dizendo que NÃO entregou. Manter o custo inflaria um
        // realizado que a fatura não vai mostrar. `delivered_at` fica onde
        // estava: é fato histórico, não afirmação de cobrança.
        actual_cost: null,
      },
    };
  }

  // `sent` — o worker já marcou. Nada a fazer.
  return { acao: "ignorar" };
}

export type VereditoDoFechamento = "fechada" | "sem_linha" | "ignorado" | "erro";

/**
 * O cliente Supabase, DESCRITO em vez de `any`.
 *
 * Este módulo usa exatamente dois encadeamentos e nada mais — descrever os dois
 * custa quinze linhas e devolve estreitamento de tipo em troca, que é o que `any`
 * joga fora. Mesmo padrão de `ClienteAdminDoWorker`
 * (`blast-official-runner.ts:75-122`) e de `GestorAuthFilter`.
 *
 * `extends PromiseLike` no filtro é o que faz `.eq(...).eq(...)` ser encadeável
 * E aguardável ao mesmo tempo — que é como o `update` deste módulo termina.
 */
interface ResultadoDoFechamento {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

interface FiltroDoFechamento extends PromiseLike<ResultadoDoFechamento> {
  eq(coluna: string, valor: unknown): FiltroDoFechamento;
  limit(n: number): PromiseLike<ResultadoDoFechamento>;
}

export interface ClienteDoFechamento {
  from(tabela: string): {
    select(colunas: string): FiltroDoFechamento;
    update(patch: Record<string, unknown>): FiltroDoFechamento;
  };
}

export interface CallbackDeEntrega {
  /** `channel_messages.external_id` da linha que o webhook já resolveu. */
  externalId: string;
  /** A org do path do webhook, já autenticada. É o guarda de tenant. */
  organizationId: string;
  status: OutboundStatus;
  agora: () => Date;
}

/**
 * Fecha a linha do Disparo correspondente a este callback, se houver uma.
 *
 * NUNCA lança. O chamador é o webhook, que tem de responder 200 ao fornecedor de
 * qualquer jeito — exceção aqui viraria retentativa do lado dele e, no limite,
 * assinatura suspensa.
 *
 * `"sem_linha"` é o desfecho COMUM, não o excepcional: quase todo callback de
 * status do produto é de conversa normal, não de Disparo. Por isso ele é
 * silencioso — sem log, sem insert, sem erro (critério 6 da #1724).
 */
export async function fecharLinhaDoDisparo(
  admin: ClienteDoFechamento,
  callback: CallbackDeEntrega,
): Promise<VereditoDoFechamento> {
  // ⚠️ CURTO-CIRCUITO ANTES DA CONSULTA, e ele é de volume, não de elegância.
  //
  // `sent` é o callback MAIS FREQUENTE do canal — chega para toda mensagem que
  // sai, de Disparo ou de conversa — e a tabela de decisão diz que ele nunca faz
  // nada (o worker já marcou a linha). Consultar o banco para descobrir isso
  // seria uma ida por evento, em troca de nada.
  //
  // A regra continua morando num lugar só: `decidirFechamento` também devolve
  // `ignorar` para `sent`, e o teste cobre os dois caminhos. Aqui é só a decisão
  // de não pagar a consulta.
  if (callback.status === "sent") return "ignorado";

  try {
    // O tenant vai NO JOIN, não na fé: ver o bloco "O GUARDA DE TENANT" acima.
    // O status do PLANO deliberadamente NÃO entra — um Disparo já `completed`
    // continua recebendo entregas, e é isso que faz o custo realizado subir
    // depois do fim do envio (critério 4).
    const busca = await admin
      .from("blast_plan_recipients")
      .select("id, status, estimated_cost, blast_plans!inner(organization_id)")
      .eq("provider_message_id", callback.externalId)
      .eq("blast_plans.organization_id", callback.organizationId)
      .limit(1);

    if (busca.error) {
      await registrar(callback, "busca_falhou", busca.error.message);
      return "erro";
    }

    const linha = (busca.data ?? [])[0] as
      | { id: string; status: StatusDaLinha; estimated_cost: string | number | null }
      | undefined;
    if (!linha) return "sem_linha";

    const decisao = decidirFechamento(
      { status: linha.status, estimated_cost: linha.estimated_cost ?? null },
      { status: callback.status, agora: callback.agora() },
    );
    if (decisao.acao === "ignorar") return "ignorado";

    const escrita = await admin
      .from("blast_plan_recipients")
      .update(decisao.patch)
      .eq("id", linha.id);

    if (escrita.error) {
      await registrar(callback, "escrita_falhou", escrita.error.message, linha.id);
      return "erro";
    }

    return "fechada";
  } catch (e) {
    await registrar(
      callback,
      "excecao",
      e instanceof Error ? e.message : String(e),
    );
    return "erro";
  }
}

/**
 * O registro de uma falha do fechamento.
 *
 * `logRuntime` e não `console.error` (`_shared/CLAUDE.md` § "Não fazer"): isto é
 * dinheiro. Uma entrega que não fechou é uma linha da fatura que o produto deixou
 * de contar, e descobrir isso meses depois exige uma consulta, não um `grep` em
 * log de edge function que já rotacionou.
 *
 * Nunca lança — `logRuntime` já é não-fatal por dentro, e o chamador é o webhook,
 * que tem de responder 200 ao fornecedor de qualquer jeito.
 *
 * Sem PII: só ids do fornecedor e da linha. Nenhum telefone, nome ou conteúdo.
 */
async function registrar(
  callback: CallbackDeEntrega,
  acao: string,
  erro: string,
  linhaId?: string,
): Promise<void> {
  await logRuntime({
    organizationId: callback.organizationId,
    module: "campaign",
    action: `blast_entrega_${acao}`,
    status: "error",
    payloadSnapshot: {
      external_id: callback.externalId,
      callback_status: callback.status,
      ...(linhaId ? { recipient_id: linhaId } : {}),
      erro,
    },
  });
}
