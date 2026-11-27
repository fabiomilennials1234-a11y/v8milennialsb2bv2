/**
 * Agenda unificada do Comando (flag `agenda_unificada`, Café Jurerê) — regras
 * puras, sem React. A tela é uma MÁSCARA: lê reuniões, mensagens agendadas e
 * próximos contatos e os põe numa lista só, por período, cada tipo na sua cor.
 * Nada aqui grava.
 */
import {
  diaLocal,
  hojeNoFuso,
  paraDia,
  type AgendaContato,
  type SituacaoAgenda,
} from "@/modules/analytics/lib/agenda-contatos";

export type Periodo = "hoje" | "semana" | "mes";
export type TipoItem = "reuniao" | "mensagem" | "contato";
export type FiltroTipo = "todos" | TipoItem;

export const OPCOES_PERIODO: ReadonlyArray<{ value: Periodo; label: string }> = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mês" },
];

/**
 * Cor por tipo: mensagem azul, reunião amarela (pedido da Café). O próximo
 * contato fica neutro — as cores azul/amarelo/vermelho dele eram de SITUAÇÃO e
 * passariam a significar duas coisas na mesma lista.
 */
export const TOM_TIPO: Record<TipoItem, { rotulo: string; chip: string; dot: string; filete: string }> = {
  mensagem: {
    rotulo: "Mensagem",
    chip: "bg-scheduled/10 text-scheduled-ink ring-1 ring-inset ring-scheduled/25",
    dot: "bg-scheduled",
    filete: "bg-scheduled",
  },
  reuniao: {
    rotulo: "Reunião",
    chip: "bg-warning/15 text-warning-strong ring-1 ring-inset ring-warning/35",
    dot: "bg-warning",
    filete: "bg-warning",
  },
  contato: {
    rotulo: "Contato",
    chip: "bg-muted text-foreground/80 ring-1 ring-inset ring-border",
    dot: "bg-muted-foreground/60",
    filete: "bg-muted-foreground/40",
  },
};

/**
 * Atrasado e ainda aberto: VERMELHO com o amarelo (reunião) ou o azul (mensagem)
 * do tipo. O vermelho diz "passou do dia", a outra cor diz "o que é" — por isso
 * o chip e o filete carregam as duas, e o atrasado não vira um quarto tipo.
 */
export const TOM_ATRASADO: Record<"reuniao" | "mensagem", { chip: string; filete: [string, string] }> = {
  reuniao: {
    chip: "bg-warning/15 text-destructive-strong ring-1 ring-inset ring-destructive/45",
    filete: ["bg-destructive", "bg-warning"],
  },
  mensagem: {
    chip: "bg-scheduled/10 text-destructive-strong ring-1 ring-inset ring-destructive/45",
    filete: ["bg-destructive", "bg-scheduled"],
  },
};

/** Evento da Agenda (`get_agenda_events_scoped`) — só o que a máscara lê. */
export interface EventoDaAgenda {
  id: string;
  source: string;
  title: string;
  description: string | null;
  start_at: string;
  event_type: string;
  status: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_company: string | null;
  created_by: string | null;
  creator_name: string | null;
}

export interface ItemAgenda {
  chave: string;
  /** Id na tabela de origem (`meetings.id` na reunião) — o que as ações gravam. */
  origemId: string;
  tipo: TipoItem;
  /** `YYYY-MM-DD` no fuso da org. */
  dia: string;
  /** `HH:mm` no fuso da org; `null` no próximo contato (só tem dia). */
  hora: string | null;
  leadId: string | null;
  leadName: string | null;
  leadCompany: string | null;
  /** Título da reunião, texto da mensagem ou observação do contato. */
  detalhe: string | null;
  ownerName: string | null;
  /** Já aconteceu (reunião realizada/falta, mensagem enviada): a linha sai riscada. */
  encerrada: boolean;
  /** Só do contato: a situação que o banco calculou. */
  situacao: SituacaoAgenda | null;
  contato: AgendaContato | null;
  /** Passou do dia e segue aberto (reunião sem desfecho, mensagem não enviada, contato atrasado). */
  atrasada: boolean;
  /** Status de origem: reunião `scheduled|completed|no_show`; mensagem `scheduled|sending|sent`. */
  status: string;
}

