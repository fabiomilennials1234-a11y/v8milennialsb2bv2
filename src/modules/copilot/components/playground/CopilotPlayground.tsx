/**
 * CopilotPlayground — Tela unica para criar/editar copilots
 *
 * Layout: 2 colunas (60/40)
 * - Esquerda: Prompt editor + paineis colapsaveis (Settings, Tools, Conhecimento)
 * - Direita: Chat de teste (Live Preview)
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { BuilderPanel } from "@/modules/copilot/components/builder/BuilderPanel";
import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";
import { buildCapabilityManifest, buildBuilderToolDefs } from "@/modules/copilot/lib/capability-manifest";
import { applyBuilderAction, type BuilderAction, type BuilderFormState } from "@/modules/copilot/lib/builder-form-reducer";
import { Save, Loader2, ChevronLeft, Bot, Power, Star, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileText, Wrench, BookOpen, Sparkles, GitBranch, Plug, SlidersHorizontal, RefreshCw, BellRing } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { PromptEditor } from "./PromptEditor";
import { PlaygroundSettings } from "./PlaygroundSettings";
import { PlaygroundTools } from "./PlaygroundTools";
import { PlaygroundKnowledge } from "./PlaygroundKnowledge";
import { PlaygroundFunis } from "./PlaygroundFunis";
import { PlaygroundConexao } from "./PlaygroundConexao";
import { PlaygroundComportamento } from "./PlaygroundComportamento";
import { FollowupSituationsTab } from "../FollowupSituationsTab";
import { PlaygroundHandoffNotify } from "./PlaygroundHandoffNotify";
import { LivePreviewChat } from "./LivePreviewChat";
import { PromptAnalysisTab } from "./PromptAnalysisTab";
import { funisStateToPayload, payloadToFunisState } from "./funis-mapping";
import {
  conexaoStateToPayload,
  payloadToConexaoState,
  comportamentoStateToPayload,
  payloadToComportamentoState,
  createDefaultConexaoState,
  createDefaultComportamentoState,
  type ConexaoState,
  type ComportamentoState,
} from "./conexao-comportamento-mapping";
import {
  PLAYGROUND_TOOLS,
  createDefaultPlaygroundData,
  DEFAULT_PROMPT_SECTIONS,
  filterLegacyTools,
  type PlaygroundData,
  type PromptSections,
} from "./types";

import {
  useCreateCopilotAgent,
  useCopilotAgentForEdit,
  useUpdateCopilotAgentFromWizard,
  useCopilotAgents,
  useToggleCopilotAgent,
  useSetDefaultCopilotAgent,
} from "@/modules/copilot/hooks/useCopilotAgents";
import { useUploadAgentDocument, useAgentDocuments, useDeleteAgentDocument } from "@/modules/copilot/hooks/useAgentDocuments";

import { useCurrentTeamMember } from "@/modules/identity";
import { hasFullBehaviorCoverage } from "@/modules/copilot/components/BehaviorWindowsEditor";

// =============================================================
// HELPER: Build system prompt from playground data
// =============================================================

/**
 * Resolve @menções em texto, substituindo por instruções que o LLM entende.
 */
function resolveMentions(text: string, data: PlaygroundData): string {
  let resolved = text;

  for (const toolDef of PLAYGROUND_TOOLS) {
    const state = data.tools[toolDef.id];
    const mentionRegex = new RegExp(`@${toolDef.id}`, "g");
    if (state?.enabled) {
      resolved = resolved.replace(mentionRegex, `[usar ferramenta "${toolDef.name}"]`);
    } else {
      resolved = resolved.replace(mentionRegex, toolDef.name);
    }
  }

  for (const link of data.links) {
    const linkMentionRegex = new RegExp(`@${link.id}`, "g");
    resolved = resolved.replace(linkMentionRegex, `${link.alias} (${link.url})`);
  }

  for (const doc of data.documents) {
    const docMentionRegex = new RegExp(`@${doc.id}`, "g");
    resolved = resolved.replace(docMentionRegex, `[documento: ${doc.name}]`);
  }

  return resolved;
}

/**
 * Monta o system prompt final a partir das seções estruturadas + tool instructions.
 *
 * Ordem: Personalidade → Objetivo → Fluxo → Ferramentas → Instruções → Links
 */
