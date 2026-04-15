---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-17-simplify-copilot-config-modal.md
---

# Simplify Copilot Config Modal - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce AgentConfigModal from 6 tabs to 2 tabs (Geral + Funis), adding custom pipeline support.

**Architecture:** Single-file refactor of AgentConfigModal.tsx. Merge Visão Geral + WhatsApp into one "Geral" tab. Remove Automação, Revisão, Regras, Follow-up tabs (keep state for save handler). Add custom pipelines to Funis tab via sub-component.

**Tech Stack:** React, shadcn/ui Tabs, TanStack Query, existing hooks

---

## File Structure

### Modified Files
| File | Changes |
|------|---------|
| `src/components/copilot/AgentConfigModal.tsx` | Remove 4 tabs, merge 2 tabs, add custom pipelines |

### No new files needed

---

## Task 1: Remove unused imports and tab triggers

**Files:**
- Modify: `src/components/copilot/AgentConfigModal.tsx:10-69` (imports) and `src/components/copilot/AgentConfigModal.tsx:241-280` (TabsList)

- [ ] **Step 1: Remove unused imports**

Replace the import block (lines 10-69) with the following. Removes: `ArrowRightLeft`, `Plus`, `Trash2`, `BarChart3`, `Clock`, `LayoutList` (icons only used in removed tabs), `Switch` (only used in Automação), `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` (only used in Automação move rules), `AgentMetricsTab`, `AgentTasksTab`, `AgentFollowupRulesTab`, `AgentKanbanRulesTab`. Adds: `useCustomPipelines`, `useCustomPipelineStages`.

```tsx
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Settings,
  GitBranch,
  X,
  Save,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Smartphone,
  Link2,
  Unlink,
  Pencil,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useNavigate } from "react-router-dom";
import { useUpdateCopilotAgentPipeline, useLinkAgentToWhatsAppInstance } from "@/hooks/useCopilotAgents";
import { useWhatsAppInstancesWithAgent } from "@/hooks/useWhatsAppInstances";
import type { CopilotAgentWithRelations, MoveRule } from "@/types/copilot";
import { PIPE_TYPES } from "@/types/copilot";
import { useAllPipelineStageOptions } from "@/hooks/usePipelineStages";
import { useCustomPipelines, useCustomPipelineStages } from "@/hooks/useCustomPipelines";
```

- [ ] **Step 2: Replace TabsList (lines 241-280)**

Replace the entire `<TabsList>` block with a simplified 2-tab version:

```tsx
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="pipelines" className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              Funis
            </TabsTrigger>
          </TabsList>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: Errors about removed imports being used in JSX (expected - we'll fix in next tasks)

- [ ] **Step 4: Commit**

```bash
git add src/components/copilot/AgentConfigModal.tsx
git commit -m "refactor: simplify AgentConfigModal imports and tab triggers (6→2 tabs)"
```

---

## Task 2: Merge Visão Geral + WhatsApp into "Geral" tab

**Files:**
- Modify: `src/components/copilot/AgentConfigModal.tsx:284-491` (overview + whatsapp tabs)

- [ ] **Step 1: Replace both tabs with merged "Geral" tab**

Replace the entire `{/* Tab: Visão Geral */}` block (lines 283-349) AND the entire `{/* Tab: WhatsApp */}` block (lines 351-491) with a single merged tab:

```tsx
            {/* Tab: Geral (Visão Geral + WhatsApp) */}
            <TabsContent value="overview" className="space-y-4 px-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Informaçoes do Agente</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Nome</Label>
                      <p className="font-medium">{agent.name}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Template</Label>
                      <Badge variant="outline" className="capitalize">
                        {agent.template_type}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Status</Label>
                      <Badge
                        className={
                          agent.is_active
                            ? "bg-green-500"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {agent.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Padrão</Label>
                      <Badge variant={agent.is_default ? "default" : "outline"}>
                        {agent.is_default ? "Sim" : "Não"}
                      </Badge>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label className="text-muted-foreground">Personalidade</Label>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <Badge variant="outline">{agent.personality_tone}</Badge>
                      <Badge variant="outline">{agent.personality_style}</Badge>
                      <Badge variant="outline">{agent.personality_energy}</Badge>
                    </div>
                  </div>

                  <div>
                    <Label className="text-muted-foreground">Objetivo Principal</Label>
                    <p className="text-sm mt-1">{agent.main_objective}</p>
                  </div>

                  <div>
                    <Label className="text-muted-foreground">Habilidades</Label>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {(agent.skills as string[] || []).map((skill, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Seção WhatsApp */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Smartphone className="w-5 h-5" />
                    Instância WhatsApp
                  </CardTitle>
                  <CardDescription>
                    Vincule uma instância de WhatsApp para o agente responder automaticamente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Instância atualmente vinculada */}
                  {selectedInstanceId && (
                    <div className="p-4 border rounded-lg bg-green-500/10 border-green-500/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                            <Link2 className="w-5 h-5 text-green-500" />
                          </div>
                          <div>
                            <p className="font-medium">
                              {whatsappInstances.find(i => i.id === selectedInstanceId)?.instance_name || "Instância"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Agente vinculado e respondendo automaticamente
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleUnlinkWhatsApp}
                          disabled={linkToWhatsApp.isPending}
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        >
                          <Unlink className="w-4 h-4 mr-2" />
                          Desvincular
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Lista de instâncias disponíveis */}
                  {!selectedInstanceId && (
                    <>
                      {isLoadingInstances ? (
                        <div className="text-center py-8 text-muted-foreground">
                          Carregando instâncias...
                        </div>
                      ) : whatsappInstances.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Smartphone className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p>Nenhuma instância de WhatsApp encontrada</p>
                          <p className="text-sm">
                            Crie uma instância na página de WhatsApp para vincular ao agente
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-sm text-muted-foreground">
                            Selecione uma instância para vincular:
                          </Label>
                          {whatsappInstances.map((instance) => {
                            const isConnected = instance.status === "connected";
                            // @ts-ignore
                            const hasOtherAgent = instance.copilot_agent_id && instance.copilot_agent_id !== agent?.id;

                            return (
                              <div
                                key={instance.id}
                                className={`p-4 border rounded-lg transition-colors ${
                                  hasOtherAgent
                                    ? "opacity-50 cursor-not-allowed"
                                    : "hover:bg-muted/50 cursor-pointer"
                                }`}
                                onClick={() => !hasOtherAgent && handleLinkWhatsApp(instance.id)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                      isConnected ? "bg-green-500/20" : "bg-yellow-500/20"
                                    }`}>
                                      <Smartphone className={`w-5 h-5 ${
                                        isConnected ? "text-green-500" : "text-yellow-500"
                                      }`} />
                                    </div>
                                    <div>
                                      <p className="font-medium">{instance.instance_name}</p>
                                      <div className="flex items-center gap-2">
                                        <Badge variant={isConnected ? "default" : "secondary"} className="text-xs">
                                          {isConnected ? "Conectado" : instance.status}
                                        </Badge>
                                        {instance.phone_number && (
                                          <span className="text-xs text-muted-foreground">
                                            {instance.phone_number}
                                          </span>
                                        )}
                                        {hasOtherAgent && (
                                          <Badge variant="outline" className="text-xs">
                                            Já vinculado a outro agente
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {!hasOtherAgent && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={linkToWhatsApp.isPending}
                                    >
                                      <Link2 className="w-4 h-4 mr-2" />
                                      Vincular
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/copilot/AgentConfigModal.tsx
git commit -m "refactor: merge Visão Geral + WhatsApp into single Geral tab"
```

---

## Task 3: Remove Automação, Revisão, Regras, Follow-up tabs

**Files:**
- Modify: `src/components/copilot/AgentConfigModal.tsx`

- [ ] **Step 1: Remove the 4 tab content blocks**

Delete the following JSX blocks entirely (they come after the Funis `</TabsContent>`):

1. `{/* Tab: Automação */}` - the entire `<TabsContent value="automation">` block
2. `{/* Tab: Revisão & Métricas */}` - the entire `<TabsContent value="review">` block
3. `{/* Tab: Regras por Etapa (Kanban) */}` - the entire `<TabsContent value="kanban">` block
4. `{/* Tab: Follow-up Rules */}` - the entire conditional `{agent.template_type === 'followup' && (...)}` block

- [ ] **Step 2: Remove dead handlers**

Delete these 3 functions (no longer referenced in JSX):

- `handleAddMoveRule` (lines 182-191)
- `handleRemoveMoveRule` (lines 193-195)
- `handleUpdateMoveRule` (lines 197-211)

**Keep** the state variables `canMoveCards`, `autoMoveOnQualify`, `autoMoveOnObjective`, `moveRules` and their initialization in `useEffect` - they are still needed by `handleSave`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors (all removed references should be cleaned up)

- [ ] **Step 4: Commit**

```bash
git add src/components/copilot/AgentConfigModal.tsx
git commit -m "refactor: remove Automação, Revisão, Regras, Follow-up tabs from config modal"
```

---

## Task 4: Add custom pipelines to Funis tab

**Files:**
- Modify: `src/components/copilot/AgentConfigModal.tsx` (Funis tab content)

- [ ] **Step 1: Add the `useCustomPipelines` hook call**

Inside the component function, after the existing `useAllPipelineStageOptions` call (around line 86), add:

```tsx
  const { data: customPipelines = [] } = useCustomPipelines();
```

- [ ] **Step 2: Create the `CustomPipeRow` sub-component**

Add this sub-component BEFORE the `AgentConfigModal` function (after the imports):

```tsx
function CustomPipeRow({
  pipeline,
  isActive,
  isExpanded,
  pipeStages,
  onTogglePipe,
  onToggleExpand,
  onToggleStage,
  onSelectAll,
  onClearAll,
}: {
  pipeline: { id: string; name: string };
  isActive: boolean;
  isExpanded: boolean;
  pipeStages: string[];
  onTogglePipe: () => void;
  onToggleExpand: () => void;
  onToggleStage: (stage: string) => void;
  onSelectAll: (stages: string[]) => void;
  onClearAll: () => void;
}) {
  const { data: stages = [] } = useCustomPipelineStages(pipeline.id);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${
          isActive ? "bg-primary/10" : "hover:bg-muted/50"
        }`}
        onClick={onTogglePipe}
      >
        <div className="flex items-center gap-3">
          <Checkbox
            checked={isActive}
            onCheckedChange={onTogglePipe}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="font-medium">{pipeline.name}</span>
          <Badge variant="outline" className="text-xs">Custom</Badge>
          {isActive && pipeStages.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {pipeStages.length} etapas
            </Badge>
          )}
        </div>
        {isActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        )}
      </div>

      <AnimatePresence>
        {isActive && isExpanded && stages.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 pt-0 border-t bg-muted/30">
              <div className="flex justify-between items-center mb-3">
                <Label className="text-sm text-muted-foreground">
                  Etapas onde o agente atuará:
                </Label>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectAll(stages.map((s) => s.stage_key))}
                  >
                    Todas
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onClearAll}>
                    Limpar
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {stages.map((stage) => (
                  <div key={stage.stage_key} className="flex items-center gap-2">
                    <Checkbox
                      id={`custom-${pipeline.id}-${stage.stage_key}`}
                      checked={pipeStages.includes(stage.stage_key)}
                      onCheckedChange={() => onToggleStage(stage.stage_key)}
                    />
                    <Label
                      htmlFor={`custom-${pipeline.id}-${stage.stage_key}`}
                      className="text-sm cursor-pointer"
                    >
                      {stage.name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 3: Add custom pipelines section to Funis tab**

In the Funis tab, after the `{PIPE_TYPES.map(...)}` closing (after the `})}` that ends the standard pipes loop), and before the `</CardContent>` closing, add:

```tsx
                  {/* Custom Pipelines */}
                  {customPipelines.length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <Label className="text-sm font-medium text-muted-foreground mb-2 block">
                        Pipes Custom
                      </Label>
                      {customPipelines.map((pipeline) => (
                        <CustomPipeRow
                          key={pipeline.id}
                          pipeline={pipeline}
                          isActive={activePipes.includes(pipeline.id)}
                          isExpanded={expandedPipes[pipeline.id] || false}
                          pipeStages={activeStages[pipeline.id] || []}
                          onTogglePipe={() => handleTogglePipe(pipeline.id)}
                          onToggleExpand={() =>
                            setExpandedPipes((prev) => ({
                              ...prev,
                              [pipeline.id]: !prev[pipeline.id],
                            }))
                          }
                          onToggleStage={(stage) => handleToggleStage(pipeline.id, stage)}
                          onSelectAll={(stages) =>
                            setActiveStages((prev) => ({
                              ...prev,
                              [pipeline.id]: stages,
                            }))
                          }
                          onClearAll={() =>
                            setActiveStages((prev) => ({
                              ...prev,
                              [pipeline.id]: [],
                            }))
                          }
                        />
                      ))}
                    </>
                  )}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/copilot/AgentConfigModal.tsx
git commit -m "feat: add custom pipelines support to Funis tab in config modal"
```

---

## Task 5: Final verification

- [ ] **Step 1: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit --pretty 2>&1 | head -50`
Expected: No errors

- [ ] **Step 2: Verify production build**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit if any cleanup needed**

```bash
git status
# If changes remain:
git add src/components/copilot/AgentConfigModal.tsx
git commit -m "chore: final cleanup for simplified copilot config modal"
```


## Links relacionados

- [[Visao Geral]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
