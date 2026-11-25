/**
 * contact-avatar-sync — a rodada do cron, com dependências injetadas.
 *
 * Ordem (orçamento ~50 s por chamada):
 *   1. drena a fila de remoção (≤ 100 objetos);
 *   2. poda órfãs (≤ 200 linhas sem conversa; o trigger enfileira o arquivo);
 *   3. reivindica lotes de ≤ 25 e, para cada linha, baixa a candidata do
 *      webhook se o `oe=` não venceu; 403/404 ou vencida → fallback
 *      POST /chat/details pela caixa elegível, com teto 5/rodada, 1/caixa,
 *      jitter 2–4 s e kill switch `cron_config.contact_avatar_chat_details`
 *      (só 'on' liga; ausente = desligado até haver fixture real);
 *   4. fecha cada linha (sempre carimba). UPDATE que não acha a linha (apagada
 *      no meio) enfileira o arquivo que acabou de subir.
 *
 * O `index.ts` só autentica e monta as dependências reais. Testes:
 * tests/unit/contact-avatar-sync.test.ts.
 */
import {
  AVATAR_BUCKET,
  avatarStoragePath,
  avatarUrlExpired,
  closePatch,
  detailsNumber,
  downloadAvatar,
  extractDetailsImageUrl,
  isAllowedAvatarUrl,
  type AvatarDownload,
  type AvatarOutcome,
  type ClaimedAvatar,
} from "../_shared/contact-avatar.ts";

export const DELETION_BATCH = 100;
export const ORPHAN_BATCH = 200;
export const CLAIM_BATCH = 25;
export const MAX_CLAIM_ROUNDS = 4;
export const DETAILS_CAP_PER_RUN = 5;
export const DETAILS_JITTER_MIN_MS = 2_000;
export const DETAILS_JITTER_MAX_MS = 4_000;
export const RUN_BUDGET_MS = 45_000;
export const KILL_SWITCH_KEY = "contact_avatar_chat_details";

/** Porta de persistência. O adaptador real (supabase-js) está em `supabaseAvatarStore`. */
export interface AvatarStore {
  listDeletionQueue(limit: number): Promise<string[]>;
  /** Paths da lista que ainda são o arquivo vivo de alguma linha. */
  liveStoragePaths(paths: string[]): Promise<Set<string>>;
  removeObjects(paths: string[]): Promise<void>;
  dequeueDeletions(paths: string[]): Promise<void>;
  enqueueDeletion(path: string): Promise<void>;
  pruneOrphans(limit: number): Promise<number>;
  /** `exclude`: ids já vistos nesta rodada (adiada não volta no lote seguinte). */
  claim(limit: number, exclude: string[]): Promise<ClaimedAvatar[]>;
  /** Linhas atualizadas (0 = a linha sumiu ou trocou de org). */
  close(row: ClaimedAvatar, patch: Record<string, unknown>): Promise<number>;
  releaseClaims(ids: string[]): Promise<void>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  instanceToken(instanceId: string, organizationId: string): Promise<string | null>;
  detailsEnabled(): Promise<boolean>;
}

export interface DetailsClient {
  chatDetails(number: string, preview: boolean): Promise<unknown>;
}

export interface SyncDeps {
  store: AvatarStore;
  fetch?: typeof fetch;
  detailsClient(token: string, instanceId: string): DetailsClient;
  sleep(ms: number): Promise<void>;
  now(): number;
  random(): number;
  log(action: string, payload: Record<string, unknown>, status?: "success" | "error"): void;
}

export interface SyncReport {
  deleted_objects: number;
  pruned_orphans: number;
  claimed: number;
  stored: number;
  unchanged: number;
  none: number;
  errors: number;
  deferred: number;
  released: number;
  details_calls: number;
  details_by_instance: Record<string, number>;
}

