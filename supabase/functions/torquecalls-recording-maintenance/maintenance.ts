/**
 * As duas manutenções da gravação: o expurgo de 90 dias e o reenfileiramento da
 * busca que falhou (Gravação S4, #1360 do PRD #1356).
 *
 * A LÓGICA MORA AQUI, E NÃO NO `index.ts`, porque é isto que o teste exerce. O
 * `index.ts` fica com HTTP, autenticação e resposta — coisas que um teste de
 * unidade só conseguiria observar por dublê de servidor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O EXPURGO PRECISA DE UMA EDGE FUNCTION. NÃO É PREFERÊNCIA.
 * ═══════════════════════════════════════════════════════════════════════════
 * `storage.objects` tem o gatilho `protect_objects_delete`, que levanta 42501
 * em QUALQUER DELETE vindo do SQL:
 *
 *     "Direct deletion from storage tables is not allowed. Use the Storage API
 *      instead." / HINT: "This prevents accidental data loss from orphaned
 *      objects."
 *
 * Um cron de SQL puro — a forma do `voip-sweep-stuck-calls` — não conseguiria
 * apagar nem a linha de índice, muito menos os bytes no S3. E apagar só o
 * `recording_url` deixaria o arquivo lá: "90 dias" viraria intenção em vez de
 * fato, com o passivo que a retenção existe para limitar crescendo, invisível.
 *
 * A ORDEM É A DECISÃO: apaga PRIMEIRO, confirma DEPOIS.
 *
 *   1. o banco diz quem venceu (`fn_voip_recording_purge_candidates`)
 *   2. a Storage API apaga o objeto (`remove` — índice E bytes)
 *   3. o banco confirma (`fn_voip_recording_purged`)
 *
 * O passo 3 RECUSA enquanto o objeto ainda estiver em `storage.objects`. Quem
 * pular o passo 2 não consegue esquecer nada — é a barreira que impede esta
 * fatia de degradar para "apagar só a referência", e ela vive no banco de
 * propósito, onde nenhuma reescrita deste arquivo a alcança.
 *
 * Invertida a ordem, o pior caso seria pior: confirmar antes de apagar deixaria
 * o áudio no bucket com o CRM achando que não está mais lá — órfão permanente e
 * invisível, que é exatamente o passivo que a retenção existe para não criar.
 * Do jeito que está, o pior caso é um objeto apagado cuja confirmação falhou: a
 * varredura seguinte encontra a linha ainda `ready`, o `remove` é inofensivo
 * (idempotente), e a confirmação passa.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O REENFILEIRAMENTO NÃO ESTAVA NA ISSUE — VEIO DA REVISÃO DA S2
 * ═══════════════════════════════════════════════════════════════════════════
 * Sem ele, uma busca que falha deixa a linha `failed` e ninguém tenta de novo:
 * cada oscilação de rede vira perda definitiva, e o áudio órfão fica no disco
 * da VPS para sempre (o `sweepPartials` de lá só limpa `.part`). Retenção que
 * promete apagar em 90 dias sobre um acervo que vaza para fora do CRM não é
 * retenção.
 *
 * O teto e o espaçamento moram no BANCO (`fn_voip_recording_retry_claim` e
 * `fn_voip_recording_retry_delay`). Este arquivo só executa o que foi
 * reivindicado. Deixar a política aqui a colocaria fora do alcance da suíte
 * pgTAP, que é onde ela é provada.
 */

import {
  asRecordingStore,
  type FetchLike,
  RECORDING_BUCKET,
  type RecordingFetchArgs,
  type RecordingOutcome,
  runRecordingIngest,
} from "../_shared/voip/recording.ts";
import { logRuntime } from "../_shared/logger.ts";

/**
 * Teto de gravações expurgadas por invocação.
 *
 * Folgado para o estado real (zero gravações hoje) e para o regime permanente
 * (~20 ligações/dia por organização vencem por dia). Existe para o dia do
 * primeiro expurgo, em que 90 dias de acervo vencem de uma vez: um lote sem
 * teto estouraria o relógio da edge function no meio, e um `remove` interrompido
 * deixa objeto apagado sem confirmação — recuperável, mas ruidoso. Com teto, o
 * excedente simplesmente sai na varredura seguinte, cinco minutos depois.
 */
export const MAX_PURGE_PER_RUN = 200;

/** Objetos por chamada de `remove`. A API aceita lista; a rede prefere lotes. */
export const PURGE_BATCH = 50;

/**
 * Teto de buscas reenfileiradas por invocação.
 *
 * Muito menor que o do expurgo, e de propósito: cada uma é um GET na VPS mais um
 * upload no bucket, com 30 s de timeout. Vinte já é mais do que a fila real pode
 * acumular em cinco minutos, e mantém a invocação curta.
 */
export const MAX_RETRY_PER_RUN = 20;

