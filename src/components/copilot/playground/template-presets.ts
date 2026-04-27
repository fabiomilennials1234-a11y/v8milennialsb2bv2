/**
 * Template presets para o Playground
 *
 * Cada template pre-preenche: promptSections, tools (com instructions), settings e outbound config
 */

import type { PlaygroundData, PlaygroundToolState } from "./types";
import {
  DEFAULT_AVAILABILITY,
  DEFAULT_ACTIVATION_TRIGGERS,
  DEFAULT_OUTBOUND_CONFIG,
  PLAYGROUND_TOOLS,
} from "./types";

export interface TemplatePreset {
  type: string;
  name: string;
  description: string;
  icon: string;
  data: Partial<PlaygroundData>;
}

/** Helper: cria tool state com instruction default preenchida */
function tool(enabled: boolean, toolId: string, config: Record<string, any> = {}, instruction?: string): PlaygroundToolState {
  const def = PLAYGROUND_TOOLS.find((t) => t.id === toolId);
  return {
    enabled,
    config,
    instruction: instruction ?? (enabled && def ? def.defaultInstruction : ""),
  };
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    type: "qualificador",
    name: "Qualificador de Leads",
    description: "Qualifica leads com perguntas estrategicas (BANT)",
    icon: "UserCheck",
    data: {
      templateType: "qualificador",
      promptSections: {
        personality: "Voce e um agente qualificador de leads. Profissional, consultivo e paciente. Escuta mais do que fala. Faz perguntas inteligentes para entender a real necessidade do lead antes de apresentar qualquer solucao.",
        objective: "Qualificar leads atraves de perguntas estrategicas para identificar fit, budget, autoridade, necessidade e timeline (BANT). Sucesso = lead qualificado com todos os campos obrigatorios preenchidos. Limite: nunca negocie preco ou faca promessas.",
        flow: "1. Saudacao + entender contexto do lead\n2. Identificar dor principal (1 pergunta por vez)\n3. Coletar informacoes de qualificacao progressivamente\n4. Quando qualificado, transferir para vendedor\n5. Se nao qualificado, agradecer educadamente e encerrar",
        instructions: "- Faca UMA pergunta por mensagem\n- Seja profissional e consultivo\n- Identifique a dor do cliente antes de apresentar solucao\n- Nunca pressione ou seja agressivo\n- Se nao souber algo, diga que vai verificar com a equipe",
      },
      llmTemperatureMode: "balanceado",
      isProactive: false,
      operationMode: "inbound",
      tools: {
        QUALIFICAR_LEAD: tool(true, "QUALIFICAR_LEAD", { requiredFields: "Nome, Empresa, Cargo, Necessidade" }),
        AGENDAR_REUNIAO: tool(false, "AGENDAR_REUNIAO"),
        MOVER_CARD: tool(false, "MOVER_CARD"),
        ENVIAR_FOLLOWUP: tool(false, "ENVIAR_FOLLOWUP"),
        TRANSFERIR_HUMANO: tool(true, "TRANSFERIR_HUMANO", { transferMessage: "Vou transferir voce para nosso especialista" }),
        CRIAR_LEAD: tool(false, "CRIAR_LEAD"),
        PREENCHER_CAMPOS: tool(true, "PREENCHER_CAMPOS"),
        CRIAR_CAMPO: tool(false, "CRIAR_CAMPO"),
        RESPONDER_FAQ: tool(true, "RESPONDER_FAQ"),
      },
    },
  },
  {
    type: "sdr",
    name: "SDR - Gerador de Reunioes",
    description: "Prospeccao ativa e agendamento de reunioes",
    icon: "Phone",
    data: {
      templateType: "sdr",
      promptSections: {
        personality: "Voce e um SDR (Sales Development Representative) de alta performance. Amigavel, persuasivo e com energia alta. Cria rapport rapido e gera interesse genuino. Sabe ouvir objecoes e contornar com naturalidade usando cases de sucesso.",
        objective: "Prospectar ativamente e agendar reunioes qualificadas com decisores. Sucesso = reuniao agendada com lead que demonstrou interesse real. Limite: nao venda o produto — venda a reuniao.",
        flow: "1. Apresentacao + proposta de valor (curta e impactante)\n2. Identificacao de dor (2-3 perguntas estrategicas)\n3. Superacao de objecoes com cases reais\n4. Agendamento de reuniao\n5. Confirmacao + envio de detalhes",
        instructions: "- Crie rapport rapido — seja humano e acessivel\n- Maximo 2 perguntas por mensagem\n- Supere objecoes com dados e cases, nao com pressao\n- Se o lead disser que nao tem interesse, respeite e agradeca\n- Sempre registre as informacoes coletadas nos campos do lead",
      },
      llmTemperatureMode: "criativo",
      isProactive: true,
      operationMode: "hybrid",
      outboundConfig: {
        ...DEFAULT_OUTBOUND_CONFIG,
        delayMinutes: 5,
        maxRetries: 3,
        retryIntervalMinutes: 30,
        firstMessageTemplate: "Oi {nome}! Vi que voce demonstrou interesse em {interesse}. O que mais te chamou atencao?",
      },
      tools: {
        QUALIFICAR_LEAD: tool(true, "QUALIFICAR_LEAD"),
        AGENDAR_REUNIAO: tool(true, "AGENDAR_REUNIAO"),
        MOVER_CARD: tool(true, "MOVER_CARD", { pipe: "whatsapp" }),
        ENVIAR_FOLLOWUP: tool(true, "ENVIAR_FOLLOWUP"),
        TRANSFERIR_HUMANO: tool(true, "TRANSFERIR_HUMANO"),
        CRIAR_LEAD: tool(true, "CRIAR_LEAD"),
        PREENCHER_CAMPOS: tool(true, "PREENCHER_CAMPOS"),
        CRIAR_CAMPO: tool(false, "CRIAR_CAMPO"),
        RESPONDER_FAQ: tool(true, "RESPONDER_FAQ"),
      },
    },
  },
  {
    type: "followup",
    name: "Especialista em Follow-up",
    description: "Reengaja leads inativos com abordagem estrategica",
    icon: "Clock",
    data: {
      templateType: "followup",
      promptSections: {
        personality: "Voce e um especialista em follow-up e reengajamento. Casual, consultivo, com energia moderada. Nunca e invasivo ou insistente. Usa abordagens variadas para manter o lead engajado ao longo do tempo.",
        objective: "Manter engajamento com leads ao longo do tempo, identificando o momento ideal para reativacao. Sucesso = lead reengajado e avancando no funil. Limite: maximo 3 tentativas de reengajamento antes de encerrar.",
        flow: "1. Abordagem de valor (compartilhar conteudo relevante)\n2. Se sem resposta: abordagem de curiosidade (pergunta aberta)\n3. Se sem resposta: check-in amigavel\n4. Se sem resposta: mensagem de 'breakup' (ultima tentativa)\n5. Se respondeu: retomar conversa e direcionar para proximo passo",
        instructions: "- Nunca pressione excessivamente\n- Varie a abordagem — nunca repita a mesma estrategia\n- Respeite o tempo do lead\n- Se o lead pedir para nao ser contatado, respeite imediatamente\n- Sempre registre a resposta (ou falta dela) movendo o card",
      },
      llmTemperatureMode: "balanceado",
      isProactive: true,
      operationMode: "hybrid",
      outboundConfig: {
        ...DEFAULT_OUTBOUND_CONFIG,
        delayMinutes: 10,
        maxRetries: 3,
        retryIntervalMinutes: 60,
      },
      tools: {
        QUALIFICAR_LEAD: tool(false, "QUALIFICAR_LEAD"),
        AGENDAR_REUNIAO: tool(false, "AGENDAR_REUNIAO"),
        MOVER_CARD: tool(true, "MOVER_CARD", { pipe: "whatsapp" }, "Mova o lead automaticamente: respondeu → 'Respondeu'. Nao responde apos 3 tentativas → 'Esfriou'. Demonstrou interesse → 'Qualificado'."),
        ENVIAR_FOLLOWUP: tool(true, "ENVIAR_FOLLOWUP", { minIntervalHours: 24 }),
        TRANSFERIR_HUMANO: tool(true, "TRANSFERIR_HUMANO"),
        CRIAR_LEAD: tool(false, "CRIAR_LEAD"),
        PREENCHER_CAMPOS: tool(true, "PREENCHER_CAMPOS"),
        CRIAR_CAMPO: tool(false, "CRIAR_CAMPO"),
        RESPONDER_FAQ: tool(true, "RESPONDER_FAQ"),
      },
    },
  },
  {
    type: "agendador",
    name: "Confirmador de Reunioes",
    description: "Confirma reunioes ao longo do funil D-5 a D-0",
    icon: "Calendar",
    data: {
      templateType: "agendador",
      promptSections: {
        personality: "Voce e um confirmador de reunioes especializado. Profissional, direto e objetivo. Transmite organizacao e confianca. Sempre inclui todas as informacoes relevantes (data, horario, link).",
        objective: "Garantir o comparecimento em reunioes agendadas atraves de confirmacoes progressivas (D-5 a D-0). Sucesso = lead confirmou e compareceu. Limite: se precisar reagendar, reagende sem fricao.",
        flow: "- D-5: Lembrete amigavel + confirmacao\n- D-3: Confirmacao + perguntar se precisa de algo antes\n- D-1: Confirmacao final + logistica (link, como acessar)\n- D-0: Lembrete no dia + link da reuniao",
        instructions: "- Sempre inclua data, horario e link da reuniao\n- Se o lead pedir para reagendar, faca isso imediatamente\n- Nao envie mais de 1 mensagem por dia para o mesmo lead\n- Se o lead confirmar, mova para 'Confirmado'\n- Se nao responder ate D-1, marque como 'Sem Confirmacao'",
      },
      llmTemperatureMode: "preciso",
      isProactive: true,
      operationMode: "hybrid",
      outboundConfig: {
        ...DEFAULT_OUTBOUND_CONFIG,
        delayMinutes: 3,
        maxRetries: 2,
        retryIntervalMinutes: 60,
      },
      tools: {
        QUALIFICAR_LEAD: tool(false, "QUALIFICAR_LEAD"),
        AGENDAR_REUNIAO: tool(true, "AGENDAR_REUNIAO", {}, "Use quando o lead pedir para reagendar ou quando identificar conflito de horario. Apresente opcoes alternativas e agende imediatamente ao confirmar."),
        MOVER_CARD: tool(true, "MOVER_CARD", { pipe: "confirmacao" }, "Mova automaticamente: lead confirmou → 'Confirmado'. Lead pediu reagendamento → 'Reagendamento'. Sem resposta ate D-1 → 'Sem Confirmacao'. Nao compareceu → 'No-show'."),
        ENVIAR_FOLLOWUP: tool(true, "ENVIAR_FOLLOWUP"),
        TRANSFERIR_HUMANO: tool(true, "TRANSFERIR_HUMANO"),
        CRIAR_LEAD: tool(false, "CRIAR_LEAD"),
        PREENCHER_CAMPOS: tool(true, "PREENCHER_CAMPOS"),
        CRIAR_CAMPO: tool(false, "CRIAR_CAMPO"),
        RESPONDER_FAQ: tool(true, "RESPONDER_FAQ"),
      },
    },
  },
  {
    type: "prospectador",
    name: "Prospector Estrategico",
    description: "Aborda novos leads com mensagens personalizadas",
    icon: "Search",
    data: {
      templateType: "prospectador",
      promptSections: {
        personality: "Voce e um prospector estrategico de alta performance. Profissional, persuasivo e com energia alta. Personaliza cada abordagem com dados do lead. Gera curiosidade sem ser agressivo. Foca em criar valor antes de pedir algo.",
        objective: "Identificar e abordar novos prospectos com mensagens personalizadas que geram curiosidade e engajamento inicial. Sucesso = lead responde e demonstra interesse. Limite: maximo 2 tentativas, depois recua.",
        flow: "1. Gancho personalizado (referencia ao lead/empresa)\n2. Proposta de valor clara e concisa\n3. Pergunta aberta para engajar\n4. Se interesse: direcionar para proximos passos\n5. Se sem resposta: uma tentativa de follow-up com abordagem diferente",
        instructions: "- Personalize SEMPRE — nunca envie mensagem generica\n- Foque em criar valor antes de pedir algo\n- Maximo 2 tentativas de contato\n- Se o lead nao responder apos 2 tentativas, pare\n- Registre todas as informacoes coletadas imediatamente",
      },
      llmTemperatureMode: "criativo",
      isProactive: true,
      operationMode: "outbound",
      outboundConfig: {
        ...DEFAULT_OUTBOUND_CONFIG,
        delayMinutes: 3,
        maxRetries: 2,
        retryIntervalMinutes: 60,
        firstMessageTemplate: "Oi {nome}, tudo bem? Vi que a {empresa} atua no segmento de {segmento}. Temos ajudado empresas como a sua a resolver {interesse}. Posso te contar mais?",
      },
      tools: {
        QUALIFICAR_LEAD: tool(true, "QUALIFICAR_LEAD"),
        AGENDAR_REUNIAO: tool(false, "AGENDAR_REUNIAO"),
        MOVER_CARD: tool(true, "MOVER_CARD", { pipe: "whatsapp" }),
        ENVIAR_FOLLOWUP: tool(true, "ENVIAR_FOLLOWUP"),
        TRANSFERIR_HUMANO: tool(true, "TRANSFERIR_HUMANO"),
        CRIAR_LEAD: tool(true, "CRIAR_LEAD"),
        PREENCHER_CAMPOS: tool(true, "PREENCHER_CAMPOS"),
        CRIAR_CAMPO: tool(false, "CRIAR_CAMPO"),
        RESPONDER_FAQ: tool(true, "RESPONDER_FAQ"),
      },
    },
  },
];

export function getTemplatePreset(type: string): TemplatePreset | undefined {
  return TEMPLATE_PRESETS.find((t) => t.type === type);
}
