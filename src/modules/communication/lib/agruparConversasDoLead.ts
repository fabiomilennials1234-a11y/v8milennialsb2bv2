/**
 * `agruparConversasDoLead` — organiza as caixas nos dois grupos do seletor.
 *
 * A regra vem da spec (`.specs/features/conversa-do-lead/SPEC.md`):
 *
 *   1. "Conversa em andamento" — caixas com histórico, mais recente primeiro.
 *   2. "Iniciar conversa por"  — caixas sem histórico, ordenadas por
 *      preferência do usuário logado, depois por caixa conectada.
 *
 * O sinal do responsável NÃO entra: a decisão original mandava derivá-lo de
 * agregação sobre `whatsapp_messages`, e a tabela não guarda quem enviou
 * (issue #1610). Ficou adiado, não esquecido.
 */

export interface ConversaDoLeadRow {
  instanceId: string;
  instanceName: string;
  instanceStatus: string;
  lastMessageAt: string | null;
  lastMessageContent: string | null;
  lastMessageDirection: string | null;
}

export interface ConversasDoLeadAgrupadas {
  comConversa: ConversaDoLeadRow[];
  semConversa: ConversaDoLeadRow[];
}

export interface AgruparConversasArgs {
  rows: ReadonlyArray<ConversaDoLeadRow>;
  /** Preferência de caixa do usuário logado (`team_members`). */
  preferredInstanceId?: string | null;
}

export function agruparConversasDoLead({
  rows,
  preferredInstanceId = null,
}: AgruparConversasArgs): ConversasDoLeadAgrupadas {
  const comConversa = rows
    .filter((r) => r.lastMessageAt !== null)
    // Mais recente primeiro. Comparação de string ISO-8601 é ordenação
    // cronológica correta e evita construir Date por linha.
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));

  const semConversa = rows
    .filter((r) => r.lastMessageAt === null)
    .sort((a, b) => {
      // Preferência do usuário no topo.
      const aPref = a.instanceId === preferredInstanceId ? 0 : 1;
      const bPref = b.instanceId === preferredInstanceId ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;

      // Depois conectadas, porque começar conversa por caixa caída não é opção.
      const aOn = a.instanceStatus === "connected" ? 0 : 1;
      const bOn = b.instanceStatus === "connected" ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;

      // Empate: nome, para a lista não dançar entre renders.
      return a.instanceName.localeCompare(b.instanceName);
    });

  return { comConversa, semConversa };
}
