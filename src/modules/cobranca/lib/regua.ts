/**
 * A régua de cobrança (entrega 2) como a tela a consome: configuração, passos,
 * envios, prévia — e o texto da mensagem.
 *
 * ⚠️ `renderizarMensagem` é GÊMEO de `supabase/functions/_shared/cobranca-regua-mensagem.ts`,
 * que é o que o devedor recebe. O teste `tests/unit/cobranca-regua-edge.test.ts`
 * roda os mesmos casos nos dois: a prévia não pode mentir.
 */

export type Gatilho = "atraso" | "lembrete_compromisso";
export type StatusDoEnvio = "pendente" | "enviando" | "enviado" | "falhou" | "pulado" | "cancelado";
export type DiaIso = "1" | "2" | "3" | "4" | "5" | "6" | "7";
export type Janela = Partial<Record<DiaIso, { inicio: string; fim: string }>>;

export interface ConfiguracaoDaRegua {
  ativa: boolean;
  janela: Janela;
  tetoDiario: number;
  intervaloMinSegundos: number;
  intervaloMaxSegundos: number;
  pausaAposRespostaDias: number;
  intervaloMinimoDias: number;
  comoPagar: string | null;
  etapaAposQuebraId: string | null;
  atualizadaEm: string | null;
}

export interface PassoDaRegua {
  id: string;
  gatilho: Gatilho;
  dias: number;
  mensagem: string | null;
  moverParaEtapaId: string | null;
  ativo: boolean;
}

export interface EnvioDaRegua {
  id: string;
  casoId: string;
  inadimplenteId: string;
  gatilho: Gatilho;
  dias: number;
  status: StatusDoEnvio;
  motivo: string | null;
  agendadoPara: string;
  enviadoEm: string | null;
  texto: string | null;
  ultimoErro: string | null;
  atualizadoEm: string;
}

export interface CandidatoDaPrevia {
  casoId: string;
  inadimplenteId: string;
  nome: string;
  gatilho: Gatilho;
  dias: number;
  status: "pendente" | "pulado";
  motivo: string | null;
  moverPara: string | null;
  mensagem: string | null;
  variaveis: Record<string, unknown>;
}

export interface PreviaDaRegua {
  configurada: boolean;
  ativa: boolean;
  numeroPronto: boolean;
  naJanela: boolean;
  proximaJanela: string | null;
  tetoDiario: number;
  enviadosHoje: number;
  naFila: number;
  candidatos: CandidatoDaPrevia[];
}

type Linha = Record<string, unknown>;
const num = (v: unknown, padrao = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : padrao;
};
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

export function parseConfiguracao(r: Linha): ConfiguracaoDaRegua {
  return {
    ativa: r.ativa === true,
    janela: (r.janela && typeof r.janela === "object" ? r.janela : {}) as Janela,
    tetoDiario: num(r.teto_diario, 30),
    intervaloMinSegundos: num(r.intervalo_min_segundos, 60),
    intervaloMaxSegundos: num(r.intervalo_max_segundos, 180),
    pausaAposRespostaDias: num(r.pausa_apos_resposta_dias, 3),
    intervaloMinimoDias: num(r.intervalo_minimo_dias, 2),
    comoPagar: str(r.como_pagar),
    etapaAposQuebraId: str(r.etapa_apos_quebra_id),
    atualizadaEm: str(r.updated_at),
  };
}

export function parsePasso(r: Linha): PassoDaRegua {
  return {
    id: String(r.id),
    gatilho: r.gatilho === "lembrete_compromisso" ? "lembrete_compromisso" : "atraso",
    dias: num(r.dias),
    mensagem: str(r.mensagem),
    moverParaEtapaId: str(r.mover_para_etapa_id),
    ativo: r.ativo !== false,
  };
}

export function parseEnvio(r: Linha): EnvioDaRegua {
  return {
    id: String(r.id),
    casoId: String(r.caso_id),
    inadimplenteId: String(r.inadimplente_id),
    gatilho: r.gatilho === "lembrete_compromisso" ? "lembrete_compromisso" : "atraso",
    dias: num(r.dias),
    status: String(r.status) as StatusDoEnvio,
    motivo: str(r.motivo),
    agendadoPara: String(r.agendado_para),
    enviadoEm: str(r.enviado_em),
    texto: str(r.texto),
    ultimoErro: str(r.ultimo_erro),
    atualizadoEm: String(r.updated_at),
  };
}

export function parsePrevia(raw: unknown): PreviaDaRegua {
  const r = (raw && typeof raw === "object" ? raw : {}) as Linha;
  const candidatos = Array.isArray(r.candidatos) ? (r.candidatos as Linha[]) : [];
  return {
    configurada: r.configurada === true,
    ativa: r.ativa === true,
    numeroPronto: r.numero_pronto === true,
    naJanela: r.na_janela === true,
    proximaJanela: str(r.proxima_janela),
    tetoDiario: num(r.teto_diario, 30),
    enviadosHoje: num(r.enviados_hoje),
    naFila: num(r.na_fila),
    candidatos: candidatos.map((c) => ({
      casoId: String(c.caso_id),
      inadimplenteId: String(c.inadimplente_id),
      nome: String(c.nome ?? ""),
      gatilho: c.gatilho === "lembrete_compromisso" ? "lembrete_compromisso" : "atraso",
      dias: num(c.dias),
      status: c.status === "pulado" ? "pulado" : "pendente",
      motivo: str(c.motivo),
      moverPara: str(c.mover_para),
      mensagem: str(c.mensagem),
      variaveis: (c.variaveis && typeof c.variaveis === "object" ? c.variaveis : {}) as Record<string, unknown>,
    })),
  };
}

