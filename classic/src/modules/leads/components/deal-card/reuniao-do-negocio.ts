/**
 * A reunião do Negócio — de onde ela vem e o que o card diz sobre ela.
 *
 * ── O PROBLEMA QUE ESTE ARQUIVO RESOLVE ───────────────────────────────────
 * Até o S6 havia duas verdades sem fio entre elas: a Agenda gravava a reunião
 * em `meetings` e o card do Negócio lia `pipeline_entries.metadata.meeting_date`.
 * Marcar reunião na Agenda nunca aparecia no card. O espelho do S6 (gatilho
 * `trg_meeting_espelha_no_funil`) passa a PROJETAR a reunião da Agenda dentro
 * do metadata, e é essa projeção que este módulo lê.
 *
 * ── POR QUE A DATA CONTINUA SAINDO DO METADATA ────────────────────────────
 * A leitura ingênua seria "meetings primeiro, metadata depois". Ela está
 * errada por três motivos medidos em prod:
 *
 *   1. **não existe penhasco.** 93 negócios de prod mostram reunião hoje só
 *      pelo metadata; ler `meetings` como fonte primária apagaria a reunião
 *      deles da tela no dia do deploy;
 *   2. **a projeção é onde as duas origens se encontram.** Os escritores do
 *      lado funil (`SetMeetingDateModal`, `MeetingFieldBlock`) continuam vivos
 *      no S6 e escrevem direto no metadata. Qualquer precedência fixa entre as
 *      duas produz "editei a data no card e não mudou";
 *   3. **é o que o resto do app já lê.** `negocio_projetado`, a view
 *      `pipe_confirmacao`, o card do Kanban e os filtros `p_meeting_after` /
 *      `p_meeting_before` de `get_pipeline_page` leem a mesma chave. Ler outra
 *      coisa aqui descolaria a leitura do filtro.
 *
 * De `meetings` vem só o que a projeção não carrega: o DESFECHO (`status`) e a
 * IDENTIDADE (`meetingId`) — que é o que permite ao card dizer "esta reunião
 * está na Agenda", em vez de ser uma data que alguém digitou no funil.
 *
 * ── ESTE MÓDULO NÃO ESCREVE NADA ──────────────────────────────────────────
 * Marcar e remarcar continuam morando na Agenda e no card do funil. Aqui só se
 * lê — e é por isso que ele é uma função pura, e não um hook.
 */

import type { DealCardData, StatusDaReuniao } from "./types";

type Linha = Record<string, unknown>;

/** Reunião de `meetings`, na forma crua em que o `select` a devolve. */
export interface ReuniaoDaAgenda {
  id: string;
  start_at: string;
  status: string | null;
  meet_link: string | null;
}

const STATUS_VALIDOS: readonly StatusDaReuniao[] = [
  "scheduled",
  "completed",
  "no_show",
  "cancelled",
];

