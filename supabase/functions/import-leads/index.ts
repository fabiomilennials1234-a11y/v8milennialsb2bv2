/**
 * Edge Function: import-leads
 *
 * Centraliza a importação de leads no backend.
 * O frontend faz o parse do arquivo (CSV/XLSX) e mapeamento de colunas,
 * depois envia o array de leads parseados para esta Edge Function que:
 * 1. Valida JWT e resolve org_id do usuário autenticado (ignora org_id do body)
 * 2. Confirma existência da organização no DB antes de processar
 * 3. Valida cada lead (name obrigatório; phone e email são opcionais — leads sem contato são importados como incompletos)
 * 4. Dedup por phone com merge inteligente
 * 5. Processa em batches de 50
 * 6. Retorna relatório detalhado
 * 7. Loga execução com logRuntime()
 *
 * Segurança: JWT obrigatório. org_id derivado do token via team_members.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { trackEvent } from "../_shared/track.ts";
import {
  isPipelineResolutionError,
  resolvePipeline,
  upsertPipeEntryDetailed,
  type ResolvedPipeline,
} from "../_shared/pipeline-adapter.ts";
import { unauthorizedResponse } from "../_shared/auth.ts";

/**
 * Explica, na linha do relatório de importação, por que a linha não entrou no funil.
 *
 * `no_pipeline` NÃO é erro: desde 20270902000000 a organização pode simplesmente
 * não ter aquele funil de sistema — nunca teve (org nova não nasce mais com
 * funil) ou o excluiu. Chamar isso de "erro ao inserir" manda o usuário caçar um
 * defeito inexistente, quando o que ele precisa é ativar ou recriar o funil.
 *
 * `nomeNaTela` é o rótulo que o usuário vê na lista de funis ("Oportunidades"),
 * não o slug interno ("whatsapp") — quem lê o relatório não conhece o slug.
 */
function motivoFalhaDeFunil(status: string, nomeNaTela: string): string {
  if (status === "no_pipeline") {
    return `O funil "${nomeNaTela}" não existe nesta organização. Ative-o em Criar → Ativar funil e importe de novo.`;
  }
  if (status === "read_failed") {
    return `Não foi possível ler o funil "${nomeNaTela}" para evitar duplicar o negócio. Tente de novo.`;
  }
  return `Falha ao inserir no funil "${nomeNaTela}".`;
}

// ─── Types ───────────────────────────────────────────────

interface ParsedLead {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  faturamento?: string;
  segment?: string;
  notes?: string;
  kommoBlock?: string;
  utm_campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_content?: string;
  utm_term?: string;
  rating?: number;
  origin?: string;
  stage?: string;
  seller_name?: string;
  calor?: number;
  valor_proposta?: number;
  product_name?: string;
  commitment_date?: string;
  contract_duration?: number;
  pipe_notes?: string;
  /** Valores de campos personalizados (nome do campo → valor). Gravados em lead_custom_field_values. */
  customFields?: Record<string, string>;
}

interface ImportPayload {
  leads: ParsedLead[];
  organization_id: string;
  /**
   * "leads" = importar SEM funil: cria/atualiza a pessoa e para aí, sem
   * `pipeline_entries`. É o destino da tela de Leads, onde o cadastro é o fim
   * em si — o negócio nasce depois, quando alguém decidir abrir um.
   */
  destination: "campaign" | "funnel" | "custom_pipeline" | "pipeline" | "leads";

  // Campaign-specific
  campanha_id?: string;
  stage_id?: string;
  sdr_id?: string;
  auto_distribute?: boolean;
  member_ids?: string[];
  distribution_mode?: "round_robin" | "random";
  closer_member_ids?: string[];
  closer_distribution_mode?: "round_robin" | "random";
  campaign_stages?: { id: string; name: string }[];

  // Funnel-specific
  funnel_destination?: "qualificacao" | "propostas" | "confirmacao";
  stage_key?: string;
  stages?: { stage_key: string; name: string }[];
  members?: { id: string; name: string }[];
  products?: { id: string; name: string }[];
  closer_id?: string;
  metrics_period_month?: number;
  metrics_period_year?: number;

  // Custom pipeline-specific
  custom_pipeline_id?: string;
  custom_stage_id?: string;
  custom_stages?: { id: string; name: string }[];

  // Destino canônico unificado (SCRUM-635, W4): QUALQUER funil por id.
  // Os formatos legados acima (funnel_destination / custom_pipeline_id)
  // seguem aceitos e colapsam neste caminho dentro de `importToPipeline`.
  /** `pipelines.id` do funil de destino (sistema ou custom). */
  pipeline_id?: string;
  /** Etapa padrão: uuid de `pipeline_stages` OU stage_key. */
  pipeline_stage?: string;
}

interface ImportReport {
  total: number;
  created: number;
  updated: number;
  rejected: number;
  /** Leads importados sem telefone e sem email (são criados, mas marcados como incompletos). */
  incomplete: number;
  errors: { row: number; reason: string }[];
  distribution?: Record<string, number>;
}

// ─── Helpers ─────────────────────────────────────────────

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * Carrega os campos personalizados da org: nome normalizado (lower/trim) → field_id.
 * Usado para resolver o mapeamento `customFields` (por nome) para lead_custom_field_values.
 */
async function loadCustomFieldMap(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await supabase
    .from("lead_custom_fields")
    .select("id, field_name")
    .eq("organization_id", organizationId);
  for (const f of (data ?? []) as { id: string; field_name: string | null }[]) {
    const name = (f.field_name ?? "").toLowerCase().trim();
    if (name) map.set(name, f.id);
  }
  return map;
}

/**
 * Persiste os valores de campos personalizados do lead em lead_custom_field_values.
 * Upsert por (lead_id, field_id) — reimportar atualiza. Campos sem correspondência
 * na org são ignorados (silenciosamente). Nunca lança: falha aqui não deve derrubar o lead.
 */
async function applyCustomFields(
  supabase: ReturnType<typeof createClient>,
  leadId: string,
  customFields: Record<string, string> | undefined,
  fieldMap: Map<string, string>,
): Promise<void> {
  if (!customFields || fieldMap.size === 0) return;
  const rows: { lead_id: string; field_id: string; value: string }[] = [];
  for (const [name, rawValue] of Object.entries(customFields)) {
    const value = (rawValue ?? "").toString().trim();
    if (!value) continue;
    const fieldId = fieldMap.get(name.toLowerCase().trim());
    if (!fieldId) continue;
    rows.push({ lead_id: leadId, field_id: fieldId, value });
  }
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("lead_custom_field_values")
    .upsert(rows, { onConflict: "lead_id,field_id" });
  if (error) {
    console.error("[import-leads] applyCustomFields falhou", { leadId, error: error.message });
  }
}