/**
 * O contrato mínimo do cliente Supabase que este módulo usa.
 *
 * Declarado por INTEIRO, e não como `extends RecordingStore` com um `&` no
 * `storage`: a interseção de duas assinaturas de `from` resolve pela primeira,
 * e `remove` desaparecia do tipo. Escrito à mão, e não `SupabaseClient`
 * inteiro, porque é ele que o teste implementa — um dublê tem que ser obrigado
 * a oferecer exatamente o que o código de produção chama, nem mais nem menos.
 *
 * Estruturalmente compatível com `RecordingStore` (S2), que é o que permite
 * passar o mesmo objeto para `runRecordingIngest` sem cast.
 */
export interface MaintenanceStore {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: ArrayBuffer | Uint8Array | Blob,
        opts?: { contentType?: string; upsert?: boolean },
      ): Promise<{ error: { message?: string } | null }>;
      remove(paths: string[]): Promise<{
        data: Array<{ name: string }> | null;
        error: { message?: string } | null;
      }>;
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface PurgeCandidate {
  call_id: string;
  organization_id: string;
  object_path: string;
}

export interface PurgeReport {
  /** Vencidas que o banco apontou nesta passada. */
  candidates: number;
  /** Objetos que a Storage API confirmou ter apagado. */
  objects_removed: number;
  /** Linhas que o banco aceitou marcar como expurgadas. */
  purged: number;
  /**
   * Linhas que o banco RECUSOU marcar. Diferente de zero é anomalia real: a
   * Storage API disse que apagou e o objeto continua no índice.
   */
  refused: number;
  /** Lotes de `remove` que falharam por inteiro. */
  batch_failures: number;
}

export interface RetryReport {
  claimed: number;
  recovered: number;
  failed: number;
}

/**
 * Expurga as gravações vencidas.
 *
 * `dryRun` lista e não apaga. Existe porque a primeira execução em produção
 * apaga áudio que não tem de onde voltar — mesma cautela do
 * `whatsapp-media-retention`, cujo primeiro contato com produção foi um
 * dry-run conferido a olho.
 */
