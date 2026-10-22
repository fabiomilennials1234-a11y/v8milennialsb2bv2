/**
 * Formas de dado da área de cobrança, como a tela as consome.
 *
 * As views e RPCs (`cobranca_inadimplentes_resumo`, `cobranca_metricas`…)
 * devolvem numeric como string e jsonb solto; os parsers abaixo são a única
 * porta, para nenhum componente fazer `Number(row.saldo)` por conta própria.
 */

export type Origem = "erp" | "planilha" | "manual";
export type PapelDaEtapa = "aberta" | "recuperado" | "perdido" | "cancelado";
export type Desfecho = "recuperado" | "perdido" | "cancelado";
export type TipoDeCompromisso = "promessa" | "acordo";
export type CanalDeContato = "whatsapp" | "telefone" | "email" | "presencial" | "outro";
export type ResultadoDoContato = "falou" | "nao_atendeu" | "recado" | "outro";

export interface Etapa {
  id: string;
  nome: string;
  posicao: number;
  papel: PapelDaEtapa;
  cor: string;
  pausaRegua: boolean;
  /** O caso entra sozinho com N dias de atraso (só para a frente). null = coluna de fase. */
  entradaDias: number | null;
  /** Sai quando o caso entra: pela régua, ou à mão com "Mover e enviar". */
  mensagem: string | null;
  /** Liga/desliga a entrada automática (e a mensagem dela). Não afeta o envio à mão. */
  automacaoAtiva: boolean;
}

export interface InadimplenteResumo {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  contatoNome: string | null;
  cidade: string | null;
  origem: Origem;
  naoContatar: boolean;
  criadoEm: string;
  casoId: string | null;
  etapaId: string | null;
  etapaNome: string | null;
  etapaPapel: PapelDaEtapa | null;
  etapaCor: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  posicao: number;
  abertoEm: string | null;
  etapaDesde: string | null;
  titulosAbertos: number;
  saldoAberto: number;
  vencimentoMaisAntigo: string | null;
  compromissoTipo: TipoDeCompromisso | null;
  compromissoProximaVencimento: string | null;
  compromissoProximaValor: number | null;
  compromissoParcelas: number | null;
  ultimoContatoEm: string | null;
  ultimoContatoCanal: CanalDeContato | null;
  ultimoDesfecho: Desfecho | null;
  ultimoEncerramento: string | null;
}

export interface TituloSaldo {
  id: string;
  origem: Origem;
  numero: string | null;
  descricao: string | null;
  valor: number;
  valorPago: number;
  saldo: number;
  vencimento: string;
  status: "aberto" | "pago" | "cancelado" | "baixado";
  pagoEm: string | null;
}

export interface EventoDoCaso {
  id: number;
  tipo: string;
  dados: Record<string, unknown>;
  autorId: string | null;
  criadoEm: string;
}

export interface MetricasDaCobranca {
  emAberto: number;
  casosAbertos: number;
  titulosAbertos: number;
  faixas: { aVencer: number; ate30: number; ate60: number; ate90: number; acima90: number };
  recuperadoMes: number;
  recuperadoMesAnterior: number;
  acordosAtivos: number;
  acordosAtivosValor: number;
  quebrasMes: number;
  compromissosHoje: number;
  compromissosHojeValor: number;
  semContato7d: number;
  semContato7dValor: number;
  recuperadosMes: number;
  diasAtePagarMediana: number | null;
}

export interface ResultadoDaImportacao {
  dryRun: boolean;
  linhas: number;
  inadimplentesNovos: number;
  inadimplentesExistentes: number;
  titulosNovos: number;
  titulosAtualizados: number;
  casosAbertos: number;
  linhasInvalidas: { linha: number; motivo: string }[];
}

type Linha = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOuNulo = (v: unknown): number | null => (v == null ? null : num(v));
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function parseEtapa(r: Linha): Etapa {
  return {
    id: String(r.id),
    nome: String(r.nome),
    posicao: num(r.posicao),
    papel: r.papel as PapelDaEtapa,
    cor: String(r.cor),
    pausaRegua: r.pausa_regua === true,
    entradaDias: numOuNulo(r.entrada_dias),
    mensagem: str(r.mensagem),
    automacaoAtiva: r.automacao_ativa !== false,
  };
}

