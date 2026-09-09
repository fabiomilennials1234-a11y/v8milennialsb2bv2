/**
 * Colunas dinâmicas da exportação de leads — SCRUM-635 (W4 · Funil é Funil).
 *
 * Antes, o arquivo exportado tinha 3 blocos FIXOS de cabeçalho (Pipe
 * Qualificação / Confirmação / Propostas) — a união de tipo dos 3 pipes de
 * sistema. Funil custom não aparecia e funil renomeado saía com o nome de
 * fábrica. Agora os blocos são derivados dos funis REAIS da org
 * (`pipelines` + `pipeline_stages`): um bloco por funil, batizado pelo nome
 * do funil, com a etapa exibida pelo NOME real da etapa.
 *
 * Módulo puro de propósito (sem supabase/react) — testável em vitest sem
 * dublê de rede. Quem busca os dados é `useExportLeads`.
 */

/** Ordem canônica dos funis de sistema no arquivo (espelha o produto). */
const SYSTEM_SLUG_ORDER: Record<string, number> = {
  whatsapp: 0,
  confirmacao: 1,
  propostas: 2,
  upsell: 3,
};

export interface ExportPipeline {
  id: string;
  name: string | null;
  slug: string | null;
  type: string | null;
}

export interface ExportPipelineStage {
  id: string;
  pipeline_id: string | null;
  stage_key: string | null;
  name: string | null;
}