/** Intervalo de dias `[de, ate]`, ambos inclusos, `YYYY-MM-DD`. */
export function intervaloDoPeriodo(hoje: string, periodo: Periodo): { de: string; ate: string } {
  if (periodo === "hoje") return { de: hoje, ate: hoje };
  const base = diaLocal(hoje);
  if (periodo === "semana") {
    // Semana de segunda a domingo, a de trabalho da Café.
    const deslocamento = (base.getDay() + 6) % 7;
    const seg = new Date(base);
    seg.setDate(base.getDate() - deslocamento);
    const dom = new Date(seg);
    dom.setDate(seg.getDate() + 6);
    return { de: paraDia(seg), ate: paraDia(dom) };
  }
  const primeiro = new Date(base.getFullYear(), base.getMonth(), 1);
  const ultimo = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { de: paraDia(primeiro), ate: paraDia(ultimo) };
}

/**
 * Janela em `Date` para buscar no banco. É LARGA de propósito (um dia a mais
 * para cada lado): quem decide se o item é do período é o `dia` no fuso da org,
 * não o fuso do navegador de quem abre a tela.
 */
export function janelaDeBusca(hoje: string, periodo: Periodo): { inicio: Date; fim: Date } {
  const { de, ate } = intervaloDoPeriodo(hoje, periodo);
  const inicio = diaLocal(de);
  inicio.setDate(inicio.getDate() - 1);
  const fim = diaLocal(ate);
  fim.setDate(fim.getDate() + 2);
  return { inicio, fim };
}

function partesNoFuso(iso: string, timezone: string | null | undefined): { dia: string; hora: string } {
  const d = new Date(iso);
  const tz = timezone || "America/Sao_Paulo";
  let dia: string;
  let hora: string;
  try {
    dia = d.toLocaleDateString("en-CA", { timeZone: tz });
    hora = d.toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    dia = hojeNoFuso(null, d);
    hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  return { dia, hora };
}

const STATUS_ENCERRADOS = new Set(["completed", "no_show", "sent"]);
const STATUS_FORA = new Set(["cancelled", "canceled", "failed"]);

/** Evento da Agenda → item. `null` para o que a máscara não mostra. */
export function itemDoEvento(e: EventoDaAgenda, timezone: string | null | undefined, hoje?: string): ItemAgenda | null {
  const tipo: TipoItem | null =
    e.source === "meeting" ? "reuniao" : e.source === "scheduled_message" ? "mensagem" : null;
  if (!tipo) return null;
  const status = (e.status ?? "").toLowerCase();
  if (STATUS_FORA.has(status)) return null;
  const { dia, hora } = partesNoFuso(e.start_at, timezone);
  const encerrada = STATUS_ENCERRADOS.has(status);
  return {
    chave: `${e.source}:${e.id}`,
    origemId: e.id,
    tipo,
    dia,
    hora,
    leadId: e.lead_id,
    leadName: e.lead_name,
    leadCompany: e.lead_company,
    detalhe: e.description?.trim() || e.title,
    ownerName: e.creator_name,
    encerrada,
    atrasada: !!hoje && !encerrada && dia < hoje,
    situacao: null,
    contato: null,
    status,
  };
}

export function itemDoContato(a: AgendaContato): ItemAgenda {
  return {
    chave: `contato:${a.id}`,
    origemId: a.id,
    tipo: "contato",
    dia: a.data_agenda,
    hora: null,
    leadId: a.lead_id,
    leadName: a.lead_name,
    leadCompany: a.lead_company,
    detalhe: a.observacao,
    ownerName: a.owner_name,
    encerrada: false,
    atrasada: a.situacao === "atrasada",
    situacao: a.situacao,
    contato: a,
    status: "open",
  };
}

/**
 * Monta a lista do período. Reunião e mensagem entram só se o `dia` cai no
 * intervalo. O próximo contato ABERTO entra também quando está ATRASADO: ele só
 * sai pelo X (regra da Café), então esconder o atrasado porque "hoje" mudou de
 * período seria perdê-lo de vista.
 *
 * No "Hoje" o mesmo vale para reunião e mensagem: o que passou do dia e segue
 * aberto (`atrasados`, vindos de uma busca própria) fica na lista até ser
 * encerrado. Semana e Mês já cobrem os próprios dias; não carregam atrasado de
 * fora do período.
 */
export function montarAgenda(input: {
  eventos: EventoDaAgenda[];
  /** Eventos abertos de dias anteriores; só entram no período "hoje". */
  atrasados?: EventoDaAgenda[];
  contatos: AgendaContato[];
  hoje: string;
  periodo: Periodo;
  timezone: string | null | undefined;
}): ItemAgenda[] {
  const { de, ate } = intervaloDoPeriodo(input.hoje, input.periodo);
  const itens: ItemAgenda[] = [];
  const vistos = new Set<string>();
  for (const e of input.eventos) {
    const it = itemDoEvento(e, input.timezone, input.hoje);
    if (!it || it.dia < de || it.dia > ate || vistos.has(it.chave)) continue;
    vistos.add(it.chave);
    itens.push(it);
  }
  if (input.periodo === "hoje") {
    for (const e of input.atrasados ?? []) {
      const it = itemDoEvento(e, input.timezone, input.hoje);
      if (!it || !it.atrasada || vistos.has(it.chave)) continue;
      vistos.add(it.chave);
      itens.push(it);
    }
  }
  for (const a of input.contatos) {
    if (a.data_agenda > ate) continue;
    if (a.data_agenda < de && a.situacao !== "atrasada") continue;
    itens.push(itemDoContato(a));
  }
  return itens.sort(compararItens);
}

const ORDEM_TIPO: Record<TipoItem, number> = { contato: 0, reuniao: 1, mensagem: 2 };

export function compararItens(a: ItemAgenda, b: ItemAgenda): number {
  if (a.dia !== b.dia) return a.dia < b.dia ? -1 : 1;
  const ha = a.hora ?? "00:00";
  const hb = b.hora ?? "00:00";
  if (ha !== hb) return ha < hb ? -1 : 1;
  if (a.tipo !== b.tipo) return ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo];
  return (a.leadName ?? "").localeCompare(b.leadName ?? "", "pt-BR");
}

