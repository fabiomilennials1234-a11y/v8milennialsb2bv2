/**
 * Abertura de segunda-feira — o contrato entre o banco e a animação.
 *
 * `boas_vindas_semana_reivindicar` devolve JSON; a animação consome
 * `ResumoSemana`. Esta é a única ponte entre os dois, e ela DESCONFIA do que
 * recebe: uma abertura é decoração, e decoração nunca derruba a tela de
 * ninguém. Resposta fora do formato vira `null` — a pessoa só não vê a
 * animação.
 */

/** Valores de segunda a domingo. */
export type PorDia = readonly [number, number, number, number, number, number, number];

export interface ResumoSemana {
  /** Ex.: "27 de out. a 2 de nov." — já formatado, com o ponto da abreviação. */
  periodo: string;
  leads: number;
  vendas: number;
  /** Em reais. */
  receita: number;
  porDia: { leads: PorDia; vendas: PorDia; receita: PorDia };
  /** A semana anterior à contada, para a variação. Ausente = sem comparação. */
  anterior?: { leads: number; vendas: number; receita: number };
  /**
   * O que é do Torque. Cada bloco é OPCIONAL e independente: org sem automação,
   * ou cuja consulta pesada falhou no banco, só não ganha aquela cena.
   */
  automacoes?: { execucoes: number; anterior: number; top: { nome: string; execucoes: number } | null };
  movimentacao?: { total: number; top: { nome: string; movimentos: number; voce: boolean } };
  ranking?: {
    /** 1 a 12. */
    mes: number;
    ano: number;
    /** false = o mês fechou há pouco e o corrente ainda não vendeu (recuo nos 7 primeiros dias). */
    corrente: boolean;
    /** Quantos vendedores ativos entram no ranking. */
    pessoas: number;
    top: { nome: string; valor: number; vendas: number; posicao: number; voce: boolean }[];
    /** A posição de quem está vendo; ausente se não é vendedor. */
    voce: { posicao: number; valor: number; vendas: number } | null;
  };
}

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatadorDia = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  // A data do banco é um dia do calendário da org, sem hora: ler em UTC é o que
  // impede o fuso do aparelho de empurrá-la para o dia anterior.
  timeZone: "UTC",
});

function diaDoCalendario(iso: unknown): Date | null {
  if (typeof iso !== "string") return null;
  const m = DATA_ISO.exec(iso);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // `Date.UTC` não rejeita data impossível, ela ROLA: "2027-13-45" vira uma data
  // de 2028. Só vale a data que sobrevive à ida e volta.
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d;
}

/** "2027-10-25", "2027-10-31" → "25 de out. a 31 de out." */
export function rotuloDoPeriodo(inicio: unknown, fim: unknown): string | null {
  const a = diaDoCalendario(inicio);
  const b = diaDoCalendario(fim);
  if (!a || !b) return null;
  return `${formatadorDia.format(a)} a ${formatadorDia.format(b)}`;
}

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function porDia(v: unknown): PorDia | null {
  if (!Array.isArray(v) || v.length !== 7) return null;
  const nums = v.map(numero);
  if (nums.some((n) => n === null)) return null;
  return nums as unknown as PorDia;
}

/**
 * `null` quando a resposta não é uma entrega válida: não elegível (já viu, não é
 * segunda, sem dados) ou fora do formato.
 */
export function mapearResumo(resposta: unknown): ResumoSemana | null {
  if (typeof resposta !== "object" || resposta === null) return null;
  const r = resposta as Record<string, unknown>;
  if (r.elegivel !== true) return null;

  const periodo = rotuloDoPeriodo(r.inicio, r.fim);
  const leads = numero(r.leads);
  const vendas = numero(r.vendas);
  const receita = numero(r.receita);
  const dia = r.por_dia as Record<string, unknown> | null | undefined;
  const dLeads = porDia(dia?.leads);
  const dVendas = porDia(dia?.vendas);
  const dReceita = porDia(dia?.receita);
  if (!periodo || leads === null || vendas === null || receita === null || !dLeads || !dVendas || !dReceita) {
    return null;
  }

  const ant = r.anterior as Record<string, unknown> | null | undefined;
  const aLeads = numero(ant?.leads);
  const aVendas = numero(ant?.vendas);
  const aReceita = numero(ant?.receita);
  const anterior =
    aLeads !== null && aVendas !== null && aReceita !== null
      ? { leads: aLeads, vendas: aVendas, receita: aReceita }
      : undefined;

  return {
    periodo,
    leads,
    vendas,
    receita,
    porDia: { leads: dLeads, vendas: dVendas, receita: dReceita },
    anterior,
    automacoes: mapearAutomacoes(r.automacoes),
    movimentacao: mapearMovimentacao(r.movimentacao),
    ranking: mapearRanking(r.ranking),
  };
}

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function mapearAutomacoes(v: unknown): ResumoSemana["automacoes"] {
  const o = objeto(v);
  const execucoes = numero(o?.execucoes);
  if (!o || execucoes === null || execucoes <= 0) return undefined;
  const topo = objeto(o.top);
  const nome = texto(topo?.nome);
  const n = numero(topo?.execucoes);
  return {
    execucoes,
    anterior: numero(o.anterior) ?? 0,
    top: nome && n !== null ? { nome, execucoes: n } : null,
  };
}

