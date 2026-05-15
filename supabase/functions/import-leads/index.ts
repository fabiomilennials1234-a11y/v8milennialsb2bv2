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
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logRuntime } from "../_shared/logger.ts";
import { trackEvent } from "../_shared/track.ts";
import { upsertPipeEntry } from "../_shared/pipeline-adapter.ts";
import { unauthorizedResponse } from "../_shared/auth.ts";

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
}

interface ImportPayload {
  leads: ParsedLead[];
  organization_id: string;
  destination: "campaign" | "funnel" | "custom_pipeline";

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

function formatPhone(phone: string): string {
  // Trata notação científica do Excel — suporta ponto ("5.51E+12") e vírgula pt-BR ("7,1994E+10")
  const trimmed = (phone || "").trim();
  const dotted = trimmed.replace(",", ".");
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(dotted)) {
    const num = Number(dotted);
    if (!isNaN(num) && num > 0) {
      return formatPhone(Math.round(num).toString());
    }
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function validatePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
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

async function importToFunnel(
  supabase: ReturnType<typeof createClient>,
  leads: ParsedLead[],
  payload: ImportPayload,
  report: ImportReport,
): Promise<void> {
  const {
    organization_id: organizationId,
    funnel_destination: destination,
    stage_key: defaultStageKey,
    stages,
    members,
    products: productsInput,
    sdr_id: defaultSdrId,
    closer_id: defaultCloserId,
    metrics_period_month,
    metrics_period_year,
  } = payload;

  if (!destination) throw new Error("funnel_destination é obrigatório para importação em funil");
  if (!defaultStageKey) throw new Error("stage_key é obrigatório para importação em funil");

  const metricsPeriodAt =
    metrics_period_month != null && metrics_period_year != null
      ? new Date(Date.UTC(metrics_period_year, metrics_period_month - 1, 1)).toISOString()
      : undefined;

  // Load products for propostas if not provided
  let productsForPropostas = productsInput ?? [];
  if (destination === "propostas" && productsForPropostas.length === 0) {
    const { data: productsFromDb } = await supabase
      .from("products").select("id, name").eq("organization_id", organizationId).order("name");
    productsForPropostas = (productsFromDb || []).map((p: any) => ({ id: p.id, name: p.name || "" }));
  }

  // Pre-fetch existing leads by phone
  const phones = leads.filter((l) => l.phone).map((l) => formatPhone(l.phone!));
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
    .eq("organization_id", organizationId)
    .in("phone", phones);

  const existingMap = new Map<string, NonNullable<typeof existingLeads>[number]>();
  existingLeads?.forEach((l) => { if (l.phone) existingMap.set(l.phone, l); });

  // Pre-fetch existing leads by email for leads without phone
  const emailsOnlyFunnel = leads
    .filter((l) => !l.phone && l.email)
    .map((l) => l.email!.toLowerCase().trim());
  const existingEmailMapFunnel = new Map<string, NonNullable<typeof existingLeads>[number]>();
  if (emailsOnlyFunnel.length > 0) {
    const { data: existingByEmailFunnel } = await supabase
      .from("leads")
      .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
      .eq("organization_id", organizationId)
      .in("email", emailsOnlyFunnel);
    existingByEmailFunnel?.forEach((l) => { if (l.email) existingEmailMapFunnel.set(l.email.toLowerCase(), l); });
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
          ? existingEmailMapFunnel.get(lead.email.toLowerCase().trim())
          : null;

      try {
        let leadId: string;

        if (existingLead) {
          leadId = existingLead.id;
          const updates: Record<string, unknown> = {};
          if (shouldReplaceValue(existingLead.name, lead.name, "name")) updates.name = lead.name;
          if (shouldReplaceValue(existingLead.company, lead.company, "company")) updates.company = lead.company;
          if (shouldReplaceValue(existingLead.email, lead.email, "email")) updates.email = lead.email;
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
            report.errors.push({ row: rowIndex + 1, reason: `Erro ao inserir lead: ${leadError.message}` });
            continue;
          }
          leadId = newLead.id;
          report.created++;
          createdLeadIds.push(newLead.id);
        }

        // Resolve stage
        const stageKeyForLead =
          stages?.length
            ? resolveStageFromName(lead.stage, stages, defaultStageKey)
            : defaultStageKey;

        // Resolve seller
        const sdrIdForLead = destination !== "propostas"
          ? resolveSellerToId(lead.seller_name, membersList, defaultSdrId ?? null)
          : null;
        const closerIdForLead = destination !== "qualificacao"
          ? resolveSellerToId(lead.seller_name, membersList, defaultCloserId ?? null)
          : null;

        // Update lead with assigned SDR/closer
        const leadUpdates: Record<string, unknown> = {};
        if (sdrIdForLead) leadUpdates.sdr_id = sdrIdForLead;
        if (closerIdForLead) leadUpdates.closer_id = closerIdForLead;
        const responsibleIdForLead = closerIdForLead || sdrIdForLead;
        if (responsibleIdForLead) leadUpdates.responsible_id = responsibleIdForLead;
        if (sdrIdForLead) leadUpdates.pre_sale_responsible_id = sdrIdForLead;
        if (closerIdForLead) leadUpdates.sale_responsible_id = closerIdForLead;
        if (Object.keys(leadUpdates).length > 0) {
          await supabase.from("leads").update(leadUpdates).eq("id", leadId);
        }

        // Insert into pipeline via adapter
        if (destination === "qualificacao") {
          await upsertPipeEntry(supabase, {
            leadId,
            orgId: organizationId,
            slug: "whatsapp",
            stageKey: stageKeyForLead,
            metadata: { sdr_id: sdrIdForLead, responsible_id: sdrIdForLead },
            assignedTo: sdrIdForLead,
          });
        } else if (destination === "propostas") {
          const productNamesRaw = (lead.product_name || "").trim();
          const productNames = productNamesRaw
            ? productNamesRaw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
            : [];
          const productIds: string[] = [];
          for (const name of productNames) {
            const id = resolveProductToId(name, productsForPropostas, null);
            if (id) productIds.push(id);
          }
          const firstProductId = productIds.length > 0 ? productIds[0] : null;
          const totalValue = lead.valor_proposta ?? null;

          const propostaMetadata: Record<string, unknown> = {
            closer_id: closerIdForLead,
            responsible_id: closerIdForLead,
            sale_value: totalValue,
            calor: lead.calor ?? null,
            commitment_date: lead.commitment_date ?? null,
            contract_duration: lead.contract_duration ?? null,
            product_id: firstProductId,
          };
          if (metricsPeriodAt != null) propostaMetadata.metrics_period_at = metricsPeriodAt;

          const propostaEntryId = await upsertPipeEntry(supabase, {
            leadId,
            orgId: organizationId,
            slug: "propostas",
            stageKey: stageKeyForLead,
            metadata: propostaMetadata,
            assignedTo: closerIdForLead,
            notes: lead.pipe_notes ?? null,
          });

          if (!propostaEntryId) {
            report.rejected++;
            report.errors.push({ row: rowIndex + 1, reason: "Erro ao inserir proposta via pipeline_entries" });
            continue;
          }

          // Insert product items (still uses pipe_proposta_items with entry id)
          if (productIds.length > 0) {
            const n = productIds.length;
            const valuePerItem = totalValue != null && n > 0 ? Math.floor(totalValue / n) : null;
            const remainder = totalValue != null && n > 0 ? totalValue - (valuePerItem ?? 0) * n : 0;
            const itemsToInsert = productIds.map((product_id, index) => ({
              pipe_proposta_id: propostaEntryId,
              product_id,
              sale_value: totalValue != null && valuePerItem != null
                ? (index < n - 1 ? valuePerItem : valuePerItem + remainder)
                : null,
            }));
            await supabase.from("pipe_proposta_items").insert(itemsToInsert);
          }
        } else {
          // confirmacao
          const confirmacaoMetadata: Record<string, unknown> = {
            sdr_id: sdrIdForLead,
            closer_id: closerIdForLead,
            meeting_date: lead.commitment_date ?? null,
          };
          if (metricsPeriodAt != null) confirmacaoMetadata.metrics_period_at = metricsPeriodAt;
          await upsertPipeEntry(supabase, {
            leadId,
            orgId: organizationId,
            slug: "confirmacao",
            stageKey: stageKeyForLead,
            metadata: confirmacaoMetadata,
            assignedTo: closerIdForLead || sdrIdForLead,
            notes: lead.pipe_notes ?? null,
          });
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
      description: "Sistema: Lead importado via funil",
      created_by: null,
    }));
    await supabase.from("lead_history").insert(historyRows);
  }
}