// ── Texto ──────────────────────────────────────────────────────────────────

export const VARIAVEIS_DA_REGUA: { chave: string; rotulo: string; exemplo: unknown; soLembrete?: boolean }[] = [
  { chave: "primeiro_nome", rotulo: "Primeiro nome", exemplo: "Joana" },
  { chave: "nome", rotulo: "Nome completo", exemplo: "Joana Prates" },
  { chave: "empresa", rotulo: "Sua empresa", exemplo: "Sua Empresa" },
  { chave: "valor", rotulo: "Valor em aberto", exemplo: 1840.5 },
  { chave: "vencimento", rotulo: "Vencimento mais antigo", exemplo: "2026-10-05" },
  { chave: "dias_atraso", rotulo: "Dias de atraso", exemplo: 16 },
  { chave: "titulos", rotulo: "Títulos em aberto", exemplo: 2 },
  { chave: "como_pagar", rotulo: "Como pagar", exemplo: "PIX: financeiro@empresa.com.br" },
  { chave: "parcela_valor", rotulo: "Valor da parcela", exemplo: 460, soLembrete: true },
  { chave: "parcela_vencimento", rotulo: "Vencimento da parcela", exemplo: "2026-10-30", soLembrete: true },
  { chave: "quando", rotulo: "Quando (hoje/amanhã)", exemplo: "amanhã", soLembrete: true },
];

const DINHEIRO = new Set(["valor", "parcela_valor"]);
const DATA = new Set(["vencimento", "parcela_vencimento"]);

export function formatarVariavel(chave: string, valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (DINHEIRO.has(chave)) {
    const n = typeof valor === "number" ? valor : Number(valor);
    return Number.isFinite(n)
      ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ")
      : "";
  }
  if (DATA.has(chave)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valor);
  }
  return String(valor).trim();
}

export function renderizarMensagem(modelo: string, variaveis: Record<string, unknown>): string {
  const linhas: string[] = [];
  for (const original of modelo.replace(/\r\n?/g, "\n").split("\n")) {
    const linha = original
      .replace(/\{([a-z_]+)\}/g, (_inteiro, chave: string) => formatarVariavel(chave, variaveis[chave]))
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    if (linha === "" && original.trim() !== "") continue;
    linhas.push(linha);
  }
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function variaveisDeExemplo(comoPagar: string | null, empresa?: string): Record<string, unknown> {
  const v: Record<string, unknown> = Object.fromEntries(VARIAVEIS_DA_REGUA.map((x) => [x.chave, x.exemplo]));
  v.como_pagar = comoPagar ?? "";
  if (empresa) v.empresa = empresa;
  return v;
}

/** Chaves usadas no texto que não existem (erro de digitação vira texto sumido). */
export function variaveisDesconhecidas(modelo: string): string[] {
  const conhecidas = new Set(VARIAVEIS_DA_REGUA.map((x) => x.chave));
  const usadas = [...modelo.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
  return [...new Set(usadas.filter((u) => !conhecidas.has(u)))];
}

// ── Rótulos ────────────────────────────────────────────────────────────────

export const DIAS_DA_SEMANA: { dia: DiaIso; curto: string; longo: string }[] = [
  { dia: "1", curto: "Seg", longo: "Segunda" },
  { dia: "2", curto: "Ter", longo: "Terça" },
  { dia: "3", curto: "Qua", longo: "Quarta" },
  { dia: "4", curto: "Qui", longo: "Quinta" },
  { dia: "5", curto: "Sex", longo: "Sexta" },
  { dia: "6", curto: "Sáb", longo: "Sábado" },
  { dia: "7", curto: "Dom", longo: "Domingo" },
];

export function rotuloDoPasso(p: { gatilho: Gatilho; dias: number }): string {
  if (p.gatilho === "lembrete_compromisso") {
    return p.dias === 0 ? "No dia da promessa/parcela" : p.dias === 1 ? "Véspera da promessa/parcela" : `${p.dias} dias antes da promessa/parcela`;
  }
  return p.dias === 1 ? "1 dia de atraso" : `${p.dias} dias de atraso`;
}

export function marcaDoPasso(p: { gatilho: Gatilho; dias: number }): string {
  return p.gatilho === "lembrete_compromisso" ? (p.dias === 0 ? "D0" : `D-${p.dias}`) : `D+${p.dias}`;
}

export const ROTULO_STATUS_ENVIO: Record<StatusDoEnvio, string> = {
  pendente: "Na fila",
  enviando: "Enviando",
  enviado: "Enviado",
  falhou: "Falhou",
  pulado: "Pulado",
  cancelado: "Cancelado",
};

export const ROTULO_MOTIVO: Record<string, string> = {
  so_etapa: "Só muda a etapa",
  sem_telefone: "Sem telefone",
  nao_contatar: "Pediu para não receber",
  caso_encerrado: "Caso encerrado",
  arquivado: "Inadimplente arquivado",
  etapa_pausada: "Etapa pausa a régua",
  compromisso_ativo: "Tem promessa ou acordo",
  compromisso_encerrado: "Compromisso encerrado",
  divida_mudou: "A dívida mudou (pagamento)",
  passo_desligado: "Passo desligado",
  passo_removido: "Passo removido",
  regua_desligada: "Régua desligada",
  sem_numero: "Sem número da cobrança",
  cancelado_pela_equipe: "Cancelado pela equipe",
  resultado_incerto: "Resultado incerto",
  sem_whatsapp: "Número sem WhatsApp",
  erro_no_envio: "Erro no envio",
};
