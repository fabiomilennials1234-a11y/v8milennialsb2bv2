import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarClock, Check, ChevronLeft, ChevronRight, ImagePlus, Info, Layers, Loader2,
  ListFilter, MousePointerClick, Send, Sparkles, Users, X, Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useWhatsAppInstances } from "@/modules/communication";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import { UpgradeModal } from "@/shared/components/UpgradeModal";
import {
  TEMPLATE_VARIABLES,
  replaceVariablesWithExamples,
  useCampaignTemplates,
} from "@/modules/campaigns";
import { useQuickBlast, useTags, type QuickBlastResult } from "@/modules/leads";
import {
  useCreateBlastPlan,
  type BlastPlanLotBreakdown,
  type CreateBlastPlanResult,
} from "@/modules/campaigns";
import { useCarteiraLeadIds } from "@/modules/carteira";

import { usePipelines } from "../../hooks/model/usePipelines";
import { usePipelineLeadIds } from "../../hooks/model/usePipelineLeadIds";
import { useStagesDoFunil } from "../../hooks/model/useStagesDoFunil";

import { BlastBreakdown } from "./BlastBreakdown";
import { BlastRefinementsControls } from "./BlastRefinementsControls";
import {
  AudienceConditionsControls,
  EMPTY_CONDITIONS,
  type AudienceConditions,
} from "./AudienceConditionsControls";
import {
  DEFAULT_REFINEMENTS,
  resolveRefinementFields,
  useBlastPreview,
  type BlastPreviewState,
  type BlastRefinements,
} from "./useBlastPreview";

/**
 * The funnel board's live filter, narrowed to the dimensions the "Filtro ativo"
 * audience source can honor — exactly the ones the board resolves SERVER-SIDE
 * (search, responsible, tags). The page-only filters (origin, calor, range, …)
 * are deliberately absent: they never reach the full result set, so the wizard
 * cannot replay them. Threaded from `PipeWhatsapp` so the wizard count matches
 * the board after the same filter.
 *
 * `chips` carry human labels for the active server-side dimensions so the
 * operator sees precisely what "Filtro ativo" honors — resolved by the page
 * (which owns the member/tag dictionaries), not re-fetched here.
 */
export interface DisparoBoardFilter {
  search?: string;
  /** Pre/sale responsible id, or `"all"`/null when cleared (board convention). */
  responsibleId?: string | null;
  tagIds?: string[];
  /** Pre-resolved labels for the active honored dimensions (page-owned). */
  chips?: string[];
}

/**
 * Source of the audience. For funnels the primary source is a whole stage; for
 * carteira it's a segment set (post-sale). "filtro" replays the board's live
 * filter; "manual" is a hand-picked set seeded from the kanban bulk-bar. The
 * value strings are stable across contexts — only the LABEL changes ("Estágio"
 * for funis, "Segmento" for carteira), keeping downstream logic uniform.
 */
export type DisparoSource = "estagio" | "filtro" | "manual";

/**
 * @deprecated Fatia B (Funil é Funil): só sobrevive no contrato LEGADO do
 * contexto `{kind:"system"}` — aceito na leitura pra sempre; código novo monta
 * `{kind:"pipeline", pipelineId}`. Morre na F6 junto com o contexto legado.
 */
export type SystemPipelineType = "whatsapp" | "confirmacao" | "propostas";

/**
 * Where the wizard is mounted — discriminates how the audience resolves. All
 * kinds funnel into the SAME refinements + dry-run preview + fire + "agendar
 * lotes" downstream (those take lead_ids and never branch on context):
 *
 *   - pipeline: CANÔNICO (Fatia B) — um funil qualquer da org por
 *               `pipelines.id`. Etapas via `useStagesDoFunil` (uuid), público
 *               via `usePipelineLeadIds` (motor único `get_pipeline_lead_ids`).
 *   - system  : LEGADO, aceito pra sempre — slug do trio; normaliza pra
 *               `pipeline` resolvendo o id em `usePipelines` por (org, slug).
 *   - custom  : LEGADO, aceito pra sempre — já carrega o `pipelineId`;
 *               normaliza direto (a lista `stages` passada é ignorada: a fonte
 *               única de etapas é `useStagesDoFunil`).
 *   - carteira: the post-sale portfolio. Source picker becomes "Segmento";
 *               resolves via `useCarteiraLeadIds`. No responsible filter.
 */
export type DisparoContext =
  | { kind: "pipeline"; pipelineId: string }
  | { kind: "system"; pipelineType: SystemPipelineType }
  | { kind: "custom"; pipelineId: string; stages: { id: string; name: string; color?: string | null }[] }
  | { kind: "carteira" };

const DEFAULT_CONTEXT: DisparoContext = { kind: "system", pipelineType: "whatsapp" };

/** Carteira segment options for the "Segmento" source picker (multi-select). */
const CARTEIRA_SEGMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "ouro", label: "Ouro" },
  { value: "prata", label: "Prata" },
  { value: "novo", label: "Novo" },
  { value: "resgate", label: "Resgate" },
  { value: "dormindo", label: "Dormindo" },
];

interface DisparoWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where the wizard targets. Defaults to the WhatsApp system funnel so the
   * existing `PipeWhatsapp` mount keeps working unchanged.
   */
  context?: DisparoContext;
  /** The funnel board's live server-side filter (powers the "Filtro ativo" source). */
  boardFilter?: DisparoBoardFilter;
  /** Pre-seeded lead ids for the "Manual" source (from the kanban bulk-bar). */
  initialManualLeadIds?: string[];
  /** Source to open on — defaults to "estagio". Pass "manual" with seeded ids. */
  initialSource?: DisparoSource;
}

type StepId = "publico" | "mensagem" | "revisao";

const STEPS: { id: StepId; label: string; hint: string }[] = [
  { id: "publico", label: "Público", hint: "Quem recebe" },
  { id: "mensagem", label: "Mensagem", hint: "O que dispara" },
  { id: "revisao", label: "Revisão", hint: "Quando e confirmação" },
];

const CONNECTED = new Set(["open", "connected"]);

// Custom easing — não usar `ease`. Entrada decisiva, saída suave (Linear/Stripe).
const EASE = [0.22, 1, 0.36, 1] as const;

/** Mirror do resolver do servidor: variáveis viram exemplo, depois cada spintax
 *  {a|b|c} colapsa pra primeira opção (o servidor sorteia por destinatário). */
function previewMessage(template: string): string {
  const withVars = replaceVariablesWithExamples(template);
  return withVars.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, body: string) => body.split("|")[0]);
}