// ─── Import to Custom Pipeline ──────────────────────────

async function importToCustomPipeline(
  supabase: ReturnType<typeof createClient>,
  leads: ParsedLead[],
  payload: ImportPayload,
  report: ImportReport,
): Promise<void> {
  const {
    organization_id: organizationId,
    custom_pipeline_id: pipelineId,
    custom_stage_id: defaultStageId,
    custom_stages: stages,
    sdr_id: defaultSdrId,
    members,
  } = payload;

  if (!pipelineId) throw new Error("custom_pipeline_id é obrigatório para importação em pipeline custom");
  if (!defaultStageId) throw new Error("custom_stage_id é obrigatório para importação em pipeline custom");

  // Validate pipeline belongs to this organization and is active
  const { data: pipelineRow } = await supabase
    .from("custom_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();
  if (!pipelineRow) throw new Error("Pipeline custom não encontrado ou não pertence a esta organização");

  // Validate default stage belongs to this pipeline
  const { data: stageRow } = await supabase
    .from("custom_pipeline_stages")
    .select("id")
    .eq("id", defaultStageId)
    .eq("pipeline_id", pipelineId)
    .eq("is_active", true)
    .maybeSingle();
  if (!stageRow) throw new Error("Etapa padrão não encontrada ou não pertence a este pipeline");

  // Pre-fetch existing leads by phone (skip .in() with empty array — PostgREST rejects it)
  const phones = leads.filter((l) => l.phone).map((l) => formatPhone(l.phone!));
  const existingMap = new Map<string, { id: string; phone: string | null; name: string; company: string | null; email: string | null; faturamento: string | null; segment: string | null }>();
  if (phones.length > 0) {
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
      .eq("organization_id", organizationId)
      .in("phone", phones);
    existingLeads?.forEach((l: any) => { if (l.phone) existingMap.set(l.phone, l); });
  }

  // Pre-fetch existing leads by email for leads without phone
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

        if (existingLead) {
          leadId = existingLead.id;
          const updates: Record<string, unknown> = {};
          if (shouldReplaceValue(existingLead.name, lead.name, "name")) updates.name = lead.name;
          if (shouldReplaceValue(existingLead.company, lead.company, "company")) updates.company = lead.company;
          if (shouldReplaceValue(existingLead.email, lead.email, "email")) updates.email = lead.email;
          if (shouldReplaceValue(existingLead.faturamento, lead.faturamento ? normalizeFaturamento(lead.faturamento) : undefined, "faturamento"))
            updates.faturamento = normalizeFaturamento(lead.faturamento!);
          if (shouldReplaceValue(existingLead.segment, lead.segment, "segment")) updates.segment = lead.segment;

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

          const { data: newLead, error: leadError } = await supabase
            .from("leads").insert(leadInsert).select("id").single();

          if (leadError) {
            report.rejected++;
            report.errors.push({ row: rowIndex + 1, reason: `Erro ao inserir lead: ${leadError.message}` });
            continue;
          }
          leadId = newLead.id;
          report.created++;
          createdLeadIds.push(newLead.id);
        }

        // Resolve stage — match by name if stages provided, fallback to default
        const stageIdForLead = stages?.length
          ? resolveCustomStageFromName(lead.stage, stages, defaultStageId)
          : defaultStageId;

        // Resolve seller
        const assignedTo = resolveSellerToId(lead.seller_name, membersList, defaultSdrId ?? null);

        // Update lead responsible
        if (assignedTo) {
          await supabase.from("leads").update({ responsible_id: assignedTo, sdr_id: assignedTo }).eq("id", leadId);
        }

        // Upsert into custom_pipe_entries
        const { data: existingEntry, error: existingEntryError } = await supabase
          .from("custom_pipe_entries")
          .select("id")
          .eq("lead_id", leadId)
          .eq("pipeline_id", pipelineId)
          .maybeSingle();

        if (existingEntryError) {
          report.errors.push({
            row: rowIndex + 1,
            reason: `Falha ao verificar funil existente: ${truncateErr(existingEntryError.message)}`,
          });
          if (!existingLead) {
            report.created = Math.max(0, report.created - 1);
            report.rejected++;
          }
          continue;
        }

        let pipeEntryError: { message: string } | null = null;

        if (existingEntry) {
          const { error: updateError } = await supabase
            .from("custom_pipe_entries")
            .update({
              stage_id: stageIdForLead,
              assigned_to: assignedTo,
              stage_changed_at: new Date().toISOString(),
            })
            .eq("id", existingEntry.id)
            .select("id")
            .single();
          pipeEntryError = updateError;
        } else {
          const { error: insertError } = await supabase
            .from("custom_pipe_entries")
            .insert({
              lead_id: leadId,
              organization_id: organizationId,
              pipeline_id: pipelineId,
              stage_id: stageIdForLead,
              assigned_to: assignedTo,
              entered_at: new Date().toISOString(),
              stage_changed_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          pipeEntryError = insertError;
        }

        if (pipeEntryError) {
          console.error("[import-leads] custom_pipe_entries write failed", {
            row: rowIndex + 1,
            leadId,
            pipelineId,
            stageId: stageIdForLead,
            assignedTo,
            error: pipeEntryError.message,
          });
          report.errors.push({
            row: rowIndex + 1,
            reason: `Lead criado mas não entrou no funil: ${truncateErr(pipeEntryError.message)}`,
          });
          if (!existingLead) {
            report.created = Math.max(0, report.created - 1);
            report.rejected++;
          }
          continue;
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
      description: "Sistema: Lead importado via pipeline custom",
      created_by: null,
    }));
    await supabase.from("lead_history").insert(historyRows);
  }
}

