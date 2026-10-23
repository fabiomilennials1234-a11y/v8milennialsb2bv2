/**
 * `agruparConversasDoLead` — organiza as caixas nos dois grupos do seletor.
 *
 * A regra vem da spec (`.specs/features/conversa-do-lead/SPEC.md`):
 *
 *   1. "Conversa em andamento" — caixas com histórico, mais recente primeiro.
 *   2. "Iniciar conversa por"  — caixas sem histórico, ordenadas por
 *      preferência do usuário logado, caixa vinculada a ele, caixa vinculada
 *      ao responsável do lead e, por fim, caixa conectada.
 *
 * O sinal do responsável vem do vínculo `whatsapp_instance_allowed_members`
 * (`useCaixasDeQuemAtende`), não de agregação sobre `whatsapp_messages`: a
 * tabela não guarda quem enviou (issue #1610).
 */
import { prioridadeDaCaixa } from "./prioridadeDaCaixa";

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
  /**
   * Caixas vinculadas ao usuário logado (`whatsapp_instance_allowed_members`).
   * Admin e master enxergam TODAS as caixas; sem este sinal a lista caía em
   * ordem alfabética e a caixa de outra vendedora ficava no topo
   * (Chamados 52df972e / b7941f5e).
   */
  minhasInstanceIds?: ReadonlyArray<string>;
  /** Caixas vinculadas ao responsável do lead — o sinal de quem atende quando o usuário não tem caixa. */
  doResponsavelInstanceIds?: ReadonlyArray<string>;
}

export function agruparConversasDoLead({
  rows,
  preferredInstanceId = null,
  minhasInstanceIds = [],
  doResponsavelInstanceIds = [],
}: AgruparConversasArgs): ConversasDoLeadAgrupadas {
  const comConversa = rows
    .filter((r) => r.lastMessageAt !== null)
    // Mais recente primeiro. Comparação de string ISO-8601 é ordenação
    // cronológica correta e evita construir Date por linha.
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));

  // A mesma ordem que o chat usa ao abrir lead sem conversa — ver `prioridadeDaCaixa`.
  const prioridade = prioridadeDaCaixa({ preferredInstanceId, minhasInstanceIds, doResponsavelInstanceIds });

  const semConversa = rows
    .filter((r) => r.lastMessageAt === null)
    .sort((a, b) => {
      // Preferência salva, depois a caixa do usuário, depois a do responsável.
      const aPref = prioridade(a.instanceId);
      const bPref = prioridade(b.instanceId);
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
