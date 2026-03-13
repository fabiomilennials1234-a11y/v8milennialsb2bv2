/**
 * Edge Function: import-leads
 *
 * Centraliza a importação de leads no backend.
 * O frontend faz o parse do arquivo (CSV/XLSX) e mapeamento de colunas,
 * depois envia o array de leads parseados para esta Edge Function que:
 * 1. Autentica via requireAuth()
 * 2. Verifica permissão via canUserPerformAction({ action: 'import_leads' })
 * 3. Valida cada lead (name obrigatório, phone ou email obrigatório, formato phone)
 * 4. Dedup por phone com merge inteligente
 * 5. Processa em batches de 50
 * 6. Retorna relatório detalhado
 * 7. Loga execução com logRuntime()
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logRuntime } from "../_shared/logger.ts";
import { trackEvent } from "../_shared/track.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { canUserPerformAction } from "../_shared/permission_engine.ts";

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
  destination: "campaign" | "funnel";

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
}

interface ImportReport {
  total: number;
  created: number;
  updated: number;
  rejected: number;
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
  if (!lead.phone?.trim() && !lead.email?.trim()) return `Linha ${index + 1}: telefone ou email é obrigatório`;
  if (lead.phone?.trim() && !validatePhone(lead.phone)) {
    return `Linha ${index + 1}: telefone inválido (${lead.phone}) — esperado 10-13 dígitos`;
  }
  return null;
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

  // Distribution setup
  const distribution: Record<string, number> = {};
  let memberIndex = 0;
  if (autoDistribute && memberIds?.length) {
    memberIds.forEach((id) => { distribution[id] = 0; });
    if (distributionMode === "round_robin") {
      const { count } = await supabase.from("campanha_leads").select("id", { count: "exact", head: true }).eq("campanha_id", campanhaId);
      memberIndex = count ?? 0;
    }
  }
  let closerIndex = 0;
  if (closerMemberIds?.length && closerDistributionMode === "round_robin") {
    const { count } = await supabase.from("campanha_leads").select("id", { count: "exact", head: true }).eq("campanha_id", campanhaId).not("closer_id", "is", null);
    closerIndex = count ?? 0;
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

      const existingLead = formattedPhone ? existingMap.get(formattedPhone) : null;

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
            const { assignedSdrId, assignedCloserId } = resolveDistribution(
              autoDistribute, memberIds, distributionMode, memberIndex, distribution, sdrId,
              closerMemberIds, closerDistributionMode, closerIndex,
            );
            if (assignedSdrId && autoDistribute) memberIndex++;
            if (assignedCloserId && closerMemberIds?.length) closerIndex++;

            await supabase.from("campanha_leads").insert({
              campanha_id: campanhaId,
              lead_id: existingLead.id,
              stage_id: stageIdForLead,
              sdr_id: assignedSdrId,
              closer_id: assignedCloserId,
            });

            const leadUpdates: Record<string, string> = {};
            if (assignedSdrId) leadUpdates.sdr_id = assignedSdrId;
            if (assignedCloserId) leadUpdates.closer_id = assignedCloserId;
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

        const { assignedSdrId, assignedCloserId } = resolveDistribution(
          autoDistribute, memberIds, distributionMode, memberIndex, distribution, sdrId,
          closerMemberIds, closerDistributionMode, closerIndex,
        );
        if (assignedSdrId && autoDistribute) memberIndex++;
        if (assignedCloserId && closerMemberIds?.length) closerIndex++;

        await supabase.from("campanha_leads").insert({
          campanha_id: campanhaId,
          lead_id: newLead.id,
          stage_id: stageIdForLead,
          sdr_id: assignedSdrId,
          closer_id: assignedCloserId,
        });

        const leadUpdates: Record<string, string> = {};
        if (assignedSdrId) leadUpdates.sdr_id = assignedSdrId;
        if (assignedCloserId) leadUpdates.closer_id = assignedCloserId;
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

function resolveDistribution(
  autoDistribute: boolean | undefined,
  memberIds: string[] | undefined,
  distributionMode: "round_robin" | "random" | undefined,
  memberIndex: number,
  distribution: Record<string, number>,
  sdrId: string | undefined,
  closerMemberIds: string[] | undefined,
  closerDistributionMode: "round_robin" | "random" | undefined,
  closerIndex: number,
): { assignedSdrId: string | null; assignedCloserId: string | null } {
  let assignedSdrId: string | null = null;
  if (autoDistribute && memberIds?.length) {
    if (distributionMode === "random") {
      assignedSdrId = memberIds[Math.floor(Math.random() * memberIds.length)];
    } else {
      assignedSdrId = memberIds[memberIndex % memberIds.length];
    }
    distribution[assignedSdrId] = (distribution[assignedSdrId] || 0) + 1;
  } else if (sdrId) {
    assignedSdrId = sdrId;
  }

  let assignedCloserId: string | null = null;
  if (closerMemberIds?.length) {
    if (closerDistributionMode === "random") {
      assignedCloserId = closerMemberIds[Math.floor(Math.random() * closerMemberIds.length)];
    } else {
      assignedCloserId = closerMemberIds[closerIndex % closerMemberIds.length];
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

      const existingLead = formattedPhone ? existingMap.get(formattedPhone) : null;

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
        if (Object.keys(leadUpdates).length > 0) {
          await supabase.from("leads").update(leadUpdates).eq("id", leadId);
        }

        // Insert into pipeline-specific table
        if (destination === "qualificacao") {
          await supabase.from("pipe_whatsapp").insert({
            lead_id: leadId,
            status: stageKeyForLead,
            organization_id: organizationId,
            sdr_id: sdrIdForLead,
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

          const propostaInsert: Record<string, unknown> = {
            lead_id: leadId,
            status: stageKeyForLead,
            organization_id: organizationId,
            closer_id: closerIdForLead,
            sale_value: totalValue,
            calor: lead.calor ?? null,
            commitment_date: lead.commitment_date ?? null,
            contract_duration: lead.contract_duration ?? null,
            notes: lead.pipe_notes ?? null,
            product_id: firstProductId,
          };
          if (metricsPeriodAt != null) propostaInsert.metrics_period_at = metricsPeriodAt;

          const { data: newProposta, error: propostaError } = await supabase
            .from("pipe_propostas").insert(propostaInsert).select("id").single();

          if (propostaError) {
            report.rejected++;
            report.errors.push({ row: rowIndex + 1, reason: `Erro ao inserir proposta: ${propostaError.message}` });
            continue;
          }

          // Insert product items
          if (productIds.length > 0) {
            const n = productIds.length;
            const valuePerItem = totalValue != null && n > 0 ? Math.floor(totalValue / n) : null;
            const remainder = totalValue != null && n > 0 ? totalValue - (valuePerItem ?? 0) * n : 0;
            const itemsToInsert = productIds.map((product_id, index) => ({
              pipe_proposta_id: newProposta.id,
              product_id,
              sale_value: totalValue != null && valuePerItem != null
                ? (index < n - 1 ? valuePerItem : valuePerItem + remainder)
                : null,
            }));
            await supabase.from("pipe_proposta_items").insert(itemsToInsert);
          }
        } else {
          // confirmacao
          const confirmacaoInsert: Record<string, unknown> = {
            lead_id: leadId,
            status: stageKeyForLead,
            organization_id: organizationId,
            sdr_id: sdrIdForLead,
            closer_id: closerIdForLead,
            meeting_date: lead.commitment_date ?? null,
            notes: lead.pipe_notes ?? null,
          };
          if (metricsPeriodAt != null) confirmacaoInsert.metrics_period_at = metricsPeriodAt;
          await supabase.from("pipe_confirmacao").insert(confirmacaoInsert);
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

    // 1. Parse body
    let body: ImportPayload;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "JSON inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Auth
    let authCtx;
    try {
      authCtx = await requireAuth(req, { organizationId: body.organization_id, body: body as any });
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
      throw e;
    }

    // 3. Permission check
    const permResult = await canUserPerformAction({
      userId: authCtx.userId,
      organizationId: authCtx.organizationId,
      action: "import_leads",
    });

    if (!permResult.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: permResult.reason || "Sem permissão para importar leads" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Validate payload
    if (!body.leads || !Array.isArray(body.leads) || body.leads.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Array de leads vazio ou inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!body.destination || !["campaign", "funnel"].includes(body.destination)) {
      return new Response(
        JSON.stringify({ success: false, error: "destination deve ser 'campaign' ou 'funnel'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 5. Validate each lead
    const validLeads: ParsedLead[] = [];
    const report: ImportReport = { total: body.leads.length, created: 0, updated: 0, rejected: 0, errors: [] };

    for (let i = 0; i < body.leads.length; i++) {
      const validationError = validateLead(body.leads[i], i);
      if (validationError) {
        report.rejected++;
        report.errors.push({ row: i + 1, reason: validationError });
      } else {
        validLeads.push(body.leads[i]);
      }
    }

    // 6. Process valid leads
    const supabase = getServiceClient();

    try {
      if (body.destination === "campaign") {
        await importToCampaign(supabase, validLeads, { ...body, organization_id: authCtx.organizationId }, report);
      } else {
        await importToFunnel(supabase, validLeads, { ...body, organization_id: authCtx.organizationId }, report);
      }
    } catch (err) {
      console.error("[import-leads] Processing error:", err);

      await logRuntime({
        organizationId: authCtx.organizationId,
        module: "pipe_dispatch",
        action: "import_leads",
        status: "error",
        errorMessage: (err as Error).message,
        entityType: "user",
        entityId: authCtx.userId,
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
      organizationId: authCtx.organizationId,
      module: "pipe_dispatch",
      action: "import_leads",
      status: "success",
      entityType: "user",
      entityId: authCtx.userId,
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
      organizationId: authCtx.organizationId,
      userId: authCtx.userId,
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