function comoStatus(v: unknown): StatusDaReuniao | null {
  return typeof v === "string" && (STATUS_VALIDOS as readonly string[]).includes(v)
    ? (v as StatusDaReuniao)
    : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * A reunião que a projeção está mostrando, entre as que o negócio tem.
 *
 * A escolha segue o CARIMBO do espelho antes de qualquer heurística:
 * `metadata.agenda_espelho.meeting_id` diz, sem adivinhação, qual reunião
 * produziu a data que está na tela. Sem ele — reunião legado, data digitada no
 * funil, ou espelho que ainda não passou por aqui — cai para a regra que um
 * vendedor usaria: a PRÓXIMA que ainda vai acontecer; e, se não há nenhuma
 * futura, a mais recente que já passou.
 *
 * Escolher "a primeira da lista" seria pior do que não escolher: um lead com
 * duas reuniões no mesmo negócio veria o desfecho de uma pendurado na data da
 * outra.
 */
export function escolherReuniaoDaAgenda(
  reunioes: ReuniaoDaAgenda[],
  carimboMeetingId: string | null,
  agora: number,
): ReuniaoDaAgenda | null {
  if (reunioes.length === 0) return null;

  if (carimboMeetingId) {
    const carimbada = reunioes.find((r) => r.id === carimboMeetingId);
    // Carimbo que aponta para reunião que não veio na lista (apagada, ou de
    // outro negócio) NÃO faz o card cair para outra: cair seria trocar a
    // reunião mostrada por uma que ninguém pediu.
    if (carimbada) return carimbada;
  }

  const ordenadas = [...reunioes].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  const futura = ordenadas.find((r) => new Date(r.start_at).getTime() >= agora);
  return futura ?? ordenadas[ordenadas.length - 1] ?? null;
}

/**
 * Junta projeção e Agenda no formato que o card consome.
 *
 * `metadata` manda na DATA e no LINK. A queda para `meetings.start_at` só
 * existe para o caso em que o negócio tem reunião na Agenda e a projeção ainda
 * não chegou (espelho aplicado depois da reunião, org divergente, reparo
 * manual): ela só ACRESCENTA — nunca sobrepõe uma data que já está no
 * metadata, que é justamente o que apagaria reunião da tela.
 */
export function montarReuniaoDoNegocio(
  metadata: Linha,
  reunioes: ReuniaoDaAgenda[],
  agora: number = Date.now(),
): DealCardData["reuniao"] {
  const carimbo = (() => {
    const c = metadata.agenda_espelho;
    if (!c || typeof c !== "object" || Array.isArray(c)) return null;
    return texto((c as Linha).meeting_id);
  })();

  const daAgenda = escolherReuniaoDaAgenda(reunioes, carimbo, agora);

  const dataProjetada = texto(metadata.meeting_date);
  const data = dataProjetada ?? (daAgenda ? texto(daAgenda.start_at) : null);
  if (!data) return null;

  return {
    data,
    // `is_confirmed` é do funil e não tem equivalente em `meetings`: "o lead
    // confirmou" e "a reunião aconteceu" são perguntas diferentes.
    confirmada: metadata.is_confirmed === true,
    link: texto(metadata.meet_link) ?? (daAgenda ? texto(daAgenda.meet_link) : null),
    status: daAgenda ? comoStatus(daAgenda.status) : null,
    meetingId: daAgenda ? daAgenda.id : null,
  };
}

export interface SituacaoDaReuniao {
  /** O que a linha do card escreve ao lado da data. */
  rotulo: string;
  /** Como pintar: desfecho bom, desfecho ruim, pendência, ou nada de especial. */
  tom: "ok" | "ruim" | "alerta" | "neutro";
  /** Tem linha em `meetings` — ou seja, é reunião da Agenda, não data digitada. */
  daAgenda: boolean;
  /** A hora marcada já passou. */
  passou: boolean;
}

/**
 * O que o card DIZ sobre a reunião.
 *
 * Duas perguntas que o card do Negócio nunca respondeu e que são as únicas que
 * importam quando se abre um negócio: **isto já aconteceu?** e **quem sabe
 * disso é a Agenda ou é o funil?**. Reunião marcada, passada e sem desfecho é
 * pendência de verdade — é dela que sai o no-show que ninguém registrou — e por
 * isso ela é a única que acende.
 */
export function situacaoDaReuniao(
  reuniao: NonNullable<DealCardData["reuniao"]>,
  agora: number = Date.now(),
): SituacaoDaReuniao {
  const quando = new Date(reuniao.data).getTime();
  const passou = !Number.isNaN(quando) && quando < agora;
  // Truthy, não `!== null`: o selo "Agenda" afirma que existe reunião do outro
  // lado. Um `undefined` vindo de dado velho não pode virar afirmação.
  const daAgenda = typeof reuniao.meetingId === "string" && reuniao.meetingId !== "";

  if (reuniao.status === "completed") {
    return { rotulo: "compareceu", tom: "ok", daAgenda, passou };
  }
  if (reuniao.status === "no_show") {
    return { rotulo: "não compareceu", tom: "ruim", daAgenda, passou };
  }
  if (reuniao.status === "cancelled") {
    return { rotulo: "cancelada", tom: "ruim", daAgenda, passou };
  }

  // `scheduled` e "sem linha em meetings" caem no mesmo lugar de propósito: os
  // dois querem dizer "ninguém marcou desfecho". O que muda a leitura é a HORA.
  if (passou) {
    return { rotulo: "já passou, sem desfecho", tom: "alerta", daAgenda, passou };
  }
  return {
    rotulo: reuniao.confirmada ? "confirmada" : "sem confirmação",
    tom: reuniao.confirmada ? "ok" : "neutro",
    daAgenda,
    passou,
  };
}
