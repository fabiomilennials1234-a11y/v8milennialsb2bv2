/**
 * Painel de diagnóstico do Chamado — etapa 4 do processo de fix
 * (docs/operations/chamado-fix.md).
 *
 * Quem abre o Chamado depois do diagnóstico tem duas tarefas: responder o
 * cliente e executar o prompt. O painel serve exatamente essas duas — a
 * resposta sugerida entra no campo de resposta com um clique, e o setup de
 * modelo/effort e o prompt saem copiados, prontos para o Claude Code.
 *
 * Só master vê: a RLS de `support_ticket_diagnoses` não abre nada ao cliente.
 */

import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Check,
  ClipboardCopy,
  CornerDownLeft,
  Loader2,
  Pencil,
  Plus,
  Stethoscope,
  Terminal,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notifyError } from "@/shared/errors";
import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  COMPLEXITY_LABELS,
  DIAGNOSIS_COMPLEXITIES,
  DIAGNOSIS_KINDS,
  EXECUTION_OUTCOMES,
  KIND_LABELS,
  MODEL_LABELS,
  OUTCOME_LABELS,
  diagnoseCommand,
  formatUsd,
  isOneOf,
  parseKeystones,
  parseUsd,
  routeDeviation,
  routeFor,
  sessionSetup,
  validateDraft,
  type DiagnosisDraft,
  type ExecutionOutcome,
  type Keystone,
} from "../../lib/ticket-diagnosis";
import {
  useRecordDiagnosisExecution,
  useSaveTicketDiagnosis,
  useTicketDiagnosis,
  type TicketDiagnosis,
} from "../../hooks/useTicketDiagnosis";

const OUTCOME_TONE: Record<ExecutionOutcome, string> = {
  resolvido: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  parcial: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  falhou: "border-red-500/30 bg-red-500/10 text-red-400",
};