export async function runContactAvatarSync(deps: SyncDeps): Promise<SyncReport> {
  const started = deps.now();
  const report: SyncReport = {
    deleted_objects: 0, pruned_orphans: 0, claimed: 0, stored: 0, unchanged: 0, none: 0,
    errors: 0, deferred: 0, released: 0, details_calls: 0, details_by_instance: {},
  };
  const overBudget = () => deps.now() - started > RUN_BUDGET_MS;

  report.deleted_objects = await drainDeletionQueue(deps.store);
  report.pruned_orphans = await deps.store.pruneOrphans(ORPHAN_BATCH);

  const details = new DetailsBudget(deps);
  const seen: string[] = [];
  for (let round = 0; round < MAX_CLAIM_ROUNDS && !overBudget(); round += 1) {
    const rows = await deps.store.claim(CLAIM_BATCH, seen);
    seen.push(...rows.map((r) => r.id));
    report.claimed += rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      if (overBudget()) {
        const rest = rows.slice(i).map((r) => r.id);
        await deps.store.releaseClaims(rest);
        report.released += rest.length;
        break;
      }
      const row = rows[i];
      const { outcome, uploaded } = await processRow(row, deps, details);
      await closeRow(row, outcome, uploaded, deps);
      report[REPORT_KEY[outcome.kind]] += 1;
    }
    if (rows.length < CLAIM_BATCH) break;
  }

  report.details_calls = details.calls;
  report.details_by_instance = details.byInstance();
  if (report.details_calls > 0) {
    deps.log("contact_avatar_details_call", {
      calls: report.details_calls,
      by_instance: report.details_by_instance,
    });
  }
  return report;
}

const REPORT_KEY = {
  ok: "stored", same: "unchanged", none: "none", error: "errors", deferred: "deferred",
} as const satisfies Record<AvatarOutcome["kind"], keyof SyncReport>;

async function drainDeletionQueue(store: AvatarStore): Promise<number> {
  const queued = await store.listDeletionQueue(DELETION_BATCH);
  if (queued.length === 0) return 0;
  // Um path pode ter voltado a ser o arquivo vivo (foto reapareceu): não apaga.
  const live = await store.liveStoragePaths(queued);
  const toRemove = queued.filter((p) => !live.has(p));
  if (toRemove.length > 0) await store.removeObjects(toRemove);
  await store.dequeueDeletions(queued);
  return toRemove.length;
}

/** Teto global e por caixa do /chat/details nesta rodada, com jitter entre chamadas. */
class DetailsBudget {
  calls = 0;
  private readonly used = new Map<string, number>();
  private enabled: boolean | null = null;
  private readonly tokens = new Map<string, string | null>();
  constructor(private readonly deps: SyncDeps) {}

  async isEnabled(): Promise<boolean> {
    if (this.enabled === null) {
      try {
        this.enabled = await this.deps.store.detailsEnabled();
      } catch {
        // Sem ler o kill switch, não chama o provedor (falha fechada).
        this.enabled = false;
      }
    }
    return this.enabled;
  }

  canCall(instanceId: string): boolean {
    return this.calls < DETAILS_CAP_PER_RUN && !this.used.has(instanceId);
  }

  async token(instanceId: string, organizationId: string): Promise<string | null> {
    if (!this.tokens.has(instanceId)) {
      this.tokens.set(instanceId, await this.deps.store.instanceToken(instanceId, organizationId));
    }
    return this.tokens.get(instanceId) ?? null;
  }

  async call(instanceId: string, token: string, number: string): Promise<unknown> {
    if (this.calls > 0) {
      const span = DETAILS_JITTER_MAX_MS - DETAILS_JITTER_MIN_MS;
      await this.deps.sleep(DETAILS_JITTER_MIN_MS + Math.floor(this.deps.random() * span));
    }
    this.calls += 1;
    this.used.set(instanceId, (this.used.get(instanceId) ?? 0) + 1);
    return this.deps.detailsClient(token, instanceId).chatDetails(number, true);
  }

  byInstance(): Record<string, number> {
    return Object.fromEntries(this.used);
  }
}