export async function runPurge(
  db: MaintenanceStore,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<PurgeReport> {
  const limit = opts.limit ?? MAX_PURGE_PER_RUN;
  const report: PurgeReport = {
    candidates: 0,
    objects_removed: 0,
    purged: 0,
    refused: 0,
    batch_failures: 0,
  };

  const { data, error } = await db.rpc("fn_voip_recording_purge_candidates", {
    p_limit: limit,
  });
  if (error) {
    console.error("[recording-maintenance] listagem de vencidas falhou:", error.message ?? error);
    await logRuntime({
      module: "voip",
      action: "gravacao_expurgo_listagem_falhou",
      status: "error",
      errorMessage: error.message ?? String(error),
    });
    return report;
  }

  const candidates = (data ?? []) as PurgeCandidate[];
  report.candidates = candidates.length;
  if (candidates.length === 0 || opts.dryRun) return report;

  for (let i = 0; i < candidates.length; i += PURGE_BATCH) {
    const chunk = candidates.slice(i, i + PURGE_BATCH);

    // O QUE APAGA DE VERDADE. `remove` tira a linha de `storage.objects` E os
    // bytes do S3; nenhum caminho de SQL faz isso.
    const { data: removed, error: removeError } = await db.storage
      .from(RECORDING_BUCKET)
      .remove(chunk.map((c) => c.object_path));

    if (removeError) {
      report.batch_failures += 1;
      console.error("[recording-maintenance] remove falhou:", removeError.message ?? removeError);
      await logRuntime({
        module: "voip",
        action: "gravacao_expurgo_remove_falhou",
        status: "error",
        errorMessage: removeError.message ?? String(removeError),
        payloadSnapshot: { lote: chunk.length },
      });
      // Segue para o próximo lote: um lote ruim não pode reter os outros, e a
      // confirmação deste não vai passar de qualquer forma — o banco recusa
      // enquanto o objeto estiver lá.
      continue;
    }

    // `removed` é a lista do que a API confirmou. Quando ela vem vazia — o que
    // acontece quando o objeto já não existia —, a confirmação segue mesmo
    // assim: a barreira do banco é quem decide, e ela olha o índice, não esta
    // resposta. Confiar nesta lista para PULAR a confirmação deixaria linhas
    // `ready` apontando para objetos que já não existem.
    report.objects_removed += (removed ?? []).length;

    for (const c of chunk) {
      const { data: outcome, error: confirmError } = await db.rpc("fn_voip_recording_purged", {
        p_call_id: c.call_id,
      });
      if (confirmError) {
        report.refused += 1;
        console.error(
          "[recording-maintenance] confirmação do expurgo falhou:",
          confirmError.message ?? confirmError,
        );
        continue;
      }
      if (outcome === "purged" || outcome === "already_purged") {
        report.purged += 1;
        continue;
      }
      // `object_still_present` aqui significa que o `remove` respondeu sem erro
      // e o objeto continua no índice. É anomalia de infraestrutura, e é
      // barulhenta de propósito: a alternativa é a retenção parar de funcionar
      // em silêncio.
      report.refused += 1;
      await logRuntime({
        organizationId: c.organization_id,
        module: "voip",
        action: "gravacao_expurgo_recusado",
        status: "error",
        entityType: "voip_call",
        entityId: c.call_id,
        payloadSnapshot: { desfecho: String(outcome), caminho: c.object_path },
      });
    }
  }

  await logRuntime({
    module: "voip",
    action: "gravacao_expurgo",
    status: report.refused > 0 || report.batch_failures > 0 ? "error" : "success",
    payloadSnapshot: { ...report, retencao_dias: 90 },
  });

  return report;
}

interface ClaimedRetry {
  call_id: string;
  tc_call_id: string;
  tc_session_id: string;
  organization_id: string;
  refetch_count: number;
}

/**
 * A busca em si, injetável. O padrão é `runRecordingIngest` — a MESMA busca da
 * tentativa original, sem uma linha nova.
 *
 * A costura existe por uma razão concreta, e não por gosto por injeção: a
 * busca de verdade cunha um token Ed25519, e o único jeito de instalar uma
 * chave de brinquedo é ler `TORQUECALLS_SIGNING_SK` — o que
 * `scripts/test-voip-choke.sh` PROÍBE fora de `_shared/voip/`, de propósito
 * (ADR-0024 §4: a exceção para teste é estreita justamente para que não baste
 * batizar o vazamento de "teste"). Este arquivo é uma edge function, não mora
 * lá, e não vai ganhar exceção.
 *
 * A partição fica limpa: a BUSCA é provada em `_shared/voip/recording.test.ts`,
 * com o assinador de verdade; a FILA é provada aqui, com a busca dublada. Cada
 * unidade na suíte que alcança o que ela faz.
 */
export type RecordingIngest = (
  db: MaintenanceStore,
  args: RecordingFetchArgs,
  deps: { fetch?: FetchLike },
) => Promise<RecordingOutcome>;

/**
 * Reenfileira as buscas que falharam e ainda têm ficha.
 *
 * Quem decide QUEM entra é o banco: o claim já aplicou o espaçamento, o teto de
 * quatro reenfileiramentos e a barreira de 24 horas, e já gastou a ficha na
 * entrada — então um worker que morra a partir daqui não vira laço.
 *
 * O trabalho em si é o `runRecordingIngest` da S2, sem uma linha nova: a
 * retentativa não é um caminho diferente da busca, é a MESMA busca outra vez.
 * Duplicá-la aqui seria duas cópias divergindo em três meses.
 */
export async function runRetryQueue(
  db: MaintenanceStore,
  opts: { dryRun?: boolean; limit?: number } = {},
  deps: { fetch?: FetchLike; ingest?: RecordingIngest } = {},
): Promise<RetryReport> {
  const limit = opts.limit ?? MAX_RETRY_PER_RUN;
  const ingest = deps.ingest ?? runRecordingIngest;
  const report: RetryReport = { claimed: 0, recovered: 0, failed: 0 };

  if (opts.dryRun) {
    // Reivindicar num dry-run gastaria ficha sem tentar nada — o oposto do que
    // um ensaio deve fazer.
    return report;
  }

  const { data, error } = await db.rpc("fn_voip_recording_retry_claim", { p_limit: limit });
  if (error) {
    console.error("[recording-maintenance] reivindicação falhou:", error.message ?? error);
    await logRuntime({
      module: "voip",
      action: "gravacao_refila_claim_falhou",
      status: "error",
      errorMessage: error.message ?? String(error),
    });
    return report;
  }

  const claimed = (data ?? []) as ClaimedRetry[];
  report.claimed = claimed.length;
  if (claimed.length === 0) return report;

  for (const row of claimed) {
    // Os quatro campos vêm da LINHA reivindicada, e a correspondência importa:
    // trocar `call_id` por `tc_call_id` mandaria o GET para a rota errada na
    // VPS e o objeto para debaixo do nome errado no bucket.
    const outcome = await ingest(db, {
      callId: row.call_id,
      tcCallId: row.tc_call_id,
      sessionId: row.tc_session_id,
      organizationId: row.organization_id,
    }, { fetch: deps.fetch });

    if (outcome.ok) {
      report.recovered += 1;
      await logRuntime({
        organizationId: row.organization_id,
        module: "voip",
        action: "gravacao_recuperada_na_refila",
        status: "success",
        entityType: "voip_call",
        entityId: row.call_id,
        payloadSnapshot: { tentativa: row.refetch_count, bytes: outcome.bytes },
      });
    } else {
      // `runRecordingIngest` já registrou a falha no banco e em runtime_logs.
      // Aqui só se conta.
      report.failed += 1;
    }
  }

  return report;
}

/** Adapta o cliente real ao contrato mínimo acima. Ver `asRecordingStore`. */
export function asMaintenanceStore(client: unknown): MaintenanceStore {
  return asRecordingStore(client as never) as MaintenanceStore;
}