/** Resolve stage name to custom stage ID (with accent normalization and fuzzy match) */
function resolveCustomStageFromName(
  stageName: string | undefined,
  stages: { id: string; name: string }[],
  defaultStageId: string,
): string {
  if (!stageName?.trim()) return defaultStageId;
  const inputNorm = stageComparable(stageName);
  if (!inputNorm) return defaultStageId;
  // 1) Exact match
  const exact = stages.find((s) => stageComparable(s.name) === inputNorm);
  if (exact) return exact.id;
  // 2) Contains match
  const contains = stages.find((s) => {
    const n = stageComparable(s.name);
    return n.includes(inputNorm) || inputNorm.includes(n);
  });
  if (contains) return contains.id;
  // 3) Starts with match
  const startsWith = stages.find((s) => {
    const n = stageComparable(s.name);
    return inputNorm.startsWith(n) || n.startsWith(inputNorm);
  });
  if (startsWith) return startsWith.id;
  return defaultStageId;
}

// ─── Main Handler ───────────────────────────────────────

Deno.serve(
  withSentry("import-leads", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));

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

    // Resolve organization from team_members (server-side — ignores body org_id)
    const { data: membership, error: memberErr } = await supabaseEarly
      .from("team_members")
      .select("organization_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (memberErr || !membership?.organization_id) {
      return unauthorizedResponse("User not associated with any organization", corsHeaders);
    }
    const organizationId = membership.organization_id;

    // 2. Parse body
    let body: ImportPayload;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "JSON inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Validate payload
    if (!body.leads || !Array.isArray(body.leads) || body.leads.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Array de leads vazio ou inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!body.destination || !["campaign", "funnel", "custom_pipeline"].includes(body.destination)) {
      return new Response(
        JSON.stringify({ success: false, error: "destination deve ser 'campaign', 'funnel' ou 'custom_pipeline'" }),
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
      } else if (body.destination === "custom_pipeline") {
        await importToCustomPipeline(supabase, validLeads, { ...body, organization_id: organizationId }, report);
      } else {
        await importToFunnel(supabase, validLeads, { ...body, organization_id: organizationId }, report);
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
