/**
 * realtimeTransportPlan — qual transporte cada tabela usa NESTA org, para
 * ESTE usuário: `postgres_changes` (padrão) ou Broadcast privado.
 *
 * Fonte única: RPC `realtime_subscription_plan(org)` (migration
 * 20271128000000). Ela diz `broadcast` só quando a org ligou a flag E o
 * usuário pode entrar no tópico (membro ativo, fora do modo estrito de dono) —
 * o cliente nunca tenta um join que o servidor recusaria.
 *
 * Store de módulo (não React Query): o transporte vive abaixo de qualquer
 * QueryClientProvider e é lido por hooks que os testes montam sem provider.
 *   - 1ª leitura de uma org dispara a busca; enquanto ela não volta, tabela
 *     com broadcast possível fica PENDENTE (o canal espera, até 3 s) — abrir
 *     no postgres_changes e trocar logo depois custaria dois joins por aba.
 *   - Falha, timeout ou cliente sem `rpc` (dublê de teste) → postgres_changes.
 *   - `RealtimeOrgProvider` busca assim que a org resolve e relê a cada 5 min
 *     (kill switch: desligar a flag devolve todos ao postgres_changes em ≤5 min).
 *   - `VITE_REALTIME_BROADCAST=off` desliga tudo no cliente, sem rede.
 */
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BROADCAST_TABLES, broadcastSupports, broadcastTopic, parseEqFilter } from "./broadcastTransport";

export type RealtimeTransport = "pg_changes" | "broadcast";
type Plan = Readonly<Record<string, RealtimeTransport>>;

interface PlanEntry {
  readonly status: "loading" | "ready";
  readonly plan: Plan;
}

export const PLAN_TTL_MS = 5 * 60_000;
export const PLAN_TIMEOUT_MS = 3_000;
const EMPTY: Plan = Object.freeze({});

const entries = new Map<string, PlanEntry>();
const fetchedAt = new Map<string, number>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function disabledByEnv(): boolean {
  return import.meta.env.VITE_REALTIME_BROADCAST === "off";
}

function emit() {
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function parsePlan(data: unknown): Plan {
  if (!data || typeof data !== "object") return EMPTY;
  const out: Record<string, RealtimeTransport> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v === "broadcast" || v === "pg_changes") out[k] = v;
  }
  return out;
}

function samePlan(a: Plan, b: Plan): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** Grava o plano; avisa os ouvintes só se algo visível mudou. */
function settle(org: string, plan: Plan, notify: boolean) {
  const prev = entries.get(org);
  const changed = !prev || prev.status !== "ready" || !samePlan(prev.plan, plan);
  // Mesmo conteúdo = mesmo objeto: o snapshot do useSyncExternalStore não muda.
  if (changed) entries.set(org, { status: "ready", plan });
  if (notify && changed) emit();
}

/**
 * Busca (ou rebusca) o plano. Erro mantém o plano anterior (sem flapping);
 * sem anterior, postgres_changes. `notify=false` só no caminho síncrono de
 * dentro do getSnapshot (avisar ali re-renderizaria durante o render).
 */
function load(org: string, notify: boolean): void {
  if (inFlight.has(org)) return;
  const prev = entries.get(org);
  const fallback = prev?.plan ?? EMPTY;
  if (!prev) entries.set(org, { status: "loading", plan: fallback });
  fetchedAt.set(org, Date.now());

  let call: PromiseLike<{ data: unknown; error: unknown }>;
  try {
    call = supabase.rpc("realtime_subscription_plan" as never, { p_organization_id: org } as never) as never;
  } catch {
    settle(org, fallback, notify);
    return;
  }
  inFlight.add(org);
  const timer = setTimeout(() => {
    // Lento demais: segue no postgres_changes; se a resposta chegar depois,
    // ela ainda vale (troca de transporte uma vez).
    if (entries.get(org)?.status === "loading") settle(org, fallback, true);
  }, PLAN_TIMEOUT_MS);
  Promise.resolve(call)
    .then(
      (res) => (res && !res.error ? parsePlan(res.data) : fallback),
      () => fallback,
    )
    .then((plan) => {
      clearTimeout(timer);
      inFlight.delete(org);
      settle(org, plan, true);
    });
}

function read(org: string): PlanEntry {
  const e = entries.get(org);
  if (e) return e;
  load(org, false);
  return entries.get(org)!;
}

/** Plano é por usuário: logout descarta tudo (o próximo login rebusca). */
let authWatch = false;
function watchAuth() {
  if (authWatch) return;
  const auth = (supabase as unknown as { auth?: { onAuthStateChange?: (cb: (event: string) => void) => unknown } }).auth;
  if (typeof auth?.onAuthStateChange !== "function") return;
  authWatch = true;
  auth.onAuthStateChange((event) => {
    // Só SIGNED_OUT: o supabase-js reemite SIGNED_IN ao refocar a aba, e
    // limpar ali derrubaria e reabriria todos os canais a cada foco.
    if (event !== "SIGNED_OUT") return;
    entries.clear();
    fetchedAt.clear();
    emit();
  });
}

/** Prefetch + releitura periódica. Montado uma vez, no `RealtimeOrgProvider`. */
export function useRealtimePlanRefresh(organizationId: string | null): void {
  useEffect(() => {
    if (!organizationId || disabledByEnv()) return;
    watchAuth();
    const last = fetchedAt.get(organizationId);
    if (last === undefined || Date.now() - last >= PLAN_TTL_MS) load(organizationId, true);
    const refresh = () => load(organizationId, true);
    const id = setInterval(refresh, PLAN_TTL_MS);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", refresh);
    };
  }, [organizationId]);
}

/**
 * Transporte desta assinatura:
 *   - `null`      → postgres_changes (padrão; tabela sem broadcast, filtro que
 *                   o cliente não reproduz, sem org, plano diz pg_changes);
 *   - `string`    → tópico privado do Broadcast;
 *   - `undefined` → plano ainda chegando: o canal espera.
 */
export type TransportChoice = string | null | undefined;

export function useRealtimeTransport(
  table: string,
  filter: string | undefined,
  organizationId: string | null,
): TransportChoice {
  const eligible =
    !!organizationId && !disabledByEnv() && broadcastSupports(table, filter) && sameOrg(filter, organizationId);
  const entry = useSyncExternalStore(subscribe, () => (eligible ? read(organizationId!) : undefined));
  if (!eligible || !entry) return null;
  if (entry.status === "loading") return undefined;
  const key = BROADCAST_TABLES[table].planKey;
  return entry.plan[key] === "broadcast" ? broadcastTopic(table, organizationId!) : null;
}

/** Filtro por OUTRA org não cabe no tópico desta (o evento nunca chegaria). */
function sameOrg(filter: string | undefined, organizationId: string): boolean {
  const eq = filter ? parseEqFilter(filter) : null;
  return !eq || eq.column !== "organization_id" || eq.value === organizationId;
}

/** Testes. */
export function __resetRealtimeTransportPlan(): void {
  entries.clear();
  fetchedAt.clear();
  inFlight.clear();
}