function buildSystemPrompt(data: PlaygroundData): string {
  const parts: string[] = [];
  const s = data.promptSections;

  if (s.personality.trim()) {
    parts.push(`# PERSONALIDADE\n\n${resolveMentions(s.personality.trim(), data)}`);
  }

  if (s.objective.trim()) {
    parts.push(`# OBJETIVO\n\n${resolveMentions(s.objective.trim(), data)}`);
  }

  if (s.flow.trim()) {
    parts.push(`# FLUXO DE ATENDIMENTO\n\n${resolveMentions(s.flow.trim(), data)}`);
  }

  if (s.products?.trim()) {
    parts.push(`# PRODUTOS E SERVICOS\n\n${resolveMentions(s.products.trim(), data)}`);
  }

  // Tool instructions — only enabled tools
  const toolSections: string[] = [];
  for (const toolDef of PLAYGROUND_TOOLS) {
    const state = data.tools[toolDef.id];
    if (!state?.enabled) continue;
    const instruction = state.instruction?.trim() || toolDef.defaultInstruction;
    toolSections.push(`## ${toolDef.name}\n${resolveMentions(instruction, data)}`);
  }
  if (toolSections.length > 0) {
    parts.push(`# FERRAMENTAS DISPONÍVEIS\n\n${toolSections.join("\n\n")}`);
  }

  // Media available for sending
  const mediaDocs = data.documents.filter(
    (d) => (d.fileType === "image" || d.fileType === "video") && (d.description || d.sendWhen)
  );
  if (mediaDocs.length > 0) {
    const mediaSections = mediaDocs.map((d) => {
      const typeLabel = d.fileType === "image" ? "imagem" : "video";
      let section = `## [${typeLabel}] ${d.name}`;
      if (d.description) section += `\nDescricao: ${d.description}`;
      if (d.sendWhen) section += `\nQuando enviar: ${d.sendWhen}`;
      return section;
    });
    parts.push(`# MÍDIA DISPONÍVEL PARA ENVIAR\n\n${mediaSections.join("\n\n")}`);
  }

  if (s.instructions.trim()) {
    parts.push(`# INSTRUÇÕES\n\n${resolveMentions(s.instructions.trim(), data)}`);
  }

  // Links
  if (data.links.length > 0) {
    let linkSection = "## Links disponiveis para enviar ao lead:\n";
    for (const link of data.links) {
      linkSection += `- ${link.alias}: ${link.url}\n`;
    }
    linkSection += "\nIMPORTANTE: Quando relevante, envie o link completo na mensagem para o lead poder clicar.";
    parts.push(linkSection);
  }

  return parts.join("\n\n");
}

/**
 * Junta todas as seções em texto contínuo para salvar como custom_instructions.
 */
function sectionsToFlatText(data: PlaygroundData): string {
  return buildSystemPrompt(data);
}

// =============================================================
// HELPER: Convert playground data to agent payload
// =============================================================

function playgroundToAgentPayload(data: PlaygroundData, conexaoState?: ConexaoState) {
  const activeTools = Object.entries(data.tools)
    .filter(([_, state]) => state.enabled)
    .map(([id]) => id);

  const systemPrompt = buildSystemPrompt(data);

  const funisPayload = funisStateToPayload(data.funis);

  return {
    agent: {
      name: data.name,
      template_type: data.templateType || "custom",
      system_prompt: systemPrompt,
      system_prompt_version: 1,
      personality_tone: "profissional",
      personality_style: "consultivo",
      personality_energy: "moderada",
      main_objective: (data.promptSections.objective || data.promptSections.personality).slice(0, 200),
      skills: activeTools,
      allowed_topics: [],
      forbidden_topics: [],
      operation_mode: "inbound",
      activation_triggers: data.isProactive ? data.activationTriggers : null,
      outbound_config: data.isProactive ? {
        ...data.outboundConfig,
        audioEnabled: data.audioEnabled,
        audioSendOrder: data.audioSendOrder,
      } : null,
      availability: data.availability,
      behavior_windows: data.behaviorWindows ?? [],
      behavior_enforcement: data.behaviorEnforcement ?? "hard",
      response_delay_ms: data.responseDelayMs,
      llm_temperature_mode: data.llmTemperatureMode,
      can_qualify_lead: data.tools.QUALIFICAR_LEAD?.enabled ?? false,
      can_schedule_meeting: data.tools.AGENDAR_REUNIAO?.enabled ?? false,
      can_send_followup: false,
      can_update_lead: data.tools.PREENCHER_CAMPOS?.enabled ?? false,
      can_update_crm: false,
      can_answer_faq: false,
      can_create_lead: data.tools.CRIAR_LEAD?.enabled ?? false,
      can_transfer_human: data.tools.TRANSFERIR_HUMANO?.enabled ?? false,
      can_move_cards: data.tools.MOVER_CARD?.enabled ?? false,
      can_send_document: data.tools.ENVIAR_DOCUMENTO?.enabled ?? false,
      can_transfer_sz_chat: data.tools.TRANSFERIR_SZ_CHAT?.enabled ?? false,
      human_pause_enabled: data.tools.PAUSAR_ATENDIMENTO_HUMANO?.enabled ?? true,
      human_pause_duration_minutes: data.tools.PAUSAR_ATENDIMENTO_HUMANO?.config?.durationMinutes
        ? Number(data.tools.PAUSAR_ATENDIMENTO_HUMANO.config.durationMinutes)
        : 60,
      active_pipes: funisPayload.activePipes,
      active_stages: funisPayload.activeStages,
      move_rules: funisPayload.moveRules,
      max_conversation_turns: 20,
      business_context: {},
      conversation_style: {
        // Playground structured data (round-trip persistence)
        promptSections: data.promptSections,
        toolInstructions: Object.fromEntries(
          Object.entries(data.tools)
            .filter(([_, s]) => s.enabled && s.instruction)
            .map(([id, s]) => [id, s.instruction])
        ),
        handoffNotifyPhones: data.handoffNotifyPhones,
        handoffNotifyInstructions: data.handoffNotifyInstructions,
      },
      custom_instructions: sectionsToFlatText(data),
      // Handoff WhatsApp Notification
      handoff_notify_phones: data.handoffNotifyPhones.length > 0
        ? data.handoffNotifyPhones.map((p) => p.phone)
        : null,
      handoff_notify_instructions: data.handoffNotifyInstructions || null,
      // Conexao fields
      ...(conexaoState ? conexaoStateToPayload(conexaoState) : {}),
    },
    faqs: [],
    kanbanRules: [],
  };
}

