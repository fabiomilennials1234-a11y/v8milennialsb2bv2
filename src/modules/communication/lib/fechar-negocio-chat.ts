/**
 * Ganho/Perda do negócio direto do chat (Café Jurerê, flag `chat_ganho_perda_negocio`).
 *
 * O desfecho do negócio (`deals.outcome`) é independente da etapa: a RPC
 * `definir_desfecho_da_entrada` só grava o desfecho. Na Café Jurerê nenhuma
 * etapa tem role ganho/perda (todas `open`), então quem fecha escolhe também
 * PARA ONDE o card vai — e a ordem é mover primeiro, desfecho depois.
 */

export const CHAT_GANHO_PERDA_FLAG = "chat_ganho_perda_negocio";

export type DesfechoDoChat = "won" | "lost";

interface EtapaMinima {
  key: string;
  label: string;
}

function normalizar(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PALAVRAS: Record<DesfechoDoChat, RegExp> = {
  won: /\b(vendid[oa]s?|ganh[oa]s?|fechad[oa]s?|won)\b/,
  lost: /\b(perdid[oa]s?|lost)\b/,
};
const CONTRARIA: Record<DesfechoDoChat, RegExp> = {
  won: PALAVRAS.lost,
  lost: PALAVRAS.won,
};

/**
 * A etapa que o modal já deixa marcada. Só sugere o que o NOME diz com clareza
 * ("Vendido", "Perdido"); sem candidata devolve `null` e o modal começa em
 * "Manter na etapa atual" em vez de chutar um destino.
 */
export function sugerirEtapaDeFechamento(desfecho: DesfechoDoChat, etapas: readonly EtapaMinima[]): string | null {
  for (const etapa of etapas) {
    const nome = normalizar(etapa.label);
    if (PALAVRAS[desfecho].test(nome) && !CONTRARIA[desfecho].test(nome)) return etapa.key;
  }
  return null;
}

/** Move só se o destino existe e é outra etapa: mover para a mesma duplicaria o evento. */
export function planoDeFechamento(args: { etapaAtualKey: string | null; destinoKey: string | null }): {
  mover: boolean;
  destinoKey: string | null;
} {
  const { etapaAtualKey, destinoKey } = args;
  if (!destinoKey || destinoKey === etapaAtualKey) return { mover: false, destinoKey: null };
  return { mover: true, destinoKey };
}