export function contarPorTipo(itens: ItemAgenda[]): Record<FiltroTipo, number> {
  const c: Record<FiltroTipo, number> = { todos: itens.length, reuniao: 0, mensagem: 0, contato: 0 };
  for (const i of itens) c[i.tipo] += 1;
  return c;
}

export function filtrarPorTipo(itens: ItemAgenda[], filtro: FiltroTipo): ItemAgenda[] {
  return filtro === "todos" ? itens : itens.filter((i) => i.tipo === filtro);
}

/**
 * O que a linha da reunião oferece no par ✓ compareceu / ✗ não compareceu.
 *
 * Toda reunião mostra o par. Antes só a ATRASADA mostrava: a de hoje ficava sem
 * botão até virar o dia, e quem não tinha atrasada não via botão nenhum.
 *
 *   - aberta, de hoje ou de antes → `marcar`;
 *   - aberta, de dia futuro → `aguarda`: o par aparece desligado. O desfecho
 *     grava `meeting_held`/`meeting_no_show` com a data da reunião
 *     (`fn_meeting_outcome_to_events`); marcar antes lançaria comparecimento
 *     num dia que ainda não chegou;
 *   - com desfecho → `compareceu` | `faltou`, só para ler.
 */
export type Comparecimento = "marcar" | "aguarda" | "compareceu" | "faltou";

export function comparecimentoDaReuniao(
  item: Pick<ItemAgenda, "tipo" | "status" | "dia">,
  hoje: string,
): Comparecimento | null {
  if (item.tipo !== "reuniao") return null;
  if (item.status === "completed") return "compareceu";
  if (item.status === "no_show") return "faltou";
  return item.dia > hoje ? "aguarda" : "marcar";
}

export function contarAtrasados(itens: ItemAgenda[]): number {
  return itens.filter((i) => i.atrasada).length;
}
