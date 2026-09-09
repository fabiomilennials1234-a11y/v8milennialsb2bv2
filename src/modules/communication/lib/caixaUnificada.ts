/**
 * `unificarCaixas` — o motor da Caixa de Entrada Unificada. PURO.
 *
 * Recebe as listas que os hooks de cada canal trouxeram e devolve UMA lista,
 * ordenada por recência, com cada linha marcada com a caixa de onde veio e com
 * as outras caixas em que aquele mesmo interlocutor tem conversa viva.
 *
 * Sem rede, sem React, sem TanStack Query — pelo mesmo motivo que o engine de
 * filtro do inbox (`inboxFilter.ts`) vive aqui: a regra que decide o que a
 * pessoa vê precisa ser exercitável sem montar a tela.
 *
 * ─── UMA LINHA POR CAIXA (decisão 1 do grill) ───────────────────────────────
 *
 * O mesmo telefone falando com duas Instances dá DUAS linhas. Não é efeito
 * colateral: é o modelo do glossário — a Conversa do Lead é o par
 * (Lead ↔ caixa), e a Alamaster separou 57 números por departamento de
 * propósito. Quem pede orçamento no comercial e abre chamado na técnica está
 * tendo duas conversas, e fundi-las apagaria o assunto de uma delas.
 *
 * O que o motor faz é tornar isso LEGÍVEL: as duas linhas sabem uma da outra
 * (`tambemEm`), e a lista continua PLANA — a linha nunca vira um objeto com
 * filhos, porque a lista é virtualizada e altura variável por linha é o começo
 * de um bug de scroll.
 *
 * ─── O INTERLOCUTOR ATRAVESSA CANAL ─────────────────────────────────────────
 *
 * No canal oficial o `external_user_id` É UM TELEFONE (ver `contactLabel`), e é
 * exatamente o caso que originou o épico: na Chique, 10 contatos conversam pelo
 * Chip e pela caixa oficial ao mesmo tempo. Por isso a identidade do
 * interlocutor normaliza os dois lados com a MESMA função — comparar
 * `phone_number` cru com `external_user_id` cru não casaria nenhum dos 10.
 *
 * ─── O PISO DE CONFIANÇA (D3 atravessando canais) ───────────────────────────
 *
 * Cada RPC aplica o limite sobre o SEU conjunto de caixas. Duas fontes cortadas
 * em N não podem ser simplesmente concatenadas: se a fonte A voltou cheia e a
 * mais antiga dela é de ontem, tudo que a fonte B trouxe de anteontem apareceria
 * DEPOIS de um buraco — conversa de A que existe, é mais nova, e não veio.
 *
 * Então o corte é honesto: de toda fonte que voltou CHEIA, guarda-se o instante
 * da linha mais antiga; o piso é o MAIOR deles, e nada abaixo do piso entra.
 * `truncada` diz que houve corte, para a UI oferecer "carregar mais" em vez de
 * mentir um fim de lista.
 */
import { normalizePhone } from "@/lib/normalizePhone";
import { contactKey, isWhatsAppContact, type InboxContact } from "@/modules/communication/hooks/chat/types";

/** A caixa de onde a linha veio, no mínimo que a lista precisa para desenhá-la. */
export interface CaixaDaLinha {
  id: string;
  nome: string;
  kind: "whatsapp" | "instagram";
  /** Canal oficial da Meta: `kind` é `"whatsapp"`, mas a origem tem selo próprio. */
  oficial?: boolean;
}

/** Um contato já casado com a caixa que o trouxe. */
export interface EntradaUnificada {
  contato: InboxContact;
  caixa: CaixaDaLinha;
}

/**
 * Uma fonte de conversas: uma chamada de RPC já convertida em entradas.
 *
 * `cheia` é o que a fonte respondeu no limite pedido — ver o piso de confiança.
 * Quem sabe disso é o hook (compara o tamanho da resposta com `p_limit`); o
 * motor não adivinha, porque uma org com menos conversas que o limite ficaria
 * marcada como truncada para sempre.
 */
export interface FonteUnificada {
  entradas: readonly EntradaUnificada[];
  cheia: boolean;
}

export interface LinhaUnificada {
  contato: InboxContact;
  caixa: CaixaDaLinha;
  /** Identidade da linha — `(caixa, interlocutor)`, via `contactKey`. */
  chave: string;
  /**
   * As OUTRAS caixas em que este mesmo interlocutor tem conversa na lista
   * exibida. Vazio na esmagadora maioria das linhas (10 em 664 na Chique, 21%
   * na Alamaster). Só olha o que está na tela: uma caixa desmarcada não produz
   * fio, porque a linha dela não existe para ser ligada.
   */
  tambemEm: CaixaDaLinha[];
}

