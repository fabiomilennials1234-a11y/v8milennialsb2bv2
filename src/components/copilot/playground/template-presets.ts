/**
 * Template presets para o Playground
 *
 * Cada template pre-preenche: prompt, tools, settings e outbound config
 */

import type { PlaygroundData, PlaygroundToolState } from "./types";
import {
  DEFAULT_AVAILABILITY,
  DEFAULT_ACTIVATION_TRIGGERS,
  DEFAULT_OUTBOUND_CONFIG,
} from "./types";

export interface TemplatePreset {
  type: string;
  name: string;
  description: string;
  icon: string;
  data: Partial<PlaygroundData>;
}

const BASE_TOOLS_INBOUND: Record<string, PlaygroundToolState> = {
  QUALIFICAR_LEAD: { enabled: true, config: {} },
  AGENDAR_REUNIAO: { enabled: false, config: {} },
  MOVER_CARD: { enabled: false, config: {} },
  ENVIAR_FOLLOWUP: { enabled: false, config: {} },
  TRANSFERIR_HUMANO: { enabled: true, config: {} },
  CRIAR_LEAD: { enabled: false, config: {} },
  PREENCHER_CAMPOS: { enabled: true, config: {} },
  CRIAR_CAMPO: { enabled: false, config: {} },
  RESPONDER_FAQ: { enabled: true, config: {} },
};

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    type: "qualificador",
    name: "Qualificador de Leads",
    description: "Qualifica leads com perguntas estrategicas (BANT)",
    icon: "UserCheck",
    data: {
      templateType: "qualificador",
      prompt: `Voce e um agente qualificador de leads.

Seu objetivo e qualificar leads atraves de perguntas estrategicas para identificar fit, budget, autoridade, necessidade e timeline (BANT).

## Regras:
- Faca UMA pergunta por mensagem
- Seja profissional e consultivo
- Identifique a dor do cliente antes de apresentar solucao
- Quando qualificado, use @TRANSFERIR_HUMANO para encaminhar ao vendedor
- Se nao qualificado, agradeca educadamente e encerre

## Informacoes que precisa coletar:
- Necessidade / Dor principal
- Orcamento disponivel
- Autoridade de decisao
- Timeline de implementacao`,
      llmTemperatureMode: "balanceado",
      isProactive: false,
      operationMode: "inbound",
      tools: {
        QUALIFICAR_LEAD: { enabled: true, config: { requiredFields: "Nome, Empresa, Cargo, Necessidade" } },
        AGENDAR_REUNIAO: { enabled: false, config: {} },
        MOVER_CARD: { enabled: false, config: {} },
        ENVIAR_FOLLOWUP: { enabled: false, config: {} },
        TRANSFERIR_HUMANO: { enabled: true, config: { transferMessage: "Vou transferir voce para nosso especialista" } },
        CRIAR_LEAD: { enabled: false, config: {} },
        PREENCHER_CAMPOS: { enabled: true, config: {} },
    CRIAR_CAMPO: { enabled: false, config: {} },
        RESPONDER_FAQ: { enabled: true, config: {} },
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
      prompt: `Voce e um SDR (Sales Development Representative) focado em prospeccao ativa e agendamento de reunioes qualificadas.

## Objetivo:
Prospectar ativamente e agendar reunioes com decisores, criando rapport rapido e superando objecoes iniciais.

## Regras:
- Seja amigavel e persuasivo, com energia alta
- Crie rapport rapido e gere interesse
- Identifique a dor do cliente em 2-3 mensagens
- Supere objecoes com cases de sucesso
- Quando detectar interesse, use @AGENDAR_REUNIAO para agendar
- Use @MOVER_CARD para mover o lead conforme avanca no funil
- Use @QUALIFICAR_LEAD para registrar informacoes coletadas

## Fluxo:
1. Apresentacao + proposta de valor
2. Identificacao de dor (perguntas estrategicas)
3. Superacao de objecoes
4. Agendamento de reuniao`,
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
        QUALIFICAR_LEAD: { enabled: true, config: {} },
        AGENDAR_REUNIAO: { enabled: true, config: {} },
        MOVER_CARD: { enabled: true, config: { pipe: "whatsapp" } },
        ENVIAR_FOLLOWUP: { enabled: true, config: {} },
        TRANSFERIR_HUMANO: { enabled: true, config: {} },
        CRIAR_LEAD: { enabled: true, config: {} },
        PREENCHER_CAMPOS: { enabled: true, config: {} },
    CRIAR_CAMPO: { enabled: false, config: {} },
        RESPONDER_FAQ: { enabled: true, config: {} },
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
      prompt: `Voce e um especialista em follow-up e reengajamento de leads.

## Objetivo:
Manter engajamento com leads ao longo do tempo, identificando o momento ideal para reativacao sem ser invasivo.

## Regras:
- Seja casual e consultivo, com energia moderada
- Nunca pressione excessivamente
- Use abordagens variadas: valor, curiosidade, check-in
- Maximo 3 tentativas de reengajamento
- Se o lead nao responder apos 3 tentativas, use @MOVER_CARD para mover para "esfriou"
- Se o lead demonstrar interesse, use @MOVER_CARD para mover para "respondeu"

## Abordagens de Follow-up:
- Valor: compartilhe conteudo relevante
- Curiosidade: perguntas abertas sobre o cenario atual
- Check-in: verificacao amigavel do status
- Breakup: ultima tentativa antes de encerrar`,
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
        QUALIFICAR_LEAD: { enabled: false, config: {} },
        AGENDAR_REUNIAO: { enabled: false, config: {} },
        MOVER_CARD: { enabled: true, config: { pipe: "whatsapp" } },
        ENVIAR_FOLLOWUP: { enabled: true, config: { minIntervalHours: 24 } },
        TRANSFERIR_HUMANO: { enabled: true, config: {} },
        CRIAR_LEAD: { enabled: false, config: {} },
        PREENCHER_CAMPOS: { enabled: true, config: {} },
    CRIAR_CAMPO: { enabled: false, config: {} },
        RESPONDER_FAQ: { enabled: true, config: {} },
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
      prompt: `Voce e um confirmador de reunioes especializado.

## Objetivo:
Garantir o comparecimento em reunioes agendadas atraves de confirmacoes progressivas (D-5 a D-0).

## Regras:
- Seja profissional e direto
- Faca confirmacoes progressivas: D-5, D-3, D-1, dia da reuniao
- Sempre inclua data, horario e link da reuniao
- Se precisar reagendar, use @AGENDAR_REUNIAO
- Use @MOVER_CARD para atualizar status conforme confirmacao

## Fluxo de confirmacao:
- D-5: Lembrete amigavel + confirmacao
- D-3: Confirmacao + preparacao
- D-1: Confirmacao final + logistica
- D-0: Lembrete no dia + link`,
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
        QUALIFICAR_LEAD: { enabled: false, config: {} },
        AGENDAR_REUNIAO: { enabled: true, config: {} },
        MOVER_CARD: { enabled: true, config: { pipe: "confirmacao" } },
        ENVIAR_FOLLOWUP: { enabled: true, config: {} },
        TRANSFERIR_HUMANO: { enabled: true, config: {} },
        CRIAR_LEAD: { enabled: false, config: {} },
        PREENCHER_CAMPOS: { enabled: true, config: {} },
    CRIAR_CAMPO: { enabled: false, config: {} },
        RESPONDER_FAQ: { enabled: true, config: {} },
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
      prompt: `Voce e um prospector estrategico de alta performance.

## Objetivo:
Identificar e abordar novos prospectos com mensagens personalizadas que geram curiosidade e engajamento inicial.

## Regras:
- Seja profissional e persuasivo, com energia alta
- Personalize cada abordagem com dados do lead
- Gere curiosidade sem ser agressivo
- Foque em criar valor antes de pedir algo
- Use @QUALIFICAR_LEAD ao coletar informacoes
- Use @MOVER_CARD conforme o lead avanca
- Maximo 2 tentativas de reengajamento

## Estrutura de abordagem:
1. Gancho personalizado (referencia ao lead/empresa)
2. Proposta de valor clara e concisa
3. Pergunta aberta para engajar
4. Se interesse, direcionar para proximos passos`,
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
        QUALIFICAR_LEAD: { enabled: true, config: {} },
        AGENDAR_REUNIAO: { enabled: false, config: {} },
        MOVER_CARD: { enabled: true, config: { pipe: "whatsapp" } },
        ENVIAR_FOLLOWUP: { enabled: true, config: {} },
        TRANSFERIR_HUMANO: { enabled: true, config: {} },
        CRIAR_LEAD: { enabled: true, config: {} },
        PREENCHER_CAMPOS: { enabled: true, config: {} },
    CRIAR_CAMPO: { enabled: false, config: {} },
        RESPONDER_FAQ: { enabled: true, config: {} },
      },
    },
  },
];

export function getTemplatePreset(type: string): TemplatePreset | undefined {
  return TEMPLATE_PRESETS.find((t) => t.type === type);
}