const SECTION_LABEL = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copiado.`);
  } catch {
    toast.error("Não deu para copiar — selecione e copie à mão.");
  }
}

export function TicketDiagnosisPanel({
  ticketId,
  onUseReply,
}: {
  ticketId: string;
  /** Leva a resposta sugerida para o campo de resposta ao cliente. */
  onUseReply: (text: string) => void;
}) {
  const { data: diagnosis, isLoading } = useTicketDiagnosis(ticketId);
  const [editing, setEditing] = useState(false);

  return (
    <section
      aria-labelledby={`diag-${ticketId}`}
      className="rounded-lg border border-primary/25 bg-primary/[0.03]"
    >
      <header className="flex items-center gap-2 border-b border-primary/15 px-3 py-2">
        <Stethoscope className="h-4 w-4 text-primary" aria-hidden />
        <h3 id={`diag-${ticketId}`} className="text-sm font-medium">
          Diagnóstico
        </h3>
        {diagnosis && !editing && (
          <DiagnosisMeta diagnosis={diagnosis} />
        )}
        {diagnosis && !editing && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1.5 text-xs"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Editar
          </Button>
        )}
      </header>

      <div className="p-3">
        {isLoading ? (
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : editing ? (
          <DiagnosisForm
            ticketId={ticketId}
            initial={diagnosis ?? null}
            onDone={() => setEditing(false)}
          />
        ) : diagnosis ? (
          <DiagnosisView diagnosis={diagnosis} onUseReply={onUseReply} />
        ) : (
          <EmptyDiagnosis ticketId={ticketId} onManual={() => setEditing(true)} />
        )}
      </div>
    </section>
  );
}

function DiagnosisMeta({ diagnosis }: { diagnosis: TicketDiagnosis }) {
  const kind = isOneOf(DIAGNOSIS_KINDS, diagnosis.kind) ? diagnosis.kind : "fix";
  const complexity = isOneOf(DIAGNOSIS_COMPLEXITIES, diagnosis.complexity)
    ? diagnosis.complexity
    : "media";
  return (
    <span className="truncate text-xs text-muted-foreground">
      {KIND_LABELS[kind]} · complexidade {COMPLEXITY_LABELS[complexity].toLowerCase()}
      <span aria-hidden> · </span>
      {diagnosis.source === "claude_code" ? "Claude Code" : "manual"},{" "}
      {formatDistanceToNow(new Date(diagnosis.updated_at), { addSuffix: true, locale: ptBR })}
    </span>
  );
}

function EmptyDiagnosis({ ticketId, onManual }: { ticketId: string; onManual: () => void }) {
  const command = diagnoseCommand(ticketId);
  return (
    <div className="space-y-2.5">
      <p className="text-sm text-muted-foreground">
        Ainda sem diagnóstico. Rode no Claude Code, na raiz do repositório:
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border/60 bg-background/70 px-2.5 py-1.5 font-mono text-xs">
          {command}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs"
          onClick={() => copy(command, "Comando")}
        >
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          Copiar
        </Button>
      </div>
      <Button variant="ghost" size="sm" className="h-7 px-0 text-xs text-muted-foreground" onClick={onManual}>
        Ou registre o diagnóstico à mão
      </Button>
    </div>
  );
}

function DiagnosisView({
  diagnosis,
  onUseReply,
}: {
  diagnosis: TicketDiagnosis;
  onUseReply: (text: string) => void;
}) {
  const keystones = parseKeystones(diagnosis.keystones);
  const route = {
    model: isOneOf(CLAUDE_MODELS, diagnosis.recommended_model) ? diagnosis.recommended_model : "opus",
    effort: isOneOf(CLAUDE_EFFORTS, diagnosis.recommended_effort)
      ? diagnosis.recommended_effort
      : "high",
  } as const;
  const deviation =
    isOneOf(DIAGNOSIS_KINDS, diagnosis.kind) && isOneOf(DIAGNOSIS_COMPLEXITIES, diagnosis.complexity)
      ? routeDeviation(diagnosis.kind, diagnosis.complexity, route)
      : "na-matriz";

  return (
    <div className="space-y-4">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{diagnosis.summary}</p>

      {diagnosis.root_cause && (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            Causa raiz
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-primary/30 pl-3 text-sm leading-relaxed text-muted-foreground">
            {diagnosis.root_cause}
          </p>
        </details>
      )}

      {/* Execução: rota da sessão + prompt. É o que o dev operacional leva ao Claude Code. */}
      <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={SECTION_LABEL}>Executar no Claude Code</span>
          <span className="text-xs">
            <span className="font-medium">{MODEL_LABELS[route.model]}</span>
            <span className="text-muted-foreground"> · effort </span>
            <span className="font-medium">{route.effort}</span>
          </span>
          {deviation !== "na-matriz" && (
            <span
              className="text-[11px] text-amber-400"
              title="A rota gravada difere da matriz complexidade → modelo/effort. Confira o porquê no prompt."
            >
              {deviation === "acima" ? "acima da matriz" : "abaixo da matriz"}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            estimado {formatUsd(diagnosis.estimated_cost_usd)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => copy(sessionSetup(route), "Setup de modelo e effort")}
            title={sessionSetup(route)}
          >
            <Terminal className="h-3.5 w-3.5" aria-hidden />
            1. Copiar setup
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => copy(diagnosis.resolution_prompt, "Prompt")}
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
            2. Copiar prompt
          </Button>
          {diagnosis.customer_reply && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => onUseReply(diagnosis.customer_reply ?? "")}
            >
              <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
              Usar resposta sugerida
            </Button>
          )}
        </div>
        <details>
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            Ver prompt ({diagnosis.resolution_prompt.length.toLocaleString("pt-BR")} caracteres)
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border/50 bg-background/80 p-3 font-mono text-[11px] leading-relaxed">
            {diagnosis.resolution_prompt}
          </pre>
        </details>
      </div>

      {keystones.length > 0 && (
        <div className="space-y-1.5">
          <h4 className={SECTION_LABEL}>Pronto quando</h4>
          <ul className="space-y-1.5">
            {keystones.map((k, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
                <div className="min-w-0">
                  <p className="leading-snug">{k.label}</p>
                  {k.verify && (
                    <code className="mt-0.5 block break-words font-mono text-[11px] text-muted-foreground">
                      {k.verify}
                    </code>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ExecutionFooter diagnosis={diagnosis} />
    </div>
  );
}

/** Fecho do ciclo: o desfecho e o custo real calibram a matriz e a estimativa. */
function ExecutionFooter({ diagnosis }: { diagnosis: TicketDiagnosis }) {
  const record = useRecordDiagnosisExecution();
  const [outcome, setOutcome] = useState<ExecutionOutcome | "">("");
  const [cost, setCost] = useState("");

  const executed =
    diagnosis.execution_outcome && isOneOf(EXECUTION_OUTCOMES, diagnosis.execution_outcome)
      ? diagnosis.execution_outcome
      : null;

  function submit(next: ExecutionOutcome | null) {
    record.mutate(
      { ticketId: diagnosis.ticket_id, outcome: next, actualCostUsd: next ? parseUsd(cost) : null },
      {
        onSuccess: () => {
          setOutcome("");
          setCost("");
        },
        onError: (e: unknown) => notifyError(e, { fallback: "Não deu para registrar a execução." }),
      },
    );
  }

  if (executed) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3 text-xs">
        <Badge variant="outline" className={cn("text-[11px]", OUTCOME_TONE[executed])}>
          {OUTCOME_LABELS[executed]}
        </Badge>
        <span className="text-muted-foreground">
          custo real {formatUsd(diagnosis.actual_cost_usd)} · estimado{" "}
          {formatUsd(diagnosis.estimated_cost_usd)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1.5 text-xs"
          disabled={record.isPending}
          onClick={() => submit(null)}
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          Desfazer
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
      <span className={cn(SECTION_LABEL, "mr-1")}>Execução</span>
      <Select value={outcome} onValueChange={(v) => setOutcome(v as ExecutionOutcome)}>
        <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Desfecho da execução">
          <SelectValue placeholder="Desfecho" />
        </SelectTrigger>
        <SelectContent>
          {EXECUTION_OUTCOMES.map((o) => (
            <SelectItem key={o} value={o}>
              {OUTCOME_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        inputMode="decimal"
        placeholder="Custo real (US$)"
        aria-label="Custo real em dólares, do /cost do Claude Code"
        className="h-8 w-[140px] text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        disabled={!outcome || record.isPending}
        onClick={() => outcome && submit(outcome)}
      >
        {record.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Registrar"}
      </Button>
    </div>
  );
}

function toDraft(d: TicketDiagnosis | null): DiagnosisDraft {
  const kind = d && isOneOf(DIAGNOSIS_KINDS, d.kind) ? d.kind : "fix";
  const complexity = d && isOneOf(DIAGNOSIS_COMPLEXITIES, d.complexity) ? d.complexity : "baixa";
  const route = routeFor(kind, complexity);
  return {
    kind,
    complexity,
    summary: d?.summary ?? "",
    root_cause: d?.root_cause ?? "",
    customer_reply: d?.customer_reply ?? "",
    recommended_model:
      d && isOneOf(CLAUDE_MODELS, d.recommended_model) ? d.recommended_model : route.model,
    recommended_effort:
      d && isOneOf(CLAUDE_EFFORTS, d.recommended_effort) ? d.recommended_effort : route.effort,
    resolution_prompt: d?.resolution_prompt ?? "",
    keystones: d ? parseKeystones(d.keystones) : [{ label: "", verify: "" }],
    estimated_cost_usd: d?.estimated_cost_usd != null ? String(d.estimated_cost_usd) : "",
  };
}

function DiagnosisForm({
  ticketId,
  initial,
  onDone,
}: {
  ticketId: string;
  initial: TicketDiagnosis | null;
  onDone: () => void;
}) {
  const save = useSaveTicketDiagnosis();
  const [draft, setDraft] = useState<DiagnosisDraft>(() => toDraft(initial));
  // Enquanto ninguém mexe no modelo/effort, eles seguem a matriz.
  const [routeTouched, setRouteTouched] = useState(initial !== null);
  const [errors, setErrors] = useState<string[]>([]);

  const set = <K extends keyof DiagnosisDraft>(key: K, value: DiagnosisDraft[K]) =>
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (!routeTouched && (key === "kind" || key === "complexity")) {
        const r = routeFor(next.kind, next.complexity);
        next.recommended_model = r.model;
        next.recommended_effort = r.effort;
      }
      return next;
    });

  const setKeystone = (i: number, patch: Partial<Keystone>) =>
    set(
      "keystones",
      draft.keystones.map((k, j) => (j === i ? { ...k, ...patch } : k)),
    );

  function submit() {
    const found = validateDraft(draft);
    setErrors(found);
    if (found.length) return;
    save.mutate(
      { ticketId, draft },
      {
        onSuccess: () => {
          toast.success(initial ? "Diagnóstico atualizado." : "Diagnóstico registrado.");
          onDone();
        },
        onError: (e: unknown) => notifyError(e, { fallback: "Não deu para salvar o diagnóstico." }),
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <LabeledSelect
          label="Tipo"
          value={draft.kind}
          options={DIAGNOSIS_KINDS.map((k) => [k, KIND_LABELS[k]])}
          onChange={(v) => set("kind", v as DiagnosisDraft["kind"])}
        />
        <LabeledSelect
          label="Complexidade"
          value={draft.complexity}
          options={DIAGNOSIS_COMPLEXITIES.map((c) => [c, COMPLEXITY_LABELS[c]])}
          onChange={(v) => set("complexity", v as DiagnosisDraft["complexity"])}
        />
        <LabeledSelect
          label="Modelo"
          value={draft.recommended_model}
          options={CLAUDE_MODELS.map((m) => [m, MODEL_LABELS[m]])}
          onChange={(v) => {
            setRouteTouched(true);
            set("recommended_model", v as DiagnosisDraft["recommended_model"]);
          }}
        />
        <LabeledSelect
          label="Effort"
          value={draft.recommended_effort}
          options={CLAUDE_EFFORTS.map((e) => [e, e])}
          onChange={(v) => {
            setRouteTouched(true);
            set("recommended_effort", v as DiagnosisDraft["recommended_effort"]);
          }}
        />
      </div>

      <Field label="Diagnóstico simplificado">
        <Textarea
          value={draft.summary}
          onChange={(e) => set("summary", e.target.value)}
          rows={3}
          placeholder="O que está errado, em duas ou três frases, para quem vai executar."
        />
      </Field>
      <Field label={draft.kind === "fix" ? "Causa raiz" : "Causa raiz (opcional)"}>
        <Textarea
          value={draft.root_cause}
          onChange={(e) => set("root_cause", e.target.value)}
          rows={3}
          placeholder="Onde e por quê — arquivo:linha, query, evidência."
        />
      </Field>
      <Field label="Resposta sugerida ao cliente">
        <Textarea
          value={draft.customer_reply}
          onChange={(e) => set("customer_reply", e.target.value)}
          rows={2}
          placeholder="Sem detalhe interno — o cliente lê isto."
        />
      </Field>
      <Field label="Prompt de resolução">
        <Textarea
          value={draft.resolution_prompt}
          onChange={(e) => set("resolution_prompt", e.target.value)}
          rows={8}
          className="font-mono text-xs"
          placeholder="Cole o prompt gerado pelo /chamado-diagnosticar."
        />
      </Field>

      <fieldset className="space-y-1">
        <legend className={SECTION_LABEL}>Pronto quando (keystones)</legend>
        <div className="space-y-1.5">
          {draft.keystones.map((k, i) => (
            <div key={i} className="flex gap-1.5">
              <Input
                value={k.label}
                onChange={(e) => setKeystone(i, { label: e.target.value })}
                placeholder="O que prova que acabou"
                aria-label={`Keystone ${i + 1}`}
                className="h-8 flex-1 text-xs"
              />
              <Input
                value={k.verify}
                onChange={(e) => setKeystone(i, { verify: e.target.value })}
                placeholder="Comando ou query que verifica"
                aria-label={`Verificação do keystone ${i + 1}`}
                className="h-8 flex-1 font-mono text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={`Remover keystone ${i + 1}`}
                onClick={() =>
                  set(
                    "keystones",
                    draft.keystones.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          ))}
          {draft.keystones.length < 15 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-1 text-xs text-muted-foreground"
              onClick={() => set("keystones", [...draft.keystones, { label: "", verify: "" }])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Keystone
            </Button>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Custo estimado (US$)">
          <Input
            value={draft.estimated_cost_usd}
            onChange={(e) => set("estimated_cost_usd", e.target.value)}
            inputMode="decimal"
            className="h-8 w-[140px] text-xs"
          />
        </Field>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            Salvar diagnóstico
          </Button>
        </div>
      </div>

      {initial?.execution_outcome && (
        <p className="text-[11px] text-muted-foreground">
          Salvar limpa o desfecho da execução registrada — o prompt novo ainda não rodou.
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-[11px] text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={SECTION_LABEL}>{label}</span>
      {children}
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span className={SECTION_LABEL}>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([k, l]) => (
            <SelectItem key={k} value={k}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