function mapearMovimentacao(v: unknown): ResumoSemana["movimentacao"] {
  const o = objeto(v);
  const total = numero(o?.total);
  const topo = objeto(o?.top);
  const nome = texto(topo?.nome);
  const movimentos = numero(topo?.movimentos);
  if (!o || total === null || total <= 0 || !nome || movimentos === null) return undefined;
  return { total, top: { nome, movimentos, voce: topo?.voce === true } };
}

function mapearRanking(v: unknown): ResumoSemana["ranking"] {
  const o = objeto(v);
  const mes = numero(o?.mes);
  const ano = numero(o?.ano);
  if (!o || mes === null || ano === null || mes < 1 || mes > 12 || !Array.isArray(o.top)) return undefined;
  const top: NonNullable<ResumoSemana["ranking"]>["top"] = [];
  for (const item of o.top) {
    const i = objeto(item);
    const nome = texto(i?.nome);
    const valor = numero(i?.valor);
    const vendas = numero(i?.vendas);
    const posicao = numero(i?.posicao);
    if (!i || !nome || valor === null || vendas === null || posicao === null) continue;
    top.push({ nome, valor, vendas, posicao, voce: i.voce === true });
  }
  if (top.length === 0) return undefined;
  const vc = objeto(o.voce);
  const vPos = numero(vc?.posicao);
  const vValor = numero(vc?.valor);
  const vVendas = numero(vc?.vendas);
  return {
    mes,
    ano,
    corrente: o.corrente === true,
    pessoas: numero(o.pessoas) ?? top.length,
    top: top.sort((a, b) => a.posicao - b.posicao),
    voce: vc && vPos !== null && vValor !== null && vVendas !== null ? { posicao: vPos, valor: vValor, vendas: vVendas } : null,
  };
}

/** "Bom dia/Boa tarde/Boa noite" pela hora de Brasília, não pela do aparelho. */
export function saudacaoBrt(agora: Date = new Date()): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "America/Sao_Paulo",
    }).format(agora),
  );
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

/** "outubro", a partir de mês 1–12 (o rótulo do ranking). */
export function nomeDoMes(mes: number, ano: number): string {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(ano, mes - 1, 1)));
}

// ─── Cronograma ──────────────────────────────────────────────────────────────

export type CenaId = "impacto" | "leads" | "vendas" | "receita" | "automacoes" | "movimentacao" | "ranking" | "fecho";

/**
 * A abertura nunca passa disto. Eram 30 s e ficou corrido: cada cena tinha menos
 * tempo do que a própria coreografia pedia, e o número que contava nem chegava a
 * ser lido antes de a câmera sair. 42 s dão a cada cena cerca de 1 s a mais.
 */
export const DURACAO_MAX_MS = 42_000;
/** Quanto uma cena já está entrando enquanto a anterior ainda sai. */
export const SOBREPOSICAO_MS = 700;

/**
 * Duração-base de cada cena, em ms, do tamanho que a coreografia dela pede
 * (a de vendas tem um arrasto de cursor; a de receita, um mergulho no gráfico).
 * Somam 46,9 s e, com 7 sobreposições de 0,7 s, dão exatamente 42 s: com todas
 * as cenas a escala é 1,0 e nada é esticado nem espremido.
 *
 * O fecho é o mais longo de propósito (8,3 s): é o painel-resumo, o último quadro,
 * e quem o lê precisa de tempo — a parede de telas abre nos primeiros ~3 s, o resumo
 * monta em ~2 s, e ele fica inteiro na tela pelo resto.
 */
const DURACAO_BASE_MS: Record<CenaId, number> = {
  impacto: 4_200,
  leads: 5_300,
  vendas: 6_100,
  receita: 6_700,
  automacoes: 5_100,
  movimentacao: 5_100,
  ranking: 6_100,
  fecho: 8_300,
};

/** As cenas que esta org TEM, na ordem em que contam a história. */
export function planejarCenas(resumo: ResumoSemana): CenaId[] {
  const cenas: CenaId[] = ["impacto", "leads", "vendas", "receita"];
  if (resumo.automacoes) cenas.push("automacoes");
  if (resumo.movimentacao) cenas.push("movimentacao");
  if (resumo.ranking) cenas.push("ranking");
  cenas.push("fecho");
  return cenas;
}

export interface CenaNoTempo {
  id: CenaId;
  /** ms desde o início da abertura. */
  inicio: number;
  fim: number;
}

/**
 * Distribui as cenas na linha do tempo. Com poucas cenas, as que sobram são
 * ESTICADAS — mas só até 1,25×: acima disso a coreografia, que tem duração
 * própria, ficaria parada esperando a próxima. Nesse caso a abertura simplesmente
 * dura menos que o teto, o que para uma org com pouco a mostrar é o certo.
 */
export function cronograma(cenas: readonly CenaId[], maximo: number = DURACAO_MAX_MS): CenaNoTempo[] {
  const soma = cenas.reduce((s, c) => s + DURACAO_BASE_MS[c], 0);
  const sobreposicoes = (cenas.length - 1) * SOBREPOSICAO_MS;
  const escala = Math.min(1.25, (maximo + sobreposicoes) / soma);
  const saida: CenaNoTempo[] = [];
  let inicio = 0;
  for (const id of cenas) {
    // O teto é do total, não de cada arredondamento: sem o `min`, 7 cenas somam até
    // 1 ms a mais que o máximo (medido: 42001 > 42000).
    const fim = Math.min(maximo, Math.round(inicio + DURACAO_BASE_MS[id] * escala));
    saida.push({ id, inicio: Math.round(inicio), fim });
    inicio = fim - SOBREPOSICAO_MS;
  }
  return saida;
}
