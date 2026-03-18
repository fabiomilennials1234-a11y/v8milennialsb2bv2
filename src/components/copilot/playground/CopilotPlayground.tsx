/**
 * CopilotPlayground — Tela unica para criar/editar copilots
 *
 * Layout: 2 colunas (60/40)
 * - Esquerda: Prompt editor + paineis colapsaveis (Settings, Tools, Conhecimento)
 * - Direita: Chat de teste (Live Preview)
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Save, Loader2, ChevronLeft, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PromptEditor } from "./PromptEditor";
import { PlaygroundSettings } from "./PlaygroundSettings";
import { PlaygroundTools } from "./PlaygroundTools";
import { PlaygroundKnowledge } from "./PlaygroundKnowledge";
import { LivePreviewChat } from "./LivePreviewChat";
import { TEMPLATE_PRESETS, getTemplatePreset } from "./template-presets";
import {
  PLAYGROUND_TOOLS,
  createDefaultPlaygroundData,
  type PlaygroundData,
  type KnowledgeDocument,
  type KnowledgeLink,
} from "./types";

import {
  useCreateCopilotAgent,
  useCopilotAgentForEdit,
  useUpdateCopilotAgentFromWizard,
} from "@/hooks/useCopilotAgents";
import { useUploadAgentDocument } from "@/hooks/useAgentDocuments";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";

// =============================================================
// HELPER: Build system prompt from playground data
// =============================================================

/**
 * Resolve @menções no prompt, substituindo por instruções que o LLM entende.
 * - @TOOL_ID → instrução de uso da ferramenta (se ativa) ou nome legível
 * - @link_id → alias (URL)
 * - @doc_id → referência ao documento
 */
function resolveMentions(prompt: string, data: PlaygroundData): string {
  let resolved = prompt;

  // Resolve @mentions de tools
  for (const toolDef of PLAYGROUND_TOOLS) {
    const state = data.tools[toolDef.id];
    const mentionRegex = new RegExp(`@${toolDef.id}`, "g");

    if (state?.enabled) {
      resolved = resolved.replace(mentionRegex, `[usar ferramenta "${toolDef.name}"]`);
    } else {
      resolved = resolved.replace(mentionRegex, toolDef.name);
    }
  }

  // Resolve @mentions de links — substituir pelo link real
  for (const link of data.links) {
    const linkMentionRegex = new RegExp(`@${link.id}`, "g");
    resolved = resolved.replace(linkMentionRegex, `${link.alias} (${link.url})`);
  }

  // Resolve @mentions de documentos
  for (const doc of data.documents) {
    const docMentionRegex = new RegExp(`@${doc.id}`, "g");
    resolved = resolved.replace(docMentionRegex, `[documento: ${doc.name}]`);
  }

  return resolved;
}

function buildSystemPrompt(data: PlaygroundData): string {
  let prompt = resolveMentions(data.prompt, data);

  // Append links como recursos disponíveis para enviar
  if (data.links.length > 0) {
    prompt += "\n\n## Links disponiveis para enviar ao lead:\n";
    for (const link of data.links) {
      prompt += `- ${link.alias}: ${link.url}\n`;
    }
    prompt += "\nIMPORTANTE: Quando relevante, envie o link completo na mensagem para o lead poder clicar.\n";
  }

  return prompt;
}

// =============================================================
// HELPER: Convert playground data to agent payload
// =============================================================

