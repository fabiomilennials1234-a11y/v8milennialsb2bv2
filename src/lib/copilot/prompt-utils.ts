/**
 * Utilitários para preview do prompt no wizard
 *
 * Converte dados do formulário (CopilotWizardData) para o formato
 * que generatePrompt() aceita (CopilotAgent), permitindo gerar
 * preview em tempo real durante a criação/edição.
 */

import type { CopilotWizardData, CopilotAgent, CopilotAgentFaq } from "@/types/copilot";

/**
 * Converte dados do wizard para um pseudo-CopilotAgent que generatePrompt() aceita.
 * Campos ausentes recebem defaults seguros.
 */
export function mapWizardDataToAgentPreview(data: CopilotWizardData): {
  agent: CopilotAgent;
  faqs: CopilotAgentFaq[];
} {
  const agent = {
    id: "preview",
    name: data.name || "Agente Preview",
    template_type: data.templateType || "custom",
    personality_tone: data.personality?.tone || "profissional",
    personality_style: data.personality?.style || "consultivo",
    personality_energy: data.personality?.energy || "moderada",
    main_objective: data.objectiveComposite?.mission || data.mainObjective || "",
    objective_composite: data.objectiveComposite?.mission
      ? data.objectiveComposite
      : null,
    custom_instructions: data.customInstructions || null,
    business_context: data.businessContext || {},
    conversation_style: data.conversationStyle || {},
    qualification_rules: data.qualification || {},
    skills: data.skills || [],
    allowed_topics: data.allowedTopics || [],
    forbidden_topics: data.forbiddenTopics || [],
    few_shot_examples: data.examples || [],
    availability: data.availability || {},
    response_delay_seconds: data.responseDelaySeconds || 0,
    system_prompt: null,
    system_prompt_version: 1,
    is_active: false,
    is_default: false,
    organization_id: "",
    created_by: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as CopilotAgent;

  const faqs: CopilotAgentFaq[] = (data.faqs || [])
    .filter((f) => f.question && f.answer)
    .map((f, i) => ({
      id: `faq-${i}`,
      agent_id: "preview",
      question: f.question,
      answer: f.answer,
      position: i,
      created_at: new Date().toISOString(),
    })) as CopilotAgentFaq[];

  return { agent, faqs };
}
