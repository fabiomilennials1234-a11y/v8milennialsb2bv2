const APP_BASE_URL = "https://torquecrm.com.br";

export function buildHallucinationAlert(input: {
  feedbackId: string;
  organizationName: string;
  comment: string | null;
}): string {
  const comment = input.comment?.trim();
  return [
    "🚨 *Possível invenção do Oráculo*",
    "",
    `*${input.organizationName}*`,
    comment ? cut(comment, 500) : "Usuário marcou a resposta como inventada.",
    "",
    `${APP_BASE_URL}/master/oraculo-feedback?caso=${input.feedbackId}`,
  ].join("\n");
}

export function buildWeeklyFeedbackDigest(input: {
  periodStart: string;
  periodEnd: string;
  conversations: number;
  positive: number;
  negative: number;
  invented: number;
}): string {
  const invention = input.invented === 0
    ? "nenhuma por invenção"
    : `${input.invented} por invenção`;
  return [
    "📊 *Oráculo · resumo semanal*",
    "",
    `Semana de ${brDate(input.periodStart)} a ${brDate(input.periodEnd)}`,
    `${input.conversations} conversas · ${input.positive} positivas · ${input.negative} negativas · ${invention}.`,
    "",
    `${APP_BASE_URL}/master/oraculo-feedback`,
  ].join("\n");
}

function brDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}` : iso;
}

function cut(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
