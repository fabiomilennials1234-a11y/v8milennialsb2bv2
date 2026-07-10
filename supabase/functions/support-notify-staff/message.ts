/**
 * Formatação da mensagem do grupo de suporte (#1030). Pura, sem I/O — é o núcleo
 * testável de `support-notify-staff`. Vive fora do index.ts para não arrastar o
 * `Deno.serve` do topo para dentro do Vitest.
 */

const APP_BASE_URL = "https://torquecrm.com.br";

const TIPO_LABEL: Record<string, string> = {
  bug: "Bug",
  duvida: "Dúvida",
  solicitacao: "Solicitação",
};

// Ordenados por urgência — "parado" é o negócio parado, primeiro.
const IMPACTO_LABEL: Record<string, string> = {
  parado: "🔴 Parado",
  contorno: "🟡 Com contorno",
  incomodo: "⚪ Incômodo",
};

export interface StaffTicket {
  id: string;
  title: string;
  tipo: string;
  impacto: string;
  severidade?: string | null;
}

/**
 * O título vem do cliente: entra como texto puro, e o corte de tamanho evita um
 * título gigante empurrar o deep-link pra fora da prévia da notificação.
 */
export function buildStaffMessage(ticket: StaffTicket, orgName: string): string {
  const tipo = TIPO_LABEL[ticket.tipo] ?? ticket.tipo;
  const impacto = IMPACTO_LABEL[ticket.impacto] ?? ticket.impacto;
  const titulo = ticket.title.length > 140 ? `${ticket.title.slice(0, 139)}…` : ticket.title;
  const deepLink = `${APP_BASE_URL}/master/support-tickets`;

  return [
    "🎫 *Novo chamado*",
    "",
    `*${orgName}*`,
    `${impacto} · ${tipo}`,
    "",
    titulo,
    "",
    deepLink,
  ].join("\n");
}