/** Shape mínimo de uma linha de `pipeline_entries` que a exportação consome. */
export interface ExportPipelineEntry {
  pipeline_id: string;
  lead_id: string | null;
  stage_id?: string | null;
  stage_key?: string | null;
  assigned_to?: string | null;
  notes?: string | null;
  closed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Ordena os funis para o arquivo: sistema primeiro (na ordem canônica
 * whatsapp → confirmacao → propostas → upsell), custom depois por nome.
 * Determinístico — o mesmo export sai sempre com as colunas na mesma ordem.
 */
export function orderPipelinesForExport(pipelines: ExportPipeline[]): ExportPipeline[] {
  return [...pipelines].sort((a, b) => {
    const aSystem = a.type === "system";
    const bSystem = b.type === "system";
    if (aSystem !== bSystem) return aSystem ? -1 : 1;
    if (aSystem && bSystem) {
      const ao = SYSTEM_SLUG_ORDER[a.slug ?? ""] ?? 99;
      const bo = SYSTEM_SLUG_ORDER[b.slug ?? ""] ?? 99;
      if (ao !== bo) return ao - bo;
    }
    return (a.name ?? "").localeCompare(b.name ?? "", "pt-BR");
  });
}

/**
 * Bloco de colunas de UM funil. Template uniforme — cobre os campos que os 3
 * blocos fixos antigos tinham, com a origem em `pipeline_entries`:
 *   · scheduled_date (Qualificação) e meeting_date (Confirmação) colapsam em
 *     "Data reunião" (meeting_date vence quando ambos existem);
 *   · calor não sai mais por funil (nem por lead — saiu da planilha);
 *   · commitment_date por funil colapsou em "Data compromisso (lead)".
 */
export function funnelColumnHeaders(funnelName: string): string[] {
  const f = funnelName || "Funil";
  return [
    `Etapa — ${f}`,
    `Responsável — ${f}`,
    `Valor venda (R$) — ${f}`,
    `Data reunião — ${f}`,
    `Reunião confirmada (sim/não) — ${f}`,
    `Tipo produto — ${f}`,
    `Duração contrato (meses) — ${f}`,
    `Data fechamento — ${f}`,
    `Notas — ${f}`,
    `Data criação — ${f}`,
    `Data atualização — ${f}`,
    `Data período métricas — ${f}`,
  ];
}

/** Cabeçalho completo do arquivo: bloco do lead + um bloco por funil real. */
export function buildExportHeaders(
  leadHeaders: readonly string[],
  pipelines: ExportPipeline[],
): string[] {
  const ordered = orderPipelinesForExport(pipelines);
  return [...leadHeaders, ...ordered.flatMap((p) => funnelColumnHeaders(p.name ?? ""))];
}

function metaStr(meta: Record<string, unknown> | null | undefined, key: string): string {
  const v = meta?.[key];
  if (v == null || v === "") return "";
  return String(v);
}

function metaNum(meta: Record<string, unknown> | null | undefined, key: string): number | "" {
  const v = meta?.[key];
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

/**
 * Resolve o nome exibível da etapa de uma entry: `stage_id` (uuid, canônico
 * pós-W3) vence; `stage_key` cobre a entry legada; o cru é o último recurso —
 * nunca célula vazia quando a entry existe.
 */
export function resolveStageName(
  entry: ExportPipelineEntry,
  stagesById: Map<string, ExportPipelineStage>,
  stagesByPipelineAndKey: Map<string, ExportPipelineStage>,
): string {
  if (entry.stage_id) {
    const byId = stagesById.get(entry.stage_id);
    if (byId?.name) return byId.name;
  }
  if (entry.stage_key) {
    const byKey = stagesByPipelineAndKey.get(`${entry.pipeline_id}:${entry.stage_key}`);
    if (byKey?.name) return byKey.name;
    return entry.stage_key;
  }
  return "";
}

/**
 * Monta as células do bloco de um funil para um lead. `entry === undefined`
 * significa "lead não está neste funil" — todas as células saem vazias.
 * O responsável segue a mesma precedência dos boards: responsável explícito da
 * entry > papéis de venda/pré-venda > assigned_to.
 */
export function buildFunnelCells(
  funnelName: string,
  entry: ExportPipelineEntry | undefined,
  ctx: {
    stagesById: Map<string, ExportPipelineStage>;
    stagesByPipelineAndKey: Map<string, ExportPipelineStage>;
    memberName: (id: string | null | undefined) => string;
    fmtDate: (v: string | null | undefined) => string;
  },
): Record<string, string | number> {
  const headers = funnelColumnHeaders(funnelName);
  if (!entry) {
    return Object.fromEntries(headers.map((h) => [h, ""]));
  }
  const meta = entry.metadata ?? null;
  const responsibleId =
    metaStr(meta, "responsible_id") ||
    metaStr(meta, "sale_responsible_id") ||
    metaStr(meta, "closer_id") ||
    metaStr(meta, "pre_sale_responsible_id") ||
    metaStr(meta, "sdr_id") ||
    entry.assigned_to ||
    "";
  const meetingDate = metaStr(meta, "meeting_date") || metaStr(meta, "scheduled_date");
  const isConfirmedRaw = meta?.["is_confirmed"];
  const [
    hEtapa, hResp, hValor, hReuniao, hConfirmada, hProduto,
    hContrato, hFechamento, hNotas, hCriacao, hAtualizacao, hMetricas,
  ] = headers;
  return {
    [hEtapa]: resolveStageName(entry, ctx.stagesById, ctx.stagesByPipelineAndKey),
    [hResp]: ctx.memberName(responsibleId),
    [hValor]: metaNum(meta, "sale_value"),
    [hReuniao]: ctx.fmtDate(meetingDate || null),
    [hConfirmada]: isConfirmedRaw == null ? "" : isConfirmedRaw === true || isConfirmedRaw === "true" ? "sim" : "não",
    [hProduto]: metaStr(meta, "product_type"),
    [hContrato]: metaNum(meta, "contract_duration"),
    [hFechamento]: ctx.fmtDate(entry.closed_at),
    [hNotas]: entry.notes ?? "",
    [hCriacao]: ctx.fmtDate(entry.created_at),
    [hAtualizacao]: ctx.fmtDate(entry.updated_at),
    [hMetricas]: ctx.fmtDate(metaStr(meta, "metrics_period_at") || null),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `stageId` da UI pode ser uuid de `pipeline_stages` (canônico) ou stage_key legado. */
export function isStageUuid(stageId: string): boolean {
  return UUID_RE.test(stageId);
}

/**
 * Dado um lote de entries (potencialmente N por (funil, lead) — recompra,
 * ADR-0023 d.2), escolhe UMA por (pipeline_id, lead_id): a de `updated_at`
 * mais recente — o mesmo desempate que a exportação legada usava por pipe.
 */
export function pickLatestEntryPerFunnel(
  entries: ExportPipelineEntry[],
): Map<string, ExportPipelineEntry> {
  const byKey = new Map<string, ExportPipelineEntry>();
  for (const e of entries) {
    if (!e.lead_id) continue;
    const key = `${e.pipeline_id}:${e.lead_id}`;
    const prev = byKey.get(key);
    if (!prev || new Date(e.updated_at ?? 0) > new Date(prev.updated_at ?? 0)) {
      byKey.set(key, e);
    }
  }
  return byKey;
}
