/**
 * CopilotV2Wizard — Slice 8 authoring surface (Copilot v2). HYBRID IA: a linear
 * STEPPER for first-time creation (forces the required sections so the
 * activation-gate is satisfiable), TABS for editing. ONE transactional save in
 * both modes (no save-per-section → no orphan, kills v1 #35). The prompt is never
 * edited; the operator fills typed slots. Server is authoritative — the client
 * activation mirror only disables "Ativar"; linter/activation errors surface
 * inline from the structured save result.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { sectionsFor, type SectionDef } from "./wizardSections";
import { FieldRenderer } from "./fields";
import { setPath } from "./pathUtils";
import { RubricForm } from "./RubricForm";
import { SimulatorPanel } from "./SimulatorPanel";
import { useSaveCopilotV2Config } from "../../hooks/useCopilotV2Config";
import {
  missingHardForActivation,
  toSavePayload,
  type Archetype,
  type CopilotV2Config,
  type RubricRule,
} from "../../lib/copilot-v2-config";

export interface CopilotV2WizardProps {
  agentId: string;
  archetype: Archetype;
  mode?: "create" | "edit";
  initialConfig?: CopilotV2Config;
  initialRubric?: RubricRule[];
  onSaved?: (activated: boolean) => void;
}

export function CopilotV2Wizard({
  agentId,
  archetype,
  mode = "create",
  initialConfig,
  initialRubric,
  onSaved,
}: CopilotV2WizardProps) {
  const sections = useMemo(() => sectionsFor(archetype), [archetype]);
  const [config, setConfig] = useState<CopilotV2Config>(initialConfig ?? { capabilities: {} });
  const [rubricRules, setRubricRules] = useState<RubricRule[]>(initialRubric ?? []);
  const [step, setStep] = useState(0);
  const [linterError, setLinterError] = useState<string | null>(null);
  const save = useSaveCopilotV2Config();

  const missing = missingHardForActivation(archetype, config, rubricRules.length);
  const canActivate = missing.length === 0;

  const onChange = (path: string, value: unknown) => {
    setLinterError(null);
    setConfig((c) => setPath(c, path, value));
  };

  const submit = async (activate: boolean) => {
    setLinterError(null);
    const payload = toSavePayload(agentId, archetype, config, activate, rubricRules);
    const result = await save.mutateAsync(payload);
    switch (result.status) {
      case "ok":
        toast.success(activate ? "Agente ativado" : "Configuração salva");
        onSaved?.(activate);
        break;
      case "rejected":
        if (result.reason.startsWith("escape_hatch")) {
          setLinterError(linterMessage(result.reason));
          toast.error("Escape-hatch rejeitado pelo linter");
        } else {
          toast.error(`Rejeitado: ${result.reason}`);
        }
        break;
      case "invalid":
        toast.error(`Configuração inválida: ${result.errors.slice(0, 3).join("; ")}`);
        break;
      case "not_activatable":
        toast.error(`Faltam campos obrigatórios: ${result.missingHard.join(", ")}`);
        break;
    }
  };

  const renderSection = (s: SectionDef) => (
    <div className="space-y-4">
      {s.fields.map((field, i) =>
        field.kind === "rubric" ? (
          <RubricForm key={i} rules={rubricRules} onChange={setRubricRules} />
        ) : (
          <FieldRenderer
            key={i}
            field={field}
            archetype={archetype}
            config={config as Record<string, unknown>}
            onChange={onChange}
            linterError={field.kind === "escape-hatch" ? linterError : null}
          />
        ),
      )}
    </div>
  );

  const footer = (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" disabled={save.isPending} onClick={() => submit(false)}>
          Salvar rascunho
        </Button>
        <Button disabled={!canActivate || save.isPending} onClick={() => submit(true)}>
          Ativar agente
        </Button>
      </div>
      {!canActivate && (
        <p className="text-right text-xs text-muted-foreground">
          Faltam para ativar: <span className="text-amber-500">{missing.join(", ")}</span>
        </p>
      )}
    </div>
  );

  // ── EDIT mode: free-navigation tabs ──
  if (mode === "edit") {
    return (
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base capitalize">Configuração — {archetype}</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={sections[0].id}>
            <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-transparent">
              {sections.map((s) => (
                <TabsTrigger key={s.id} value={s.id} className="text-xs">
                  {s.title}
                  {s.required && <span className="ml-0.5 text-primary">*</span>}
                </TabsTrigger>
              ))}
              <TabsTrigger value="__teste" className="text-xs">Teste</TabsTrigger>
            </TabsList>
            {sections.map((s) => (
              <TabsContent key={s.id} value={s.id} className="pt-4">
                {renderSection(s)}
              </TabsContent>
            ))}
            <TabsContent value="__teste" className="pt-4">
              <SimulatorPanel archetype={archetype} mode="edit" agentId={agentId} />
            </TabsContent>
          </Tabs>
          {footer}
        </CardContent>
      </Card>
    );
  }

  // ── CREATE mode: linear stepper (+ a final synthetic "Testar" step) ──
  const SIM_STEP = sections.length;
  const total = sections.length + 1;
  const onSim = step === SIM_STEP;
  const current = sections[step];
  const pct = Math.round(((step + 1) / total) * 100);
  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {onSim ? "Testar agente" : current.title}
            {!onSim && current.required && <span className="ml-0.5 text-primary">*</span>}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {step + 1}/{total}
          </span>
        </div>
        <Progress value={pct} className="h-1" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="min-h-[180px]">
          {onSim ? (
            <SimulatorPanel archetype={archetype} mode="create" draftConfig={config} draftRubric={rubricRules} />
          ) : (
            renderSection(current)
          )}
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Voltar
          </Button>
          {step < SIM_STEP ? (
            <Button onClick={() => setStep((s) => Math.min(SIM_STEP, s + 1))}>Continuar</Button>
          ) : (
            <span className={cn("text-xs", canActivate ? "text-primary" : "text-muted-foreground")}>
              {canActivate ? "Pronto para ativar" : `Faltam: ${missing.join(", ")}`}
            </span>
          )}
        </div>
        {onSim && footer}
      </CardContent>
    </Card>
  );
}

function linterMessage(reason: string): string {
  const cat = reason.split(":")[1] ?? "";
  const map: Record<string, string> = {
    jailbreak: "Detectada tentativa de alterar o comportamento base do agente.",
    pii: "Detectado dado pessoal sensível (PII). Remova antes de salvar.",
    policy_conflict: "Conflito com a política comercial (ex.: autorizar desconto proibido).",
  };
  return map[cat] ?? "Conteúdo rejeitado pelo linter de segurança.";
}
