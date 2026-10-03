/**
 * Rótulos de exibição dos enums do agente Copilot (tipo, personalidade,
 * estilo de resposta). Só apresentação: o valor gravado não muda. Valor fora
 * da lista volta como veio — melhor um identificador cru do que um rótulo
 * inventado.
 */
const TYPE: Record<string, string> = {
  qualificador: "Qualificador",
  sdr: "SDR",
  followup: "Follow-up",
  agendador: "Agendador",
  prospectador: "Prospectador",
  custom: "Personalizado",
};

const TONE: Record<string, string> = {
  formal: "Formal",
  casual: "Casual",
  profissional: "Profissional",
  amigavel: "Amigável",
  energetico: "Energético",
  consultivo: "Consultivo",
};

const STYLE: Record<string, string> = {
  direto: "direto",
  detalhado: "detalhado",
  consultivo: "consultivo",
  persuasivo: "persuasivo",
  educativo: "educativo",
};

const ENERGY: Record<string, string> = {
  baixa: "energia baixa",
  moderada: "energia moderada",
  alta: "energia alta",
  muito_alta: "energia muito alta",
};

const TEMPERATURE: Record<string, string> = {
  criativo: "Criativo",
  balanceado: "Balanceado",
  preciso: "Preciso",
};

const pick = (map: Record<string, string>, v: string | null | undefined) => (v ? map[v] ?? v : "");

export const agentTypeLabel = (v: string | null | undefined) => pick(TYPE, v) || "Agente";
export const toneLabel = (v: string | null | undefined) => pick(TONE, v);
export const styleLabel = (v: string | null | undefined) => pick(STYLE, v);
export const energyLabel = (v: string | null | undefined) => pick(ENERGY, v);
export const temperatureLabel = (v: string | null | undefined) => pick(TEMPERATURE, v);
export const AGENT_TYPE_ORDER = ["qualificador", "sdr", "followup", "agendador", "prospectador", "custom"] as const;
