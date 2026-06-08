/**
 * CopilotV2Wizard — Copilot v2 authoring surface (redesign 2026-06-08).
 *
 * ONE 2-tab layout for BOTH create and edit (the stepper is dead): BASE (factory
 * core, read-only except tone) · ESPECIFICIDADES (the company's slots) · TESTAR
 * (the dry-run simulator, available in both modes). A single sticky action bar
 * carries the activation checklist + Salvar/Ativar. ONE transactional save covers
 * both editable tabs. Capabilities are LOCKED per-archetype (ADR): the wizard
 * sends the full whitelist as ON and the server re-derives them anyway. The prompt
 * is never edited — the operator only fills typed slots. Server is authoritative;
 * a not_activatable result jumps to the tab owning the first missing field.
 */

import { useMemo, useState } from "react";
import { ShieldCheck, Sparkles, Wand2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { groupsFor, type GroupDef, type FieldDef } from "./wizardSections";
import { FieldRenderer } from "./fields";
import { BaseTab } from "./BaseTab";
import { setPath } from "./pathUtils";
import { RubricForm } from "./RubricForm";
import { SimulatorPanel } from "./SimulatorPanel";
import { useSaveCopilotV2Config } from "../../hooks/useCopilotV2Config";
import {
  missingHardForActivation,
  toSavePayload,
  defaultCapabilitiesFor,
  type Archetype,
  type CopilotV2Config,
  type RubricRule,
} from "../../lib/copilot-v2-config";

type WizardTab = "base" | "specs" | "test";

export interface CopilotV2WizardProps {
  agentId: string;
  archetype: Archetype;
  mode?: "create" | "edit";
  initialConfig?: CopilotV2Config;
  initialRubric?: RubricRule[];
  /** Create-only: opens the v1 prefill picker (the page owns the dialog). */
  onPrefill?: () => void;
  onSaved?: (activated: boolean) => void;
  /** Bubbles the unsaved-changes flag up so the page can guard the route toggle. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Friendly label + owning tab for each hard-required field (checklist + routing). */
const MISSING_META: Record<string, { label: string; tab: WizardTab }> = {
  "company.name": { label: "Nome da empresa", tab: "specs" },
  icp: { label: "Cliente ideal (ICP)", tab: "specs" },
  products: { label: "Produtos", tab: "specs" },
  tone: { label: "Tom de voz", tab: "base" },
  businessHours: { label: "Horário de atendimento", tab: "specs" },
  capabilities: { label: "Capacidades", tab: "base" },
  rubric: { label: "Rúbrica de qualificação", tab: "specs" },
  objective: { label: "Objetivo do agente", tab: "specs" },
  commercialPolicy: { label: "Política comercial", tab: "specs" },
  handoffTarget: { label: "Destino do handoff", tab: "specs" },
};

export function CopilotV2Wizard({
  agentId,
  archetype,
  mode = "create",
  initialConfig,
  initialRubric,
  onPrefill,
  onSaved,
  onDirtyChange,
}: CopilotV2WizardProps) {
  const groups = useMemo(() => groupsFor(archetype), [archetype]);
  // Capabilities are locked per-archetype → seed the full whitelist (server re-derives).
  const seededInitial = useMemo<CopilotV2Config>(
    () => ({ ...(initialConfig ?? {}), capabilities: defaultCapabilitiesFor(archetype) }),
    [initialConfig, archetype],
  );
  const [config, setConfig] = useState<CopilotV2Config>(seededInitial);
  const [rubricRules, setRubricRules] = useState<RubricRule[]>(initialRubric ?? []);
  const [tab, setTab] = useState<WizardTab>(mode === "create" ? "specs" : "specs");
  const [dirty, setDirty] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(mode === "create");
  const [checklistOpen, setChecklistOpen] = useState(mode === "create");
  const [linterError, setLinterError] = useState<string | null>(null);
  const save = useSaveCopilotV2Config();

  const missing = missingHardForActivation(archetype, config, rubricRules.length);
  const canActivate = missing.length === 0;
  const missingPaths = useMemo(() => new Set(missing), [missing]);

  const markDirty = () => {
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
  };

  const onChange = (path: string, value: unknown) => {
    setLinterError(null);
    markDirty();
    setConfig((c) => setPath(c, path, value));
  };

  const onToneChange = (tone: string) => {
    markDirty();
    setConfig((c) => ({ ...c, tone }));
  };

  const onRubricChange = (r: RubricRule[]) => {
    markDirty();
    setRubricRules(r);
  };

  const submit = async (activate: boolean) => {
    setLinterError(null);
    // Always send the locked capability set; the server re-derives it regardless.
    const payload = toSavePayload(
      agentId,
      archetype,
      { ...config, capabilities: defaultCapabilitiesFor(archetype) },
      activate,
      rubricRules,
    );
    const result = await save.mutateAsync(payload);
    switch (result.status) {
      case "ok":
        toast.success(activate ? "Agente ativado" : "Configuração salva");
        setDirty(false);
        onDirtyChange?.(false);
        onSaved?.(activate);
        break;
      case "rejected":
        if (result.reason.startsWith("escape_hatch")) {
          setLinterError(linterMessage(result.reason));
          setTab("specs");
          toast.error("Escape-hatch rejeitado pelo linter");
        } else {
          toast.error(`Rejeitado: ${result.reason}`);
        }
        break;
      case "invalid":
        toast.error(`Configuração inválida: ${result.errors.slice(0, 3).join("; ")}`);
        break;
      case "not_activatable": {
        // Jump to the tab owning the first missing field + open the checklist.
        const first = result.missingHard[0];
        const meta = first ? MISSING_META[first] : undefined;
        if (meta) setTab(meta.tab);
        setChecklistOpen(true);
        toast.error(`Faltam campos obrigatórios: ${result.missingHard.map((m) => MISSING_META[m]?.label ?? m).join(", ")}`);
        break;
      }
    }
  };

  const renderField = (field: FieldDef, key: number) =>
    field.kind === "rubric" ? (
      <div key={key} className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {field.label}
            {field.required && <span className="ml-0.5 text-primary">*</span>}
          </span>
          {field.archetypeChip && (
            <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {field.archetypeChip}
            </span>
          )}
        </div>
        {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
        <RubricForm rules={rubricRules} onChange={onRubricChange} />
      </div>
    ) : (
      <FieldRenderer
        key={key}
        field={field}
        archetype={archetype}
        config={config as Record<string, unknown>}
        onChange={onChange}
        missingPaths={missingPaths}
        linterError={field.kind === "escape-hatch" ? linterError : null}
      />
    );

  const renderGroup = (g: GroupDef) => (
    <section
      key={g.id}
      className={cn(
        "space-y-4 rounded-lg border border-border/60 p-4",
        g.featured && "relative overflow-hidden pl-5",
      )}
    >
      {g.featured && <span className="absolute left-0 top-0 h-full w-[3px] bg-primary/60" />}
      <div className="space-y-0.5">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          {g.featured && <Package className="h-4 w-4 text-primary" />}
          {g.title}
          {g.required && <span className="text-primary">*</span>}
        </h4>
        {g.subtitle && <p className="text-xs text-muted-foreground">{g.subtitle}</p>}
      </div>
      <div className="space-y-4">{g.fields.map((field, i) => renderField(field, i))}</div>
    </section>
  );

  return (
    <div className="space-y-4">
      {mode === "create" && bannerOpen && (
        <Card className="border-primary/30 bg-primary/[0.04]">
          <CardContent className="flex items-start gap-3 py-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1 text-sm">
              <p className="font-medium">Configure as especificidades.</p>
              <p className="text-muted-foreground">A base já está pronta de fábrica — você só preenche o que é da sua empresa.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setBannerOpen(false)}>
              Entendi
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as WizardTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="base">Base (de fábrica)</TabsTrigger>
          <TabsTrigger value="specs">Especificidades</TabsTrigger>
          <TabsTrigger value="test">Testar</TabsTrigger>
        </TabsList>

        <TabsContent value="base" className="pt-4">
          <BaseTab archetype={archetype} tone={config.tone} onToneChange={onToneChange} />
        </TabsContent>

        <TabsContent value="specs" className="space-y-4 pt-4">
          {mode === "create" && onPrefill && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onPrefill}
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                <Wand2 className="mr-2 h-4 w-4" />
                Pré-preencher do v1
              </Button>
            </div>
          )}
          {groups.map(renderGroup)}
        </TabsContent>

        <TabsContent value="test" className="pt-4">
          {mode === "edit" ? (
            <SimulatorPanel archetype={archetype} mode="edit" agentId={agentId} />
          ) : (
            <div className="space-y-3">
              {!canActivate && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
                  Você está testando um rascunho incompleto — algumas ações podem ficar limitadas até preencher os
                  obrigatórios.
                </p>
              )}
              <SimulatorPanel archetype={archetype} mode="create" draftConfig={config} draftRubric={rubricRules} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Sticky bottom action bar */}
      <div className="sticky bottom-0 z-10 -mx-1 border-t border-border/60 bg-background/95 px-1 pb-1 pt-3 backdrop-blur">
        <div className="flex flex-col gap-2">
          {!canActivate && (
            <button
              type="button"
              onClick={() => setChecklistOpen((o) => !o)}
              className="flex items-center gap-1.5 text-left text-xs text-muted-foreground"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Faltam para ativar:{" "}
              <span className="text-amber-500">
                {checklistOpen
                  ? missing.map((m) => MISSING_META[m]?.label ?? m).join(", ")
                  : `${missing.length} item(ns)`}
              </span>
            </button>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" disabled={save.isPending} onClick={() => submit(false)}>
              {mode === "edit" ? "Salvar alterações" : "Salvar rascunho"}
            </Button>
            <Button disabled={!canActivate || save.isPending} onClick={() => submit(true)}>
              {save.isPending ? "Salvando…" : "Ativar agente"}
            </Button>
          </div>
        </div>
      </div>
    </div>
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