export function parseResumo(r: Linha): InadimplenteResumo {
  return {
    id: String(r.id),
    nome: String(r.nome),
    documento: str(r.documento),
    telefone: str(r.telefone),
    email: str(r.email),
    contatoNome: str(r.contato_nome),
    cidade: str(r.cidade),
    origem: r.origem as Origem,
    naoContatar: r.nao_contatar === true,
    criadoEm: String(r.created_at),
    casoId: str(r.caso_id),
    etapaId: str(r.etapa_id),
    etapaNome: str(r.etapa_nome),
    etapaPapel: (str(r.etapa_papel) as PapelDaEtapa | null) ?? null,
    etapaCor: str(r.etapa_cor),
    responsavelId: str(r.responsavel_id),
    responsavelNome: str(r.responsavel_nome),
    posicao: num(r.posicao),
    abertoEm: str(r.aberto_em),
    etapaDesde: str(r.etapa_desde),
    titulosAbertos: num(r.titulos_abertos),
    saldoAberto: num(r.saldo_aberto),
    vencimentoMaisAntigo: str(r.vencimento_mais_antigo),
    compromissoTipo: (str(r.compromisso_tipo) as TipoDeCompromisso | null) ?? null,
    compromissoProximaVencimento: str(r.compromisso_proxima_vencimento),
    compromissoProximaValor: numOuNulo(r.compromisso_proxima_valor),
    compromissoParcelas: numOuNulo(r.compromisso_parcelas),
    ultimoContatoEm: str(r.ultimo_contato_em),
    ultimoContatoCanal: (str(r.ultimo_contato_canal) as CanalDeContato | null) ?? null,
    ultimoDesfecho: (str(r.ultimo_desfecho) as Desfecho | null) ?? null,
    ultimoEncerramento: str(r.ultimo_encerramento),
  };
}

export function parseTitulo(r: Linha): TituloSaldo {
  return {
    id: String(r.id),
    origem: r.origem as Origem,
    numero: str(r.numero),
    descricao: str(r.descricao),
    valor: num(r.valor),
    valorPago: num(r.valor_pago),
    saldo: num(r.saldo),
    vencimento: String(r.vencimento),
    status: r.status as TituloSaldo["status"],
    pagoEm: str(r.pago_em),
  };
}

export function parseEvento(r: Linha): EventoDoCaso {
  return {
    id: num(r.id),
    tipo: String(r.tipo),
    dados: (r.dados && typeof r.dados === "object" ? r.dados : {}) as Record<string, unknown>,
    autorId: str(r.autor_id),
    criadoEm: String(r.created_at),
  };
}

export function parseMetricas(raw: unknown): MetricasDaCobranca {
  const m = (raw && typeof raw === "object" ? raw : {}) as Linha;
  const f = (m.faixas && typeof m.faixas === "object" ? m.faixas : {}) as Linha;
  return {
    emAberto: num(m.em_aberto),
    casosAbertos: num(m.casos_abertos),
    titulosAbertos: num(m.titulos_abertos),
    faixas: {
      aVencer: num(f.a_vencer),
      ate30: num(f.ate_30),
      ate60: num(f.ate_60),
      ate90: num(f.ate_90),
      acima90: num(f.acima_90),
    },
    recuperadoMes: num(m.recuperado_mes),
    recuperadoMesAnterior: num(m.recuperado_mes_anterior),
    acordosAtivos: num(m.acordos_ativos),
    acordosAtivosValor: num(m.acordos_ativos_valor),
    quebrasMes: num(m.quebras_mes),
    compromissosHoje: num(m.compromissos_hoje),
    compromissosHojeValor: num(m.compromissos_hoje_valor),
    semContato7d: num(m.sem_contato_7d),
    semContato7dValor: num(m.sem_contato_7d_valor),
    recuperadosMes: num(m.recuperados_mes),
    diasAtePagarMediana: numOuNulo(m.dias_ate_pagar_mediana),
  };
}

export function parseImportacao(raw: unknown): ResultadoDaImportacao {
  const r = (raw && typeof raw === "object" ? raw : {}) as Linha;
  const invalidas = Array.isArray(r.linhas_invalidas) ? (r.linhas_invalidas as Linha[]) : [];
  return {
    dryRun: r.dry_run === true,
    linhas: num(r.linhas),
    inadimplentesNovos: num(r.inadimplentes_novos),
    inadimplentesExistentes: num(r.inadimplentes_existentes),
    titulosNovos: num(r.titulos_novos),
    titulosAtualizados: num(r.titulos_atualizados),
    casosAbertos: num(r.casos_abertos),
    linhasInvalidas: invalidas.map((l) => ({ linha: num(l.linha), motivo: String(l.motivo ?? "") })),
  };
}