/**
 * Extrai os dígitos locais (DDD + número, 10-11) de UM telefone a partir de uma célula
 * possivelmente suja: vários números, prefixos, texto solto, ou notação científica.
 * Defesa em profundidade — o frontend (pickBestPhone) já normaliza, mas outras origens
 * (XLSX, n8n, payload externo) podem mandar célula crua. Sem isto, "X / Y" vira string
 * de 20+ dígitos e o lead é rejeitado por validatePhone. "" quando não há candidato.
 */
function bestPhoneDigits(phone: string): string {
  // Notação científica do Excel — ponto ("5.51E+12") e vírgula pt-BR ("7,1994E+10")
  let work = (phone || "").trim();
  const dotted = work.replace(",", ".");
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(dotted)) {
    const num = Number(dotted);
    if (!isNaN(num) && num > 0) work = Math.round(num).toString();
  }

  const chunks = work.split(/[/;,|\n]|\s+ou\s+|\s+e\s+/i);
  const candidates: string[] = [];
  for (const chunk of chunks) {
    let digits = chunk.replace(/\D/g, "");
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
      digits = digits.slice(2);
    }
    if (digits.length === 10 || digits.length === 11) candidates.push(digits);
  }
  if (candidates.length === 0) return "";
  candidates.sort((a, b) => b.length - a.length); // celular (11) antes de fixo (10)
  return candidates[0];
}

function formatPhone(phone: string): string {
  const local = bestPhoneDigits(phone);
  if (local) return `55${local}`;
  // Sem candidato válido: devolve dígitos crus (validatePhone abaixo decide rejeição).
  return (phone || "").replace(/\D/g, "");
}

function validatePhone(phone: string): boolean {
  return bestPhoneDigits(phone) !== "";
}

function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeStageName(s: string): string {
  return s
    .replace(/\s*[✓✗📅]\s*$/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/-/g, " ");
}

function stageComparable(str: string): string {
  return normalizeStageName(str).replace(/_/g, " ").replace(/\s+/g, " ");
}

function resolveStageFromName(
  stageName: string | undefined,
  stages: { stage_key: string; name: string }[],
  defaultStageKey: string,
): string {
  if (!stageName?.trim()) return defaultStageKey;
  const inputNorm = stageComparable(stageName);
  if (!inputNorm) return defaultStageKey;

  const exact = stages.find((s) => {
    const n = stageComparable(s.name);
    const k = stageComparable(s.stage_key);
    return n === inputNorm || k === inputNorm;
  });
  if (exact) return exact.stage_key;

  const contains = stages.find((s) => {
    const n = stageComparable(s.name);
    const k = stageComparable(s.stage_key);
    return n.includes(inputNorm) || inputNorm.includes(n) || k.includes(inputNorm) || inputNorm.includes(k);
  });
  if (contains) return contains.stage_key;

  const startsWith = stages.find((s) => {
    const n = stageComparable(s.name);
    const k = stageComparable(s.stage_key);
    return inputNorm.startsWith(n) || n.startsWith(inputNorm) || inputNorm.startsWith(k) || k.startsWith(inputNorm);
  });
  if (startsWith) return startsWith.stage_key;

  return defaultStageKey;
}

function truncateErr(msg: string | undefined | null, max = 200): string {
  if (!msg) return "erro desconhecido";
  return msg.length <= max ? msg : `${msg.slice(0, max)}…`;
}

function resolveSellerToId(
  sellerName: string | undefined,
  members: { id: string; name: string }[],
  defaultId: string | null,
): string | null {
  if (!sellerName?.trim() || !members.length) return defaultId;
  const normalized = normalizeName(sellerName);
  if (!normalized) return defaultId;

  const withNorm = members.map((m) => ({ ...m, norm: normalizeName(m.name || "") })).filter((m) => m.norm);
  if (withNorm.length === 0) return defaultId;

  const exact = withNorm.find((m) => m.norm === normalized);
  if (exact) return exact.id;
  const contains = withNorm.find((m) => m.norm.includes(normalized) || normalized.includes(m.norm));
  if (contains) return contains.id;

  const byLength = [...withNorm].sort((a, b) => Math.abs(a.norm.length - normalized.length) - Math.abs(b.norm.length - normalized.length));
  return byLength[0]?.id ?? defaultId;
}

function resolveProductToId(
  productName: string | undefined,
  products: { id: string; name: string }[],
  defaultId: string | null,
): string | null {
  if (!products.length) return defaultId;
  const raw = (productName || "").trim();
  if (!raw) return defaultId;
  const normalized = normalizeName(raw);
  if (!normalized) return defaultId;

  const withNorm = products.map((p) => ({ ...p, norm: normalizeName((p.name || "").trim()) })).filter((p) => p.norm);
  if (withNorm.length === 0) return defaultId;

  const exact = withNorm.find((p) => p.norm === normalized);
  if (exact) return exact.id;
  const startsWith = withNorm.find((p) => p.norm.startsWith(normalized) || normalized.startsWith(p.norm));
  if (startsWith) return startsWith.id;
  const contains = withNorm.find((p) => p.norm.includes(normalized) || normalized.includes(p.norm));
  if (contains) return contains.id;

  const byLength = [...withNorm].sort((a, b) => Math.abs(a.norm.length - normalized.length) - Math.abs(b.norm.length - normalized.length));
  return byLength[0]?.id ?? defaultId;
}

function normalizeFaturamento(value: string): string {
  if (!value) return "";
  let normalized = value.replace(/_/g, " ").replace(/r\$/gi, "R$").replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  if (lower.includes("+1") && lower.includes("milhão")) return "+1 Milhão";
  if (lower.includes("500") && lower.includes("1 milh")) return "R$500 mil a R$1 milhão";
  if (lower.includes("250") && lower.includes("500")) return "R$250 mil a R$500 mil";
  if (lower.includes("100") && lower.includes("250")) return "R$100 mil a R$250 mil";
  if (lower.includes("50") && lower.includes("100")) return "R$50 mil a R$100 mil";
  return normalized;
}

function isEmptyLike(v: string | null | undefined): boolean {
  if (!v) return true;
  const t = v.trim();
  if (!t) return true;
  return /^(?:-+|n\/a|na|nao informado|não informado|sem info|sem informação|0)$/i.test(t);
}