async function processRow(
  row: ClaimedAvatar,
  deps: SyncDeps,
  details: DetailsBudget,
): Promise<{ outcome: AvatarOutcome; uploaded: string | null }> {
  const fetchOpts = { fetch: deps.fetch };
  let fallbackReason = "no_candidate";
  if (row.candidate_url && isAllowedAvatarUrl(row.candidate_url)) {
    if (avatarUrlExpired(row.candidate_url, deps.now())) {
      fallbackReason = "candidate_expired";
    } else {
      const got = await downloadAvatar(row.candidate_url, fetchOpts);
      if (got.kind !== "gone") return store(row, got, deps);
      fallbackReason = `candidate_${got.reason}`;
    }
  }

  // ── fallback /chat/details ────────────────────────────────────────────────
  if (!row.details_instance_id) return { outcome: { kind: "error", reason: `${fallbackReason};no_instance` }, uploaded: null };
  if (!(await details.isEnabled())) return { outcome: { kind: "deferred", reason: "details_disabled" }, uploaded: null };
  if (!details.canCall(row.details_instance_id)) return { outcome: { kind: "deferred", reason: "details_cap" }, uploaded: null };
  const token = await details.token(row.details_instance_id, row.organization_id);
  if (!token) return { outcome: { kind: "error", reason: "uazapi_token_missing" }, uploaded: null };

  let body: unknown;
  try {
    body = await details.call(row.details_instance_id, token, detailsNumber(row));
  } catch (err) {
    const status = (err as { status?: unknown })?.status;
    return { outcome: { kind: "error", reason: `details_failed${typeof status === "number" ? `_${status}` : ""}` }, uploaded: null };
  }
  const image = extractDetailsImageUrl(body);
  if (image.kind === "none") return { outcome: { kind: "none" }, uploaded: null };
  if (image.kind === "unknown") return { outcome: { kind: "error", reason: "details_shape_unknown" }, uploaded: null };
  if (image.kind === "rejected") return { outcome: { kind: "error", reason: "details_url_rejected" }, uploaded: null };
  const got = await downloadAvatar(image.url, fetchOpts);
  if (got.kind === "gone") return { outcome: { kind: "error", reason: `details_${got.reason}` }, uploaded: null };
  return store(row, got, deps);
}

async function store(
  row: ClaimedAvatar,
  got: Exclude<AvatarDownload, { kind: "gone" }>,
  deps: SyncDeps,
): Promise<{ outcome: AvatarOutcome; uploaded: string | null }> {
  if (got.kind === "error") return { outcome: { kind: "error", reason: got.reason }, uploaded: null };
  if (row.storage_path && row.content_sha256 === got.sha256) return { outcome: { kind: "same" }, uploaded: null };
  const path = avatarStoragePath(row.organization_id, row.id);
  try {
    await deps.store.upload(path, got.bytes, got.contentType);
  } catch {
    return { outcome: { kind: "error", reason: "upload_failed" }, uploaded: null };
  }
  return { outcome: { kind: "ok", storagePath: path, sha256: got.sha256 }, uploaded: path };
}

async function closeRow(row: ClaimedAvatar, outcome: AvatarOutcome, uploaded: string | null, deps: SyncDeps) {
  const updated = await deps.store.close(row, closePatch(row, outcome, new Date(deps.now()).toISOString()));
  if (uploaded && updated === 0) {
    // A linha sumiu entre o claim e o fechamento (órfã, cascade): o arquivo
    // recém-subido não tem dono. Vai para a fila.
    await deps.store.enqueueDeletion(uploaded);
  } else if (uploaded) {
    // Mesmo path pode estar na fila de uma transição anterior: não pode ser
    // drenado agora que voltou a ser o arquivo vivo.
    await deps.store.dequeueDeletions([uploaded]);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Adaptador supabase-js (service_role)
// ════════════════════════════════════════════════════════════════════════════

type Res = { data: unknown; error: { message?: string } | null };
/** O mínimo do supabase-js que o adaptador usa — tipado à mão para o dublê. */
export interface QueryChain extends PromiseLike<Res> {
  select(columns: string): QueryChain;
  order(column: string): QueryChain;
  limit(n: number): QueryChain;
  in(column: string, values: string[]): QueryChain;
  eq(column: string, value: string): QueryChain;
  delete(): QueryChain;
  update(patch: Record<string, unknown>): QueryChain;
  upsert(row: Record<string, unknown>, opts: { onConflict: string; ignoreDuplicates: boolean }): QueryChain;
  maybeSingle(): QueryChain;
}
export interface SupabaseLike {
  from(table: string): QueryChain;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<Res>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<Res>;
      upload(path: string, body: Uint8Array, opts: { contentType: string; cacheControl: string; upsert: boolean }): PromiseLike<Res>;
    };
  };
}

