import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check, ChevronLeft, ChevronRight, ImagePlus, Layers, Loader2,
  ListFilter, MousePointerClick, Send, Sparkles, Users, X,
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
import {
  TEMPLATE_VARIABLES,
  replaceVariablesWithExamples,
  useCampaignTemplates,
} from "@/modules/campaigns";
import { useQuickBlast, type QuickBlastResult } from "@/modules/leads";

import { usePipelineStages } from "../../hooks/model/usePipelineStages";
import { useStageLeadIds } from "../../hooks/model/useStageLeadIds";

interface DisparoWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function DisparoWizard({ open, onOpenChange }: DisparoWizardProps) {
  const reduceMotion = useReducedMotion();

  const [step, setStep] = useState<StepId>("publico");
  const [direction, setDirection] = useState<1 | -1>(1);

  // Step 1 — Público (somente fonte "Estágio" nesta fatia)
  const [stageKey, setStageKey] = useState<string>("");

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
  const [result, setResult] = useState<QuickBlastResult | null>(null);

  const { data: stages = [], isLoading: stagesLoading } = usePipelineStages("whatsapp");
  const { data: stageLeadIds, isLoading: audienceLoading } = useStageLeadIds("whatsapp", stageKey);
  const { data: templates = [] } = useCampaignTemplates();
  const { data: instances = [] } = useWhatsAppInstances();
  const blast = useQuickBlast();

  const audienceSize = stageLeadIds?.length ?? 0;
  const selectedStage = stages.find((s) => s.stage_key === stageKey);

  const connectedInstances = useMemo(
    () => instances.filter((i: any) => CONNECTED.has(i.status)),
    [instances],
  );
  const selectableInstances = connectedInstances.length > 0 ? connectedInstances : instances;

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const preview = previewMessage(message);

  const canAdvancePublico = !!stageKey && !audienceLoading && audienceSize > 0;
  const canAdvanceMensagem =
    message.trim().length > 0 && !!instanceId && delayMin >= 0 && delayMax >= delayMin && !uploading;
  const scheduleValid = when === "now" || (!!scheduledFor && new Date(scheduledFor).getTime() > Date.now());
  const canFire = canAdvancePublico && canAdvanceMensagem && scheduleValid && !blast.isPending && !result;