function shouldReplaceValue(
  existingValue: string | null | undefined,
  incomingValue: string | undefined,
  field: "name" | "company" | "email" | "phone" | "faturamento" | "segment" | "utm",
): boolean {
  if (!incomingValue?.trim()) return false;
  if (isEmptyLike(existingValue)) return true;

  const existing = (existingValue || "").trim();
  const incoming = incomingValue.trim();
  if (existing === incoming) return false;

  if (field === "email") return !existing.includes("@") && incoming.includes("@");
  if (field === "phone") return existing.replace(/\D/g, "").length < incoming.replace(/\D/g, "").length;
  if (field === "faturamento") {
    const eDigits = existing.replace(/\D/g, "").length;
    const iDigits = incoming.replace(/\D/g, "").length;
    return iDigits > eDigits || incoming.length > existing.length;
  }
  return incoming.length > existing.length;
}

const KOMMO_BLOCK_START = "--- Kommo (campos) ---";
const KOMMO_BLOCK_END = "--- /Kommo (campos) ---";

function stripKommoBlock(notes: string): string {
  if (!notes) return notes;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escape(KOMMO_BLOCK_START)}[\\s\\S]*?${escape(KOMMO_BLOCK_END)}\\n?`, "g");
  return notes.replace(re, "").trim();
}

function mergeNotes(existingNotes?: string | null, rawNotes?: string, kommoBlock?: string): string | undefined {
  let out = stripKommoBlock((existingNotes || "").trim());
  if (rawNotes?.trim()) {
    const incoming = rawNotes.trim();
    if (!out.includes(incoming)) {
      out = out ? `${out}\n\n--- Notas Kommo ---\n\n${incoming}` : incoming;
    }
  }
  if (kommoBlock?.trim()) {
    out = out ? `${out}\n\n${kommoBlock.trim()}` : kommoBlock.trim();
  }
  return out.trim() || undefined;
}

// ─── Validation ──────────────────────────────────────────

function validateLead(lead: ParsedLead, index: number): string | null {
  if (!lead.name?.trim()) return `Linha ${index + 1}: nome é obrigatório`;
  if (lead.phone?.trim() && !validatePhone(lead.phone)) {
    return `Linha ${index + 1}: telefone inválido (${lead.phone}) — esperado 10-13 dígitos`;
  }
  return null;
}

/** Retorna true se o lead não tem telefone nem email (será importado como incompleto). */
function isIncomplete(lead: ParsedLead): boolean {
  return !lead.phone?.trim() && !lead.email?.trim();
}

// ─── Campaign Import ────────────────────────────────────

async function importToCampaign(
  supabase: ReturnType<typeof createClient>,
  leads: ParsedLead[],
  payload: ImportPayload,
  report: ImportReport,
): Promise<void> {
  const {
    organization_id: organizationId,
    campanha_id: campanhaId,
    stage_id: stageId,
    sdr_id: sdrId,
    auto_distribute: autoDistribute,
    member_ids: memberIds,
    distribution_mode: distributionMode,
    closer_member_ids: closerMemberIds,
    closer_distribution_mode: closerDistributionMode,
    campaign_stages: campaignStages,
  } = payload;

  if (!campanhaId) throw new Error("campanha_id é obrigatório para importação em campanha");
  if (!stageId) throw new Error("stage_id é obrigatório para importação em campanha");

  const customFieldMap = await loadCustomFieldMap(supabase, organizationId);

  // Pre-fetch existing leads by phone for dedup
  const phones = leads.filter((l) => l.phone).map((l) => formatPhone(l.phone!));
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
    .eq("organization_id", organizationId)
    .in("phone", phones);

  const existingMap = new Map<string, NonNullable<typeof existingLeads>[number]>();
  existingLeads?.forEach((l) => { if (l.phone) existingMap.set(l.phone, l); });

  // Pre-fetch existing leads by email for leads without phone
  const emailsOnly = leads
    .filter((l) => !l.phone && l.email)
    .map((l) => l.email!.toLowerCase().trim());
  const existingEmailMap = new Map<string, NonNullable<typeof existingLeads>[number]>();
  if (emailsOnly.length > 0) {
    const { data: existingByEmail } = await supabase
      .from("leads")
      .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
      .eq("organization_id", organizationId)
      .in("email", emailsOnly);
    existingByEmail?.forEach((l) => { if (l.email) existingEmailMap.set(l.email.toLowerCase(), l); });
  }

  // Create/get import tag
  const now = new Date();
  const tagName = `Importação - ${now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
  let tagId: string;
  const { data: existingTag } = await supabase
    .from("tags").select("id").eq("name", tagName).eq("organization_id", organizationId).maybeSingle();
  if (existingTag) {
    tagId = existingTag.id;
  } else {
    const { data: newTag, error: tagError } = await supabase
      .from("tags").insert({ name: tagName, color: "#f59e0b", organization_id: organizationId }).select("id").single();
    if (tagError) throw tagError;
    tagId = newTag.id;
  }

  // Distribution tracking (for report only)
  const distribution: Record<string, number> = {};
  if (autoDistribute && memberIds?.length) {
    memberIds.forEach((id) => { distribution[id] = 0; });
  }

  const processedPhones = new Set<string>();
  const createdLeadIds: string[] = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);

    for (const lead of batch) {
      const rowIndex = leads.indexOf(lead);
      const formattedPhone = lead.phone ? formatPhone(lead.phone) : undefined;

      // Skip dups within this import
      if (formattedPhone && processedPhones.has(formattedPhone)) {
        report.rejected++;
        report.errors.push({ row: rowIndex + 1, reason: "Telefone duplicado neste arquivo" });
        continue;
      }

      const stageIdForLead =
        campaignStages?.length
          ? resolveStageFromName(lead.stage, campaignStages.map((s) => ({ stage_key: s.id, name: s.name })), stageId)
          : stageId;

      const existingLead = formattedPhone
        ? existingMap.get(formattedPhone)
        : lead.email
          ? existingEmailMap.get(lead.email.toLowerCase().trim())
          : null;

      try {
        if (existingLead) {
          // Update existing lead with better data
          const updates: Record<string, unknown> = {};
          if (shouldReplaceValue(existingLead.name, lead.name, "name")) updates.name = lead.name;
          if (shouldReplaceValue(existingLead.company, lead.company, "company")) updates.company = lead.company;
          if (shouldReplaceValue(existingLead.email, lead.email, "email")) updates.email = lead.email;
          if (shouldReplaceValue(existingLead.phone, formattedPhone, "phone")) updates.phone = formattedPhone;
          if (shouldReplaceValue(existingLead.faturamento, lead.faturamento ? normalizeFaturamento(lead.faturamento) : undefined, "faturamento"))
            updates.faturamento = normalizeFaturamento(lead.faturamento!);
          if (shouldReplaceValue(existingLead.segment, lead.segment, "segment")) updates.segment = lead.segment;
          if (shouldReplaceValue((existingLead as any).utm_campaign, lead.utm_campaign, "utm")) updates.utm_campaign = lead.utm_campaign;
          if (shouldReplaceValue((existingLead as any).utm_source, lead.utm_source, "utm")) updates.utm_source = lead.utm_source;
          if (shouldReplaceValue((existingLead as any).utm_medium, lead.utm_medium, "utm")) updates.utm_medium = lead.utm_medium;
          if (shouldReplaceValue((existingLead as any).utm_content, lead.utm_content, "utm")) updates.utm_content = lead.utm_content;
          if (shouldReplaceValue((existingLead as any).utm_term, lead.utm_term, "utm")) updates.utm_term = lead.utm_term;
          if (lead.rating && (!existingLead.rating || existingLead.rating < lead.rating)) updates.rating = lead.rating;

          const mergedNotes = mergeNotes(existingLead.notes, lead.notes, lead.kommoBlock);
          if (mergedNotes && mergedNotes !== (existingLead.notes || "")) updates.notes = mergedNotes;

          if (Object.keys(updates).length > 0) {
            await supabase.from("leads").update(updates).eq("id", existingLead.id);
            report.updated++;
          } else {
            report.rejected++;
            report.errors.push({ row: rowIndex + 1, reason: "Lead já existe sem dados novos para atualizar" });
          }

          // Add to campaign if not already there
          const { data: existingCL } = await supabase
            .from("campanha_leads").select("id").eq("campanha_id", campanhaId).eq("lead_id", existingLead.id).maybeSingle();

          if (!existingCL) {
            const { assignedSdrId, assignedCloserId } = await resolveDistribution(
              supabase, campanhaId,
              autoDistribute, memberIds, distributionMode, distribution, sdrId,
              closerMemberIds, closerDistributionMode,
            );

            await supabase.from("campanha_leads").insert({
              campanha_id: campanhaId,
              lead_id: existingLead.id,
              stage_id: stageIdForLead,
              sdr_id: assignedSdrId,
              closer_id: assignedCloserId,
              responsible_id: assignedCloserId || assignedSdrId,
              pre_sale_responsible_id: assignedSdrId,
              sale_responsible_id: assignedCloserId,
            });

            const leadUpdates: Record<string, string> = {};
            if (assignedSdrId) leadUpdates.sdr_id = assignedSdrId;
            if (assignedCloserId) leadUpdates.closer_id = assignedCloserId;
            const responsibleId = assignedCloserId || assignedSdrId;
            if (responsibleId) leadUpdates.responsible_id = responsibleId;
            if (assignedSdrId) leadUpdates.pre_sale_responsible_id = assignedSdrId;
            if (assignedCloserId) leadUpdates.sale_responsible_id = assignedCloserId;
            if (Object.keys(leadUpdates).length > 0) {
              await supabase.from("leads").update(leadUpdates).eq("id", existingLead.id);
            }

            // Add tag
            const { data: existingTagLink } = await supabase
              .from("lead_tags").select("id").eq("lead_id", existingLead.id).eq("tag_id", tagId).maybeSingle();
            if (!existingTagLink) {
              await supabase.from("lead_tags").insert({ lead_id: existingLead.id, tag_id: tagId });
            }
          }

          await applyCustomFields(supabase, existingLead.id, lead.customFields, customFieldMap);
          if (formattedPhone) processedPhones.add(formattedPhone);
          continue;
        }

        // Insert new lead
        const { data: newLead, error: leadError } = await supabase
          .from("leads")
          .insert({
            organization_id: organizationId,
            name: lead.name,
            company: lead.company,
            phone: formattedPhone,
            email: lead.email,
            faturamento: lead.faturamento ? normalizeFaturamento(lead.faturamento) : undefined,
            segment: lead.segment,
            notes: mergeNotes(undefined, lead.notes, lead.kommoBlock),
            origin: "outro",
            rating: lead.rating || 0,
            utm_campaign: lead.utm_campaign,
            utm_source: lead.utm_source,
            utm_medium: lead.utm_medium,
            utm_content: lead.utm_content,
            utm_term: lead.utm_term,
          })
          .select("id")
          .single();

        if (leadError) {
          report.rejected++;
          report.errors.push({ row: rowIndex + 1, reason: `Erro ao inserir: ${leadError.message}` });
          continue;
        }

        const { assignedSdrId, assignedCloserId } = await resolveDistribution(
          supabase, campanhaId,
          autoDistribute, memberIds, distributionMode, distribution, sdrId,
          closerMemberIds, closerDistributionMode,
        );

        await supabase.from("campanha_leads").insert({
          campanha_id: campanhaId,
          lead_id: newLead.id,
          stage_id: stageIdForLead,
          sdr_id: assignedSdrId,
          closer_id: assignedCloserId,
          responsible_id: assignedCloserId || assignedSdrId,
          pre_sale_responsible_id: assignedSdrId,
          sale_responsible_id: assignedCloserId,
        });

        const leadUpdates: Record<string, string> = {};
        if (assignedSdrId) leadUpdates.sdr_id = assignedSdrId;
        if (assignedCloserId) leadUpdates.closer_id = assignedCloserId;
        const responsibleId2 = assignedCloserId || assignedSdrId;
        if (responsibleId2) leadUpdates.responsible_id = responsibleId2;
        if (assignedSdrId) leadUpdates.pre_sale_responsible_id = assignedSdrId;
        if (assignedCloserId) leadUpdates.sale_responsible_id = assignedCloserId;
        if (Object.keys(leadUpdates).length > 0) {
          await supabase.from("leads").update(leadUpdates).eq("id", newLead.id);
        }

        await supabase.from("lead_tags").insert({ lead_id: newLead.id, tag_id: tagId });
        await applyCustomFields(supabase, newLead.id, lead.customFields, customFieldMap);
        if (formattedPhone) processedPhones.add(formattedPhone);

        report.created++;
        createdLeadIds.push(newLead.id);
      } catch (err) {
        report.rejected++;
        report.errors.push({ row: rowIndex + 1, reason: `Erro inesperado: ${(err as Error).message}` });
      }
    }
  }

  // Bulk insert lead_history for created leads
  if (createdLeadIds.length > 0) {
    const historyRows = createdLeadIds.map((id) => ({
      lead_id: id,
      action: "lead_created",
      description: "Sistema: Lead importado via campanha",
      created_by: null,
    }));
    await supabase.from("lead_history").insert(historyRows);
  }

  report.distribution = autoDistribute ? distribution : undefined;
}

