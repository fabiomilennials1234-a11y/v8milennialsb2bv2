/**
 * Webhook Genérico para Receber Leads
 *
 * Recebe leads de qualquer fonte (Meta Ads, Google Ads, Landing Pages, etc.)
 * e dispara o fluxo de outbound se houver agente configurado.
 */

import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateLead } from "../_shared/lead-service.ts";
import { enqueueWebhookDeliveries } from "../_shared/webhook-utils.ts";
import { getCampaignLeadAssignment, getCampaignCloserAssignment } from "../_shared/campaign-distribution.ts";
import { logRuntime } from "../_shared/logger.ts";
import { isValidUUID, isValidISODate, validateArraySize, validateReferencedId } from "../_shared/validation.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import { upsertPipeEntryDetailed, getPipeEntry, updatePipeEntryById, resolveActiveStageKey, resolvePipeline, isPipelineResolutionError } from "../_shared/pipeline-adapter.ts";
import { resolveMeetingDestination } from "../_shared/pipeline-destination.ts";
import type { ResolvedPipeline } from "../_shared/pipeline-adapter.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare, checkRateLimitPersistent, getClientIdentifier, checkRateLimit, rateLimitedResponse } from "../_shared/auth.ts";

// Destino opcional: colocar o lead em um funil em uma etapa específica.
// D6 (SCRUM-624 / ADR-0034): `pipe` aceita o **id (uuid) ou slug de QUALQUER
// funil da org** — custom incluído. Os 3 nomes históricos (`whatsapp`,
// `confirmacao`, `propostas`) seguem funcionando: são os slugs dos funis
// semeados; aliases legados (`pipe_whatsapp`, `qualificacao`, …) resolvem via
// adapter. Funil inexistente/inativo → 4xx ANTES de criar o lead (fim do
// 200 + descarte silencioso).
interface PlaceInPipe {
  pipe: string; // id (uuid) ou slug de qualquer funil da org
  stage: string; // ex: "novo", "abordado", "reuniao_marcada", "marcar_compromisso"
  meeting_date?: string; // ISO 8601 — salva no pipe (meeting_date) e no lead (compromisso_date)
}

// Destino opcional: colocar o lead em uma campanha em uma etapa específica
interface PlaceInCampaign {
  campaign_id: string; // UUID da campanha
  stage_id: string;    // UUID do campanha_stages
  notes?: string;     // Observações do lead nesta campanha (card na campanha)
}

interface LeadWebhookPayload {
  // Identificação da fonte
  source: string; // "meta_ads", "google_ads", "landing_page", etc.
  campaign_id?: string;
  campaign_name?: string;

  // Tags para identificar (aceita array ou string JSON)
  tags?: string[] | string;

  // Dados do lead
  fields: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    // Campos personalizados
    [key: string]: string | undefined;
  };

  // Organização (identificada por API key ou passada diretamente)
  organization_id?: string;

  // Padrão: sempre cria um novo lead. Se true, busca por telefone/email e atualiza o lead existente (evita duplicar).
  update_existing_if_match?: boolean;

  // Destino opcional: colocar o lead direto em um pipe e/ou campanha (ex: n8n, campanha de ads)
  place_in_pipe?: PlaceInPipe;
  place_in_campaign?: PlaceInCampaign;

  // Atribuição opcional (ex.: round robin do n8n) — team_member_id para SDR/Closer
  assigned_user_id?: string;

  // Closer fixo (responsável da VENDA) quando o lead entra em pipe confirmacao.
  // Diferente de assigned_user_id (que trava os 5 papéis): aqui só o closer/sale é fixo,
  // o SDR/pré-venda continua sendo distribuído via round robin do funil.
  // Ex: Cal.com da Basic4u → venda sempre Bruna, pré-venda distribui.
  sale_responsible_id?: string; // team_member_id (UUID)

  // Custom fields separados (Make.com envia fora de fields via toCollection)
  custom_fields?: Record<string, string>;
}

// ── Field name normalization ──
// n8n/Meta Ads sends form question text as field keys (e.g. "Email:", "Nome da Empresa").
// This map normalizes common variations to standard lead column names so data lands
// in the right place instead of creating orphan custom fields.
const STANDARD_FIELD_ALIASES: Record<string, string> = {
  // name
  "nome": "name",
  "nome completo": "name",
  "full name": "name",
  "nome_completo": "name",
  "full_name": "name",
  // phone
  "telefone": "phone",
  "celular": "phone",
  "whatsapp": "phone",
  "tel": "phone",
  "fone": "phone",
  "phone_number": "phone",
  "numero": "phone",
  "número": "phone",
  // email
  "e-mail": "email",
  "e_mail": "email",
  "email_address": "email",
  "endereço de email": "email",
  "endereco de email": "email",
  // company
  "empresa": "company",
  "nome da empresa": "company",
  "nome empresa": "company",
  "razão social": "company",
  "razao social": "company",
  "company_name": "company",
  "nome do salão/empresa": "company",
  "nome do salao/empresa": "company",
  "nome fantasia": "company",
  "organização": "company",
  "organizacao": "company",
  // notes
  "observações": "notes",
  "observacoes": "notes",
  "observação": "notes",
  "observacao": "notes",
  "notas": "notes",
  "anotações": "notes",
  "anotacoes": "notes",
  "comentários": "notes",
  "comentarios": "notes",
  // segment
  "segmento": "segment",
  "setor": "segment",
  // uf (Estado)
  "estado": "uf",
  "uf": "uf",
  // faturamento
  "faturamento mensal": "faturamento",
  "receita": "faturamento",
  "receita mensal": "faturamento",
  "revenue": "faturamento",
  // rating
  "nota": "rating",
  "avaliação": "rating",
  "avaliacao": "rating",
  "score": "rating",
  // urgency
  "urgência": "urgency",
  "urgencia": "urgency",
  "prioridade": "urgency",
};

const STANDARD_FIELD_NAMES = new Set([
  "name", "phone", "email", "company", "notes", "segment", "faturamento", "uf", "urgency", "rating",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
]);

function normalizeFieldKeys(fields: Record<string, string | undefined>): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  const usedStandard = new Set<string>();

  // First pass: collect keys that already match standard names exactly
  for (const key of Object.keys(fields)) {
    if (STANDARD_FIELD_NAMES.has(key)) {
      usedStandard.add(key);
    }
  }

  for (const [originalKey, value] of Object.entries(fields)) {
    // Already a known standard key — keep as-is
    if (usedStandard.has(originalKey)) {
      result[originalKey] = value;
      continue;
    }

    // Normalize: lowercase, strip trailing colon/punctuation, trim
    const normalized = originalKey.toLowerCase().replace(/[:?!.]+$/, "").trim();

    // Check if normalized form IS a standard name (e.g. "Email:" → "email")
    // or if it maps via alias table (e.g. "Nome da Empresa" → "company")
    const mappedKey = STANDARD_FIELD_NAMES.has(normalized) ? normalized : STANDARD_FIELD_ALIASES[normalized];
    if (mappedKey && !usedStandard.has(mappedKey)) {
      result[mappedKey] = value;
      usedStandard.add(mappedKey);
      console.log(`[lead-webhook] Field "${originalKey}" → mapped to standard "${mappedKey}"`);
    } else {
      // Keep as custom field with original key
      result[originalKey] = value;
    }
  }

  return result;
}