function must<T>(res: Res, what: string): T | null {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? "erro"}`);
  return (res.data ?? null) as T | null;
}

export function supabaseAvatarStore(db: SupabaseLike): AvatarStore {
  return {
    async listDeletionQueue(limit) {
      const rows = must<Array<{ object_path: string }>>(
        await db.from("contact_avatar_storage_deletions").select("object_path").order("queued_at").limit(limit),
        "fila de remoção",
      );
      return (rows ?? []).map((r) => r.object_path);
    },
    async liveStoragePaths(paths) {
      if (paths.length === 0) return new Set();
      const rows = must<Array<{ storage_path: string }>>(
        await db.from("whatsapp_contact_avatars").select("storage_path").in("storage_path", paths),
        "paths vivos",
      );
      return new Set((rows ?? []).map((r) => r.storage_path));
    },
    async removeObjects(paths) {
      must(await db.storage.from(AVATAR_BUCKET).remove(paths), "storage.remove");
    },
    async dequeueDeletions(paths) {
      if (paths.length === 0) return;
      must(await db.from("contact_avatar_storage_deletions").delete().in("object_path", paths), "desenfileirar");
    },
    async enqueueDeletion(path) {
      must(
        await db.from("contact_avatar_storage_deletions").upsert({ object_path: path }, { onConflict: "object_path", ignoreDuplicates: true }),
        "enfileirar",
      );
    },
    async pruneOrphans(limit) {
      const n = must<number>(await db.rpc("podar_avatares_orfaos", { p_limit: limit }), "podar órfãs");
      return typeof n === "number" ? n : 0;
    },
    async claim(limit, exclude) {
      const rows = must<ClaimedAvatar[]>(
        await db.rpc("reivindicar_avatares", { p_limit: limit, p_exclude: exclude }),
        "reivindicar",
      );
      return rows ?? [];
    },
    async close(row, patch) {
      const rows = must<Array<{ id: string }>>(
        await db.from("whatsapp_contact_avatars").update(patch)
          .eq("id", row.id).eq("organization_id", row.organization_id).select("id"),
        "fechar",
      );
      return rows?.length ?? 0;
    },
    async releaseClaims(ids) {
      if (ids.length === 0) return;
      must(await db.from("whatsapp_contact_avatars").update({ claimed_until: null }).in("id", ids), "soltar claim");
    },
    async upload(path, bytes, contentType) {
      must(
        await db.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType, cacheControl: "3600", upsert: true }),
        "storage.upload",
      );
    },
    async instanceToken(instanceId, organizationId) {
      const row = must<{ uazapi_token: string | null }>(
        await db.from("whatsapp_instance_secrets").select("uazapi_token")
          .eq("instance_id", instanceId).eq("organization_id", organizationId).maybeSingle(),
        "token da caixa",
      );
      return row?.uazapi_token ?? null;
    },
    async detailsEnabled() {
      const row = must<{ value: string | null }>(
        await db.from("cron_config").select("value").eq("key", KILL_SWITCH_KEY).maybeSingle(),
        "kill switch",
      );
      // Só 'on' explícito liga. Ausente = DESLIGADO até existir fixture real
      // do /chat/details (ligar: cron_config key=contact_avatar_chat_details,
      // value='on').
      return row?.value?.trim().toLowerCase() === "on";
    },
  };
}