async function resolveDistribution(
  supabase: ReturnType<typeof createClient>,
  campanhaId: string,
  autoDistribute: boolean | undefined,
  memberIds: string[] | undefined,
  distributionMode: "round_robin" | "random" | undefined,
  distribution: Record<string, number>,
  sdrId: string | undefined,
  closerMemberIds: string[] | undefined,
  closerDistributionMode: "round_robin" | "random" | undefined,
): Promise<{ assignedSdrId: string | null; assignedCloserId: string | null }> {
  let assignedSdrId: string | null = null;
  if (autoDistribute && memberIds?.length) {
    if (distributionMode === "round_robin") {
      // Atomic RPC with advisory lock — each call sees updated counts
      const { data } = await supabase.rpc("distribute_campaign_round_robin", {
        p_campaign_id: campanhaId,
        p_member_ids: memberIds,
      });
      assignedSdrId = data ?? null;
    } else if (distributionMode === "random") {
      assignedSdrId = memberIds[Math.floor(Math.random() * memberIds.length)];
    } else {
      assignedSdrId = memberIds[0];
    }
    if (assignedSdrId) {
      distribution[assignedSdrId] = (distribution[assignedSdrId] || 0) + 1;
    }
  } else if (sdrId) {
    assignedSdrId = sdrId;
  }

  let assignedCloserId: string | null = null;
  if (closerMemberIds?.length) {
    if (closerDistributionMode === "round_robin") {
      const { data } = await supabase.rpc("distribute_campaign_round_robin", {
        p_campaign_id: campanhaId,
        p_member_ids: closerMemberIds,
      });
      assignedCloserId = data ?? null;
    } else if (closerDistributionMode === "random") {
      assignedCloserId = closerMemberIds[Math.floor(Math.random() * closerMemberIds.length)];
    } else {
      assignedCloserId = closerMemberIds[0];
    }
  }

  return { assignedSdrId, assignedCloserId };
}

