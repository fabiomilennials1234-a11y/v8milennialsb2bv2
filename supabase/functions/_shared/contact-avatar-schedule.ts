/**
 * Ponte do webhook `messages` (Uazapi) para a foto do contato: só registra a
 * URL candidata — zero download no caminho do ack. Fire-and-forget DEPOIS da
 * mensagem persistida: erro aqui nunca muda a resposta do webhook. O cron
 * contact-avatar-sync baixa e grava.
 *
 * Mora em `_shared` (e não dentro do handler) para o teste exercitar o código
 * real: tests/unit/contact-avatar-schedule.test.ts.
 */
import { logRuntime } from "./logger.ts";
import { uazapiChatAvatarCandidate } from "./uazapi-event.ts";
import { registerAvatarCandidate, type AvatarCandidateMemo, type AvatarRpcClient } from "./contact-avatar.ts";

export interface AvatarScheduleInstance {
  id: string;
  organization_id: string;
  provider?: string | null;
}

export function scheduleContactAvatarCandidate(
  supabase: AvatarRpcClient,
  instance: AvatarScheduleInstance,
  payload: Record<string, unknown>,
  memo?: AvatarCandidateMemo,
): void {
  let candidate: ReturnType<typeof uazapiChatAvatarCandidate>;
  try {
    candidate = uazapiChatAvatarCandidate(payload, instance.provider);
  } catch {
    return;
  }
  if (!candidate) return;
  const task = registerAvatarCandidate(supabase, instance.organization_id, instance.id, candidate, memo)
    .catch((err) => {
      // Sem telefone nem URL no log (PII).
      void logRuntime({
        organizationId: instance.organization_id,
        module: "webhook",
        action: "contact_avatar_register_error",
        status: "error",
        payloadSnapshot: {
          instance_id: instance.id,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
        },
      });
    });
  (globalThis as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil?.(task);
}