/**
 * Plan gate — disparo em massa é feature `whatsapp_bulk`. Wrapper (e não
 * early-return interno) pra não condicionar a ordem dos hooks do wizard.
 * Cobre todos os entry points (pipes, custom, carteira, bulk bars) num
 * único choke point.
 */
export function DisparoWizard(props: DisparoWizardProps) {
  const orgFeatures = useOrgFeaturesOptional();
  const locked = orgFeatures ? !orgFeatures.hasFeature("whatsapp_bulk") : false;

  if (locked) {
    return (
      <UpgradeModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        featureKey="whatsapp_bulk"
      />
    );
  }
  return <DisparoWizardInner {...props} />;
}

function DisparoWizardInner({
  open,
  onOpenChange,
  context = DEFAULT_CONTEXT,
  boardFilter,
  initialManualLeadIds,
  initialSource = "estagio",
}: DisparoWizardProps) {
  const reduceMotion = useReducedMotion();

  const isCarteira = context.kind === "carteira";
  // Fatia B: o kind system/custom colapsou — todo contexto de funil normaliza
  // pra UM `pipelineId`. O contrato legado `{kind:"system", pipelineType}` é
  // aceito pra sempre: o slug resolve pro funil real da org via `usePipelines`.
  const { data: orgPipelines = [] } = usePipelines();
  const funnelId: string | null = isCarteira
    ? null
    : context.kind === "system"
      ? orgPipelines.find((p) => p.slug === context.pipelineType)?.id ?? null
      : context.pipelineId;
  // The primary source label flips for carteira (a Segment set, not a Stage).
  const primarySourceLabel = isCarteira ? "Segmento" : "Estágio";

  const [step, setStep] = useState<StepId>("publico");
  const [direction, setDirection] = useState<1 | -1>(1);

  // Step 1 — Público
  const [source, setSource] = useState<DisparoSource>(initialSource);
  // Funnel stage selection — `pipeline_stages.id` (uuid, canônico de qualquer
  // funil). O nome `stageKey` fica pelo prop público do PublicoStep.
  const [stageKey, setStageKey] = useState<string>("");
  // Carteira segment multi-select (only used when context.kind === "carteira").
  const [segments, setSegments] = useState<string[]>([]);
  const [manualLeadIds, setManualLeadIds] = useState<string[]>(initialManualLeadIds ?? []);
  const [refinements, setRefinements] = useState<BlastRefinements>(DEFAULT_REFINEMENTS);
  // Audience conditions (Phase 2a) — narrow EVERY source except Manual.
  const [conditions, setConditions] = useState<AudienceConditions>(EMPTY_CONDITIONS);

  // Seed source + manual ids whenever the dialog (re)opens — the caller may
  // open with a fresh kanban selection each time.
  useEffect(() => {
    if (!open) return;
    setSource(initialSource);
    setManualLeadIds(initialManualLeadIds ?? []);
    setSegments([]);
    setConditions(EMPTY_CONDITIONS);
    // Only on open: an open dialog must not have its source yanked mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Step 2 — Mensagem
  const [templateId, setTemplateId] = useState<string>("");
  const [message, setMessage] = useState("");
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [instanceId, setInstanceId] = useState<string>("");
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(30);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Step 3 — Revisão
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [scheduledFor, setScheduledFor] = useState<string>("");
  // When the audience overflows today's budget, the operator picks between
  // draining it over days ("plan") or sending only what fits today ("today").
  // Defaults to "plan" — the recommended path that loses no one.
  const [overBudgetChoice, setOverBudgetChoice] = useState<"plan" | "today">("plan");
  const [result, setResult] = useState<QuickBlastResult | null>(null);
  const [planResult, setPlanResult] = useState<CreateBlastPlanResult | null>(null);

  // Unified stage list for the picker — `pipeline_stages` por pipeline_id,
  // chave = stage id (uuid), pra QUALQUER funil. Carteira has no stage picker.
  const stagesQuery = useStagesDoFunil(funnelId);
  const stages = useMemo<{ key: string; name: string; color?: string | null }[]>(
    () => (stagesQuery.data ?? []).map((s) => ({ key: s.id, name: s.name, color: s.color })),
    [stagesQuery.data],
  );
  const stagesLoading = !!funnelId && stagesQuery.isLoading;

  const { data: orgTags = [] } = useTags();
  const { data: templates = [] } = useCampaignTemplates();
  const { data: instances = [] } = useWhatsAppInstances();
  const blast = useQuickBlast();
  const createPlan = useCreateBlastPlan();

  // Does the board carry an active server-side filter at all? Without one the
  // "Filtro ativo" source has nothing to honor and is empty/disabled. Carteira
  // has no funnel board, so it never offers the "filtro" source.
  const boardFilterActive = useMemo(() => {
    if (isCarteira || !boardFilter) return false;
    const { search, responsibleId, tagIds } = boardFilter;
    return (
      (!!search && search.trim().length > 0) ||
      (!!responsibleId && responsibleId !== "all") ||
      (!!tagIds && tagIds.length > 0)
    );
  }, [isCarteira, boardFilter]);

  // Conditions shared across the filtered resolvers (system/custom).
  const conditionFields = {
    tagIds: conditions.tagIds,
    qualificationTier: conditions.qualificationTier,
    preQualificationTier: conditions.preQualificationTier,
    origin: conditions.origin,
  };

  // ── FUNNEL resolver (motor único — Fatia B) ───────────────────────────────
  // `get_pipeline_lead_ids` cobre estágio, funil inteiro, condições e o replay
  // do filtro do board para QUALQUER funil, por pipeline_id. O hook desliga
  // sozinho com pipelineId null (carteira/manual-only).
  const funnelResolverActive =
    !isCarteira &&
    !!funnelId &&
    ((source === "estagio" && !!stageKey) || (source === "filtro" && boardFilterActive));
  const { data: funnelLeadIds, isLoading: funnelLeadsLoading } = usePipelineLeadIds(
    funnelResolverActive ? funnelId : null,
    source === "filtro"
      ? {
          search: boardFilter?.search,
          responsibleId: boardFilter?.responsibleId,
          // Board tags + condition tags both narrow; merge them (intersection
          // semantics are server-side ALL-of, so union the requested lists).
          tagIds: [...(boardFilter?.tagIds ?? []), ...conditions.tagIds],
          qualificationTier: conditions.qualificationTier,
          preQualificationTier: conditions.preQualificationTier,
          origin: conditions.origin,
        }
      : {
          stageId: stageKey || null,
          ...conditionFields,
        },
  );

  // ── CARTEIRA resolver ─────────────────────────────────────────────────────
  // Segment source + conditions. Fetched only on the carteira context; the
  // "filtro" source there means "all carteira narrowed by conditions" (no board).
  const { data: carteiraLeadIds, isLoading: carteiraLoading } = useCarteiraLeadIds(
    isCarteira && (source === "estagio" || source === "filtro")
      ? {
          segments: source === "estagio" ? segments : undefined,
          ...conditionFields,
        }
      : {},
  );

  // ── Resolve the active source into a single candidate set + loading flag ───
  const audienceLeadIds = (() => {
    if (source === "manual") return manualLeadIds;
    if (isCarteira) return carteiraLeadIds;
    return funnelResolverActive ? funnelLeadIds : [];
  })();

  const audienceLoading = (() => {
    if (source === "manual") return false;
    if (isCarteira) {
      // estagio needs a segment chosen; filtro is always resolvable.
      const ready = source === "filtro" || segments.length > 0;
      return carteiraLoading && ready;
    }
    return funnelResolverActive && funnelLeadsLoading;
  })();

  const audienceSize = audienceLeadIds?.length ?? 0;
  const selectedStage = stages.find((s) => s.key === stageKey);

  // Whether the active source has a "chosen target" — gates the live count
  // panel. Carteira "estagio" needs ≥1 segment; carteira "filtro" is always
  // ready (conditions-only narrowing of the whole carteira).
  const sourceReady =
    source === "manual"
      ? audienceSize > 0
      : isCarteira
        ? source === "filtro"
          ? true
          : segments.length > 0
        : source === "filtro"
          ? boardFilterActive
          : !!stageKey;

  const connectedInstances = useMemo(
    () => instances.filter((i: any) => CONNECTED.has(i.status)),
    [instances],
  );
  const selectableInstances = connectedInstances.length > 0 ? connectedInstances : instances;

  // Live dry-run preview. Uses the chosen instance; before one is picked, a
  // connected instance stands in purely for the count — the preview never sends.
  // Feeds the SAME downstream regardless of source — the resolved lead ids are
  // all the preview needs.
  const previewInstanceId = instanceId || connectedInstances[0]?.id || instances[0]?.id;
  const blastPreview = useBlastPreview({
    leadIds: audienceLeadIds,
    instanceId: previewInstanceId,
    message,
    refinements,
    enabled: open && sourceReady && audienceSize > 0 && !result && !planResult,
  });

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const preview = previewMessage(message);

  // Days label only when the recency refinement is actually engaged.
  const activeRecentDays =
    refinements.excludeRecent && refinements.recentDays > 0 ? refinements.recentDays : null;

  // Source recap shown in Revisão — names the audience provenance plainly.
  // The primary-source label flips to "Segmento" for carteira; "filtro" reads
  // as a plain conditions narrowing there (no funnel board behind it).
  const sourceLabel =
    source === "estagio"
      ? primarySourceLabel
      : source === "filtro"
        ? isCarteira
          ? "Condições"
          : "Filtro ativo"
        : "Manual";
  const sourceValue =
    source === "estagio"
      ? isCarteira
        ? segments.length > 0
          ? segments
              .map((seg) => CARTEIRA_SEGMENT_OPTIONS.find((s) => s.value === seg)?.label ?? seg)
              .join(", ")
          : "—"
        : selectedStage?.name ?? "—"
      : source === "filtro"
        ? isCarteira
          ? "carteira filtrada"
          : "filtro do funil"
        : `${manualLeadIds.length} selecionados`;

  // Audience provenance descriptor — best-effort, recorded on the plan for its
  // panel label e pra coluna canônica `blast_plans.pipeline_id` (Fatia B). O
  // `stageId` é uuid de `pipeline_stages`; a chave legada `stageKey` de planos
  // antigos continua aceita na leitura.
  const audienceSourceDescriptor = useMemo<Record<string, unknown>>(
    () => ({
      context: context.kind,
      source,
      ...(funnelId ? { pipelineId: funnelId } : {}),
      ...(source === "estagio"
        ? isCarteira
          ? { segments }
          : { stageId: stageKey }
        : {}),
    }),
    [context.kind, source, isCarteira, segments, stageKey, funnelId],
  );

  // Over-budget decision (#707). The dry-run preview reports `remaining` —
  // today's Daily Blast Budget headroom — plus the refined eligible set
  // (would-send today + the slice it clipped as `overDailyBudget`). The blast
  // overflows today when that eligible set exceeds the headroom. We surface the
  // scheduled-plan choice ONLY with a settled preview that proves the overflow;
  // a preview hiccup (`remaining` unknown) silently keeps the single-day flow.
  const previewData = blastPreview.data;
  const remaining = previewData?.remaining;
  // Eligible-today = what would send + what the budget clipped. This is the true
  // size the plan must drain; `count` alone is already clamped to the budget.
  const eligibleToday =
    previewData != null ? previewData.count + (previewData.skipped.overDailyBudget ?? 0) : null;
  const overBudget =
    remaining != null &&
    eligibleToday != null &&
    !blastPreview.isLoading &&
    eligibleToday > remaining;
  // The single-day path sends at most `remaining`; the plan drains all eligible.
  const todayCount = overBudget ? remaining ?? 0 : eligibleToday ?? audienceSize;
  const planAudience = eligibleToday ?? audienceSize;
  // Projected number of daily lots, assuming each day clears one full budget.
  // Best-effort, shown upfront so "Agendar N lotes" carries a real N; the
  // backend returns the authoritative breakdown on creation.
  const projectedLots =
    overBudget && remaining != null && remaining > 0
      ? Math.ceil(planAudience / remaining)
      : null;

  const canAdvancePublico = sourceReady && !audienceLoading && audienceSize > 0;
  const canAdvanceMensagem =
    message.trim().length > 0 && !!instanceId && delayMin >= 3 && delayMax >= delayMin && !uploading;
  const scheduleValid = when === "now" || (!!scheduledFor && new Date(scheduledFor).getTime() > Date.now());
  const busy = blast.isPending || createPlan.isPending;
  // The active CTA: schedule a plan only when over budget AND the operator kept
  // the recommended "plan" choice. Everything else fires the single-day blast.
  const fireAsPlan = overBudget && overBudgetChoice === "plan";
  const canFire =
    canAdvancePublico && canAdvanceMensagem && scheduleValid && !busy && !result && !planResult;
  // Terminal state — either a single-day blast fired or a plan was created.
  const done = !!result || !!planResult;

  function resetAll() {
    setStep("publico");
    setDirection(1);
    setSource(initialSource);
    setStageKey("");
    setSegments([]);
    setConditions(EMPTY_CONDITIONS);
    setManualLeadIds(initialManualLeadIds ?? []);
    setRefinements(DEFAULT_REFINEMENTS);
    setTemplateId("");
    setMessage("");
    setInstanceId("");
    setDelayMin(5);
    setDelayMax(30);
    setImageUrl(null);
    setWhen("now");
    setScheduledFor("");
    setOverBudgetChoice("plan");
    setResult(null);
    setPlanResult(null);
  }

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // Limpa após a animação de saída do dialog.
      setTimeout(resetAll, 220);
    }
  }

  function goTo(target: StepId) {
    setDirection(STEPS.findIndex((s) => s.id === target) > stepIndex ? 1 : -1);
    setStep(target);
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (tpl) setMessage(tpl.content ?? "");
  }

  function insertVariable(key: string) {
    const el = messageRef.current;
    const snippet = `{${key}}`;
    if (!el) {
      setMessage((m) => m + snippet);
      return;
    }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    setMessage(message.slice(0, start) + snippet + message.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      el.setSelectionRange(caret, caret);
    });
  }

  async function handleImageUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem");
      return;
    }
    setUploading(true);
    try {
      const path = `disparo/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("media").upload(path, file, {
        contentType: file.type,
        upsert: true,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (e) {
      toast.error(`Falha no upload: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleFire() {
    if (!audienceLeadIds || audienceLeadIds.length === 0) {
      toast.error("Nenhum lead no público selecionado");
      return;
    }
    try {
      const res = await blast.mutateAsync({
        instance_id: instanceId,
        lead_ids: audienceLeadIds,
        message: message.trim(),
        delay_min_ms: Math.round(delayMin * 1000),
        delay_max_ms: Math.round(delayMax * 1000),
        image_url: imageUrl ?? undefined,
        scheduled_for:
          when === "schedule" && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        // Server re-resolves the same refinements authoritatively on fire.
        ...resolveRefinementFields(refinements),
      });
      setResult(res);
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao iniciar disparo");
    }
  }

  // Schedule a Blast Plan (#707): the same audience + refinements the fire path
  // resolves, but drained over consecutive days. Backend freezes the snapshot
  // and fires lot 1 today; the returned breakdown drives the success panel.
  async function handleCreatePlan() {
    if (!audienceLeadIds || audienceLeadIds.length === 0) {
      toast.error("Nenhum lead no público selecionado");
      return;
    }
    try {
      const res = await createPlan.mutateAsync({
        instance_id: instanceId,
        lead_ids: audienceLeadIds,
        message: message.trim(),
        delay_min_ms: Math.round(delayMin * 1000),
        delay_max_ms: Math.round(delayMax * 1000),
        image_url: imageUrl ?? undefined,
        // Same refinements as the fire path — the server re-resolves them.
        ...resolveRefinementFields(refinements),
        source: audienceSourceDescriptor,
      });
      setPlanResult(res);
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao criar o plano");
    }
  }

  const variants = {
    enter: (dir: 1 | -1) => ({ opacity: 0, x: reduceMotion ? 0 : dir * 24 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: 1 | -1) => ({ opacity: 0, x: reduceMotion ? 0 : dir * -24 }),
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        {/* Cabeçalho editorial */}
        <DialogHeader className="space-y-1.5 border-b border-border/60 px-6 pb-5 pt-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/12 text-primary">
              <Send className="h-3.5 w-3.5" />
            </span>
            <DialogTitle className="text-lg font-semibold tracking-tight">Disparo</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            {isCarteira
              ? "Envio em massa por segmento da carteira ou seleção manual."
              : "Envio em massa por estágio, filtro ativo do funil ou seleção manual."}{" "}
            Leads sem telefone, duplicados e o teto da organização são tratados automaticamente.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <Stepper steps={STEPS} activeIndex={stepIndex} done={done} />

        {/* Corpo dos passos */}
        <div className="relative min-h-[336px] px-6 py-5">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={done ? "done" : step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: EASE }}
            >
              {planResult ? (
                <PlanSuccessPanel result={planResult} />
              ) : result ? (
                <SuccessPanel result={result} scheduled={when === "schedule"} />
              ) : step === "publico" ? (
                <PublicoStep
                  contextKind={context.kind}
                  primarySourceLabel={primarySourceLabel}
                  source={source}
                  onSource={setSource}
                  stages={stages}
                  stagesLoading={stagesLoading}
                  stageKey={stageKey}
                  onStageKey={setStageKey}
                  segments={segments}
                  onSegments={setSegments}
                  conditions={conditions}
                  onConditions={setConditions}
                  orgTags={orgTags}
                  audienceSize={audienceSize}
                  audienceLoading={audienceLoading}
                  refinements={refinements}
                  onRefinements={setRefinements}
                  preview={blastPreview}
                  activeRecentDays={activeRecentDays}
                  boardFilterActive={boardFilterActive}
                  boardFilterChips={boardFilter?.chips ?? []}
                  manualCount={manualLeadIds.length}
                />
              ) : step === "mensagem" ? (
                <MensagemStep
                  templates={templates}
                  templateId={templateId}
                  onTemplate={applyTemplate}
                  message={message}
                  onMessage={setMessage}
                  messageRef={messageRef}
                  onInsertVariable={insertVariable}
                  preview={preview}
                  instanceId={instanceId}
                  onInstance={setInstanceId}
                  instances={selectableInstances}
                  delayMin={delayMin}
                  delayMax={delayMax}
                  onDelayMin={setDelayMin}
                  onDelayMax={setDelayMax}
                  imageUrl={imageUrl}
                  uploading={uploading}
                  onImage={handleImageUpload}
                  onClearImage={() => setImageUrl(null)}
                />
              ) : (
                <RevisaoStep
                  audienceSize={audienceSize}
                  sourceLabel={sourceLabel}
                  sourceValue={sourceValue}
                  when={when}
                  onWhen={setWhen}
                  scheduledFor={scheduledFor}
                  onScheduledFor={setScheduledFor}
                  scheduleValid={scheduleValid}
                  preview={blastPreview}
                  activeRecentDays={activeRecentDays}
                  onlyNonResponders={refinements.onlyNonResponders}
                  overBudget={overBudget}
                  overBudgetChoice={overBudgetChoice}
                  onOverBudgetChoice={setOverBudgetChoice}
                  todayCount={todayCount}
                  planAudience={planAudience}
                  projectedLots={projectedLots}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Rodapé / navegação */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/20 px-6 py-4">
          {done ? (
            <Button className="ml-auto gradient-gold" onClick={() => handleClose(false)}>
              Concluir
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => (stepIndex === 0 ? handleClose(false) : goTo(STEPS[stepIndex - 1].id))}
                disabled={busy}
              >
                {stepIndex === 0 ? (
                  "Cancelar"
                ) : (
                  <>
                    <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
                  </>
                )}
              </Button>

              {step === "revisao" ? (
                fireAsPlan ? (
                  <Button className="gradient-gold" onClick={handleCreatePlan} disabled={!canFire}>
                    {createPlan.isPending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <CalendarClock className="mr-1.5 h-4 w-4" />
                    )}
                    {projectedLots != null ? `Agendar ${projectedLots} lotes` : "Agendar lotes"}
                  </Button>
                ) : (
                  <Button className="gradient-gold" onClick={handleFire} disabled={!canFire}>
                    {blast.isPending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 h-4 w-4" />
                    )}
                    {overBudget
                      ? `Disparar só hoje (${todayCount.toLocaleString("pt-BR")})`
                      : when === "schedule"
                        ? "Agendar disparo"
                        : "Disparar agora"}
                  </Button>
                )
              ) : (
                <Button
                  className="gradient-gold"
                  onClick={() => goTo(STEPS[stepIndex + 1].id)}
                  disabled={step === "publico" ? !canAdvancePublico : !canAdvanceMensagem}
                >
                  Próximo <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Stepper — trilha de progresso (Linear: índice + check, conector em gold)
 * ────────────────────────────────────────────────────────────────────────── */
function Stepper({
  steps,
  activeIndex,
  done,
}: {
  steps: { id: StepId; label: string; hint: string }[];
  activeIndex: number;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-6 pb-4 pt-4">
      {steps.map((s, i) => {
        const completed = done || i < activeIndex;
        const active = !done && i === activeIndex;
        return (
          <div key={s.id} className="flex flex-1 items-center gap-2 last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors duration-300",
                  active && "border-primary bg-primary/15 text-primary",
                  completed && "border-primary bg-primary text-primary-foreground",
                  !active && !completed && "border-border bg-transparent text-muted-foreground",
                )}
              >
                {completed ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <div className="hidden flex-col leading-tight sm:flex">
                <span
                  className={cn(
                    "text-xs font-medium transition-colors",
                    active || completed ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{s.hint}</span>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="relative h-px flex-1 overflow-hidden rounded-full bg-border">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-primary"
                  initial={false}
                  animate={{ width: completed ? "100%" : "0%" }}
                  transition={{ duration: 0.35, ease: EASE }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Step 1 — Público
 * ────────────────────────────────────────────────────────────────────────── */
/**
 * Source options for the picker, context-aware. The primary source flips its
 * label/copy/icon for carteira (a Segment set, not a funnel Stage); "filtro"
 * is dropped on carteira (no funnel board behind it).
 */
function sourceOptionsFor(
  contextKind: DisparoContext["kind"],
  primarySourceLabel: string,
): { id: DisparoSource; label: string; desc: string; icon: typeof Layers }[] {
  if (contextKind === "carteira") {
    return [
      { id: "estagio", label: primarySourceLabel, desc: "Clientes de um segmento", icon: Layers },
      { id: "manual", label: "Manual", desc: "Selecionados no quadro", icon: MousePointerClick },
    ];
  }
  return [
    { id: "estagio", label: primarySourceLabel, desc: "Todos de uma etapa", icon: Layers },
    { id: "filtro", label: "Filtro ativo", desc: "Como está no funil", icon: ListFilter },
    { id: "manual", label: "Manual", desc: "Selecionados no quadro", icon: MousePointerClick },
  ];
}

function PublicoStep({
  contextKind,
  primarySourceLabel,
  source,
  onSource,
  stages,
  stagesLoading,
  stageKey,
  onStageKey,
  segments,
  onSegments,
  conditions,
  onConditions,
  orgTags,
  audienceSize,
  audienceLoading,
  refinements,
  onRefinements,
  preview,
  activeRecentDays,
  boardFilterActive,
  boardFilterChips,
  manualCount,
}: {
  contextKind: DisparoContext["kind"];
  primarySourceLabel: string;
  source: DisparoSource;
  onSource: (s: DisparoSource) => void;
  /** Unified stage list keyed by `key` (slug for system, stage_id for custom). */
  stages: { key: string; name: string; color?: string | null }[];
  stagesLoading: boolean;
  stageKey: string;
  onStageKey: (v: string) => void;
  segments: string[];
  onSegments: (v: string[]) => void;
  conditions: AudienceConditions;
  onConditions: (next: AudienceConditions) => void;
  orgTags: { id: string; name: string; color?: string | null }[];
  audienceSize: number;
  audienceLoading: boolean;
  refinements: BlastRefinements;
  onRefinements: (next: BlastRefinements) => void;
  preview: BlastPreviewState;
  activeRecentDays: number | null;
  boardFilterActive: boolean;
  boardFilterChips: string[];
  manualCount: number;
}) {
  const isCarteira = contextKind === "carteira";
  const sourceOptions = sourceOptionsFor(contextKind, primarySourceLabel);
  const gridCols = sourceOptions.length === 2 ? "grid-cols-2" : "grid-cols-3";

  // The target is "chosen" when the active source has something to resolve.
  const sourceReady =
    source === "estagio"
      ? isCarteira
        ? segments.length > 0
        : !!stageKey
      : source === "filtro"
        ? isCarteira
          ? true
          : boardFilterActive
        : manualCount > 0;

  // Conditions narrow EVERY source except a hand-picked Manual set.
  const showConditions = source !== "manual";
  // Refinements only make sense once there is an audience to narrow.
  const showRefinements = sourceReady;

  return (
    <div className="space-y-5">
      {/* Origem do público — segmented radio-cards (Linear) */}
      <div className="space-y-2.5">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Origem do público
        </Label>
        <div
          className={cn("grid gap-2.5", gridCols)}
          role="radiogroup"
          aria-label="Origem do público"
        >
          {sourceOptions.map((src) => {
            const selected = src.id === source;
            return (
              <button
                key={src.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSource(src.id)}
                className={cn(
                  "relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  selected
                    ? "border-primary/60 bg-primary/[0.06]"
                    : "border-border hover:border-border/80 hover:bg-muted/30",
                )}
              >
                <src.icon
                  className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")}
                />
                <span className="text-sm font-medium leading-none">{src.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{src.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Configuração por fonte */}
      {source === "estagio" && (
        <div className="space-y-4">
          {isCarteira ? (
            <SegmentPicker value={segments} onChange={onSegments} />
          ) : (
            // Sem recorte por responsável: o estágio dispara para TODOS os leads
            // da etapa, com ou sem responsável atribuído. A instância de envio é
            // escolhida no passo Mensagem — ela é quem envia, para todos.
            <div className="space-y-2">
              <Label htmlFor="disparo-stage" className="text-sm">
                {primarySourceLabel} do funil
              </Label>
              <Select value={stageKey} onValueChange={onStageKey} disabled={stagesLoading}>
                <SelectTrigger id="disparo-stage">
                  <SelectValue
                    placeholder={stagesLoading ? "Carregando etapas…" : "Selecione o estágio"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: s.color ?? "hsl(var(--muted-foreground))" }}
                        />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Todos os leads desta etapa entram no disparo, inclusive os sem responsável.
              </p>
            </div>
          )}
        </div>
      )}

      {source === "filtro" &&
        (isCarteira ? (
          <CarteiraFiltroPanel />
        ) : (
          <FiltroSourcePanel active={boardFilterActive} chips={boardFilterChips} />
        ))}

      {source === "manual" && <ManualSourcePanel count={manualCount} />}

      {/* Condições do público — narram tags/qualificação/origem (Phase 2a).
          Comuns a todas as fontes exceto Manual (ids explícitos). */}
      {showConditions && (
        <AudienceConditionsControls
          value={conditions}
          onChange={onConditions}
          tags={orgTags}
          disabled={audienceLoading}
        />
      )}

      {/* Refinos do público — comuns às fontes com público resolvível */}
      {showRefinements && (
        <BlastRefinementsControls
          value={refinements}
          onChange={onRefinements}
          disabled={audienceLoading || audienceSize === 0}
        />
      )}

      {/* Contagem viva do público */}
      {!sourceReady ? (
        <EmptyAudienceHint source={source} contextKind={contextKind} />
      ) : audienceLoading ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-3.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/12 text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
          <span className="text-sm text-muted-foreground">Calculando público…</span>
        </div>
      ) : audienceSize === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-3.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/12 text-primary">
            <Users className="h-4 w-4" />
          </span>
          <span className="text-sm text-muted-foreground">
            {source === "estagio"
              ? isCarteira
                ? "Nenhum cliente neste segmento com essas condições"
                : "Nenhum lead neste estágio com essas condições"
              : source === "filtro"
                ? isCarteira
                  ? "Nenhum cliente bate com as condições"
                  : "Nenhum lead bate com o filtro do funil"
                : "Nenhum lead selecionado"}
          </span>
        </div>
      ) : (
        <BlastBreakdown
          candidates={audienceSize}
          preview={preview.data}
          isLoading={preview.isLoading}
          error={preview.error}
          recentDays={activeRecentDays}
        />
      )}
    </div>
  );
}

/** Carteira segment multi-select — chips for ouro/prata/novo/resgate/dormindo. */
function SegmentPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(seg: string) {
    onChange(value.includes(seg) ? value.filter((s) => s !== seg) : [...value, seg]);
  }
  return (
    <div className="space-y-2">
      <Label className="text-sm">Segmento da carteira</Label>
      <div className="flex flex-wrap gap-2">
        {CARTEIRA_SEGMENT_OPTIONS.map((seg) => {
          const selected = value.includes(seg.value);
          return (
            <button
              key={seg.value}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => toggle(seg.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                selected
                  ? "border-primary/60 bg-primary/[0.08] text-foreground"
                  : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
              )}
            >
              {selected && <Check className="h-3 w-3 text-primary" />}
              {seg.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Dispara para clientes ativos nos segmentos escolhidos.
      </p>
    </div>
  );
}

/** Carteira "filtro" panel — there's no funnel board; conditions do the work. */
function CarteiraFiltroPanel() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
      <Info className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p className="text-[12px] leading-snug text-muted-foreground">
        Toda a carteira ativa, narrada apenas pelas{" "}
        <span className="text-foreground">condições</span> abaixo (tag, qualificação, origem).
      </p>
    </div>
  );
}

/** Empty-state hint shown before a source target is chosen — per-source copy. */
function EmptyAudienceHint({
  source,
  contextKind,
}: {
  source: DisparoSource;
  contextKind: DisparoContext["kind"];
}) {
  const isCarteira = contextKind === "carteira";
  const copy =
    source === "estagio"
      ? isCarteira
        ? "Escolha um segmento para ver o público"
        : "Escolha um estágio para ver o público"
      : source === "filtro"
        ? "Ative um filtro no funil para usar esta fonte"
        : "Selecione leads no quadro para disparar manualmente";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-3.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/12 text-primary">
        <Users className="h-4 w-4" />
      </span>
      <span className="text-sm text-muted-foreground">{copy}</span>
    </div>
  );
}

/**
 * "Filtro ativo" config — a calm helper that states exactly which board filters
 * this source honors (search, responsible, tags — the only ones resolved
 * server-side), with the active ones surfaced as chips. Origin/calor/range are
 * page-only and silently dropped, so we say so plainly: the operator is never
 * surprised that a chip they set on the board isn't applied here.
 */
function FiltroSourcePanel({ active, chips }: { active: boolean; chips: string[] }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
        <Info className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-2">
          <p className="text-[12px] leading-snug text-muted-foreground">
            Honra <span className="text-foreground">busca</span>,{" "}
            <span className="text-foreground">responsável</span> e{" "}
            <span className="text-foreground">tags</span> do funil. Origem, calor e período ficam só
            no quadro — não entram aqui.
          </p>
          {active && chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-primary/30 bg-primary/[0.06] px-2 py-0.5 text-[10px] font-medium text-foreground"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Manual" config — read-only recap of the kanban-seeded selection. */
function ManualSourcePanel({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/12 text-primary">
        <MousePointerClick className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium tabular-nums">
          {count.toLocaleString("pt-BR")} {count === 1 ? "lead selecionado" : "leads selecionados"}
        </p>
        <p className="text-[11px] leading-tight text-muted-foreground">
          Selecionados no quadro antes de abrir o disparo
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Step 2 — Mensagem
 * ────────────────────────────────────────────────────────────────────────── */
function MensagemStep({
  templates,
  templateId,
  onTemplate,
  message,
  onMessage,
  messageRef,
  onInsertVariable,
  preview,
  instanceId,
  onInstance,
  instances,
  delayMin,
  delayMax,
  onDelayMin,
  onDelayMax,
  imageUrl,
  uploading,
  onImage,
  onClearImage,
}: {
  templates: { id: string; name: string }[];
  templateId: string;
  onTemplate: (id: string) => void;
  message: string;
  onMessage: (v: string) => void;
  messageRef: React.RefObject<HTMLTextAreaElement>;
  onInsertVariable: (key: string) => void;
  preview: string;
  instanceId: string;
  onInstance: (v: string) => void;
  instances: any[];
  delayMin: number;
  delayMax: number;
  onDelayMin: (v: number) => void;
  onDelayMax: (v: number) => void;
  imageUrl: string | null;
  uploading: boolean;
  onImage: (file: File) => void;
  onClearImage: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Template */}
      <div className="space-y-1.5">
        <Label className="text-sm">Ponto de partida</Label>
        <Select value={templateId} onValueChange={onTemplate}>
          <SelectTrigger>
            <SelectValue placeholder="Em branco — ou carregue um template salvo" />
          </SelectTrigger>
          <SelectContent>
            {templates.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum template salvo</div>
            ) : (
              templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Mensagem */}
      <div className="space-y-1.5">
        <Label htmlFor="disparo-msg" className="text-sm">
          Mensagem
        </Label>
        <Textarea
          id="disparo-msg"
          ref={messageRef}
          value={message}
          onChange={(e) => onMessage(e.target.value)}
          placeholder="Escreva a mensagem do disparo…"
          rows={4}
        />
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => onInsertVariable(v.key)}
              className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Spintax <code className="rounded bg-muted px-1">{"{oi|olá|e aí}"}</code> sorteia uma opção
          por lead — reduz risco de bloqueio.
        </p>
      </div>

      {/* Preview */}
      {message.trim().length > 0 && (
        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Prévia (dados de exemplo)
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{preview}</p>
        </div>
      )}

      {/* Instância */}
      <div className="space-y-1.5">
        <Label className="text-sm">Instância de envio</Label>
        <Select value={instanceId} onValueChange={onInstance}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione o WhatsApp" />
          </SelectTrigger>
          <SelectContent>
            {instances.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.instance_name ?? i.name ?? i.id}
                {CONNECTED.has(i.status) ? "" : " (desconectada)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Delay + imagem */}
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="disparo-min" className="text-sm">
            Delay mín (s)
          </Label>
          <Input
            id="disparo-min"
            type="number"
            min={3}
            value={delayMin}
            onChange={(e) => onDelayMin(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="disparo-max" className="text-sm">
            Delay máx (s)
          </Label>
          <Input
            id="disparo-max"
            type="number"
            min={3}
            value={delayMax}
            onChange={(e) => onDelayMax(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Imagem</Label>
          {imageUrl ? (
            <div className="flex h-10 items-center gap-2 rounded-md border border-border px-2">
              <img src={imageUrl} alt="anexo" className="h-7 w-7 rounded object-cover" />
              <button
                type="button"
                onClick={onClearImage}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground transition-colors hover:border-primary/60">
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {uploading ? "Enviando…" : "Anexar"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImage(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Step 3 — Revisão
 * ────────────────────────────────────────────────────────────────────────── */
function RevisaoStep({
  audienceSize,
  sourceLabel,
  sourceValue,
  when,
  onWhen,
  scheduledFor,
  onScheduledFor,
  scheduleValid,
  preview,
  activeRecentDays,
  onlyNonResponders,
  overBudget,
  overBudgetChoice,
  onOverBudgetChoice,
  todayCount,
  planAudience,
  projectedLots,
}: {
  audienceSize: number;
  sourceLabel: string;
  sourceValue: string;
  when: "now" | "schedule";
  onWhen: (v: "now" | "schedule") => void;
  scheduledFor: string;
  onScheduledFor: (v: string) => void;
  scheduleValid: boolean;
  preview: BlastPreviewState;
  activeRecentDays: number | null;
  onlyNonResponders: boolean;
  /** Audience overflows today's Daily Blast Budget — offer the plan choice. */
  overBudget: boolean;
  overBudgetChoice: "plan" | "today";
  onOverBudgetChoice: (v: "plan" | "today") => void;
  /** What a single-day blast would send today (= today's headroom). */
  todayCount: number;
  /** Full eligible audience the plan would drain over days. */
  planAudience: number;
  /** Projected lot count, when derivable from headroom; null otherwise. */
  projectedLots: number | null;
}) {
  const activeRefinements = [
    activeRecentDays != null ? `recebidos nos últimos ${activeRecentDays}d excluídos` : null,
    onlyNonResponders ? "só não respondentes" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      {/* Resumo do público — contagem refinada + breakdown completo */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Público final
          </span>
          <span className="text-[11px] text-muted-foreground">
            {sourceLabel} <span className="text-foreground">{sourceValue}</span>
          </span>
        </div>
        <BlastBreakdown
          candidates={audienceSize}
          preview={preview.data}
          isLoading={preview.isLoading}
          error={preview.error}
          recentDays={activeRecentDays}
          variant="inline"
        />
        {activeRefinements.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeRefinements.map((label) => (
              <span
                key={label}
                className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {overBudget ? (
        <OverBudgetChoice
          choice={overBudgetChoice}
          onChoice={onOverBudgetChoice}
          todayCount={todayCount}
          planAudience={planAudience}
          projectedLots={projectedLots}
        />
      ) : (
        <>
          {/* Quando */}
          <div className="space-y-2.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Quando disparar
            </Label>
            <div className="grid grid-cols-2 gap-2.5">
              {(["now", "schedule"] as const).map((opt) => {
                const selected = when === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onWhen(opt)}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                      selected ? "border-primary/60 bg-primary/[0.06]" : "border-border hover:border-border/80",
                    )}
                  >
                    <span className="text-sm font-medium">
                      {opt === "now" ? "Agora" : "Agendar"}
                    </span>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {opt === "now" ? "Dispara de supetão ao confirmar" : "Escolha data e hora"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {when === "schedule" && (
            <div className="space-y-1.5">
              <Label htmlFor="disparo-schedule" className="text-sm">
                Data e hora
              </Label>
              <Input
                id="disparo-schedule"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => onScheduledFor(e.target.value)}
              />
              {!scheduleValid && scheduledFor && (
                <p className="text-[11px] text-destructive">Escolha um horário no futuro.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Over-budget — escolha calma entre agendar lotes e disparar só hoje (#707)
 *
 * Read as a single explained decision, not two competing CTAs: one line states
 * why a plan exists ("seu público passa do teto de hoje"), then two stacked
 * option-rows — the plan recommended (gold ring + selo), the single-day option
 * honest about the drop. The footer CTA reflects whichever is selected.
 * ────────────────────────────────────────────────────────────────────────── */
function OverBudgetChoice({
  choice,
  onChoice,
  todayCount,
  planAudience,
  projectedLots,
}: {
  choice: "plan" | "today";
  onChoice: (v: "plan" | "today") => void;
  todayCount: number;
  planAudience: number;
  projectedLots: number | null;
}) {
  const fmt = (n: number) => n.toLocaleString("pt-BR");
  const dropped = Math.max(0, planAudience - todayCount);

  return (
    <div className="space-y-2.5">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Como enviar
      </Label>

      {/* Por que existe a escolha — uma linha, calma, sem alarme */}
      <p className="flex items-start gap-2 text-[12px] leading-snug text-muted-foreground">
        <Info className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
        <span>
          Seu público (<span className="tabular-nums text-foreground">{fmt(planAudience)}</span>) passa
          do teto de hoje (<span className="tabular-nums text-foreground">{fmt(todayCount)}</span>).
          Agende para enviar tudo ao longo dos dias.
        </span>
      </p>

      <div className="space-y-2.5" role="radiogroup" aria-label="Como enviar">
        {/* Recomendado — agendar lotes */}
        <OverBudgetOption
          selected={choice === "plan"}
          onSelect={() => onChoice("plan")}
          icon={CalendarClock}
          recommended
          title={projectedLots != null ? `Agendar ${projectedLots} lotes` : "Agendar lotes"}
          desc={
            <>
              <span className="tabular-nums text-foreground">{fmt(todayCount)}</span> hoje, o resto nos
              próximos dias — ninguém fica de fora.
            </>
          }
        />

        {/* Alternativa honesta — só hoje, o excedente cai */}
        <OverBudgetOption
          selected={choice === "today"}
          onSelect={() => onChoice("today")}
          icon={Zap}
          title={`Disparar só hoje (${fmt(todayCount)})`}
          desc={
            dropped > 0 ? (
              <>
                Envia até o teto de hoje;{" "}
                <span className="tabular-nums text-foreground">{fmt(dropped)}</span> ficam de fora.
              </>
            ) : (
              <>Envia o que cabe hoje.</>
            )
          }
        />
      </div>
    </div>
  );
}

/** One option-row in the over-budget choice — selectable, ring on select. */
function OverBudgetOption({
  selected,
  onSelect,
  icon: Icon,
  title,
  desc,
  recommended = false,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: typeof CalendarClock;
  title: string;
  desc: React.ReactNode;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "border-primary/60 bg-primary/[0.06]"
          : "border-border hover:border-border/80 hover:bg-muted/30",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          selected ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium leading-none">{title}</span>
          {recommended && (
            <span className="rounded-full border border-primary/30 bg-primary/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
              Recomendado
            </span>
          )}
        </div>
        <p className="text-[12px] leading-snug text-muted-foreground">{desc}</p>
      </div>
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {selected && <Check className="h-2.5 w-2.5" />}
      </span>
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Success — resultado do disparo
 * ────────────────────────────────────────────────────────────────────────── */
function SuccessPanel({ result, scheduled }: { result: QuickBlastResult; scheduled: boolean }) {
  const { noPhone, duplicates, overCap } = result.skipped;
  const skips = [
    { n: noPhone, label: "sem telefone" },
    { n: duplicates, label: "duplicados" },
    { n: overCap, label: "acima do teto" },
  ].filter((s) => s.n > 0);

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success"
      >
        <Check className="h-7 w-7" />
      </motion.div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">
        {scheduled ? "Disparo agendado" : "Disparo iniciado"}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">
          {result.count.toLocaleString("pt-BR")}
        </span>{" "}
        {result.count === 1 ? "lead entrará na fila" : "leads entrarão na fila"} de envio.
      </p>

      {skips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          {skips.map((s) => (
            <span
              key={s.label}
              className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              <span className="font-medium text-foreground tabular-nums">{s.n}</span> {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Plan success — plano de lotes criado, lote 1 disparado hoje (#707)
 *
 * Mirrors SuccessPanel's success-state styling (success ring + Check + editorial
 * headline), then surfaces the per-day breakdown as a receipt — "hoje X · amanhã
 * Y · dia 3 Z …" — so the operator sees exactly how the audience drains.
 * ────────────────────────────────────────────────────────────────────────── */
function lotDayLabel(lot: BlastPlanLotBreakdown): string {
  if (lot.lotIndex === 1) return "hoje";
  if (lot.lotIndex === 2) return "amanhã";
  // Past lot 2: a plain "dia N" reads cleaner than a date the operator must parse.
  return `dia ${lot.lotIndex}`;
}

function PlanSuccessPanel({ result }: { result: CreateBlastPlanResult }) {
  const fmt = (n: number) => n.toLocaleString("pt-BR");

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success"
      >
        <Check className="h-7 w-7" />
      </motion.div>

      <h3 className="mt-4 text-lg font-semibold tracking-tight">Plano criado</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{fmt(result.lots_total)}</span>{" "}
        {result.lots_total === 1 ? "lote" : "lotes"} ·{" "}
        <span className="font-medium text-foreground tabular-nums">{fmt(result.total_recipients)}</span>{" "}
        {result.total_recipients === 1 ? "lead no total" : "leads no total"}. Lote 1 disparado hoje.
      </p>

      {/* Breakdown por dia — recibo tabular (hoje X · amanhã Y · dia 3 Z …) */}
      {result.breakdown.length > 0 && (
        <div className="mt-4 w-full max-w-sm rounded-lg border border-border/70 bg-muted/30 px-4 py-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Cronograma
          </p>
          <dl className="space-y-1">
            {result.breakdown.map((lot) => (
              <div key={lot.lotIndex} className="flex items-center justify-between text-xs">
                <dt className="text-muted-foreground">{lotDayLabel(lot)}</dt>
                <dd className="font-medium tabular-nums text-foreground">{fmt(lot.count)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Acompanhe e pause o plano a qualquer momento na aba Disparos.
      </p>
    </div>
  );
}