// ─── Funnel Import ──────────────────────────────────────

// ─── Import to ANY pipeline — motor único (SCRUM-635, W4) ───────────────────
//
// Substitui `importToFunnel` + `importToCustomPipeline`: todo destino colapsa
// em `pipeline_id` e a escrita passa pelo choke `upsertPipeEntryDetailed`
// (pipeline-adapter), que já aceita id/slug de QUALQUER funil (SCRUM-623).
//
// Formatos legados preservados (aditivo):
//   · destination "funnel" + funnel_destination qualificacao|propostas|
//     confirmacao + stage_key → slug do funil de sistema;
//   · destination "custom_pipeline" + custom_pipeline_id + custom_stage_id
//     (pós-inversão do silo, o id do funil custom É `pipelines.id`);
//   · destination "pipeline" (canônico) + pipeline_id + pipeline_stage
//     (uuid de pipeline_stages ou stage_key).
//
// O caminho custom usava a RPC `import_lead_into_custom_pipeline` para
// suprimir o trigger `trg_auto_assign_lead_default_pipe` (corrida que duplicava
// o card em Oportunidades). MEDIDO em prod 2026-09-02: o trigger NÃO EXISTE
// mais (dropado por 20270824060000, em prod desde 24/08) — o insert direto do
// lead deixou de correr contra qualquer semeadura automática, então os dois
// caminhos convergem no mesmo insert + upsert do adapter.

const FUNNEL_DESTINATION_SLUG: Record<string, string> = {
  qualificacao: "whatsapp",
  propostas: "propostas",
  confirmacao: "confirmacao",
};

/** Nome que o usuário vê no relatório quando o funil de sistema não existe. */
const FUNNEL_DESTINATION_LABEL: Record<string, string> = {
  qualificacao: "Oportunidades",
  propostas: "Orçamentos",
  confirmacao: "Agendamentos",
};

interface PipelineStageRow {
  id: string;
  stage_key: string;
  name: string;
}

/**
 * Resolve a etapa por linha da planilha (coluna Etapa) para um stage_key.
 * Aliases do cliente (formatos legados `stages`/`custom_stages`) têm
 * precedência quando enviados — mesmo contrato de antes; as etapas reais do
 * funil (DB) cobrem o resto.
 */
function resolveRowStageKey(
  stageName: string | undefined,
  aliases: { stage_key: string; name: string }[],
  defaultStageKey: string,
): string {
  if (!aliases.length) return defaultStageKey;
  return resolveStageFromName(stageName, aliases, defaultStageKey);
}