serve(withErrorBoundary('lead-webhook', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verificar autenticação via header
    const webhookKey = req.headers.get("x-webhook-key");
    const expectedKey = Deno.env.get("WEBHOOK_API_KEY");
    
    if (!webhookKey || !expectedKey || !timingSafeCompare(webhookKey, expectedKey)) {
      console.error("[lead-webhook] Invalid or missing webhook key");
      return errorResponse(401, "Unauthorized", corsHeaders, { req });
    }

    // In-memory rate limit — fast first-line defense (resets on cold start)
    const clientIp = getClientIdentifier(req);
    const memRl = checkRateLimit(`lead-webhook:${clientIp}`, 60, 60_000); // 60 req/min
    if (!memRl.allowed) {
      return rateLimitedResponse(memRl.resetIn, corsHeaders);
    }

    // Parse payload
    const payload: LeadWebhookPayload = await req.json();
    console.log("[lead-webhook] Received payload for org:", payload.organization_id, "source:", payload.source);

    // Merge custom_fields into fields (Make.com sends them separately)
    if (payload.custom_fields && typeof payload.custom_fields === "object") {
      payload.fields = { ...payload.fields, ...payload.custom_fields };
    }

    // Sanitizar campos: remover whitespace/newlines de todos os valores em fields
    if (payload.fields) {
      for (const key of Object.keys(payload.fields)) {
        const val = payload.fields[key];
        if (typeof val === "string") {
          // Strip prefixo "?" espúrio que a origem (Meta Ads/n8n) às vezes injeta
          // nos valores (ex: "?Jhonny's Drinkeria", "?outro") — vazava literal pro
          // cliente nas mensagens da automação. Bug C, incidente Bertin 2026-06-03.
          const trimmed = val.trim().replace(/^\?+\s*/, "");
          payload.fields[key] = trimmed === "" ? undefined : trimmed;
        }
      }
      // Normalize field keys: map common n8n/Meta Ads variations to standard names
      // e.g. "Email:" → "email", "Nome da Empresa" → "company"
      payload.fields = normalizeFieldKeys(payload.fields);
    }

    // Validação básica
    if (!payload.fields || (!payload.fields.phone && !payload.fields.email)) {
      return errorResponse(400, "Lead must have phone or email", corsHeaders, { req });
    }

    // ── Input validation ──
    if (payload.organization_id && !isValidUUID(payload.organization_id)) {
      return errorResponse(400, "Validation failed: organization_id não é um UUID válido", corsHeaders, { req });
    }
    if (payload.assigned_user_id && !isValidUUID(payload.assigned_user_id)) {
      return errorResponse(400, "Validation failed: assigned_user_id não é um UUID válido", corsHeaders, { req });
    }
    if (payload.sale_responsible_id && !isValidUUID(payload.sale_responsible_id)) {
      return errorResponse(400, "Validation failed: sale_responsible_id não é um UUID válido", corsHeaders, { req });
    }
    if (payload.place_in_campaign?.campaign_id && !isValidUUID(payload.place_in_campaign.campaign_id)) {
      return errorResponse(400, "Validation failed: place_in_campaign.campaign_id não é um UUID válido", corsHeaders, { req });
    }
    if (payload.place_in_campaign?.stage_id && !isValidUUID(payload.place_in_campaign.stage_id)) {
      return errorResponse(400, "Validation failed: place_in_campaign.stage_id não é um UUID válido", corsHeaders, { req });
    }
    // Normalizar tags: aceita string JSON '["Ouro"]', string simples "Ouro", ou array
    if (payload.tags) {
      if (typeof payload.tags === "string") {
        const raw = payload.tags;
        try {
          const parsed = JSON.parse(raw);
          payload.tags = Array.isArray(parsed) ? parsed as string[] : [String(parsed)];
        } catch {
          payload.tags = [raw];
        }
      }
      if (Array.isArray(payload.tags)) {
        payload.tags = payload.tags.map((t) => String(t).trim()).filter(Boolean);
        const tagsValidation = validateArraySize(payload.tags, 50, "tags");
        if (!tagsValidation.valid) {
          return errorResponse(400, `Validation failed: ${tagsValidation.error}`, corsHeaders, { req });
        }
      }
    }
    if (payload.fields) {
      const customFieldKeys = Object.keys(payload.fields).filter(
        (k) => !STANDARD_FIELD_NAMES.has(k)
      );
      if (customFieldKeys.length > 100) {
        return errorResponse(400, "Validation failed: custom_fields excede o limite de 100 campos", corsHeaders, { req });
      }
    }
    if (payload.place_in_pipe?.meeting_date && !isValidISODate(payload.place_in_pipe.meeting_date)) {
      return errorResponse(400, "Validation failed: meeting_date não é uma data ISO 8601 válida", corsHeaders, { req });
    }

    // Criar cliente Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Persistent rate limit — authoritative check (survives cold starts)
    const persistentRl = await checkRateLimitPersistent(supabase, `lead-webhook:${clientIp}`, 60, 60);
    if (!persistentRl.allowed) {
      console.warn("[lead-webhook] Persistent rate limit hit for:", clientIp);
      return errorResponse(429, "Rate limit exceeded", corsHeaders, { req });
    }

    // Determinar organization_id
    let organizationId = payload.organization_id;
    
    if (!organizationId) {
      // Buscar organização padrão (primeira ativa)
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .limit(1)
        .single();
      
      if (!org) {
        return errorResponse(400, "No organization found", corsHeaders, { req });
      }
      organizationId = org.id;
    }

    // Referenced ID validation (warning only — don't block)
    if (payload.assigned_user_id && organizationId) {
      const refCheck = await validateReferencedId(supabase, "team_members", payload.assigned_user_id, organizationId);
      if (!refCheck.exists) {
        console.warn(`[lead-webhook] assigned_user_id not found in team_members for org ${organizationId}: ${refCheck.error}`);
      }
    }

    // Usar serviço centralizado para buscar ou criar lead
    const {
      name,
      phone,
      email,
      company,
      notes: fieldsNotes,
      segment,
      faturamento,
      uf: rawUf,
      urgency,
      rating,
      utm_source: fieldsUtmSource,
      utm_medium: fieldsUtmMedium,
      utm_campaign: fieldsUtmCampaign,
      utm_content: fieldsUtmContent,
      utm_term: fieldsUtmTerm,
      ...customFields
    } = payload.fields;

    // UTM resolution: fields.utm_* (inside fields object) take precedence,
    // then top-level payload.utm_* (how n8n body fields sends them),
    // then legacy payload.campaign_name/campaign_id for campaign only.
    const utmSource = fieldsUtmSource || payload.utm_source || null;
    const utmMedium = fieldsUtmMedium || payload.utm_medium || null;
    const utmCampaign = fieldsUtmCampaign || payload.utm_campaign || payload.campaign_name || payload.campaign_id || null;
    const utmContent = fieldsUtmContent || payload.utm_content || null;
    const utmTerm = fieldsUtmTerm || payload.utm_term || null;

    // Mapear origem (valores do enum lead_origin)
    const originMap: Record<string, string> = {
      "meta_ads": "meta_ads",
      "facebook": "meta_ads",
      "instagram": "instagram",
      "tiktok": "tiktok",
      "google_ads": "google_ads",
      "landing_page": "landing_page",
      "site": "site",
      "remarketing": "remarketing",
      "indicacao": "indicacao",
      "indicação": "indicacao",
      "referral": "indicacao",
      "evento": "evento",
      "event": "evento",
      "prospeccao_ativa": "prospeccao_ativa",
      "prospeccao": "prospeccao_ativa",
      "outbound": "prospeccao_ativa",
      "whatsapp": "whatsapp",
      "calendly": "cal",
      "cal": "cal",
      "cal.com": "cal",
    };
    const origin = originMap[payload.source.toLowerCase()] || "outro";

    // Leads de Cal.com já entram em pipe_confirmacao (reunião agendada) — nunca devem
    // ser semeados em whatsapp/novo. Sem isso o lead aparece duplicado na coluna "Novo"
    // do funil WhatsApp (incomoda no fluxo cal.com, onde toda entrada é reunião marcada).
    const skipDefaultSeed = origin === "cal";

    // ── Cal.com bypass ──────────────────────────────────────────────────
    // Leads vindos do Cal.com já têm reunião agendada — pulam pipe_whatsapp
    // (qualificação) e entram direto em pipe_confirmacao/reuniao_marcada.
    // meeting_date é obrigatório (lembretes D-N dependem disso).
    if (origin === "cal") {
      const meetingDate =
        payload.place_in_pipe?.meeting_date ||
        (payload.fields?.meeting_date as string | undefined) ||
        (payload as { meeting_date?: string }).meeting_date;

      if (!meetingDate || !isValidISODate(meetingDate)) {
        return errorResponse(
          400,
          "Validation failed: origin=cal requer meeting_date ISO 8601 em place_in_pipe.meeting_date ou fields.meeting_date",
          corsHeaders,
          { req },
        );
      }

      // SCRUM-641: o destino preferido segue 'confirmacao'/'reuniao_marcada'
      // (org antiga: idêntico). Org sem esse funil → funil PADRÃO ancorado
      // pela etapa de papel meeting_booked; sem funil padrão → lead sem card.
      const calDest = await resolveMeetingDestination(supabase, organizationId as string, {
        ref: "confirmacao",
        stageKey: "reuniao_marcada",
      });

      if (payload.place_in_pipe && calDest && payload.place_in_pipe.pipe !== calDest.ref) {
        console.warn(
          `[lead-webhook] origin=cal override: caller mandou pipe="${payload.place_in_pipe.pipe}" stage="${payload.place_in_pipe.stage}", forçando ${calDest.ref}/${calDest.stageKey}`,
        );
      }

      if (calDest) {
        payload.place_in_pipe = {
          pipe: calDest.ref,
          stage: calDest.stageKey,
          meeting_date: meetingDate,
        };
      } else {
        console.warn(
          `[lead-webhook] origin=cal sem destino de reunião na org ${organizationId} (sem funil 'confirmacao' e sem funil padrão) — lead será criado sem card.`,
        );
        delete payload.place_in_pipe;
      }
    }

    let result: Awaited<ReturnType<typeof getOrCreateLead>>;

    // ── Meta dummy/test lead — DESCARTAR (não persistir) ─────────────────
    // A "Testing Tool" do Meta Lead Ads envia leads com email test@meta.com e
    // valores literais "<test lead: dummy data for {campo}>". Não são leads
    // reais — só validam o webhook. Antes a função CRIAVA esses leads: o lixo
    // acumulava (28 orgs poluídas) e os antigos caíam na etapa "novo"
    // (desativada em várias orgs) → invisíveis no kanban mas contados =
    // "leads fantasmas" (incidente HGE Iluminação 2026-06-30). O Meta só
    // precisa de um 200 — reconhecemos sem gravar nada. Ver [[ghost-stage]].
    const isDummyTestLead = [email, name, phone, company, ...Object.values(customFields)]
      .some((v) => typeof v === "string" &&
        (v.trim().toLowerCase() === "test@meta.com" || /^<test lead: dummy data for\b/i.test(v.trim())));
    if (isDummyTestLead) {
      console.log("[lead-webhook] Meta dummy/test lead detectado — descartando (ack 200, sem criar):", { email });
      return successResponse(
        { success: true, dummy_test_lead: true, message: "Lead de teste do Meta reconhecido (não persistido)" },
        corsHeaders,
        { req },
      );
    }

    // ── D6: resolve o destino ANTES de criar qualquer coisa ───────────────
    // `place_in_pipe.pipe` aceita id (uuid) ou slug de qualquer funil da org
    // (aliases legados inclusos — ver adapter). Funil que não resolve → 4xx
    // AQUI, antes do INSERT do lead: quem integra vê o erro na hora e o retry
    // não duplica nada. Fica DEPOIS do descarte do dummy do Meta de propósito
    // — a Testing Tool só precisa do 200, e um payload de teste com funil
    // inválido não pode reprovar a validação do webhook no painel do Meta.
    // `organizationId` foi resolvido acima (payload ou fallback) — narrow p/ string.
    const orgIdResolved = organizationId as string;
    let resolvedPipeline: ResolvedPipeline | null = null;
    if (payload.place_in_pipe?.pipe && payload.place_in_pipe?.stage) {
      try {
        resolvedPipeline = await resolvePipeline(supabase, orgIdResolved, String(payload.place_in_pipe.pipe));
      } catch (e) {
        if (isPipelineResolutionError(e)) {
          if (e.code === "pipeline_lookup_failed") {
            // Transitório: não sabemos se o funil existe. 503 para o caller
            // retentar — nada foi escrito ainda.
            console.warn("[lead-webhook] resolução de funil falhou (transitório):", e.message);
            return errorResponse(503, "Falha temporária ao resolver o funil de destino. Tente novamente.", corsHeaders, { req });
          }
          const ref = String(payload.place_in_pipe.pipe);
          const msg = e.code === "pipeline_inactive"
            ? `Funil "${ref}" está inativo nesta organização`
            : `Funil "${ref}" não existe nesta organização. Use o id (uuid) ou o slug de um funil da organização.`;
          console.warn(`[lead-webhook] place_in_pipe recusado (${e.code}): funil "${ref}" @ org ${organizationId}`);
          return errorResponse(e.code === "pipeline_inactive" ? 409 : 404, msg, corsHeaders, {
            req,
            details: { code: e.code },
          });
        }
        throw e;
      }
    }

    // ── D4: semeadura pelo funil PADRÃO da org (substitui o hardcode
    // whatsapp/novo). Etapa = 1ª ativa do funil padrão. Org sem funil padrão
    // (`default_pipeline_id` NULL — 2/108 em prod no backfill) = comportamento
    // definido: lead criado SEM card, com log explícito (o mesmo destino que
    // essas orgs já tinham quando o funil semeado não existia).
    const seedDefaultPipeline = async (leadId: string) => {
      try {
        const { data: orgRow, error: orgErr } = await supabase
          .from("organizations")
          .select("default_pipeline_id")
          .eq("id", orgIdResolved)
          .maybeSingle();
        if (orgErr) {
          console.warn("[lead-webhook] leitura de default_pipeline_id falhou; lead fica sem card:", orgErr.message);
          return;
        }
        const defaultRef = (orgRow as { default_pipeline_id?: string | null } | null)?.default_pipeline_id;
        if (!defaultRef) {
          console.log(
            `[lead-webhook] lead ${leadId} criado SEM card: org ${organizationId} não tem funil padrão (Configurações → Geral).`,
          );
          return;
        }
        const stageKey = await resolveActiveStageKey(supabase, orgIdResolved, defaultRef);
        if (!stageKey) {
          // Funil padrão sem NENHUMA etapa ativa: gravar um literal criaria um
          // card fantasma invisível no kanban — pior que não criar.
          console.warn(
            `[lead-webhook] funil padrão ${defaultRef} da org ${organizationId} sem etapas ativas; lead ${leadId} fica sem card.`,
          );
          return;
        }
        const seed = await upsertPipeEntryDetailed(supabase, {
          leadId,
          orgId: orgIdResolved,
          slug: defaultRef,
          stageKey,
          metadata: { sdr_id: payload.assigned_user_id ?? null },
          assignedTo: payload.assigned_user_id ?? null,
        });
        if (seed.status === "no_pipeline") {
          console.warn(
            `[lead-webhook] funil padrão ${defaultRef} não resolveu no upsert (corrida com deleção?); lead ${leadId} sem card.`,
          );
        } else if (seed.status !== "created" && seed.status !== "updated") {
          console.warn(`[lead-webhook] semeadura no funil padrão falhou (${seed.status}) para lead ${leadId}.`);
        }
      } catch (pipeError) {
        console.warn("[lead-webhook] semeadura no funil padrão falhou:", pipeError);
      }
    };

    // Padrão: sempre criar novo lead. Só busca por telefone/email quando o cliente envia update_existing_if_match = true.
    // Aceita boolean true ou string "true" (n8n body fields envia como string).
    // Dummy do Meta nunca deduplica (senão atualiza um lead de teste pré-existente).
    const shouldDeduplicate = !isDummyTestLead &&
      (payload.update_existing_if_match === true || payload.update_existing_if_match === "true");
    if (shouldDeduplicate) {
      result = await getOrCreateLead(supabase, {
        organizationId,
        phone: phone || null,
        email: email || null,
        name: name || "Lead sem nome",
        origin,
        // SCRUM-624 (D4): a semeadura sai do lead-service (que hardcoda o
        // funil 'whatsapp') e passa a ser feita AQUI pelo funil padrão da org
        // — ver seedDefaultPipeline. skipPipeSeed sempre true nesta porta.
        skipPipeSeed: true,
      });

      if (!result) {
        console.error("[lead-webhook] Failed to get or create lead for org:", organizationId);
        return errorResponse(500, "Failed to get or create lead", corsHeaders, {
          req,
          details: {
            hint: "Check Supabase Edge Function logs for [lead-service] errors. Common causes: missing database columns (run pending migrations), duplicate leads, or DB constraint violations.",
            context: { organization_id: organizationId, phone: phone || null, email: email || null },
          },
        });
      }
      console.log("[lead-webhook] update_existing_if_match: lead resolved:", result.lead.id, "created:", result.created);

      // Lead NOVO no caminho deduplicado: mesma semeadura do caminho de
      // criação direta — funil padrão da org (não mais whatsapp hardcoded).
      // Lead reaproveitado não é ressemeado (comportamento inalterado).
      if (result.created && !skipDefaultSeed) {
        await seedDefaultPipeline(result.lead.id);
      }
    } else {
      // Sempre criar novo lead (padrão do sistema)
      const leadName = name || "Lead sem nome";
      const insertData: Record<string, unknown> = {
        name: leadName,
        phone: phone || null,
        email: email || null,
        origin,
        organization_id: organizationId,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_content: utmContent,
        utm_term: utmTerm,
      };
      // SCRUM-202: a semeadura da coluna legada `pipe_whatsapp` saiu daqui.
      // Quem a mantém é `trg_sync_whatsapp_stage_to_lead`, disparado pelo
      // `upsertPipeEntry` logo abaixo. (A migration 20270806000010 tira o
      // `DEFAULT 'novo'` da coluna; sem ela o default gravaria "novo" para lead
      // que ainda não entrou em funil nenhum, e a coluna mentiria.)
      if (payload.assigned_user_id) {
        insertData.sdr_id = payload.assigned_user_id;
        insertData.closer_id = payload.assigned_user_id;
        insertData.responsible_id = payload.assigned_user_id;
        insertData.pre_sale_responsible_id = payload.assigned_user_id;
        insertData.sale_responsible_id = payload.assigned_user_id;
      }
      const { data: newLead, error: createError } = await supabase
        .from("leads")
        .insert(insertData)
        .select("id, name, phone, email, organization_id, normalized_phone")
        .single();

      if (createError) {
        console.error("[lead-webhook] Failed to create lead:", createError);
        if (createError.code === "23505") {
          return errorResponse(
            409,
            "Lead já existe com este telefone nesta organização. Envie update_existing_if_match=true (Make: 'Atualizar lead existente?' = Sim) para atualizar o lead existente.",
            corsHeaders,
            { req, details: createError.message },
          );
        }
        return errorResponse(500, "Failed to create lead", corsHeaders, { req, details: createError.message });
      }

      // Cal.com não semeia — o lead é colocado em confirmacao pelo bloco place_in_pipe abaixo.
      //
      // SCRUM-624 (D4): a semeadura hardcoded whatsapp/novo morreu. O lead novo
      // cai no FUNIL PADRÃO da org (etapa = 1ª ativa); org sem padrão = lead
      // sem card, logado (o destino que "org sem funil de Oportunidades" já
      // tinha — agora é configuração explícita, não acidente de seed).
      if (!skipDefaultSeed) {
        await seedDefaultPipeline(newLead.id);
      }

      result = { lead: newLead, created: true, source: "created" };
      console.log("[lead-webhook] New lead created:", newLead.id);
    }

    const leadId = result.lead.id;
    const isNewLead = result.created;

    console.log("[lead-webhook] Lead resolved:", {
      leadId,
      isNewLead,
      source: result.source
    });

    // Atualizar lead (novo ou existente) com dados do payload
    const updateData: Record<string, unknown> = {};
    if (name) updateData.name = name;
    if (company !== undefined) updateData.company = company || null;
    // Persistir email/phone quando o match foi pelo OUTRO identificador.
    // Ex: lead achado via phone → preserva email novo do typeform.
    // Sem isso, Calendly subsequente (sem phone) não acha pelo email e cria duplicado.
    if (email && result.source !== "email") updateData.email = email;
    if (phone && result.source !== "phone") updateData.phone = phone;
    // UTM fields: resolved earlier (fields.utm_* → payload.utm_* → campaign_name/id)
    if (utmCampaign) updateData.utm_campaign = utmCampaign;
    if (utmSource) updateData.utm_source = utmSource;
    if (utmMedium) updateData.utm_medium = utmMedium;
    if (utmContent) updateData.utm_content = utmContent;
    if (utmTerm) updateData.utm_term = utmTerm;
    if (fieldsNotes !== undefined && fieldsNotes !== "") {
      updateData.notes = fieldsNotes;
    } else if (isNewLead) {
      updateData.notes = `Fonte: ${payload.source}`;
    }
    if (segment !== undefined) updateData.segment = segment || null;
    // UF: valida 27 estados; resposta explícita vence o DDD derivado
    const VALID_UFS = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SE","SP","TO"]);
    if (rawUf !== undefined && typeof rawUf === "string") {
      const normUf = rawUf.trim().toUpperCase();
      if (VALID_UFS.has(normUf)) {
        updateData.uf = normUf;
        updateData.uf_source = "webhook";
      } else if (normUf) {
        console.warn("[lead-webhook] UF inválida ignorada:", rawUf);
      }
    }
    if (faturamento !== undefined) updateData.faturamento = faturamento || null;
    if (urgency !== undefined) updateData.urgency = urgency || null;
    if (rating !== undefined && rating !== "") {
      const r = Number(rating);
      if (!Number.isNaN(r) && r >= 0 && r <= 10) updateData.rating = r;
    }
    if (payload.assigned_user_id) {
      updateData.sdr_id = payload.assigned_user_id;
      updateData.closer_id = payload.assigned_user_id;
      updateData.responsible_id = payload.assigned_user_id;
      updateData.pre_sale_responsible_id = payload.assigned_user_id;
      updateData.sale_responsible_id = payload.assigned_user_id;
    }
    if (payload.place_in_pipe?.meeting_date) {
      updateData.compromisso_date = payload.place_in_pipe.meeting_date;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from("leads")
        .update(updateData)
        .eq("id", leadId);
      if (updateError) {
        console.error("[lead-webhook] Failed to update lead fields:", updateError, "data:", JSON.stringify(updateData));
      }
    }

    // Salvar campos personalizados (novo e existente)
    // Se o campo não existe na org, cria automaticamente + salva valor
    const customFieldResults: Record<string, string> = {};
    if (Object.keys(customFields).length > 0) {
      console.log("[lead-webhook] Processing custom fields:", Object.keys(customFields));
      for (const [fieldName, fieldValue] of Object.entries(customFields)) {
        if (fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== "") {
          console.log(`[lead-webhook] Custom field "${fieldName}" = "${fieldValue}"`);

          // Buscar campo existente
          const { data: existingField, error: findErr } = await supabase
            .from("lead_custom_fields")
            .select("id")
            .eq("organization_id", organizationId)
            .eq("field_name", fieldName)
            .maybeSingle();

          if (findErr) {
            console.error(`[lead-webhook] Error finding custom field "${fieldName}":`, findErr);
          }

          let customFieldId = existingField?.id;

          // Se não existe, criar automaticamente
          if (!customFieldId) {
            const { data: newField, error: createErr } = await supabase
              .from("lead_custom_fields")
              .insert({
                organization_id: organizationId,
                field_name: fieldName,
                field_type: "text",
              })
              .select("id")
              .single();

            if (createErr) {
              console.error(`[lead-webhook] Error creating custom field "${fieldName}":`, createErr);
              // Tentar buscar novamente (pode ter sido criado por race condition)
              const { data: retryField } = await supabase
                .from("lead_custom_fields")
                .select("id")
                .eq("organization_id", organizationId)
                .eq("field_name", fieldName)
                .maybeSingle();
              customFieldId = retryField?.id;
            } else {
              customFieldId = newField?.id;
              console.log(`[lead-webhook] Custom field "${fieldName}" created:`, customFieldId);
            }
          }

          // Salvar valor
          if (customFieldId) {
            const { error: upsertErr } = await supabase
              .from("lead_custom_field_values")
              .upsert({
                lead_id: leadId,
                field_id: customFieldId,
                value: String(fieldValue),
              }, {
                onConflict: "lead_id,field_id",
              });

            if (upsertErr) {
              console.error(`[lead-webhook] Error saving custom field value "${fieldName}":`, upsertErr);
              customFieldResults[fieldName] = `value_error: ${upsertErr.message}`;
            } else {
              console.log(`[lead-webhook] Custom field "${fieldName}" saved for lead ${leadId}`);
              customFieldResults[fieldName] = "saved";
            }
          } else {
            console.error(`[lead-webhook] Could not resolve custom field "${fieldName}" — skipping value`);
            customFieldResults[fieldName] = "error: field_not_resolved";
          }
        }
      }
    }

    // Adicionar tags ao lead
    if (payload.tags && payload.tags.length > 0) {
      for (const tagName of payload.tags) {
        // Buscar tag escopada por org (evita cross-tenant leak)
        let { data: tag } = await supabase
          .from("tags")
          .select("id")
          .eq("organization_id", organizationId)
          .ilike("name", tagName)
          .maybeSingle();

        if (!tag) {
          const { data: newTag, error: tagInsertError } = await supabase
            .from("tags")
            .insert({ name: tagName, color: "#6366f1", organization_id: organizationId })
            .select()
            .single();
          if (tagInsertError) {
            console.error(`[lead-webhook] Failed to create tag "${tagName}":`, tagInsertError);
          }
          tag = newTag;
        }

        if (tag) {
          // Vincular tag ao lead (ignorar se já existir)
          await supabase
            .from("lead_tags")
            .upsert({
              lead_id: leadId,
              tag_id: tag.id,
            }, {
              onConflict: "lead_id,tag_id",
              ignoreDuplicates: true,
            });
        }
      }
    }

    // ADR-0023 decisão 3 — "um Negócio nasce só por clique humano".
    //
    // O gate estrutural mora em `upsertPipeEntry` (`_shared/pipeline-adapter.ts`),
    // que cobre os 34 call sites. Aqui ele é lido ANTES por dois motivos que o
    // adapter não resolve sozinho:
    //   1. `autoDistributePipe` roda DEPOIS do upsert e escreve responsáveis em
    //      `leads` mesmo sem entry — trabalho pela metade, e round-robin gasto
    //      para um card que não existe;
    //   2. a resposta do webhook precisa dizer a verdade para quem integra. O
    //      n8n recebia 200 com `place_in_pipe` ecoado e concluía que o lead foi
    //      posicionado. Silêncio aqui é exatamente o modo de falha que o ADR
    //      nomeia: "o webhook responde 200, o Lead é criado, só o card falta".

    // 🚨 Desde 20270902000010 o funil de sistema pode NÃO EXISTIR na org — ou
    // porque ela nunca o teve (org nova não nasce mais com funil), ou porque
    // alguém o excluiu. `upsertPipeEntry` já devolve `no_pipeline` nesse caso,
    // então o Lead continua sendo criado e nada estoura. O que faltava era
    // CONTAR isso a quem integra: a resposta cravava `placed_in_pipe = true`
    // logo abaixo, e o log dizia "Lead placed in pipeline_entries" mesmo sem
    // ter criado card nenhum. O comentário acima descrevia esse contrato desde
    // sempre; o código nunca o cumpriu.
    let placedInPipe: boolean | undefined;
    let placeInPipeError: string | undefined;

    // Colocar lead em um funil em etapa específica (ex: n8n, campanha de ads).
    // `resolvedPipeline` já foi resolvido (e errou 4xx se não existia) LÁ EM
    // CIMA, antes do lead nascer — aqui só se usa.
    if (payload.place_in_pipe?.pipe && payload.place_in_pipe?.stage && resolvedPipeline) {
      const { stage, meeting_date } = payload.place_in_pipe;
      const stageVal = stage as string;

      // Helper: auto-distribuir SDR/Closer após inserir novo registro no pipe.
      // As RPCs de round-robin são keyed por slug de funil semeado; para funil
      // custom devolvem null e nada é distribuído (paridade de distribuição de
      // funil custom fica registrada como incremento — não é regressão: custom
      // nunca teve round-robin nesta porta).
      const autoDistributePipe = async (pipeSlug: string) => {
        try {
          const { data: sdrId } = await supabase.rpc("get_next_pipe_sdr", {
            p_pipe_type: pipeSlug,
            p_organization_id: organizationId,
          });
          const metadataUpdate: Record<string, unknown> = {};
          if (sdrId) metadataUpdate.sdr_id = sdrId;

          let closerId: string | null = null;
          if (pipeSlug !== "whatsapp") {
            // Closer fixo (sale_responsible_id) tem prioridade sobre o round robin.
            // Ex: Cal.com da Basic4u → venda sempre Bruna; SDR/pré-venda continua distribuindo.
            if (payload.sale_responsible_id) {
              closerId = payload.sale_responsible_id;
            } else {
              const { data: cId } = await supabase.rpc("get_next_pipe_closer", {
                p_pipe_type: pipeSlug,
                p_organization_id: organizationId,
              });
              closerId = cId;
            }
            if (closerId) metadataUpdate.closer_id = closerId;
          }

          // Closer fixo (ex: Cal.com → venda sempre Bruna). Nesse caso o DONO ATIVO do card
          // de confirmação é o pré-venda distribuído (quem trabalha o follow-up), e o closer
          // fica travado só como sale_responsible. Sem closer fixo, mantém o default histórico
          // (closer||sdr como dono).
          const fixedCloser = !!payload.sale_responsible_id;
          const activeOwner = fixedCloser ? (sdrId ?? closerId) : (closerId || sdrId);

          if (Object.keys(metadataUpdate).length > 0) {
            // Round-robin do pré-venda rastreia o último responsável gravado na entry
            // (metadata.responsible_id → assigned_to). Com closer fixo gravamos o pré-venda
            // como responsible pra rotação enxergá-lo e alternar — senão pegava sempre o 1º.
            if (fixedCloser && activeOwner) metadataUpdate.responsible_id = activeOwner;

            const entry = await getPipeEntry(supabase, leadId, organizationId, pipeSlug);
            if (entry) {
              await updatePipeEntryById(supabase, entry.id, {
                metadata: metadataUpdate,
                assignedTo: activeOwner ?? undefined,
              });
            }
            console.log(`[lead-webhook] Auto-distributed in pipeline_entries(${pipeSlug}):`, metadataUpdate);

            if (activeOwner) {
              const leadAssign: Record<string, unknown> = {};
              if (fixedCloser) {
                // Modelo atual do produto: o lead tem só DOIS responsáveis — pré-venda e venda.
                // responsible_id genérico é legado (UI não usa, só pre_sale/sale) → não setar.
                // Pré-venda = membro distribuído (null se não há pool, nunca cai no closer fixo).
                leadAssign.pre_sale_responsible_id = sdrId ?? null;
                leadAssign.sale_responsible_id = closerId; // closer fixo (ex: Bruna)
              } else {
                // Fluxo histórico (sem closer fixo): mantém responsible_id genérico = dono.
                leadAssign.responsible_id = activeOwner;
                leadAssign.pre_sale_responsible_id = sdrId || activeOwner;
                leadAssign.sale_responsible_id = closerId || activeOwner;
              }
              // sdr_id/closer_id são espelhados pelo trigger fn_sync_canonical_assignment a partir
              // de pre_sale/sale, mas setamos explícito por clareza quando disponíveis.
              if (sdrId) leadAssign.sdr_id = sdrId;
              if (closerId) leadAssign.closer_id = closerId;
              await supabase.from("leads").update(leadAssign).eq("id", leadId);
            }
          }
        } catch (e) {
          console.warn(`[lead-webhook] Auto-distribute failed for pipeline_entries(${pipeSlug}):`, e);
        }
      };

      // Slug canônico do funil resolvido: é o que vai para RPCs de round-robin,
      // logs e lead_history — mesmo quando o caller mandou uuid ou alias.
      const pipeSlug = resolvedPipeline.slug;
      const metadata: Record<string, unknown> = {};
      if (meeting_date) metadata.meeting_date = meeting_date;

      // Aceita stage_key exato ou nome da etapa (case-insensitive) — Make/n8n enviam rótulos como "Novo".
      // Normaliza whitespace (colapsa espaços repetidos + trim) pra resiliência: rótulos com emoji
      // costumam ter espaço duplo ("📥  Novo Lead") que diverge do que o caller digita ("📥 Novo Lead").
      const normalizeLabel = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      let resolvedStageKey = stageVal;
      // SCRUM-624: etapas lidas por pipeline_id (FK real, W1) — não mais por
      // pipeline_type = slug. É o que faz o casamento por rótulo funcionar
      // também para funil custom e para ref por uuid.
      const { data: orgStages } = await supabase
        .from("pipeline_stages")
        .select("stage_key, name")
        .eq("organization_id", organizationId)
        .eq("pipeline_id", resolvedPipeline.id)
        .eq("is_active", true);
      if (orgStages && orgStages.length > 0) {
        const requested = normalizeLabel(stageVal);
        const match =
          orgStages.find((s) => s.stage_key.toLowerCase() === requested) ||
          orgStages.find((s) => s.name && normalizeLabel(s.name) === requested);
        if (match) {
          resolvedStageKey = match.stage_key;
        } else {
          // Stage não casa key nem nome de etapa ATIVA. Em vez de gravar o literal (lead some
          // do kanban — coluna é keyed por stage_key), remapeia p/ a 1ª etapa ativa do pipe
          // (ghost-stage guard). Ex.: integração externa manda stage="novo" mas a org desativou
          // "novo" e usa "novo_lead" como 1ª etapa → o lead cai em novo_lead, visível.
          // Incidente DNA de Almas 2026-06: Zuvic mandava place_in_pipe whatsapp/novo e todo
          // lead caía na coluna "novo" (inativa) → invisível. Mesma classe de [[ghost-stage]].
          const guardStage = await resolveActiveStageKey(supabase, organizationId, pipeSlug, stageVal);
          if (guardStage && guardStage !== stageVal) {
            console.warn(
              `[lead-webhook] stage "${stageVal}" não casa etapa ativa em ${pipeSlug} (org ${organizationId}); remapeando p/ 1ª ativa "${guardStage}" (ghost-stage guard).`,
            );
            resolvedStageKey = guardStage;
          } else if (!guardStage) {
            // Org sem nenhuma etapa ativa nesse pipe — não há p/ onde remapear; mantém literal.
            console.warn(
              `[lead-webhook] stage "${stageVal}" não resolvido e org sem etapas ativas em ${pipeSlug} (org ${organizationId}). Gravando literal — lead pode não aparecer no funil.`,
            );
          }
        }
      }

      const existingEntry = await getPipeEntry(supabase, leadId, organizationId, pipeSlug);
      if (existingEntry) {
        // Já havia card no funil: o pedido foi atendido, independentemente de a
        // etapa ter mudado ou não.
        placedInPipe = true;
        // Reingestão externa (Make/n8n/Meta Ads) move o lead para o stage pedido — lead que
        // reconverte volta a aparecer na coluna solicitada. Registra reconversão na timeline.
        const stageChanged = existingEntry.stage_key !== resolvedStageKey;
        const entryUpdates: { stageKey?: string; metadata?: Record<string, unknown> } = {};
        if (stageChanged) entryUpdates.stageKey = resolvedStageKey;
        if (Object.keys(metadata).length > 0) entryUpdates.metadata = metadata;
        if (Object.keys(entryUpdates).length > 0) {
          await updatePipeEntryById(supabase, existingEntry.id, entryUpdates);
        }
        if (stageChanged) {
          const { error: historyErr } = await supabase.from("lead_history").insert({
            lead_id: leadId,
            organization_id: organizationId,
            action: "stage_changed",
            description: `Lead reconverteu via webhook (${origin}): movido de "${existingEntry.stage_key}" para "${resolvedStageKey}" no funil ${pipeSlug}.`,
            created_by: null,
            source: "system",
            metadata: {
              pipe: pipeSlug,
              from_stage: existingEntry.stage_key,
              to_stage: resolvedStageKey,
              reconversion: true,
            },
          });
          if (historyErr) {
            console.warn("[lead-webhook] lead_history reconversion insert failed:", historyErr);
          }
          console.log(
            `[lead-webhook] Lead reconverteu em pipeline_entries(${pipeSlug}): "${existingEntry.stage_key}" → "${resolvedStageKey}".`
          );
        }
      } else {
        const r = await upsertPipeEntryDetailed(supabase, {
          leadId,
          orgId: organizationId,
          slug: pipeSlug,
          stageKey: resolvedStageKey,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });

        if (r.status === "created" || r.status === "updated") {
          placedInPipe = true;
          await autoDistributePipe(pipeSlug);
          console.log(`[lead-webhook] Lead placed in pipeline_entries(${pipeSlug}) stage:`, resolvedStageKey);
        } else {
          placedInPipe = false;
          placeInPipeError =
            r.status === "no_pipeline"
              ? `Funil "${pipeSlug}" não existe nesta organização`
              : `Falha ao posicionar no funil "${pipeSlug}" (${r.status})`;
          // `autoDistributePipe` NÃO roda: é o motivo nº 1 do comentário acima.
          // Ele escreve responsáveis em `leads` e gasta um giro do round-robin
          // para um card que não existe — trabalho pela metade que depois
          // parece atribuição legítima.
          console.warn(`[lead-webhook] place_in_pipe NÃO posicionou: ${placeInPipeError}`);
        }
      }
    }

    // Colocar lead em uma campanha em etapa específica (ex: campanha de ads)
    let placedInCampaign: boolean | undefined;
    let placeInCampaignError: string | undefined;
    if (payload.place_in_campaign?.campaign_id && payload.place_in_campaign?.stage_id) {
      const { campaign_id, stage_id, notes } = payload.place_in_campaign;
      const { data: campaign } = await supabase
        .from("campanhas")
        .select("id")
        .eq("id", campaign_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!campaign) {
        placeInCampaignError = "Campaign not found or not in org";
        console.warn("[lead-webhook]", placeInCampaignError, campaign_id);
      } else {
        const { data: stage } = await supabase
          .from("campanha_stages")
          .select("id")
          .eq("id", stage_id)
          .eq("campanha_id", campaign_id)
          .maybeSingle();
        if (!stage) {
          placeInCampaignError = "Stage not found or not in campaign";
          console.warn("[lead-webhook]", placeInCampaignError, stage_id);
        } else {
          const { data: existing } = await supabase
            .from("campanha_leads")
            .select("id")
            .eq("lead_id", leadId)
            .eq("campanha_id", campaign_id)
            .maybeSingle();
          if (existing) {
            const updatePayload: { stage_id: string; notes?: string } = { stage_id };
            if (notes !== undefined) updatePayload.notes = notes;
            const { error: updateErr } = await supabase
              .from("campanha_leads")
              .update(updatePayload)
              .eq("id", existing.id);
            if (updateErr) {
              placeInCampaignError = updateErr.message;
              console.warn("[lead-webhook] campanha_leads update failed:", updateErr);
            } else {
              placedInCampaign = true;
              console.log("[lead-webhook] Lead placed in campaign:", campaign_id, "stage:", stage_id);
            }
          } else {
            const sdrId = payload.assigned_user_id ?? await getCampaignLeadAssignment(supabase, campaign_id);
            const closerId = await getCampaignCloserAssignment(supabase, campaign_id);
            if (!sdrId) {
              console.warn("[lead-webhook] No SDR assigned for campaign (distribution returned null). Check lead_distribution_mode and campanha_members:", campaign_id);
            }
            const responsibleId = closerId || sdrId;
            const insertPayload: Record<string, unknown> = {
              campanha_id: campaign_id,
              lead_id: leadId,
              stage_id,
            };
            if (notes !== undefined) insertPayload.notes = notes;
            if (sdrId) insertPayload.sdr_id = sdrId;
            if (closerId) insertPayload.closer_id = closerId;
            if (responsibleId) insertPayload.responsible_id = responsibleId;
            insertPayload.pre_sale_responsible_id = sdrId ?? null;
            insertPayload.sale_responsible_id = closerId ?? null;
            const { error: insertErr } = await supabase
              .from("campanha_leads")
              .insert(insertPayload);
            if (insertErr) {
              placeInCampaignError = insertErr.message;
              console.warn("[lead-webhook] campanha_leads insert failed:", insertErr);
            } else {
              placedInCampaign = true;
              console.log("[lead-webhook] Lead placed in campaign:", campaign_id, "stage:", stage_id);
              const leadUpdate: Record<string, unknown> = {};
              if (sdrId) leadUpdate.sdr_id = sdrId;
              if (closerId) leadUpdate.closer_id = closerId;
              if (responsibleId) leadUpdate.responsible_id = responsibleId;
              leadUpdate.pre_sale_responsible_id = sdrId ?? null;
              leadUpdate.sale_responsible_id = closerId ?? null;
              if (Object.keys(leadUpdate).length > 0) {
                const { error: leadUpdateErr } = await supabase
                  .from("leads")
                  .update(leadUpdate)
                  .eq("id", leadId);
                if (leadUpdateErr) {
                  console.warn("[lead-webhook] leads assignment update failed:", leadUpdateErr);
                } else {
                  console.log("[lead-webhook] Lead assigned responsible:", responsibleId, "SDR:", sdrId, "Closer:", closerId);
                }
              }
            }
          }
        }
      }
      if (placedInCampaign === undefined && !placeInCampaignError) placeInCampaignError = "Placement failed";
      if (placedInCampaign !== true) placedInCampaign = false;
    }

    // ── Build response first, then fire-and-forget non-critical work ──
    const responseBody: Record<string, unknown> = {
      success: true,
      lead_id: leadId,
      is_new: isNewLead,
      message: isNewLead ? "Lead criado com sucesso" : "Lead encontrado e atualizado",
    };
    if (Object.keys(customFieldResults).length > 0) {
      responseBody.custom_fields = customFieldResults;
    }
    if (payload.place_in_pipe) {
      responseBody.place_in_pipe = payload.place_in_pipe;
      // Contrato com quem integra: `place_in_pipe` é o que foi PEDIDO,
      // `placed_in_pipe` é o que ACONTECEU.
      //
      // 🚨 Este campo era `true` fixo. O comentário anterior justificava assim:
      // "desde #1774 não há política por organização que recuse o
      // posicionamento, então este caminho sempre posiciona". A premissa morreu
      // em 20270902000010 — o funil de sistema passou a poder não existir na
      // org, seja porque ela nunca o teve (org nova não nasce mais com funil),
      // seja porque foi excluído. Com `true` fixo, o n8n recebia 200 dizendo que
      // o lead entrou no funil enquanto nenhum card fora criado; o lead ficava
      // só na lista de Leads e o cliente lia como "o lead sumiu".
      //
      // Mesmo formato de `placed_in_campaign`/`place_in_campaign_error`, que já
      // reportava honestamente ali embaixo.
      responseBody.placed_in_pipe = placedInPipe === true;
      if (placeInPipeError) responseBody.place_in_pipe_error = placeInPipeError;
    }
    if (payload.place_in_campaign) {
      responseBody.place_in_campaign = payload.place_in_campaign;
      responseBody.placed_in_campaign = placedInCampaign === true;
      if (placeInCampaignError) responseBody.place_in_campaign_error = placeInCampaignError;
    }

    // Fire-and-forget: enqueue webhooks, outbound trigger, and log runtime.
    // These are non-critical — we don't block the HTTP response waiting for them.
    const backgroundTasks: Promise<void>[] = [];

    // Enfileira webhooks outbound (lead.created ou lead.updated)
    backgroundTasks.push(
      enqueueWebhookDeliveries(supabase, organizationId, isNewLead ? "lead.created" : "lead.updated", {
        event: isNewLead ? "lead.created" : "lead.updated",
        timestamp: new Date().toISOString(),
        data: {
          id: leadId,
          name: result.lead.name,
          email: result.lead.email ?? undefined,
          phone: result.lead.phone ?? undefined,
          organization_id: organizationId,
        },
      }).catch((e) => console.warn("[lead-webhook] Failed to enqueue webhooks:", e)),
    );

    // Se é novo lead, verificar se existe agente outbound para disparar
    if (isNewLead) {
      backgroundTasks.push(
        fetch(`${supabaseUrl}/functions/v1/outbound-trigger`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            lead_id: leadId,
            organization_id: organizationId,
            source: payload.source,
            tags: payload.tags || [],
          }),
        })
          .then(() => console.log("[lead-webhook] Triggered outbound check for lead:", leadId))
          .catch((e) => console.warn("[lead-webhook] Failed to trigger outbound:", e)),
      );
    }

    backgroundTasks.push(
      logRuntime({
        organizationId: organizationId,
        module: "lead",
        action: "webhook_ingest",
        status: "success",
        entityType: "lead",
        entityId: leadId,
        payloadSnapshot: {
          source: payload.source,
          is_new: isNewLead,
          // D6: grava a INTENÇÃO do caller (o destino pedido, como veio) e o
          // desfecho — é a matéria-prima para medir quem pede o quê e quantos
          // pedidos não viram card (antes só o console via isso).
          place_in_pipe: payload.place_in_pipe
            ? { pipe: payload.place_in_pipe.pipe, stage: payload.place_in_pipe.stage }
            : null,
          placed_in_pipe: placedInPipe ?? null,
          resolved_pipeline_id: resolvedPipeline?.id ?? null,
        },
      }).catch((e) => console.warn("[lead-webhook] logRuntime failed:", e)),
    );

    // Run background tasks without blocking response
    Promise.allSettled(backgroundTasks).catch(() => {});

    return successResponse(responseBody, corsHeaders, { req });

  } catch (error) {
    console.error("[lead-webhook] Error:", error);
    await logRuntime({
      module: "lead",
      action: "webhook_ingest",
      status: "error",
      errorMessage: String(error),
    });
    return errorResponse(500, "Internal server error", corsHeaders, { req, details: String(error) });
  }
}));