// =============================================================
// MAIN COMPONENT
// =============================================================

export function CopilotPlayground() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const isEditMode = !!editId;

  const [searchParams, setSearchParams] = useSearchParams();
  const { enabled: builderFlag } = useFeatureFlag("copilot_builder");
  const builderActive = builderFlag && searchParams.get("builder") === "1";
  const [builderLocked, setBuilderLocked] = useState<string[]>([]);
  const builderManifest = useMemo(() => buildCapabilityManifest(), []);
  const builderToolDefs = useMemo(
    () => buildBuilderToolDefs(builderManifest) as unknown[],
    [builderManifest],
  );
  const builderCapabilities = useMemo(
    () =>
      builderManifest.tools.map((t) => ({
        id: t.id,
        name: t.name,
        whenToUse: t.guide.whenToUse,
        dependency: t.dependency,
      })) as unknown[],
    [builderManifest],
  );

  const [data, setData] = useState<PlaygroundData>(createDefaultPlaygroundData());
  const [conexao, setConexao] = useState<ConexaoState>(createDefaultConexaoState());
  const [comportamento, setComportamento] = useState<ComportamentoState>(createDefaultComportamentoState());
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);
  const configVersionTimerRef = useRef<NodeJS.Timeout>();

  const [pendingActivation, setPendingActivation] = useState(false);

  const createAgent = useCreateCopilotAgent();
  const updateAgent = useUpdateCopilotAgentFromWizard();
  const uploadDocument = useUploadAgentDocument();
  const deleteDocument = useDeleteAgentDocument();
  const toggleAgent = useToggleCopilotAgent();
  const setDefault = useSetDefaultCopilotAgent();
  const { data: editData, isLoading: isLoadingEdit } = useCopilotAgentForEdit(editId);
  const { data: allAgents } = useCopilotAgents();
  const { data: existingDocs = [] } = useAgentDocuments(editId);
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  // Live agent status from the agents list (is_active, is_default, active_pipes)
  const currentAgent = useMemo(
    () => (isEditMode && allAgents ? allAgents.find((a) => a.id === editId) : null),
    [isEditMode, allAgents, editId],
  );

  const handleToggleActive = useCallback(() => {
    if (!editId || !currentAgent) return;
    const activating = !currentAgent.is_active;
    const hasNoPipes = !((currentAgent.active_pipes as string[]) || []).length;
    if (activating && hasNoPipes) {
      setPendingActivation(true);
    } else {
      toggleAgent.mutate({ id: editId, isActive: activating });
    }
  }, [editId, currentAgent, toggleAgent]);

  const handleSetDefault = useCallback(() => {
    if (!editId) return;
    setDefault.mutate(editId);
  }, [editId, setDefault]);

  // Load edit data
  useEffect(() => {
    if (!editData?.wizardData) return;

    const wd = editData.wizardData as any;

    // Retrocompat: old agents have prompt (flat text) instead of promptSections
    const legacyPrompt = wd.customInstructions?.dos || wd.mainObjective || "";
    const loadedSections: PromptSections = wd.promptSections
      ? { ...DEFAULT_PROMPT_SECTIONS, ...wd.promptSections }
      : { ...DEFAULT_PROMPT_SECTIONS, instructions: legacyPrompt };

    // Helper to build tool state with instruction
    const toolState = (enabled: boolean, toolId: string, config: Record<string, any> = {}): { enabled: boolean; config: Record<string, any>; instruction: string } => {
      const savedInstruction = wd.toolInstructions?.[toolId] || "";
      const def = PLAYGROUND_TOOLS.find((t) => t.id === toolId);
      return {
        enabled,
        config,
        instruction: savedInstruction || (enabled && def ? def.defaultInstruction : ""),
      };
    };

    setData((prev) => ({
      ...prev,
      name: wd.name,
      templateType: wd.templateType,
      promptSections: loadedSections,
      llmTemperatureMode: wd.llmTemperatureMode || "balanceado",
      responseDelayMs: wd.responseDelayMs || 1000,
      availability: wd.availability || prev.availability,
      behaviorWindows:
        Array.isArray(wd.behaviorWindows) && wd.behaviorWindows.length > 0
          ? wd.behaviorWindows
          : prev.behaviorWindows,
      behaviorEnforcement: wd.behaviorEnforcement === "soft" ? "soft" : "hard",
      isProactive: wd.operationMode !== "inbound",
      operationMode: wd.operationMode || "inbound",
      activationTriggers: wd.activationTriggers || prev.activationTriggers,
      outboundConfig: wd.outboundConfig || prev.outboundConfig,
      audioEnabled: wd.outboundConfig?.audioEnabled || false,
      audioSendOrder: wd.outboundConfig?.audioSendOrder || "text_first",
      attendUnknownContacts: wd.attendUnknownContacts ?? true,
      agentId: editId,
      handoffNotifyPhones: wd.handoffNotifyPhones || (
        Array.isArray((editData as any)?.agent?.handoff_notify_phones)
          ? ((editData as any).agent.handoff_notify_phones as string[]).map((phone: string) => ({ phone, label: "" }))
          : []
      ),
      handoffNotifyInstructions: wd.handoffNotifyInstructions || (editData as any)?.agent?.handoff_notify_instructions || "",
      funis: payloadToFunisState({
        active_pipes: wd.activePipes || [],
        active_stages: wd.activeStages || {},
        move_rules: wd.moveRules || [],
      }),
      tools: filterLegacyTools({
        QUALIFICAR_LEAD: toolState(wd.canQualifyLead, "QUALIFICAR_LEAD"),
        AGENDAR_REUNIAO: toolState(wd.canScheduleMeeting, "AGENDAR_REUNIAO"),
        MOVER_CARD: toolState(wd.canMoveCards, "MOVER_CARD"),
        TRANSFERIR_HUMANO: toolState(wd.canTransferHuman, "TRANSFERIR_HUMANO"),
        CRIAR_LEAD: toolState(wd.canCreateLead, "CRIAR_LEAD"),
        PREENCHER_CAMPOS: toolState(true, "PREENCHER_CAMPOS"),
        CRIAR_CAMPO: toolState(false, "CRIAR_CAMPO"),
        TRANSFERIR_SZ_CHAT: toolState(false, "TRANSFERIR_SZ_CHAT"),
        ENVIAR_DOCUMENTO: toolState(false, "ENVIAR_DOCUMENTO"),
        PAUSAR_ATENDIMENTO_HUMANO: {
          enabled: wd.humanPauseEnabled ?? true,
          config: { durationMinutes: wd.humanPauseDurationMinutes ?? 60 },
          instruction: wd.toolInstructions?.PAUSAR_ATENDIMENTO_HUMANO ?? "",
        },
      }),
      documents: (editData.existingDocuments || []).map((d: any) => ({
        id: d.id,
        name: d.file_name,
        status: "ready" as const,
        existingId: d.id,
        filePath: d.file_path,
        fileType: d.file_type || "document",
        description: d.description || "",
        sendWhen: d.send_when || "",
      })),
    }));

    // Load conexao state from agent
    setConexao(payloadToConexaoState({
      whatsapp_instance_id: wd.whatsappInstanceId ?? (editData as any)?.agent?.whatsapp_instance_id ?? null,
      retention_enabled: wd.retentionEnabled ?? (editData as any)?.agent?.retention_enabled ?? false,
      retention_config: wd.retentionConfig ?? (editData as any)?.agent?.retention_config ?? {},
    }));

    // Load comportamento state from existing data
    setComportamento(payloadToComportamentoState({
      availability: wd.availability,
      behavior_windows: wd.behaviorWindows,
      behavior_enforcement: wd.behaviorEnforcement,
      response_delay_ms: wd.responseDelayMs,
      llm_temperature_mode: wd.llmTemperatureMode,
    }));
  }, [editData, editId]);

  // Update config version (debounced) — triggers chat reset
  const bumpConfigVersion = useCallback(() => {
    if (configVersionTimerRef.current) {
      clearTimeout(configVersionTimerRef.current);
    }
    configVersionTimerRef.current = setTimeout(() => {
      setConfigVersion((v) => v + 1);
    }, 2000);
  }, []);

  // Generic updater
  const updateData = useCallback(
    (updates: Partial<PlaygroundData>) => {
      setData((prev) => ({ ...prev, ...updates }));
      bumpConfigVersion();
    },
    [bumpConfigVersion]
  );

  // Apply the Builder's tool-calls to the live form (reuses the pure reducer).
  const applyBuilderActions = useCallback(
    (actions: unknown[]) => {
      if (!actions?.length) return;
      setData((prev) => {
        let state: BuilderFormState = { data: prev, locked: builderLocked };
        for (const a of actions as BuilderAction[]) {
          state = applyBuilderAction(state, a);
        }
        return state.data;
      });
      bumpConfigVersion();
    },
    [builderLocked, bumpConfigVersion]
  );

  // Lock a prompt section once the user edits it by hand, so the Builder asks
  // before overwriting (handled in the reducer via the `override` flag).
  const handleSectionsChange = useCallback(
    (promptSections: PlaygroundData["promptSections"]) => {
      setData((prev) => {
        const touched = (Object.keys(promptSections) as Array<keyof PlaygroundData["promptSections"]>)
          .filter((k) => promptSections[k] !== prev.promptSections[k])
          .map((k) => `promptSections.${k}`);
        if (touched.length) {
          setBuilderLocked((locked) => Array.from(new Set([...locked, ...touched])));
        }
        return { ...prev, promptSections };
      });
      bumpConfigVersion();
    },
    [bumpConfigVersion]
  );

  // Conexao updater
  const updateConexao = useCallback(
    (updates: Partial<ConexaoState>) => {
      setConexao((prev) => ({ ...prev, ...updates }));
      bumpConfigVersion();
    },
    [bumpConfigVersion]
  );

  // Comportamento updater — also sync into PlaygroundData for prompt preview
  const updateComportamento = useCallback(
    (updates: Partial<ComportamentoState>) => {
      setComportamento((prev) => ({ ...prev, ...updates }));
      // Sync availability/behavior into PlaygroundData for system prompt & save
      const syncFields: Partial<PlaygroundData> = {};
      if (updates.availability) syncFields.availability = updates.availability;
      if (updates.behaviorWindows !== undefined) syncFields.behaviorWindows = updates.behaviorWindows;
      if (updates.behaviorEnforcement !== undefined) syncFields.behaviorEnforcement = updates.behaviorEnforcement;
      if (updates.responseDelayMs !== undefined) syncFields.responseDelayMs = updates.responseDelayMs;
      if (updates.llmTemperatureMode !== undefined) syncFields.llmTemperatureMode = updates.llmTemperatureMode;
      if (Object.keys(syncFields).length > 0) {
        setData((prev) => ({ ...prev, ...syncFields }));
      }
      bumpConfigVersion();
    },
    [bumpConfigVersion]
  );

  // Build system prompt for preview
  const systemPromptForPreview = useMemo(() => buildSystemPrompt(data), [data]);

  // Save
  const handleSave = async () => {
    // Hard validations — block save
    if (!data.name.trim()) {
      toast.error("Nome obrigatorio", { description: "Informe um nome para o agente." });
      return;
    }
    const totalContent = Object.values(data.promptSections).join("").trim();
    if (totalContent.length < 10) {
      toast.error("Prompt muito curto", { description: "Preencha pelo menos uma secao do prompt com instrucoes para o agente." });
      return;
    }

    // Soft warning — incomplete behavior windows is OK (agent responds only during configured hours)
    if (!hasFullBehaviorCoverage(data.behaviorWindows)) {
      toast.warning("Cobertura de horario incompleta", {
        description: "O agente so respondera nos horarios configurados. Voce pode ajustar isso depois em Configuracoes de horario.",
        duration: 5000,
      });
    }

    setIsSaving(true);

    try {
      if (isEditMode && editId) {
        // Update existing agent
        await updateAgent.mutateAsync({
          agentId: editId,
          data: {
            ...createWizardDataFromPlayground(data, conexao),
          },
          documentsToRemove: [],
        });

        // Upload pending documents (novos adicionados durante edicao)
        if (organizationId) {
          for (const doc of data.documents) {
            if (doc.file && doc.status === "pending") {
              try {
                await uploadDocument.mutateAsync({
                  agentId: editId,
                  organizationId,
                  file: doc.file,
                  fileType: doc.fileType,
                  description: doc.description,
                  sendWhen: doc.sendWhen,
                });
              } catch (e) {
                console.warn("Erro ao fazer upload de documento:", e);
              }
            }
          }
        }

        // Graduate a Builder draft to a real agent. No-op for agents that are
        // already finalized (guarded by finalized_at IS NULL).
        await supabase
          .from("copilot_agents")
          .update({ finalized_at: new Date().toISOString() })
          .eq("id", editId)
          .is("finalized_at", null);

        navigate("/copilot");
      } else {
        // Create new agent
        const payload = playgroundToAgentPayload(data, conexao);
        const agent = await createAgent.mutateAsync(payload as any);

        // Upload pending documents
        if (agent?.id && (organizationId || agent.organization_id)) {
          const orgId = organizationId || agent.organization_id;
          for (const doc of data.documents) {
            if (doc.file && doc.status === "pending") {
              try {
                await uploadDocument.mutateAsync({
                  agentId: agent.id,
                  organizationId: orgId,
                  file: doc.file,
                  fileType: doc.fileType,
                  description: doc.description,
                  sendWhen: doc.sendWhen,
                });
              } catch (e) {
                console.warn("Erro ao fazer upload de documento:", e);
              }
            }
          }
        }

        // Guide user through next steps after creation
        toast.success("Copilot criado com sucesso!", {
          description: "Proximos passos: 1) Ative o agente na lista, 2) Configure os funis em Configurar, 3) Vincule ao seu WhatsApp em Configuracoes.",
          duration: 10000,
        });
        navigate("/copilot");
      }
    } catch (err: any) {
      // Error handled by mutation hooks
      console.error("Save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditMode && isLoadingEdit) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col flex-1 min-w-0 h-full"
    >
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => navigate("/copilot")}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <Bot className="w-5 h-5 text-primary" />

          <Input
            value={data.name}
            onChange={(e) => updateData({ name: e.target.value })}
            placeholder="Nome do agente..."
            className="w-64 h-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Status badge + activate/deactivate + set-as-default (edit mode only) */}
          {isEditMode && currentAgent && (
            <>
              <Badge
                variant={currentAgent.is_active ? "default" : "secondary"}
                className={currentAgent.is_active ? "bg-success text-success-foreground" : ""}
              >
                {currentAgent.is_active ? "Ativo" : "Inativo"}
              </Badge>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={handleToggleActive}
                    disabled={toggleAgent.isPending}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {currentAgent.is_active ? "Desativar" : "Ativar"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {currentAgent.is_active ? "Desativar agente" : "Ativar agente"}
                </TooltipContent>
              </Tooltip>

              {!currentAgent.is_default && currentAgent.is_active && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={handleSetDefault}
                      disabled={setDefault.isPending}
                    >
                      <Star className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Definir como padrao</TooltipContent>
                </Tooltip>
              )}

              {currentAgent.is_default && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Star className="w-4 h-4 fill-primary text-primary" />
                  </TooltipTrigger>
                  <TooltipContent>Agente padrao</TooltipContent>
                </Tooltip>
              )}

              <div className="w-px h-6 bg-border" />
            </>
          )}

          <Button
            onClick={handleSave}
            disabled={isSaving}
            size="sm"
            className="gap-2"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      {/* ===== Main Content ===== */}
      <div className="flex flex-1 min-h-0">
        {/* ===== Left Column: Tabs (Prompt | Tools | Conhecimento) ===== */}
        <div className="flex flex-col w-[60%] border-r min-h-0">
          <Tabs defaultValue="prompt" className="flex flex-col flex-1 min-h-0">
            <TabsList className="grid w-full grid-cols-8 rounded-none border-b bg-background h-11 shrink-0">
              <TabsTrigger value="prompt" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <FileText className="w-3.5 h-3.5" />
                Prompt
              </TabsTrigger>
              <TabsTrigger value="tools" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <Wrench className="w-3.5 h-3.5" />
                Tools
              </TabsTrigger>
              <TabsTrigger value="funis" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <GitBranch className="w-3.5 h-3.5" />
                Funis
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <BookOpen className="w-3.5 h-3.5" />
                Conhecimento
              </TabsTrigger>
              <TabsTrigger value="followup" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <RefreshCw className="w-3.5 h-3.5" />
                Follow-up
              </TabsTrigger>
              <TabsTrigger value="conexao" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <Plug className="w-3.5 h-3.5" />
                Conexao
              </TabsTrigger>
              <TabsTrigger value="comportamento" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Comportamento
              </TabsTrigger>
              <TabsTrigger value="handoff-notify" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <BellRing className="w-3.5 h-3.5" />
                Notificação
              </TabsTrigger>
              <TabsTrigger value="analysis" className="gap-1.5 data-[state=active]:bg-muted/50 text-xs">
                <Sparkles className="w-3.5 h-3.5" />
                Analise
              </TabsTrigger>
            </TabsList>

            <TabsContent value="prompt" className="flex-1 overflow-y-auto m-0 p-0 data-[state=inactive]:hidden">
              <div className={`border-b ${isEditorExpanded ? "flex-1" : ""}`}>
                <PromptEditor
                  sections={data.promptSections}
                  onSectionsChange={handleSectionsChange}
                  tools={data.tools}
                  toolDefs={PLAYGROUND_TOOLS}
                  documents={data.documents}
                  links={data.links}
                  isExpanded={isEditorExpanded}
                  onToggleExpand={() => setIsEditorExpanded(!isEditorExpanded)}
                />
              </div>
              {!isEditorExpanded && (
                <div className="p-4">
                  <PlaygroundSettings data={data} onChange={updateData} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="tools" className="flex-1 overflow-y-auto m-0 p-4 data-[state=inactive]:hidden">
              <PlaygroundTools
                tools={data.tools}
                onChange={(tools) => updateData({ tools })}
              />
            </TabsContent>

            <TabsContent value="funis" className="flex-1 overflow-y-auto m-0 p-4 data-[state=inactive]:hidden">
              <PlaygroundFunis
                state={data.funis}
                onChange={(funis) => updateData({ funis })}
              />
            </TabsContent>

            <TabsContent value="knowledge" className="flex-1 overflow-y-auto m-0 p-4 data-[state=inactive]:hidden">
              <PlaygroundKnowledge
                documents={data.documents}
                links={data.links}
                onDocumentsChange={(documents) => updateData({ documents })}
                onAddDocuments={(newDocs) => {
                  setData((prev) => ({ ...prev, documents: [...prev.documents, ...newDocs] }));
                  bumpConfigVersion();
                }}
                onLinksChange={(links) => updateData({ links })}
                existingDocuments={existingDocs}
                onDeleteExisting={(docId, filePath) => {
                  if (editId) deleteDocument.mutate({ documentId: docId, filePath, agentId: editId });
                }}
              />
            </TabsContent>

            <TabsContent value="followup" className="flex-1 overflow-y-auto m-0 p-6 data-[state=inactive]:hidden">
              <FollowupSituationsTab organizationId={organizationId || currentAgent?.organization_id} />
            </TabsContent>

            <TabsContent value="conexao" className="flex-1 overflow-y-auto m-0 p-4 data-[state=inactive]:hidden">
              <PlaygroundConexao
                state={conexao}
                onChange={updateConexao}
                agentId={editId}
              />
            </TabsContent>

            <TabsContent value="comportamento" className="flex-1 overflow-y-auto m-0 p-4 data-[state=inactive]:hidden">
              <PlaygroundComportamento
                state={comportamento}
                onChange={updateComportamento}
              />
            </TabsContent>

            <TabsContent value="handoff-notify" className="flex-1 overflow-y-auto m-0 p-4 data-[state=inactive]:hidden">
              <PlaygroundHandoffNotify data={data} onChange={updateData} />
            </TabsContent>

            <TabsContent value="analysis" className="flex-1 overflow-y-auto m-0 p-4 data-[state=inactive]:hidden">
              <PromptAnalysisTab agentId={editId ?? undefined} />
            </TabsContent>
          </Tabs>
        </div>

        {/* ===== Right Column: Live Preview Chat (sempre visivel) ===== */}
        <div className="w-[40%] p-4">
          <LivePreviewChat
            systemPrompt={systemPromptForPreview}
            agentName={data.name}
            isProactive={data.isProactive}
            firstMessageTemplate={data.outboundConfig.firstMessageTemplate}
            configVersion={configVersion}
            agentId={editId}
            playgroundTools={data.tools}
          />
        </div>
      </div>

      {/* Activation without pipes — confirmation dialog */}
      <AlertDialog
        open={pendingActivation}
        onOpenChange={(open) => !open && setPendingActivation(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Agente sem funis configurados
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                O agente <strong>{data.name}</strong> ainda nao tem funis configurados. Ativado assim, ele pode responder a todos os leads da organizacao sem roteamento.
              </span>
              <span className="block">
                Recomendado: configure a aba <strong>Funis</strong> antes de ativar.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingActivation(false)}>
              Cancelar — vou configurar primeiro
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (editId) {
                  toggleAgent.mutate({ id: editId, isActive: true });
                  setPendingActivation(false);
                }
              }}
            >
              Ativar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
    {builderActive && (
      <div className="w-[380px] shrink-0 h-full">
        <BuilderPanel
          agentId={editId}
          toolDefs={builderToolDefs}
          capabilities={builderCapabilities}
          filled={{
            sections: Object.entries(data.promptSections)
              .filter(([, v]) => (v ?? "").trim().length > 0)
              .map(([k]) => k),
            tools: Object.entries(data.tools)
              .filter(([, v]) => v?.enabled)
              .map(([k]) => k),
          }}
          onApplyActions={applyBuilderActions}
          onClose={() => {
            searchParams.delete("builder");
            setSearchParams(searchParams, { replace: true });
          }}
        />
      </div>
    )}
    </div>
  );
}

