/**
 * Usage analytics — rastreia ações do usuário para identificar
 * organizações ativas, módulos mais usados e risco de churn.
 *
 * Nunca lança exceção — falhas são silenciadas para não quebrar o fluxo.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type EventType =
  | "lead_created"
  | "lead_updated"
  | "card_moved"
  | "card_created"
  | "message_sent"
  | "automation_triggered"
  | "campaign_started"
  | "followup_created"
  | "import_started"
  | "import_completed"
  | "module_visited"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "lead_modal_version_rendered"
  | "lead_action_telemetry"
  // Régua de espera (CX ①) — gravados em lote por `src/core/perf/medicao.ts`,
  // que é o único dono da metadata desses dois (lista fechada, sem PII).
  | "perf_util"
  | "web_vital";

interface TrackParams {
  event: EventType;
  organizationId: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Registra um evento de uso na tabela usage_events.
 * Fire-and-forget: nunca bloqueia e nunca lança exceção.
 */
export function track(params: TrackParams): void {
  trackAsync(params).catch(() => {});
}

async function trackAsync(params: TrackParams): Promise<void> {
  try {
    if (!params.organizationId) return;
    // Sessão em cache, não `getUser()`: este caminho roda a cada evento e o
    // `getUser()` é uma ida a `/auth/v1/user` por chamada (274–395/h por
    // usuário em prod, 2026-10-05). O `user_id` aqui é só atribuição — quem
    // garante que ele é o do chamador é a RLS do INSERT, com o JWT da própria
    // requisição; validar o token no servidor antes não acrescenta nada.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    await supabase.from("usage_events").insert({
      organization_id: params.organizationId,
      user_id: user.id,
      event_type: params.event,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // Silencia — analytics nunca deve quebrar o fluxo do usuário
  }
}

/** Evento de um lote: sem entidade — `entity_type`/`entity_id` vão nulos. */
export interface EventoDeUso {
  event: EventType;
  organizationId: string;
  metadata: Record<string, unknown>;
}

/**
 * Sessão em memória para o lote de saída. No `pagehide` não há tempo para
 * `await getSession()`: o navegador congela/descarta a página e a promessa
 * nunca resolve — o lote se perdia ao fechar a aba. Guardamos o token aqui,
 * atualizado pelo próprio cliente (login, refresh, logout), e o envio de
 * saída é síncrono até o `fetch`.
 */
let sessaoEmMemoria: { token: string; userId: string } | null = null;
let acompanhandoSessao = false;

function guardarSessao(session: { access_token?: string; user?: { id?: string } } | null | undefined) {
  sessaoEmMemoria = session?.access_token && session.user?.id
    ? { token: session.access_token, userId: session.user.id }
    : null;
}

/** Começa a acompanhar a sessão (idempotente). Chamado por quem usa `trackLote` com `saindo`. */
export function acompanharSessaoParaLote(): void {
  if (acompanhandoSessao) return;
  acompanhandoSessao = true;
  try {
    supabase.auth.getSession().then(({ data }) => guardarSessao(data.session), () => {});
    supabase.auth.onAuthStateChange((_evento, session) => guardarSessao(session));
  } catch {
    // Analytics nunca quebra o fluxo.
  }
}

/** Só testes. */
export function __resetarSessaoDoLoteParaTestes(): void {
  sessaoEmMemoria = null;
  acompanhandoSessao = false;
}

function linhasDoLote(validos: readonly EventoDeUso[], userId: string) {
  return validos.map((e) => ({
    organization_id: e.organizationId,
    user_id: userId,
    event_type: e.event,
    entity_type: null,
    entity_id: null,
    // Metadata montada pela medição só com primitivos (string/number).
    metadata: e.metadata as Json,
  }));
}

/**
 * Grava vários eventos numa ida só (um INSERT de várias linhas). Mesmo
 * contrato do `track`: fire-and-forget, nunca lança. Usado pela medição de
 * espera, que acumula em memória e descarrega quando a aba esconde.
 *
 * `saindo` (aba escondendo / `pagehide`): o INSERT vai por `fetch` com
 * `keepalive` — sobrevive ao fechamento da aba — com o token em memória,
 * sem nenhum `await` antes. É o MESMO INSERT do PostgREST, com o JWT do
 * usuário: a RLS de `usage_events` e a lista fechada de metadata (montada
 * em `medicao.ts`) valem igual. Sem sessão em memória, cai no caminho normal.
 */
export function trackLote(eventos: readonly EventoDeUso[], opcoes?: { saindo?: boolean }): void {
  if (opcoes?.saindo && enviarLoteAoSair(eventos)) return;
  trackLoteAsync(eventos).catch(() => {});
}

/** `true` se o lote saiu (ou não havia o que mandar) pelo caminho de saída. */
function enviarLoteAoSair(eventos: readonly EventoDeUso[]): boolean {
  try {
    const sessao = sessaoEmMemoria;
    const URL_DO_BANCO = import.meta.env.VITE_SUPABASE_URL ?? "";
    const CHAVE_PUBLICA = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
    if (!sessao || !URL_DO_BANCO || !CHAVE_PUBLICA || typeof fetch !== "function") return false;
    const validos = eventos.filter((e) => !!e.organizationId);
    if (validos.length === 0) return true;
    void fetch(`${URL_DO_BANCO}/rest/v1/usage_events`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: CHAVE_PUBLICA,
        Authorization: `Bearer ${sessao.token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(linhasDoLote(validos, sessao.userId)),
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function trackLoteAsync(eventos: readonly EventoDeUso[]): Promise<void> {
  try {
    const validos = eventos.filter((e) => !!e.organizationId);
    if (validos.length === 0) return;
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    await supabase.from("usage_events").insert(linhasDoLote(validos, user.id));
  } catch {
    // Silencia — analytics nunca deve quebrar o fluxo do usuário
  }
}

/**
 * Hook helper para track de module_visited no useEffect de mount.
 * Uso: useTrackModuleVisit("leads", organizationId)
 */
export function trackModuleVisit(module: string, organizationId: string | null): void {
  if (!organizationId) return;
  track({
    event: "module_visited",
    organizationId,
    metadata: { module },
  });
}