  function resetAll() {
    setStep("publico");
    setDirection(1);
    setStageKey("");
    setTemplateId("");
    setMessage("");
    setInstanceId("");
    setDelayMin(5);
    setDelayMax(30);
    setImageUrl(null);
    setWhen("now");
    setScheduledFor("");
    setResult(null);
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
    if (!stageLeadIds || stageLeadIds.length === 0) {
      toast.error("Nenhum lead no estágio selecionado");
      return;
    }
    try {
      const res = await blast.mutateAsync({
        instance_id: instanceId,
        lead_ids: stageLeadIds,
        message: message.trim(),
        delay_min_ms: Math.round(delayMin * 1000),
        delay_max_ms: Math.round(delayMax * 1000),
        image_url: imageUrl ?? undefined,
        scheduled_for:
          when === "schedule" && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      });
      setResult(res);
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao iniciar disparo");
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
            Envio em massa para um estágio inteiro do funil. Leads sem telefone, duplicados e o teto
            da organização são tratados automaticamente.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <Stepper steps={STEPS} activeIndex={stepIndex} done={!!result} />

        {/* Corpo dos passos */}
        <div className="relative min-h-[336px] px-6 py-5">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={result ? "done" : step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: EASE }}
            >
              {result ? (
                <SuccessPanel result={result} scheduled={when === "schedule"} />
              ) : step === "publico" ? (
                <PublicoStep
                  stages={stages}
                  stagesLoading={stagesLoading}
                  stageKey={stageKey}
                  onStageKey={setStageKey}
                  audienceSize={audienceSize}
                  audienceLoading={audienceLoading && !!stageKey}
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
                  stageName={selectedStage?.name ?? "—"}
                  when={when}
                  onWhen={setWhen}
                  scheduledFor={scheduledFor}
                  onScheduledFor={setScheduledFor}
                  scheduleValid={scheduleValid}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Rodapé / navegação */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/20 px-6 py-4">
          {result ? (
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
                disabled={blast.isPending}
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
                <Button className="gradient-gold" onClick={handleFire} disabled={!canFire}>
                  {blast.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-4 w-4" />
                  )}
                  {when === "schedule" ? "Agendar disparo" : "Disparar agora"}
                </Button>
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
function PublicoStep({
  stages,
  stagesLoading,
  stageKey,
  onStageKey,
  audienceSize,
  audienceLoading,
}: {
  stages: { stage_key: string; name: string; color?: string | null }[];
  stagesLoading: boolean;
  stageKey: string;
  onStageKey: (v: string) => void;
  audienceSize: number;
  audienceLoading: boolean;
}) {
  const sources = [
    { id: "estagio", label: "Estágio", desc: "Todos os leads de uma etapa", icon: Layers, enabled: true },
    { id: "filtro", label: "Filtro", desc: "Por origem, tag, responsável", icon: ListFilter, enabled: false },
    { id: "manual", label: "Manual", desc: "Seleção individual de leads", icon: MousePointerClick, enabled: false },
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Origem do público
        </Label>
        <div className="grid grid-cols-3 gap-2.5">
          {sources.map((src) => {
            const selected = src.id === "estagio";
            return (
              <div
                key={src.id}
                aria-disabled={!src.enabled}
                className={cn(
                  "relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                  selected && "border-primary/60 bg-primary/[0.06]",
                  !src.enabled && "cursor-not-allowed opacity-55",
                )}
              >
                <src.icon
                  className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")}
                />
                <span className="text-sm font-medium leading-none">{src.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{src.desc}</span>
                {!src.enabled && (
                  <span className="absolute right-2 top-2 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    Em breve
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="disparo-stage" className="text-sm">
          Estágio do funil
        </Label>
        <Select value={stageKey} onValueChange={onStageKey} disabled={stagesLoading}>
          <SelectTrigger id="disparo-stage">
            <SelectValue placeholder={stagesLoading ? "Carregando etapas…" : "Selecione o estágio"} />
          </SelectTrigger>
          <SelectContent>
            {stages.map((s) => (
              <SelectItem key={s.stage_key} value={s.stage_key}>
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
      </div>

      {/* Contagem viva do público */}
      <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-3.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/12 text-primary">
          <Users className="h-4 w-4" />
        </span>
        <div className="flex flex-col">
          {!stageKey ? (
            <span className="text-sm text-muted-foreground">
              Escolha um estágio para ver o público
            </span>
          ) : audienceLoading ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando público…
            </span>
          ) : (
            <>
              <span className="text-2xl font-semibold leading-none tabular-nums tracking-tight">
                {audienceSize.toLocaleString("pt-BR")}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {audienceSize === 1 ? "lead" : "leads"}
                </span>
              </span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                {audienceSize === 0
                  ? "Nenhum lead neste estágio — escolha outro"
                  : "Filtros finais (sem telefone, duplicados, teto) aplicados no envio"}
              </span>
            </>
          )}
        </div>
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
            min={0}
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
            min={0}
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
  stageName,
  when,
  onWhen,
  scheduledFor,
  onScheduledFor,
  scheduleValid,
}: {
  audienceSize: number;
  stageName: string;
  when: "now" | "schedule";
  onWhen: (v: "now" | "schedule") => void;
  scheduledFor: string;
  onScheduledFor: (v: string) => void;
  scheduleValid: boolean;
}) {
  return (
    <div className="space-y-5">
      {/* Resumo do público */}
      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/12 text-primary">
            <Users className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-xl font-semibold leading-none tabular-nums">
              {audienceSize.toLocaleString("pt-BR")}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {audienceSize === 1 ? "lead" : "leads"}
              </span>
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              Estágio <span className="text-foreground">{stageName}</span>
            </span>
          </div>
        </div>
      </div>

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
    </div>
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