function playgroundToAgentPayload(data: PlaygroundData) {
  const activeTools = Object.entries(data.tools)
    .filter(([_, state]) => state.enabled)
    .map(([id]) => id);

  const systemPrompt = buildSystemPrompt(data);

  return {
    agent: {
      name: data.name,
      template_type: data.templateType || "custom",
      system_prompt: systemPrompt,
      system_prompt_version: 1,
      personality_tone: "profissional",
      personality_style: "consultivo",
      personality_energy: "moderada",
      main_objective: data.prompt.slice(0, 200),
      skills: activeTools,
      allowed_topics: [],
      forbidden_topics: [],
      operation_mode: data.operationMode,
      activation_triggers: data.isProactive ? data.activationTriggers : null,
      outbound_config: data.isProactive ? {
        ...data.outboundConfig,
        audioEnabled: data.audioEnabled,
        audioSendOrder: data.audioSendOrder,
      } : null,
      availability: data.availability,
      response_delay_ms: data.responseDelayMs,
      llm_temperature_mode: data.llmTemperatureMode,
      can_qualify_lead: data.tools.QUALIFICAR_LEAD?.enabled ?? false,
      can_schedule_meeting: data.tools.AGENDAR_REUNIAO?.enabled ?? false,
      can_send_followup: data.tools.ENVIAR_FOLLOWUP?.enabled ?? false,
      can_update_lead: data.tools.PREENCHER_CAMPOS?.enabled ?? false,
      can_update_crm: false,
      can_answer_faq: data.tools.RESPONDER_FAQ?.enabled ?? false,
      can_create_lead: data.tools.CRIAR_LEAD?.enabled ?? false,
      can_transfer_human: data.tools.TRANSFERIR_HUMANO?.enabled ?? false,
      can_move_cards: data.tools.MOVER_CARD?.enabled ?? false,
      max_conversation_turns: 20,
      business_context: {},
      conversation_style: {},
      custom_instructions: resolveMentions(data.prompt, data),
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

  const [data, setData] = useState<PlaygroundData>(createDefaultPlaygroundData());
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);
  const configVersionTimerRef = useRef<NodeJS.Timeout>();

  const createAgent = useCreateCopilotAgent();
  const updateAgent = useUpdateCopilotAgentFromWizard();
  const uploadDocument = useUploadAgentDocument();
  const { data: editData, isLoading: isLoadingEdit } = useCopilotAgentForEdit(editId);

  // Load edit data
  useEffect(() => {
    if (!editData?.wizardData) return;

    const wd = editData.wizardData;
    setData((prev) => ({
      ...prev,
      name: wd.name,
      templateType: wd.templateType,
      prompt: wd.customInstructions?.dos || wd.mainObjective || "",
      llmTemperatureMode: wd.llmTemperatureMode || "balanceado",
      responseDelayMs: wd.responseDelayMs || 1000,
      availability: wd.availability || prev.availability,
      isProactive: wd.operationMode !== "inbound",
      operationMode: wd.operationMode || "inbound",
      activationTriggers: wd.activationTriggers || prev.activationTriggers,
      outboundConfig: wd.outboundConfig || prev.outboundConfig,
      audioEnabled: wd.outboundConfig?.audioEnabled || false,
      audioSendOrder: wd.outboundConfig?.audioSendOrder || "text_first",
      agentId: editId,
      tools: {
        QUALIFICAR_LEAD: { enabled: wd.canQualifyLead, config: {} },
        AGENDAR_REUNIAO: { enabled: wd.canScheduleMeeting, config: {} },
        MOVER_CARD: { enabled: wd.canMoveCards, config: {} },
        ENVIAR_FOLLOWUP: { enabled: wd.canSendFollowup, config: {} },
        TRANSFERIR_HUMANO: { enabled: wd.canTransferHuman, config: {} },
        CRIAR_LEAD: { enabled: wd.canCreateLead, config: {} },
        PREENCHER_CAMPOS: { enabled: true, config: {} },
        CRIAR_CAMPO: { enabled: false, config: {} },
        RESPONDER_FAQ: { enabled: wd.canAnswerFaq, config: {} },
      },
      documents: (editData.existingDocuments || []).map((d) => ({
        id: d.id,
        name: d.file_name,
        status: "ready" as const,
        existingId: d.id,
        filePath: d.file_path,
      })),
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

  // Template selection
  const handleTemplateChange = useCallback(
    (type: string) => {
      if (type === "blank") {
        setData(createDefaultPlaygroundData());
        return;
      }
      const preset = getTemplatePreset(type);
      if (!preset) return;

      setData({
        ...createDefaultPlaygroundData(),
        ...preset.data,
        name: data.name, // keep current name
      } as PlaygroundData);
      bumpConfigVersion();
    },
    [data.name, bumpConfigVersion]
  );

  // Build system prompt for preview
  const systemPromptForPreview = useMemo(() => buildSystemPrompt(data), [data]);

  // Save
  const handleSave = async () => {
    // Validation
    if (!data.name.trim()) {
      toast.error("Nome obrigatorio", { description: "Informe um nome para o agente." });
      return;
    }
    if (data.prompt.trim().length < 10) {
      toast.error("Prompt muito curto", { description: "Escreva pelo menos algumas instrucoes para o agente." });
      return;
    }
    // firstMessageTemplate é opcional — se vazio, o copilot gera a mensagem via IA

    setIsSaving(true);

    try {
      const payload = playgroundToAgentPayload(data);

      if (isEditMode && editId) {
        // Update existing agent
        await updateAgent.mutateAsync({
          agentId: editId,
          data: {
            ...createWizardDataFromPlayground(data),
          },
          documentsToRemove: [],
        });
      } else {
        // Create new agent
        const agent = await createAgent.mutateAsync(payload);

        // Upload pending documents
        if (agent?.id) {
          for (const doc of data.documents) {
            if (doc.file && doc.status === "pending") {
              try {
                await uploadDocument.mutateAsync({
                  agentId: agent.id,
                  file: doc.file,
                });
              } catch (e) {
                console.warn("Erro ao fazer upload de documento:", e);
              }
            }
          }
        }
      }

      navigate("/copilot");
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-4rem)]"
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

          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <Select
              value={data.templateType || "blank"}
              onValueChange={handleTemplateChange}
            >
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Selecione template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Em branco</SelectItem>
                {TEMPLATE_PRESETS.map((t) => (
                  <SelectItem key={t.type} value={t.type}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Input
            value={data.name}
            onChange={(e) => updateData({ name: e.target.value })}
            placeholder="Nome do agente..."
            className="w-64 h-8 text-sm"
          />
        </div>

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

      {/* ===== Main Content ===== */}
      <div className="flex flex-1 min-h-0">
        {/* ===== Left Column: Prompt + Panels ===== */}
        <div className="flex flex-col w-[60%] border-r overflow-y-auto">
          {/* Prompt Editor */}
          <div className={`border-b ${isEditorExpanded ? "flex-1" : ""}`}>
            <PromptEditor
              value={data.prompt}
              onChange={(prompt) => updateData({ prompt })}
              tools={data.tools}
              toolDefs={PLAYGROUND_TOOLS}
              documents={data.documents}
              links={data.links}
              isExpanded={isEditorExpanded}
              onToggleExpand={() => setIsEditorExpanded(!isEditorExpanded)}
            />
          </div>

          {/* Collapsible panels (hidden when editor is expanded) */}
          {!isEditorExpanded && (
            <div className="p-4 space-y-4">
              <PlaygroundSettings data={data} onChange={updateData} />

              <PlaygroundTools
                tools={data.tools}
                onChange={(tools) => updateData({ tools })}
              />

              <PlaygroundKnowledge
                documents={data.documents}
                links={data.links}
                onDocumentsChange={(documents) => updateData({ documents })}
                onLinksChange={(links) => updateData({ links })}
              />
            </div>
          )}
        </div>

        {/* ===== Right Column: Live Preview Chat ===== */}
        <div className="w-[40%] p-4">
          <LivePreviewChat
            systemPrompt={systemPromptForPreview}
            agentName={data.name}
            isProactive={data.isProactive}
            firstMessageTemplate={data.outboundConfig.firstMessageTemplate}
            configVersion={configVersion}
          />
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================
// HELPER: Convert playground data to CopilotWizardData for update
// =============================================================

function createWizardDataFromPlayground(data: PlaygroundData): any {
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
    responseDelaySeconds: 0,
    mainObjective: data.prompt.slice(0, 200),
    objectiveComposite: { mission: data.prompt.slice(0, 200), success_criteria: "", limits: "" },
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
    customInstructions: { dos: resolveMentions(data.prompt, data), donts: "" },
    knowledgeBaseFiles: [],
    canQualifyLead: data.tools.QUALIFICAR_LEAD?.enabled ?? false,
    canScheduleMeeting: data.tools.AGENDAR_REUNIAO?.enabled ?? false,
    canSendFollowup: data.tools.ENVIAR_FOLLOWUP?.enabled ?? false,
    canUpdateCrm: false,
    canAnswerFaq: data.tools.RESPONDER_FAQ?.enabled ?? false,
    canCreateLead: data.tools.CRIAR_LEAD?.enabled ?? false,
    canTransferHuman: data.tools.TRANSFERIR_HUMANO?.enabled ?? false,
    canMoveCards: data.tools.MOVER_CARD?.enabled ?? false,
    maxConversationTurns: 20,
    responseDelayMs: data.responseDelayMs,
    attendUnknownContacts: false,
    llmTemperatureMode: data.llmTemperatureMode,
    personaDescription: "",
    skillsAndTopics: "",
  };
}
