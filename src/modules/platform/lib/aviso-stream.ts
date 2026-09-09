/**
 * O fluxo de Avisos que chega pelo tempo real, aplicado sobre a lista em cache.
 *
 * Isolado de React, de Supabase e do relógio: o que quebra aqui é *decisão* —
 * entrou o que não devia, sumiu o que devia ficar, a ordem mentiu — e decisão
 * se testa sem DOM.
 *
 * Vocabulário: CONTEXT.md, seção "Avisos".
 */

export interface Aviso {
  id: string;
  organization_id: string;
  user_id: string;
  type: string;
  title: string;
  description: string | null;
  link: string | null;
  lead_id: string | null;
  entity_id: string | null;
  group_key: string | null;
  event_count: number;
  last_event_at: string | null;
  created_at: string;
  read_at: string | null;
}

export type EventoDeAviso =
  | { tipo: "INSERT"; aviso: Aviso }
  | { tipo: "UPDATE"; aviso: Aviso }
  | { tipo: "DELETE"; aviso: Pick<Aviso, "id"> };

/** O instante que ordena a lista: o último evento absorvido, não a criação. */
export function instanteDoAviso(aviso: Aviso): number {
  return new Date(aviso.last_event_at ?? aviso.created_at).getTime();
}

function maisRecentesPrimeiro(avisos: Aviso[]): Aviso[] {
  return [...avisos].sort((a, b) => instanteDoAviso(b) - instanteDoAviso(a));
}

/**
 * Aplica um evento do tempo real sobre a lista em cache.
 *
 * A organização ativa é filtro de entrada, não de exibição: o mesmo login
 * participa de mais de uma organização, e Aviso nascido na outra não pode
 * aparecer — nem tocar — na que está aberta na tela.
 */
export function aplicarEventoDeAviso(
  lista: Aviso[],
  evento: EventoDeAviso,
  organizacaoAtiva: string,
): Aviso[] {
  if (evento.tipo === "DELETE") {
    return lista.filter((a) => a.id !== evento.aviso.id);
  }

  const { aviso } = evento;
  if (aviso.organization_id !== organizacaoAtiva) return lista;

  const semEle = lista.filter((a) => a.id !== aviso.id);
  return maisRecentesPrimeiro([aviso, ...semEle]);
}

/**
 * Quantos Avisos o badge conta. Lido continua na lista — o sino mostra o dia,
 * não só o pendente — mas sai da contagem.
 */
export function contarNaoLidos(avisos: Aviso[]): number {
  return avisos.filter((a) => a.read_at === null).length;
}