async function importToPipeline(
  supabase: ReturnType<typeof createClient>,
  leads: ParsedLead[],
  payload: ImportPayload,
  report: ImportReport,
): Promise<void> {
  const {
    organization_id: organizationId,
    members,
    products: productsInput,
    sdr_id: defaultSdrId,
    closer_id: defaultCloserId,
    metrics_period_month,
    metrics_period_year,
  } = payload;

  // SEM FUNIL: o destino "leads" para no cadastro da pessoa. Não resolve
  // pipeline, não escolhe etapa, não escreve `pipeline_entries` — tudo o que
  // vem antes e depois (dedup por telefone/e-mail, campos personalizados,
  // vendedor da coluna, período de métricas, histórico) é idêntico, e é por
  // isso que ele mora aqui em vez de num motor paralelo que envelheceria à
  // parte.
  const semFunil = payload.destination === "leads";

  // ── 1. Colapsa o destino em (pipelineRef, etapa padrão) ────────────────────
  let pipelineRef: string | null = null;
  let defaultStageRaw: string | null = null;
  let legacyFunnelLabel: string | null = null;

  if (semFunil) {
    pipelineRef = null;
    defaultStageRaw = null;
  } else if (payload.destination === "funnel") {
    const dest = payload.funnel_destination;
    if (!dest) throw new Error("funnel_destination é obrigatório para importação em funil");
    if (!payload.stage_key) throw new Error("stage_key é obrigatório para importação em funil");
    pipelineRef = FUNNEL_DESTINATION_SLUG[dest] ?? dest;
    defaultStageRaw = payload.stage_key;
    legacyFunnelLabel = FUNNEL_DESTINATION_LABEL[dest] ?? dest;
  } else if (payload.destination === "custom_pipeline") {
    if (!payload.custom_pipeline_id) throw new Error("custom_pipeline_id é obrigatório para importação em pipeline custom");
    if (!payload.custom_stage_id) throw new Error("custom_stage_id é obrigatório para importação em pipeline custom");
    pipelineRef = payload.custom_pipeline_id;
    defaultStageRaw = payload.custom_stage_id;
  } else {
    if (!payload.pipeline_id) throw new Error("pipeline_id é obrigatório para importação em funil (destination='pipeline')");
    if (!payload.pipeline_stage) throw new Error("pipeline_stage é obrigatório para importação em funil (destination='pipeline')");
    pipelineRef = payload.pipeline_id;
    defaultStageRaw = payload.pipeline_stage;
  }

  // ── 2. Resolve o funil (id ou slug, qualquer funil ativo da org) ───────────
  let pipeline: ResolvedPipeline | null = null;
  if (!semFunil) {
    try {
      pipeline = await resolvePipeline(supabase, organizationId, pipelineRef!);
    } catch (err) {
      if (isPipelineResolutionError(err) && legacyFunnelLabel) {
        // Contrato legado do destino "funnel": org sem o funil de sistema não é
        // erro HTTP — cada linha sai rejeitada com a explicação de como ativar.
        for (let i = 0; i < leads.length; i++) {
          report.rejected++;
          report.errors.push({ row: i + 1, reason: motivoFalhaDeFunil("no_pipeline", legacyFunnelLabel) });
        }
        return;
      }
      if (isPipelineResolutionError(err)) {
        // Contrato legado do destino custom (e o canônico segue igual).
        throw new Error("Pipeline não encontrado ou não pertence a esta organização");
      }
      throw err;
    }
  }
  const funnelLabel = pipeline ? (pipeline.name || legacyFunnelLabel || pipeline.slug) : "";
  // Família de metadata por SLUG (ADR-0034: `type` nunca decide comportamento;
  // slug é único por org, medido 2026-09-02). Os 3 slugs históricos carregam a
  // semântica legada de vendedor/metadata; qualquer outro funil é genérico —
  // e sem funil também, para que a coluna Vendedor continue gravando
  // responsible_id/sdr_id no lead.
  const family: "whatsapp" | "confirmacao" | "propostas" | "generic" =
    pipeline && (pipeline.slug === "whatsapp" || pipeline.slug === "confirmacao" || pipeline.slug === "propostas")
      ? (pipeline.slug as "whatsapp" | "confirmacao" | "propostas")
      : "generic";

  // ── 3. Etapas reais do funil + etapa padrão ────────────────────────────────
  let defaultStageKey = "";
  let stageAliases: { stage_key: string; name: string }[] = [];

  if (pipeline) {
    const { data: stageRows } = await supabase
      .from("pipeline_stages")
      .select("id, stage_key, name")
      .eq("organization_id", organizationId)
      .eq("pipeline_id", pipeline.id)
      .eq("is_active", true)
      .order("position");
    const dbStages = (stageRows ?? []) as PipelineStageRow[];
    const stageById = new Map(dbStages.map((st) => [st.id, st]));

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(defaultStageRaw!)) {
      const st = stageById.get(defaultStageRaw!);
      if (!st) throw new Error("Etapa padrão não encontrada ou não pertence a este pipeline");
      defaultStageKey = st.stage_key;
    } else {
      // stage_key legado passa direto (contrato do destino "funnel": nunca
      // validou a key — o adapter grava o que veio).
      defaultStageKey = defaultStageRaw!;
    }

    // Aliases nome→stage_key para a coluna Etapa da planilha: lista do cliente
    // (formatos legados) tem precedência; sem ela, as etapas reais do funil.
    if (payload.stages?.length) {
      stageAliases = payload.stages;
    } else if (payload.custom_stages?.length) {
      stageAliases = payload.custom_stages
        .map((cs) => ({ stage_key: stageById.get(cs.id)?.stage_key ?? "", name: cs.name }))
        .filter((a) => a.stage_key);
    } else {
      stageAliases = dbStages.map((st) => ({ stage_key: st.stage_key, name: st.name }));
    }
  }

  const customFieldMap = await loadCustomFieldMap(supabase, organizationId);

  const metricsPeriodAt =
    metrics_period_month != null && metrics_period_year != null
      ? new Date(Date.UTC(metrics_period_year, metrics_period_month - 1, 1)).toISOString()
      : undefined;

  // Produtos só interessam ao funil de Orçamentos (propostas).
  let productsForPropostas = productsInput ?? [];
  if (family === "propostas" && productsForPropostas.length === 0) {
    const { data: productsFromDb } = await supabase
      .from("products").select("id, name").eq("organization_id", organizationId).order("name");
    productsForPropostas = (productsFromDb || []).map((p: any) => ({ id: p.id, name: p.name || "" }));
  }

  // ── 4. Pré-carrega leads existentes (telefone; email pra quem não tem) ─────
  const phones = leads.filter((l) => l.phone).map((l) => formatPhone(l.phone!));
  const existingMap = new Map<string, any>();
  if (phones.length > 0) {
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
      .eq("organization_id", organizationId)
      .in("phone", phones);
    existingLeads?.forEach((l: any) => { if (l.phone) existingMap.set(l.phone, l); });
  }

  const emailsOnly = leads.filter((l) => !l.phone && l.email).map((l) => l.email!.toLowerCase().trim());
  const existingEmailMap = new Map<string, any>();
  if (emailsOnly.length > 0) {
    const { data: existingByEmail } = await supabase
      .from("leads")
      .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
      .eq("organization_id", organizationId)
      .in("email", emailsOnly);
    existingByEmail?.forEach((l: any) => { if (l.email) existingEmailMap.set(l.email.toLowerCase(), l); });
  }

  const processedPhones = new Set<string>();
  const createdLeadIds: string[] = [];
  const BATCH_SIZE = 50;
  const membersList = members ?? [];

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);

    for (const lead of batch) {
      const rowIndex = leads.indexOf(lead);
      const formattedPhone = lead.phone ? formatPhone(lead.phone) : undefined;

      if (formattedPhone && processedPhones.has(formattedPhone)) {
        report.rejected++;
        report.errors.push({ row: rowIndex + 1, reason: "Telefone duplicado neste arquivo" });
        continue;
      }

      const existingLead = formattedPhone
        ? existingMap.get(formattedPhone)
        : lead.email
          ? existingEmailMap.get(lead.email.toLowerCase().trim())
          : null;

      try {
        let leadId: string;
        let leadWasCreated = false;

        if (existingLead) {
          leadId = existingLead.id;
          const updates: Record<string, unknown> = {};
          if (shouldReplaceValue(existingLead.name, lead.name, "name")) updates.name = lead.name;
          if (shouldReplaceValue(existingLead.company, lead.company, "company")) updates.company = lead.company;
          if (shouldReplaceValue(existingLead.email, lead.email, "email")) updates.email = lead.email;
          if (shouldReplaceValue(existingLead.phone, formattedPhone, "phone")) updates.phone = formattedPhone;
          if (shouldReplaceValue(existingLead.faturamento, lead.faturamento ? normalizeFaturamento(lead.faturamento) : undefined, "faturamento"))
            updates.faturamento = normalizeFaturamento(lead.faturamento!);
          if (shouldReplaceValue(existingLead.segment, lead.segment, "segment")) updates.segment = lead.segment;
          if (metricsPeriodAt != null) updates.metrics_period_at = metricsPeriodAt;

          if (Object.keys(updates).length > 0) {
            await supabase.from("leads").update(updates).eq("id", existingLead.id);
            report.updated++;
          } else {
            report.rejected++;
            report.errors.push({ row: rowIndex + 1, reason: "Lead já existe sem dados novos para atualizar" });
          }
        } else {
          const leadInsert: Record<string, unknown> = {
            organization_id: organizationId,
            name: lead.name,
            company: lead.company,
            phone: formattedPhone,
            email: lead.email,
            faturamento: lead.faturamento ? normalizeFaturamento(lead.faturamento) : undefined,
            segment: lead.segment,
            notes: mergeNotes(undefined, lead.notes, lead.kommoBlock),
            origin: "outro",
            rating: lead.rating || 0,
            utm_campaign: lead.utm_campaign,
            utm_source: lead.utm_source,
            utm_medium: lead.utm_medium,
            utm_content: lead.utm_content,
            utm_term: lead.utm_term,
          };
          if (metricsPeriodAt != null) leadInsert.metrics_period_at = metricsPeriodAt;

          const { data: newLead, error: leadError } = await supabase
            .from("leads").insert(leadInsert).select("id").single();

          if (leadError) {
            report.rejected++;
            report.errors.push({ row: rowIndex + 1, reason: `Erro ao inserir lead: ${truncateErr(leadError.message)}` });
            continue;
          }
          leadId = newLead.id;
          leadWasCreated = true;
          report.created++;
          createdLeadIds.push(newLead.id);
        }

        // Campos personalizados → lead_custom_field_values (upsert por lead+field)
        await applyCustomFields(supabase, leadId, lead.customFields, customFieldMap);

        // Etapa da linha (coluna Etapa da planilha) → stage_key
        const stageKeyForLead = resolveRowStageKey(lead.stage, stageAliases, defaultStageKey);

        // Vendedor(es) — semântica por família preservada dos caminhos legados.
        const sdrIdForLead = family !== "propostas"
          ? resolveSellerToId(lead.seller_name, membersList, defaultSdrId ?? null)
          : null;
        const closerIdForLead = family !== "whatsapp" && family !== "generic"
          ? resolveSellerToId(lead.seller_name, membersList, defaultCloserId ?? null)
          : null;

        // Atualiza os papéis no lead — funis de sistema gravam o conjunto
        // completo (sdr/closer/responsible/pre_sale/sale); o genérico grava
        // responsible+sdr (contrato legado do caminho custom).
        const leadUpdates: Record<string, unknown> = {};
        if (family === "generic") {
          if (sdrIdForLead) {
            leadUpdates.responsible_id = sdrIdForLead;
            leadUpdates.sdr_id = sdrIdForLead;
          }
        } else {
          if (sdrIdForLead) leadUpdates.sdr_id = sdrIdForLead;
          if (closerIdForLead) leadUpdates.closer_id = closerIdForLead;
          const responsibleIdForLead = closerIdForLead || sdrIdForLead;
          if (responsibleIdForLead) leadUpdates.responsible_id = responsibleIdForLead;
          if (sdrIdForLead) leadUpdates.pre_sale_responsible_id = sdrIdForLead;
          if (closerIdForLead) leadUpdates.sale_responsible_id = closerIdForLead;
        }
        if (Object.keys(leadUpdates).length > 0) {
          await supabase.from("leads").update(leadUpdates).eq("id", leadId);
        }

        // Metadata + responsável da entry, por família.
        let entryMetadata: Record<string, unknown> = {};
        let entryAssignedTo: string | null = null;
        let entryNotes: string | null | undefined = undefined;
        let productIds: string[] = [];
        let totalValue: number | null = null;

        if (family === "whatsapp") {
          entryMetadata = { sdr_id: sdrIdForLead, responsible_id: sdrIdForLead };
          entryAssignedTo = sdrIdForLead;
        } else if (family === "confirmacao") {
          entryMetadata = {
            sdr_id: sdrIdForLead,
            closer_id: closerIdForLead,
            meeting_date: lead.commitment_date ?? null,
          };
          if (metricsPeriodAt != null) entryMetadata.metrics_period_at = metricsPeriodAt;
          entryAssignedTo = closerIdForLead || sdrIdForLead;
          entryNotes = lead.pipe_notes ?? null;
        } else if (family === "propostas") {
          const productNamesRaw = (lead.product_name || "").trim();
          const productNames = productNamesRaw
            ? productNamesRaw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
            : [];
          for (const name of productNames) {
            const id = resolveProductToId(name, productsForPropostas, null);
            if (id) productIds.push(id);
          }
          totalValue = lead.valor_proposta ?? null;
          entryMetadata = {
            closer_id: closerIdForLead,
            responsible_id: closerIdForLead,
            sale_value: totalValue,
            calor: lead.calor ?? null,
            commitment_date: lead.commitment_date ?? null,
            contract_duration: lead.contract_duration ?? null,
            product_id: productIds.length > 0 ? productIds[0] : null,
          };
          if (metricsPeriodAt != null) entryMetadata.metrics_period_at = metricsPeriodAt;
          entryAssignedTo = closerIdForLead;
          entryNotes = lead.pipe_notes ?? null;
        } else {
          entryAssignedTo = sdrIdForLead;
        }

        // SEM FUNIL: acabou aqui. A pessoa está cadastrada, com vendedor e
        // campos personalizados; nenhum negócio foi aberto em nome dela.
        if (semFunil) {
          if (formattedPhone) processedPhones.add(formattedPhone);
          continue;
        }

        // Escrita da entry — choke único (adapter, por pipeline_id).
        const entryResult = await upsertPipeEntryDetailed(supabase, {
          leadId,
          orgId: organizationId,
          slug: pipeline!.id,
          stageKey: stageKeyForLead,
          metadata: entryMetadata,
          assignedTo: entryAssignedTo,
          ...(entryNotes !== undefined ? { notes: entryNotes } : {}),
        });

        if (entryResult.status !== "created" && entryResult.status !== "updated") {
          report.rejected++;
          report.errors.push({ row: rowIndex + 1, reason: motivoFalhaDeFunil(entryResult.status, funnelLabel) });
          // Lead novo que não entrou no funil não conta como importado — o
          // caminho custom já fazia esta contabilidade; agora vale pra todos.
          if (leadWasCreated) report.created = Math.max(0, report.created - 1);
          continue;
        }

        // Itens de produto (só Orçamentos) — ainda por pipe_proposta_items.
        if (family === "propostas" && productIds.length > 0) {
          const n = productIds.length;
          const valuePerItem = totalValue != null && n > 0 ? Math.floor(totalValue / n) : null;
          const remainder = totalValue != null && n > 0 ? totalValue - (valuePerItem ?? 0) * n : 0;
          const itemsToInsert = productIds.map((product_id, index) => ({
            pipe_proposta_id: entryResult.entryId,
            product_id,
            sale_value: totalValue != null && valuePerItem != null
              ? (index < n - 1 ? valuePerItem : valuePerItem + remainder)
              : null,
          }));
          await supabase.from("pipe_proposta_items").insert(itemsToInsert);
        }

        if (formattedPhone) processedPhones.add(formattedPhone);
      } catch (err) {
        report.rejected++;
        report.errors.push({ row: rowIndex + 1, reason: `Erro inesperado: ${(err as Error).message}` });
      }
    }
  }

  // Bulk insert lead_history for created leads
  if (createdLeadIds.length > 0) {
    const historyRows = createdLeadIds.map((id) => ({
      lead_id: id,
      action: "lead_created",
      description: semFunil
        ? "Sistema: Lead importado por planilha (sem funil)"
        : payload.destination === "custom_pipeline"
          ? "Sistema: Lead importado via pipeline custom"
          : "Sistema: Lead importado via funil",
      created_by: null,
    }));
    await supabase.from("lead_history").insert(historyRows);
  }
}