// =============================================================
// HELPER: Convert playground data to CopilotWizardData for update
// =============================================================

function createWizardDataFromPlayground(data: PlaygroundData, conexaoState?: ConexaoState): any {
  const flatPrompt = sectionsToFlatText(data);
  const objectiveText = data.promptSections.objective || data.promptSections.personality;

  // Persist tool instructions for edit round-trip
  const toolInstructions: Record<string, string> = {};
  for (const [id, state] of Object.entries(data.tools)) {
    if (state.enabled && state.instruction) {
      toolInstructions[id] = state.instruction;
    }
  }

  return {
    templateType: data.templateType || "custom",
    name: data.name,
    personality: { tone: "profissional", style: "consultivo", energy: "moderada" },
    skills: [],
    allowedTopics: [],
    forbiddenTopics: [],
    faqs: [],
    businessContext: {
      companyName: "",
      productSummary: "",
      idealCustomerProfile: "",
      serviceRegion: "",
      valueProps: "",
      customerPains: "",
      socialProof: "",
      pricingPolicy: "",
      commercialTerms: "",
      businessHoursSla: "",
      primaryCta: "",
      compliancePolicy: "",
    },
    conversationStyle: {
      responseLength: "curto",
      maxQuestions: "1",
      emojiPolicy: "raro",
      openingStyle: "",
      closingStyle: "",
      whatsappGuidelines: "",
      humanizationTips: "",
    },
    qualification: { requiredFields: [], optionalFields: [], notes: "" },
    examples: [],
    availability: data.availability,
    behaviorWindows: data.behaviorWindows ?? [],
    behaviorEnforcement: data.behaviorEnforcement ?? "hard",
    responseDelaySeconds: 0,
    mainObjective: objectiveText.slice(0, 200),
    objectiveComposite: { mission: objectiveText.slice(0, 200), success_criteria: "", limits: "" },
    kanbanRules: [],
    operationMode: data.operationMode,
    activationTriggers: data.activationTriggers,
    outboundConfig: {
      ...data.outboundConfig,
      audioEnabled: data.audioEnabled,
      audioSendOrder: data.audioSendOrder,
    },
    automationActions: {
      onQualify: { moveToStage: "", moveToPipe: null, addTags: [], notifyUserId: null, sendMessage: false, messageTemplate: "" },
      onDisqualify: { moveToStage: "", moveToPipe: null, addTags: [], notifyUserId: null, sendMessage: false, messageTemplate: "" },
      onNeedHuman: { moveToStage: "", moveToPipe: null, addTags: [], notifyUserId: null, sendMessage: false, messageTemplate: "" },
    },
    followupRules: [],
    customInstructions: { dos: flatPrompt, donts: "" },
    knowledgeBaseFiles: [],
    canQualifyLead: data.tools.QUALIFICAR_LEAD?.enabled ?? false,
    canScheduleMeeting: data.tools.AGENDAR_REUNIAO?.enabled ?? false,
    canSendFollowup: false,
    canUpdateCrm: false,
    canAnswerFaq: false,
    canCreateLead: data.tools.CRIAR_LEAD?.enabled ?? false,
    canTransferHuman: data.tools.TRANSFERIR_HUMANO?.enabled ?? false,
    canMoveCards: data.tools.MOVER_CARD?.enabled ?? false,
    canSendDocument: data.tools.ENVIAR_DOCUMENTO?.enabled ?? false,
    canTransferSzChat: data.tools.TRANSFERIR_SZ_CHAT?.enabled ?? false,
    humanPauseEnabled: data.tools.PAUSAR_ATENDIMENTO_HUMANO?.enabled ?? true,
    humanPauseDurationMinutes: data.tools.PAUSAR_ATENDIMENTO_HUMANO?.config?.durationMinutes
      ? Number(data.tools.PAUSAR_ATENDIMENTO_HUMANO.config.durationMinutes)
      : 60,
    maxConversationTurns: 20,
    responseDelayMs: data.responseDelayMs,
    attendUnknownContacts: data.attendUnknownContacts ?? true,
    llmTemperatureMode: data.llmTemperatureMode,
    personaDescription: "",
    skillsAndTopics: "",
    // Structured data for round-trip (edit mode)
    promptSections: data.promptSections,
    toolInstructions,
    // Conexao fields
    ...(conexaoState ? {
      whatsappInstanceId: conexaoState.whatsappInstanceId,
      retentionEnabled: conexaoState.retentionEnabled,
      retentionConfig: conexaoState.retentionConfig,
    } : {}),
    // Funis (pipeline config)
    ...(() => {
      const fp = funisStateToPayload(data.funis);
      return {
        activePipes: fp.activePipes,
        activeStages: fp.activeStages,
        moveRules: fp.moveRules,
      };
    })(),
  };
}
