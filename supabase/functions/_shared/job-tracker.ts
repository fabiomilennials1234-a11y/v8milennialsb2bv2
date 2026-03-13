/**
 * Job Tracker — registra execução de jobs na tabela automation_jobs
 *
 * Padrão: startJob() → execute → finishJob() ou failJob()
 * Backoff: retry 1 → +1min, retry 2 → +5min, retry 3 → +15min → dead_letter
 * Nunca lança exceção — falhas de tracking não devem parar a execução.
 */

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SourceEngine = 'pipe_dispatch' | 'copilot' | 'campaign' | 'followup' | 'webhook' | 'workflow';

export interface StartJobParams {
  organizationId: string;
  sourceEngine: SourceEngine;
  entityType: string;
  entityId: string;
  actionType: string;
  sourceTable?: string;
  sourceId?: string;
  payloadSnapshot?: Record<string, unknown>;
  maxRetries?: number;
}

const RETRY_BACKOFF_MINUTES = [1, 5, 15];

/**
 * Registra início de um job. Retorna o job_id para uso posterior.
 * Nunca lança — retorna null se falhar.
 */
export async function startJob(
  supabase: SupabaseClient,
  params: StartJobParams,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("automation_jobs")
      .insert({
        organization_id: params.organizationId,
        source_engine: params.sourceEngine,
        entity_type: params.entityType,
        entity_id: params.entityId,
        action_type: params.actionType,
        source_table: params.sourceTable || null,
        source_id: params.sourceId || null,
        payload_snapshot: params.payloadSnapshot || null,
        max_retries: params.maxRetries ?? 3,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[job-tracker] startJob failed:", error.message);
      return null;
    }

    return data.id;
  } catch (err) {
    console.warn("[job-tracker] startJob exception:", err);
    return null;
  }
}

/**
 * Marca job como sucesso.
 * Nunca lança.
 */
export async function finishJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  try {
    await supabase
      .from("automation_jobs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (err) {
    console.warn("[job-tracker] finishJob exception:", err);
  }
}

/**
 * Marca job como falha. Aplica backoff e incrementa retry_count.
 * Se retry_count >= max_retries → status = 'dead_letter'.
 * Nunca lança.
 */
export async function failJob(
  supabase: SupabaseClient,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  try {
    // Buscar estado atual
    const { data: job, error: fetchErr } = await supabase
      .from("automation_jobs")
      .select("retry_count, max_retries")
      .eq("id", jobId)
      .single();

    if (fetchErr || !job) {
      console.warn("[job-tracker] failJob: could not fetch job:", fetchErr?.message);
      return;
    }

    const nextRetry = (job.retry_count ?? 0) + 1;
    const maxRetries = job.max_retries ?? 3;

    if (nextRetry >= maxRetries) {
      // Dead letter
      await supabase
        .from("automation_jobs")
        .update({
          status: "dead_letter",
          retry_count: nextRetry,
          error_message: errorMessage,
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } else {
      // Retry com backoff
      const backoffMinutes = RETRY_BACKOFF_MINUTES[job.retry_count ?? 0] || 15;
      const nextRetryAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();

      await supabase
        .from("automation_jobs")
        .update({
          status: "retrying",
          retry_count: nextRetry,
          error_message: errorMessage,
          next_retry_at: nextRetryAt,
        })
        .eq("id", jobId);
    }
  } catch (err) {
    console.warn("[job-tracker] failJob exception:", err);
  }
}
