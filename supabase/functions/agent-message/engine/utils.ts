/**
 * Helpers puros do AgentEngine.
 *
 * Sem dependência de `this`, supabase, ou estado mutável. Funções determinísticas
 * extraídas pra reduzir o tamanho do god module agent-engine.ts e permitir teste
 * isolado.
 *
 *  - parseCustomInstructions: parse de custom_instructions (JSON ou string)
 *  - extractTopicFromMessage:  pega palavras-chave principais
 *  - detectIntentFromMessage:  intenção heurística (interesse/objecao/etc)
 *  - calculateLeadTemperature: cold/warm/hot a partir do histórico
 *  - calculateEngagementScore: 0..100 a partir do volume e tamanho
 *  - detectSentiment:          positive/neutral/negative
 *  - classifyIntent:           faq/objection/scheduling/qualification/chitchat
 *  - checkOutOfHours:          mensagem de fora-de-horário ou null
 */

import { resolveActiveWindow } from "../../_shared/copilot/time-context.ts";

export function parseCustomInstructions(raw: string): { dos: string; donts: string } {
  if (!raw || raw.trim() === "") return { dos: "", donts: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && ("dos" in parsed || "donts" in parsed)) {
      return { dos: parsed.dos || "", donts: parsed.donts || "" };
    }
  } catch {
    /* backward compat */
  }
  return { dos: raw, donts: "" };
}

export function extractTopicFromMessage(content: string): string {
  if (!content) return "";

  const words = content
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);

  return words.join(" ") || content.substring(0, 50);
}

export function detectIntentFromMessage(content: string): string {
  if (!content) return "unknown";

  const lowerContent = content.toLowerCase();

  const intents: Record<string, string[]> = {
    interesse: ["interessante", "quero saber", "me conta", "como funciona"],
    objecao_preco: ["caro", "preço", "quanto custa", "valor"],
    objecao_tempo: ["não tenho tempo", "ocupado", "depois", "agora não"],
    positivo: ["sim", "ok", "vamos", "pode ser", "combinado"],
    negativo: ["não", "não quero", "não preciso", "não tenho interesse"],
    pergunta: ["?", "como", "quando", "onde", "qual", "quem"],
    agendamento: ["marcar", "agendar", "reunião", "call", "horário"],
  };

  for (const [intent, keywords] of Object.entries(intents)) {
    if (keywords.some((kw) => lowerContent.includes(kw))) {
      return intent;
    }
  }

  return "neutro";
}

export function calculateLeadTemperature(
  leadMessages: Array<{ content?: string }>,
): "cold" | "warm" | "hot" {
  if (leadMessages.length === 0) return "cold";

  let score = 0;

  if (leadMessages.length > 10) score += 3;
  else if (leadMessages.length > 5) score += 2;
  else if (leadMessages.length > 2) score += 1;

  const positiveKeywords = ["sim", "interessante", "quero", "vamos", "pode"];
  leadMessages.forEach((m) => {
    if (m.content) {
      const lower = m.content.toLowerCase();
      if (positiveKeywords.some((kw) => lower.includes(kw))) score += 1;
    }
  });

  const questionCount = leadMessages.filter((m) => m.content?.includes("?")).length;
  score += Math.min(questionCount, 3);

  if (score >= 7) return "hot";
  if (score >= 3) return "warm";
  return "cold";
}

export function calculateEngagementScore(
  allMessages: Array<{ direction?: string; content?: string }>,
): number {
  if (allMessages.length === 0) return 0;

  let score = 0;

  const leadMessages = allMessages.filter((m) => m.direction === "incoming");
  const ratio = leadMessages.length / allMessages.length;
  score += Math.round(ratio * 40);

  const avgLength =
    leadMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) /
    (leadMessages.length || 1);
  if (avgLength > 100) score += 30;
  else if (avgLength > 50) score += 20;
  else if (avgLength > 20) score += 10;

  if (allMessages.length > 20) score += 30;
  else if (allMessages.length > 10) score += 20;
  else if (allMessages.length > 5) score += 10;

  return Math.min(score, 100);
}

export function detectSentiment(message: string): "positive" | "neutral" | "negative" {
  const t = message.toLowerCase();

  const positiveHints = [
    "ótimo",
    "excelente",
    "perfeito",
    "adorei",
    "gostei",
    "incrível",
    "top",
    "show",
    "interessante",
    "maravilhoso",
    "fantástico",
    "amei",
    "quero saber mais",
    "sim",
    "com certeza",
    "claro",
    "bora",
    "vamos",
    "quero",
    "preciso",
    "urgente",
    "faz sentido",
    "legal",
    "bacana",
    "ajuda muito",
    "muito bom",
    "isso mesmo",
    "ótima ideia",
  ];

  const negativeHints = [
    "não",
    "nunca",
    "caro",
    "impossível",
    "problema",
    "ruim",
    "péssimo",
    "chateado",
    "frustrado",
    "errado",
    "falha",
    "bug",
    "quebrado",
    "não funciona",
    "ridículo",
    "absurdo",
    "decepcionado",
    "não vejo valor",
    "sem interesse",
    "deixa pra lá",
    "não quero",
    "não preciso",
    "sem necessidade",
    "não faz sentido",
    "perd",
    "não gostei",
  ];

  const posScore = positiveHints.filter((h) => t.includes(h)).length;
  const negScore = negativeHints.filter((h) => t.includes(h)).length;

  if (posScore > negScore && posScore > 0) return "positive";
  if (negScore > posScore && negScore > 0) return "negative";
  return "neutral";
}