export interface ListaUnificada {
  linhas: LinhaUnificada[];
  /** Houve corte pelo piso de confiança ou pelo limite: existe mais coisa. */
  truncada: boolean;
}

export interface OpcoesDeUnificacao {
  /** Teto de linhas devolvidas. Ausente = sem teto no cliente. */
  limite?: number;
}

/**
 * A identidade do INTERLOCUTOR, que atravessa caixas.
 *
 * Não é a identidade da linha (essa é `contactKey`, que inclui a caixa). É o
 * "quem", e serve só para descobrir que a mesma pessoa aparece duas vezes.
 *
 * Instagram tem namespace próprio: um IGSID pode, por azar, ser uma sequência
 * de dígitos que `normalizePhone` aceitaria, e um encontro desses ligaria um
 * perfil de Instagram a um telefone que não é dele.
 */
export function identidadeDoInterlocutor(contato: InboxContact): string {
  if (isWhatsAppContact(contato)) {
    return `tel:${normalizePhone(contato.phone_number) ?? contato.phone_number}`;
  }
  if (contato.channel === "whatsapp_oficial") {
    return `tel:${normalizePhone(contato.external_user_id) ?? contato.external_user_id}`;
  }
  return `ig:${contato.external_user_id}`;
}

/**
 * O instante da última mensagem, como string comparável.
 *
 * Defensivo como o engine de filtro: campo ausente vira `""` e a linha vai para
 * o FIM em vez de derrubar a ordenação inteira com `Invalid Date`. Comparação
 * de ISO-8601 por string é cronológica e não constrói um `Date` por linha —
 * a lista da Alamaster tem 4.209 conversas.
 */
function instante(contato: InboxContact): string {
  return typeof contato.last_message_time === "string" ? contato.last_message_time : "";
}

export function unificarCaixas(
  fontes: readonly FonteUnificada[],
  opcoes: OpcoesDeUnificacao = {},
): ListaUnificada {
  const entradas: EntradaUnificada[] = [];
  for (const fonte of fontes) entradas.push(...fonte.entradas);

  // ── Piso de confiança ──────────────────────────────────────────────────────
  // Só fonte CHEIA impõe piso: uma fonte que devolveu tudo que tinha não esconde
  // nada abaixo da sua linha mais antiga.
  let piso = "";
  for (const fonte of fontes) {
    if (!fonte.cheia || fonte.entradas.length === 0) continue;
    let maisAntiga: string | null = null;
    for (const entrada of fonte.entradas) {
      const t = instante(entrada.contato);
      if (maisAntiga === null || t < maisAntiga) maisAntiga = t;
    }
    if (maisAntiga !== null && maisAntiga > piso) piso = maisAntiga;
  }

  const dentroDoPiso = piso
    ? entradas.filter((e) => instante(e.contato) >= piso)
    : entradas;

  // Recência decrescente. Empate desempata pela chave, e não pela ordem de
  // chegada: duas fontes resolvem em ordem imprevisível, e uma lista que troca
  // de ordem entre renders é a mesma classe de defeito de uma paginação sem
  // desempate — a linha "pisca" de lugar sem ninguém ter mexido nela.
  const ordenadas = [...dentroDoPiso].sort((a, b) => {
    const ta = instante(a.contato);
    const tb = instante(b.contato);
    if (ta !== tb) return tb.localeCompare(ta);
    return contactKey(a.contato).localeCompare(contactKey(b.contato));
  });

  const limite = opcoes.limite;
  const cortadas =
    typeof limite === "number" && limite >= 0 ? ordenadas.slice(0, limite) : ordenadas;

  // ── O fio ─────────────────────────────────────────────────────────────────
  // Sobre o que SOBROU, não sobre o que chegou: uma linha cortada pelo limite
  // não está na tela, e prometer "também está na caixa X" sem ter a linha X
  // visível é uma promessa que a tela não cumpre.
  const caixasPorInterlocutor = new Map<string, CaixaDaLinha[]>();
  for (const entrada of cortadas) {
    const id = identidadeDoInterlocutor(entrada.contato);
    const lista = caixasPorInterlocutor.get(id);
    if (lista) {
      if (!lista.some((c) => c.id === entrada.caixa.id)) lista.push(entrada.caixa);
    } else {
      caixasPorInterlocutor.set(id, [entrada.caixa]);
    }
  }

  const linhas = cortadas.map<LinhaUnificada>((entrada) => {
    const todas = caixasPorInterlocutor.get(identidadeDoInterlocutor(entrada.contato)) ?? [];
    return {
      contato: entrada.contato,
      caixa: entrada.caixa,
      chave: contactKey(entrada.contato),
      tambemEm: todas.filter((c) => c.id !== entrada.caixa.id),
    };
  });

  return {
    linhas,
    truncada: cortadas.length < entradas.length,
  };
}
