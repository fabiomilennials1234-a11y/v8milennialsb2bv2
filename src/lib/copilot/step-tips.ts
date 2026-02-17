/**
 * Context Tips por Step do Wizard
 *
 * Cada step tem uma dica contextual que explica
 * o impacto daquele campo no prompt final.
 */

export interface StepTip {
  title: string;
  body: string;
}

export const STEP_TIPS: Record<string, StepTip> = {
  name: {
    title: "Por que o nome importa?",
    body: "O nome do agente aparece no prompt como identidade. Leads veem este nome nas conversas. Escolha algo profissional e memorável.",
  },
  personality: {
    title: "Como a personalidade afeta o prompt?",
    body: "Tom, estilo e energia definem como o agente se comunica. Um tom 'casual' gera respostas mais descontraídas, enquanto 'formal' mantém distância profissional.",
  },
  skills: {
    title: "Habilidades guiam o comportamento",
    body: "As habilidades listadas aqui aparecem no prompt como capacidades do agente. Ele priorizará ações alinhadas com essas habilidades.",
  },
  allowedTopics: {
    title: "Tópicos permitidos = escopo",
    body: "O agente só discutirá sobre estes tópicos. Quanto mais específicos, mais focado e assertivo ele será nas respostas.",
  },
  forbiddenTopics: {
    title: "Tópicos proibidos = proteção",
    body: "O agente recusará educadamente discutir estes temas. Use para evitar promessas indevidas, preços não autorizados ou concorrentes.",
  },
  faqs: {
    title: "FAQs são o conhecimento do agente",
    body: "Estas respostas são usadas como base quando o lead faz perguntas similares. Quanto mais completas, menos o agente 'improvisa'.",
  },
  businessContext: {
    title: "Contexto = precisão",
    body: "Este é o campo mais impactante no prompt. Produto, ICP, dores e proposta de valor são usados para personalizar cada resposta do agente.",
  },
  conversationStyle: {
    title: "Estilo define o formato",
    body: "Controla tamanho das respostas, uso de emojis e como o agente abre/fecha mensagens. Impacta diretamente a experiência no WhatsApp.",
  },
  qualification: {
    title: "Qualificação direciona as perguntas",
    body: "Os campos obrigatórios aqui definem o que o agente DEVE descobrir antes de qualificar. Priorize os critérios mais importantes.",
  },
  examples: {
    title: "Exemplos calibram o tom",
    body: "O agente imita o estilo dos exemplos fornecidos. 3 exemplos bons são mais valiosos que 10 genéricos. Use conversas reais como base.",
  },
  availability: {
    title: "Disponibilidade informa o lead",
    body: "O agente comunica seus horários ao lead quando relevante. Também define expectativas de tempo de resposta.",
  },
  objectiveComposite: {
    title: "Objetivo em 3 partes = clareza total",
    body: "Missão diz O QUE fazer. Critério diz QUANDO deu certo. Limites dizem O QUE NÃO fazer. Juntos, eliminam ambiguidade do comportamento.",
  },
  customInstructions: {
    title: "Suas regras, sua voz",
    body: "Instruções personalizadas são adicionadas ao final do prompt com prioridade alta. Use para regras de compliance, exceções e jargões.",
  },
  operationMode: {
    title: "Inbound vs Outbound",
    body: "Inbound: o agente responde quando procurado. Outbound: o agente inicia contato. Hybrid: faz ambos. Muda completamente o comportamento.",
  },
  activationTriggers: {
    title: "Filtros de ativação",
    body: "Define quais leads o agente aborda automaticamente. Tags, origens e condições customizadas controlam quando o agente entra em ação.",
  },
  outboundConfig: {
    title: "Primeira impressão outbound",
    body: "O template da primeira mensagem e o delay definem como o agente inicia o contato. Personalize com variáveis do lead.",
  },
  automationActions: {
    title: "Ações automáticas",
    body: "Define o que acontece quando o agente qualifica, desqualifica ou precisa de humano. Inclui mover cards, adicionar tags e notificações.",
  },
  followupRules: {
    title: "Regras de follow-up",
    body: "Controla quando e como o agente retoma contato com leads inativos. Cada regra tem gatilho, estilo e limites específicos.",
  },
  confirmationFunnel: {
    title: "Funil de confirmação",
    body: "Define as regras de comportamento em cada etapa de confirmação (D-5, D-3, D-1, Dia). O agente segue esta sequência automaticamente.",
  },
  knowledgeBase: {
    title: "Documentos ampliam o conhecimento",
    body: "Documentos enviados aqui são processados por IA para gerar resumos. Esses resumos são injetados no prompt, permitindo que o agente responda com informações específicas da sua empresa, produtos e políticas.",
  },
  capabilities: {
    title: "Permissões definem os poderes",
    body: "Cada capacidade ativada dá ao agente uma ferramenta real no runtime. Se 'Agendar Reuniões' está desligado, o agente nem tenta agendar. Menos permissões = agente mais focado e previsível.",
  },
};