export function classifyIntent(message: string): string {
  const t = message.toLowerCase();

  const schedulingHints = [
    "agendar",
    "reunião",
    "chamada",
    "videochamada",
    "conversar",
    "horário",
    "disponível",
    "quando posso",
    "marcar",
    "call",
    "demo",
    "demonstração",
    "apresentação",
  ];
  const objectionHints = [
    "caro",
    "caro demais",
    "sem dinheiro",
    "sem verba",
    "pensar",
    "semana que vem",
    "não preciso",
    "não vejo",
    "concorrente",
    "já tenho",
    "não é prioridade",
    "budget",
    "orçamento limitado",
  ];
  const faqHints = [
    "como",
    "o que é",
    "oque é",
    "quanto custa",
    "qual é",
    "quais são",
    "explica",
    "me conta",
    "funciona",
    "diferença",
    "vantagem",
    "benefício",
    "como funciona",
  ];
  const qualHints = [
    "sou",
    "somos",
    "nossa empresa",
    "trabalho",
    "funcionários",
    "faturamento",
    "segmento",
    "área",
    "responsável",
    "meu negócio",
    "tenho uma empresa",
  ];

  if (schedulingHints.some((k) => t.includes(k))) return "scheduling";
  if (objectionHints.some((k) => t.includes(k))) return "objection";
  if (faqHints.some((k) => t.includes(k))) return "faq";
  if (qualHints.some((k) => t.includes(k))) return "qualification";

  return "chitchat";
}

/**
 * Verifica se o momento atual está dentro do horário de atendimento configurado.
 * Retorna mensagem de fora de horário (string) ou null (dentro do horário).
 *
 * Hierarquia (Time-Aware Behavior):
 *   1. behavior_enforcement = 'soft' → null sempre (LLM responde, contexto já injetado no prompt)
 *   2. behavior_windows definido + janela ativa com behavior preenchido → null (LLM contextual)
 *   3. behavior_windows definido + janela ativa com behavior vazio + hard → canned legacy
 *   4. behavior_windows definido + nenhuma janela ativa + hard → canned legacy
 *   5. Sem behavior_windows (legacy) → comportamento original via availability JSONB
 */
export function checkOutOfHours(capabilities: any): string | null {
  try {
    const enforcement = (capabilities.behavior_enforcement as string) || "hard";
    if (enforcement === "soft") return null;

    const windows = Array.isArray(capabilities.behavior_windows)
      ? capabilities.behavior_windows
      : [];
    const avail = capabilities.availability as {
      mode?: string;
      timezone?: string;
      days?: string[];
      start?: string;
      end?: string;
      out_of_hours_message?: string;
    } | null;

    if (windows.length > 0) {
      const ctx = resolveActiveWindow({ behavior_windows: windows, availability: avail });
      if (ctx && ctx.hasBehavior) return null; // janela com instrução → LLM responde com contexto
      // Sem janela ativa OU janela sem behavior → cai pra canned se houver
      return (
        avail?.out_of_hours_message ||
        "Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve."
      );
    }

    // Legacy fallback (agentes pré-Time-Aware): mantém comportamento original.
    if (!avail || avail.mode !== "scheduled") return null;

    const tz = avail.timezone || "America/Sao_Paulo";
    const now = new Date();

    const dayKey = new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz,
      weekday: "short",
    })
      .format(now)
      .toLowerCase()
      .replace(".", "")
      .substring(0, 3);

    const allowedDays = avail.days || ["seg", "ter", "qua", "qui", "sex"];
    if (!allowedDays.includes(dayKey)) {
      return (
        avail.out_of_hours_message ||
        "Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 😊"
      );
    }

    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);

    const [nowHour, nowMin] = timeStr.split(":").map(Number);
    const nowMinutes = nowHour * 60 + nowMin;

    const parseTime = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + (m || 0);
    };

    const startMin = parseTime(avail.start || "09:00");
    const endMin = parseTime(avail.end || "18:00");

    if (nowMinutes < startMin || nowMinutes >= endMin) {
      return (
        avail.out_of_hours_message ||
        "Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 😊"
      );
    }

    return null;
  } catch (e) {
    console.warn("[engine/utils] checkOutOfHours error (non-fatal):", e);
    return null;
  }
}
