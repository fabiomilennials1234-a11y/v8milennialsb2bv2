import { useState, useMemo } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePipelineTemplates,
  useAutomationTemplates,
} from "@/modules/platform/hooks/useOnboardingTemplates";

interface QuizOption {
  key: string;
  label: string;
  values: { value: string; label: string }[];
}

const QUIZ_OPTIONS: QuizOption[] = [
  {
    key: "perfil.sells",
    label: "O que vende?",
    values: [
      { value: "produto", label: "Produto" },
      { value: "servico", label: "Serviço" },
      { value: "ambos", label: "Ambos" },
    ],
  },
  {
    key: "perfil.segment",
    label: "Segmento",
    values: [
      { value: "industria", label: "Indústria" },
      { value: "distribuidora", label: "Distribuição" },
      { value: "saas", label: "SaaS" },
      { value: "consultoria", label: "Consultoria" },
      { value: "agencia", label: "Agência" },
      { value: "outro", label: "Outro" },
    ],
  },
  {
    key: "estrutura",
    label: "Estrutura",
    values: [
      { value: "solo", label: "Solo" },
      { value: "team_no_sdr", label: "Time sem SDR" },
      { value: "team_sdr_closer", label: "Time SDR+Closer" },
    ],
  },
  {
    key: "processo",
    label: "Processo",
    values: [
      { value: "meetings_proposals", label: "Reuniões + Propostas" },
      { value: "meetings_only", label: "Só reuniões" },
      { value: "direct", label: "Direto WhatsApp" },
    ],
  },
];

function expandAnswers(selections: Record<string, string>): Record<string, Record<string, string>> {
  const answers: Record<string, Record<string, string>> = { perfil: {}, estrutura: {}, processo: {} };

  if (selections["perfil.sells"]) answers.perfil.sells = selections["perfil.sells"];
  if (selections["perfil.segment"]) answers.perfil.segment = selections["perfil.segment"];

  const est = selections["estrutura"];
  if (est === "solo") Object.assign(answers.estrutura, { has_sdr: "false", has_closer: "false", team_size: "1" });
  else if (est === "team_no_sdr") Object.assign(answers.estrutura, { has_sdr: "false", has_closer: "false", team_size: "2+" });
  else if (est === "team_sdr_closer") Object.assign(answers.estrutura, { has_sdr: "true", has_closer: "true", team_size: "2+" });

  const proc = selections["processo"];
  if (proc === "meetings_proposals") Object.assign(answers.processo, { schedules_meeting: "true", uses_proposal: "true" });
  else if (proc === "meetings_only") Object.assign(answers.processo, { schedules_meeting: "true", uses_proposal: "false" });
  else if (proc === "direct") Object.assign(answers.processo, { schedules_meeting: "false", uses_proposal: "false" });

  return answers;
}

function resolveFieldPath(answers: Record<string, Record<string, string>>, path: string): string | undefined {
  const parts = path.split(".");
  let current: any = answers;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

function matchesCriteria(
  criteria: Record<string, string[]> | null,
  answers: Record<string, Record<string, string>>,
): boolean {
  if (!criteria || Object.keys(criteria).length === 0) return true;
  return Object.entries(criteria).every(([path, allowed]) => {
    const val = resolveFieldPath(answers, path);
    return val != null && allowed.includes(val);
  });
}

export function OnboardingPreviewTab() {
  const { data: pipeTemplates } = usePipelineTemplates();
  const { data: autoTemplates } = useAutomationTemplates();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [ran, setRan] = useState(false);

  const answers = useMemo(() => expandAnswers(selections), [selections]);

  const matchedPipelines = useMemo(() => {
    if (!ran || !pipeTemplates) return [];
    return (pipeTemplates as any[])
      .filter((t) => t.is_active && matchesCriteria(t.match_criteria, answers))
      .sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0));
  }, [ran, pipeTemplates, answers]);

  const matchedAutomations = useMemo(() => {
    if (!ran || !autoTemplates) return [];
    return (autoTemplates as any[]).filter(
      (t) => t.is_active && matchesCriteria(t.match_criteria, answers),
    );
  }, [ran, autoTemplates, answers]);

  const allSelected = QUIZ_OPTIONS.every((q) => selections[q.key]);

  return (
    <div className="space-y-6 mt-4">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Simulador de Quiz
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Simule respostas do quiz e veja quais templates seriam matched.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {QUIZ_OPTIONS.map((q) => (
          <div key={q.key}>
            <Label className="text-xs">{q.label}</Label>
            <Select
              value={selections[q.key] ?? ""}
              onValueChange={(v) => setSelections((prev) => ({ ...prev, [q.key]: v }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {q.values.map((v) => (
                  <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={() => setRan(true)}
          disabled={!allSelected}
        >
          <Play className="w-4 h-4 mr-1" /> Simular Match
        </Button>
        <Button
          variant="outline"
          onClick={() => { setSelections({}); setRan(false); }}
        >
          <RotateCcw className="w-4 h-4 mr-1" /> Resetar
        </Button>
      </div>

      {ran && (
        <div className="space-y-4 pt-4 border-t border-border/40">
          <div className="p-3 rounded-lg bg-muted/30">
            <Label className="text-xs text-muted-foreground block mb-1">Answers expandidas (debug)</Label>
            <pre className="text-[10px] font-mono text-muted-foreground overflow-x-auto">
              {JSON.stringify(answers, null, 2)}
            </pre>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">
              Pipeline Templates Matched ({matchedPipelines.length})
            </h4>
            {matchedPipelines.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum match. O template Padrão (P0) sem criteria deveria sempre casar.</p>
            )}
            {matchedPipelines.map((t: any) => (
              <div key={t.id} className="p-3 rounded-lg border border-border/40 mb-2 flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: t.color ?? "#888" }}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    <Badge variant="outline" className="text-[10px]">P{t.priority}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </div>
              </div>
            ))}
            {matchedPipelines.length > 1 && (
              <p className="text-[10px] text-amber-500">
                Maior prioridade vence: {matchedPipelines[0]?.name}
              </p>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">
              Automação Templates Matched ({matchedAutomations.length})
            </h4>
            {matchedAutomations.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum match.</p>
            )}
            {matchedAutomations.map((t: any) => (
              <div key={t.id} className="p-3 rounded-lg border border-border/40 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  <Badge variant="outline" className="text-[10px]">{t.type}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{t.trigger_type}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