// ─── Main Handler ───────────────────────────────────────

Deno.serve(
  withErrorBoundary("import-leads", async (req: Request): Promise<Response> => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. JWT Authentication — resolve org from authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return unauthorizedResponse("Missing Authorization header", corsHeaders);
    }
    const jwt = authHeader.slice(7);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return unauthorizedResponse("Invalid token", corsHeaders);
    }

    const userId = userData.user.id;
    const supabaseEarly = getServiceClient();

    // Parse body first so we can resolve the target org for master users
    // (master may not have a team_members row in the target org).
    let body: ImportPayload;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "JSON inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve organization:
    //  1. Scoped membership match (user is member of body.organization_id)
    //  2. Master fallback (active master may target any org via body.organization_id)
    //  3. Legacy fallback (first membership when body.organization_id is missing)
    let organizationId: string | null = null;

    if (body.organization_id) {
      const { data: scoped } = await supabaseEarly
        .from("team_members")
        .select("organization_id")
        .eq("user_id", userId)
        .eq("organization_id", body.organization_id)
        .maybeSingle();
      if (scoped?.organization_id) {
        organizationId = scoped.organization_id;
      } else {
        const { data: masterRow } = await supabaseEarly
          .from("master_users")
          .select("id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();
        if (masterRow) organizationId = body.organization_id;
      }
    }

    if (!organizationId) {
      const { data: legacy } = await supabaseEarly
        .from("team_members")
        .select("organization_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (!legacy?.organization_id) {
        return unauthorizedResponse("User not associated with any organization", corsHeaders);
      }
      organizationId = legacy.organization_id;
    }

    // 4. Validate payload
    if (!body.leads || !Array.isArray(body.leads) || body.leads.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Array de leads vazio ou inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!body.destination || !["campaign", "funnel", "custom_pipeline", "pipeline", "leads"].includes(body.destination)) {
      return new Response(
        JSON.stringify({ success: false, error: "destination deve ser 'campaign', 'funnel', 'custom_pipeline', 'pipeline' ou 'leads'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 5. Validate each lead
    const validLeads: ParsedLead[] = [];
    const report: ImportReport = { total: body.leads.length, created: 0, updated: 0, rejected: 0, incomplete: 0, errors: [] };

    for (let i = 0; i < body.leads.length; i++) {
      const validationError = validateLead(body.leads[i], i);
      if (validationError) {
        report.rejected++;
        report.errors.push({ row: i + 1, reason: validationError });
      } else {
        if (isIncomplete(body.leads[i])) report.incomplete++;
        validLeads.push(body.leads[i]);
      }
    }

    // 6. Process valid leads
    const supabase = supabaseEarly; // reuse client created in step 3

    try {
      if (body.destination === "campaign") {
        await importToCampaign(supabase, validLeads, { ...body, organization_id: organizationId }, report);
      } else {
        // funnel | custom_pipeline | pipeline — os três colapsam no motor
        // único por pipeline_id (SCRUM-635). "leads" entra no mesmo motor e
        // sai antes da escrita da entry.
        await importToPipeline(supabase, validLeads, { ...body, organization_id: organizationId }, report);
      }
    } catch (err) {
      console.error("[import-leads] Processing error:", err);

      await logRuntime({
        organizationId: organizationId,
        module: "pipe_dispatch",
        action: "import_leads",
        status: "error",
        errorMessage: (err as Error).message,
        entityType: "user",
        entityId: userId,
        payloadSnapshot: {
          destination: body.destination,
          totalLeads: body.leads.length,
          validLeads: validLeads.length,
        },
      });

      return new Response(
        JSON.stringify({ success: false, error: (err as Error).message, report }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 7. Log success
    await logRuntime({
      organizationId: organizationId,
      module: "pipe_dispatch",
      action: "import_leads",
      status: "success",
      entityType: "user",
      entityId: userId,
      payloadSnapshot: {
        destination: body.destination,
        total: report.total,
        created: report.created,
        updated: report.updated,
        rejected: report.rejected,
      },
    });

    // Track usage event (fire-and-forget)
    trackEvent({
      organizationId: organizationId,
      userId: userId,
      eventType: "import_completed",
      entityType: "lead",
      metadata: {
        destination: body.destination,
        total: report.total,
        created: report.created,
        updated: report.updated,
        rejected: report.rejected,
      },
    }).catch(() => {});

    // Truncate errors array to 100 items max for response size
    const truncatedErrors = report.errors.length > 100
      ? [...report.errors.slice(0, 100), { row: -1, reason: `... e mais ${report.errors.length - 100} erros` }]
      : report.errors;

    return new Response(
      JSON.stringify({
        success: true,
        report: { ...report, errors: truncatedErrors },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }),
);
