/**
 * Step Registry - mapeia IDs de steps para componentes
 *
 * Cada step tem um ID único, componente React, título e campo de validação.
 * Os wizard configs referenciam steps por ID.
 */

import { NameStep } from "../wizard-steps/NameStep";
import { PersonalityStep } from "../wizard-steps/PersonalityStep";
import { SkillsStep } from "../wizard-steps/SkillsStep";
import { AllowedTopicsStep } from "../wizard-steps/AllowedTopicsStep";
import { ForbiddenTopicsStep } from "../wizard-steps/ForbiddenTopicsStep";
import { FaqStep } from "../wizard-steps/FaqStep";
import { BusinessContextStep } from "../wizard-steps/BusinessContextStep";
import { ConversationStyleStep } from "../wizard-steps/ConversationStyleStep";
import { QualificationStep } from "../wizard-steps/QualificationStep";
import { ExamplesStep } from "../wizard-steps/ExamplesStep";
import { AvailabilityStep } from "../wizard-steps/AvailabilityStep";
import { ObjectiveStep } from "../wizard-steps/ObjectiveStep";
import { ObjectiveCompositeStep } from "../wizard-steps/ObjectiveCompositeStep";
import { OperationModeStep } from "../wizard-steps/OperationModeStep";
import { ActivationTriggersStep } from "../wizard-steps/ActivationTriggersStep";
import { OutboundConfigStep } from "../wizard-steps/OutboundConfigStep";
import { AutomationActionsStep } from "../wizard-steps/AutomationActionsStep";
import { FollowupRulesStep } from "../wizard-steps/FollowupRulesStep";
import { MeetingConfirmationStep } from "../wizard-steps/MeetingConfirmationStep";
import { FollowupActionsStep } from "../wizard-steps/FollowupActionsStep";
import { ConfirmationFunnelStep } from "../wizard-steps/ConfirmationFunnelStep";
import { ConfirmerActionsStep } from "../wizard-steps/ConfirmerActionsStep";
import { CustomInstructionsStep } from "../wizard-steps/CustomInstructionsStep";
import { KnowledgeBaseStep } from "../wizard-steps/KnowledgeBaseStep";
import { AgentCapabilitiesStep } from "../wizard-steps/AgentCapabilitiesStep";
import { KanbanRulesReviewStep } from "../wizard-steps/KanbanRulesReviewStep";
import { TestConversationStep } from "../wizard-steps/TestConversationStep";
import { PersonaTomStep } from "../wizard-steps/PersonaTomStep";
import { ObjectiveInstructionsStep } from "../wizard-steps/ObjectiveInstructionsStep";
import { RulesLimitsStep } from "../wizard-steps/RulesLimitsStep";
import type { StepRegistryEntry } from "./types";

export const STEP_REGISTRY: Record<string, StepRegistryEntry> = {
  name: {
    component: NameStep,
    title: "Nome",
    fieldToValidate: "name",
  },
  personality: {
    component: PersonalityStep,
    title: "Personalidade",
    fieldToValidate: "personality",
  },
  skills: {
    component: SkillsStep,
    title: "Habilidades",
    fieldToValidate: "skills",
  },
  allowedTopics: {
    component: AllowedTopicsStep,
    title: "Permitidos",
    fieldToValidate: "allowedTopics",
  },
  forbiddenTopics: {
    component: ForbiddenTopicsStep,
    title: "Proibidos",
    fieldToValidate: "forbiddenTopics",
  },
  faqs: {
    component: FaqStep,
    title: "FAQs",
    fieldToValidate: "faqs",
  },
  businessContext: {
    component: BusinessContextStep,
    title: "Negócio",
    fieldToValidate: "businessContext",
  },
  conversationStyle: {
    component: ConversationStyleStep,
    title: "Estilo",
    fieldToValidate: "conversationStyle",
  },
  qualification: {
    component: QualificationStep,
    title: "Qualificação",
    fieldToValidate: "qualification",
  },
  examples: {
    component: ExamplesStep,
    title: "Exemplos",
    fieldToValidate: "examples",
  },
  availability: {
    component: AvailabilityStep,
    title: "Disponibilidade",
    fieldToValidate: "availability",
  },
  objective: {
    component: ObjectiveStep,
    title: "Objetivo",
    fieldToValidate: "mainObjective",
  },
  objectiveComposite: {
    component: ObjectiveCompositeStep,
    title: "Objetivo",
    fieldToValidate: "objectiveComposite",
  },
  operationMode: {
    component: OperationModeStep,
    title: "Modo BDR",
    fieldToValidate: "operationMode",
  },
  activationTriggers: {
    component: ActivationTriggersStep,
    title: "Gatilhos",
    fieldToValidate: "activationTriggers",
  },
  outboundConfig: {
    component: OutboundConfigStep,
    title: "Outbound",
    fieldToValidate: "outboundConfig",
  },
  automationActions: {
    component: AutomationActionsStep,
    title: "Ações",
    fieldToValidate: "automationActions",
  },
  followupRules: {
    component: FollowupRulesStep,
    title: "Follow-up",
    fieldToValidate: "followupRules",
  },
  meetingConfirmation: {
    component: MeetingConfirmationStep,
    title: "Confirmação",
    fieldToValidate: "automationActions",
  },
  followupActions: {
    component: FollowupActionsStep,
    title: "Ações",
    fieldToValidate: "automationActions",
  },
  confirmationFunnel: {
    component: ConfirmationFunnelStep,
    title: "Funil",
    fieldToValidate: "kanbanRules",
  },
  confirmerActions: {
    component: ConfirmerActionsStep,
    title: "Ações",
    fieldToValidate: "automationActions",
  },
  customInstructions: {
    component: CustomInstructionsStep,
    title: "Instruções",
    fieldToValidate: "customInstructions",
  },
  knowledgeBase: {
    component: KnowledgeBaseStep,
    title: "Documentos",
    fieldToValidate: "knowledgeBaseFiles",
  },
  capabilities: {
    component: AgentCapabilitiesStep,
    title: "Capacidades",
    fieldToValidate: "canQualifyLead",
  },
  kanbanRulesReview: {
    component: KanbanRulesReviewStep,
    title: "Kanban",
    fieldToValidate: "kanbanRules",
  },
  testConversation: {
    component: TestConversationStep,
    title: "Testar",
    fieldToValidate: "name", // step opcional, valida só name
  },
  // ===== Wizard v3 — Steps Reestruturados =====
  personaTom: {
    component: PersonaTomStep,
    title: "Persona",
    fieldToValidate: "personaDescription",
  },
  objectiveInstructions: {
    component: ObjectiveInstructionsStep,
    title: "Objetivo",
    fieldToValidate: "objectiveComposite",
  },
  rulesLimits: {
    component: RulesLimitsStep,
    title: "Regras",
    fieldToValidate: "skillsAndTopics",
  },
};
