/**
 * Importação de inadimplentes por planilha — a parte pura.
 *
 * O navegador lê o arquivo (`ler-planilha.ts`) e entrega cabeçalhos + linhas.
 * Aqui: descobrir qual coluna é o quê e transformar cada linha no formato que a
 * RPC `cobranca_importar` recebe. A RPC é quem valida e decide (dry-run conta,
 * real grava); este lado só normaliza número e data no formato brasileiro, que
 * o Postgres não leria sozinho.
 */

export type CampoDaPlanilha =
  | "nome"
  | "documento"
  | "telefone"
  | "email"
  | "contato_nome"
  | "cidade"
  | "numero"
  | "descricao"
  | "valor"
  | "vencimento";

export type MapaDeColunas = Record<CampoDaPlanilha, number>;

export const CAMPOS_OBRIGATORIOS: CampoDaPlanilha[] = ["nome", "valor", "vencimento"];

export const ROTULO_DO_CAMPO: Record<CampoDaPlanilha, string> = {
  nome: "Nome ou razão social",
  documento: "CPF/CNPJ",
  telefone: "Telefone",
  email: "E-mail",
  contato_nome: "Pessoa de contato",
  cidade: "Cidade",
  numero: "Nº do título",
  descricao: "Descrição",
  valor: "Valor em aberto",
  vencimento: "Vencimento",
};

/**
 * Sinônimos por campo. A ORDEM das chaves é a ordem em que os campos disputam
 * as colunas: "Número do documento" é do título (numero vem antes de
 * documento), "Nome do contato" é da pessoa de contato (contato_nome vem antes
 * de nome), e nome fica por último porque "cliente"/"empresa" são genéricos.
 */
const SINONIMOS: [CampoDaPlanilha, string[]][] = [
  ["numero", ["numero", "nº", "n titulo", "titulo", "nota fiscal", "nf", "fatura", "boleto", "duplicata"]],
  ["documento", ["cpf cnpj", "cnpj cpf", "cnpj", "cpf", "documento", "doc"]],
  ["telefone", ["telefone", "celular", "whatsapp", "whats", "fone", "tel"]],
  ["email", ["email", "e mail"]],
  ["vencimento", ["vencimento", "data de vencimento", "data vencimento", "venc", "vence em"]],
  ["valor", ["saldo", "valor em aberto", "valor atualizado", "valor", "montante", "total"]],
  ["cidade", ["cidade", "municipio"]],
  ["contato_nome", ["nome do contato", "contato", "responsavel", "falar com"]],
  ["descricao", ["descricao", "historico", "referencia", "observacao", "obs"]],
  ["nome", ["razao social", "nome fantasia", "nome", "cliente", "devedor", "sacado", "empresa", "razao"]],
];

/** Minúsculas, sem acento, não-alfanumérico vira espaço único. */
export function normalizarCabecalho(h: string): string {
  return (h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/º/g, "o")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function casa(cabecalho: string, sinonimo: string): boolean {
  if (cabecalho === sinonimo) return true;
  // Palavra inteira dentro do cabeçalho: "valor em aberto (R$)" casa "valor em aberto".
  return ` ${cabecalho} `.includes(` ${normalizarCabecalho(sinonimo)} `);
}

/**
 * Cada coluna vai para no máximo um campo; o primeiro sinônimo que casa vence
 * dentro do campo (a lista de sinônimos já está em ordem de preferência — por
 * isso "Saldo" ganha de "Valor original" para `valor`).
 */
export function detectarColunas(cabecalhos: string[]): MapaDeColunas {
  const normalizados = cabecalhos.map(normalizarCabecalho);
  const mapa = Object.fromEntries(SINONIMOS.map(([campo]) => [campo, -1])) as MapaDeColunas;
  const usadas = new Set<number>();
  for (const [campo, sinonimos] of SINONIMOS) {
    let achou = -1;
    for (const sinonimo of sinonimos) {
      achou = normalizados.findIndex((h, i) => !usadas.has(i) && h.length > 0 && casa(h, normalizarCabecalho(sinonimo)));
      if (achou >= 0) break;
    }
    if (achou >= 0) {
      mapa[campo] = achou;
      usadas.add(achou);
    }
  }
  return mapa;
}

export function camposFaltando(mapa: MapaDeColunas): CampoDaPlanilha[] {
  return CAMPOS_OBRIGATORIOS.filter((c) => mapa[c] < 0);
}

/**
 * "R$ 1.234,56" · "1234,56" · "1.234" · "1234.56" · 1234.56 → número.
 * Com vírgula e ponto, o último separador é o decimal. Só ponto: "1.234" e
 * "12.345.678" são milhar; "1.5" é decimal.
 */
export function lerValor(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? Math.round(bruto * 100) / 100 : null;
  if (typeof bruto !== "string") return null;
  let s = bruto.replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const virgula = s.lastIndexOf(",");
  const ponto = s.lastIndexOf(".");
  if (virgula >= 0 && ponto >= 0) {
    s = virgula > ponto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (virgula >= 0) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (ponto >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const EPOCA_EXCEL = Date.UTC(1899, 11, 30);

/**
 * Data → `aaaa-mm-dd`. Aceita Date (o exceljs entrega assim), número de série
 * do Excel, "dd/mm/aaaa", "dd/mm/aa", "dd-mm-aaaa" e "aaaa-mm-dd".
 */
export function lerData(bruto: unknown): string | null {
  const iso = (a: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(a, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  if (bruto instanceof Date) {
    if (Number.isNaN(bruto.getTime())) return null;
    // O exceljs cria a data em UTC à meia-noite: lê em UTC para não voltar um dia.
    return iso(bruto.getUTCFullYear(), bruto.getUTCMonth() + 1, bruto.getUTCDate());
  }
  if (typeof bruto === "number" && bruto > 20000 && bruto < 80000) {
    const dt = new Date(EPOCA_EXCEL + Math.round(bruto) * 86_400_000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof bruto !== "string") return null;
  const s = bruto.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(ano, Number(m[2]), Number(m[1]));
  }
  return null;
}

function texto(bruto: unknown): string | undefined {
  if (bruto == null) return undefined;
  const s = String(bruto).trim();
  return s.length ? s : undefined;
}

/** O que a RPC recebe por linha (chaves = parâmetros de `cobranca_importar`). */
export interface LinhaParaImportar {
  nome?: string;
  documento?: string;
  telefone?: string;
  email?: string;
  contato_nome?: string;
  cidade?: string;
  numero?: string;
  descricao?: string;
  /** Número com ponto decimal, ou o texto cru quando ilegível (o banco aponta a linha). */
  valor?: number | string;
  /** `aaaa-mm-dd`, ou o texto cru quando ilegível. */
  vencimento?: string;
}

export interface LinhasMontadas {
  linhas: LinhaParaImportar[];
  /** Número da linha na planilha (1 = cabeçalho) de cada item de `linhas`. */
  linhaNaPlanilha: number[];
}

/** Linhas totalmente vazias são descartadas; o resto vai como está para o banco julgar. */
export function montarLinhas(linhas: unknown[][], mapa: MapaDeColunas): LinhasMontadas {
  const saida: LinhaParaImportar[] = [];
  const origem: number[] = [];
  linhas.forEach((celulas, i) => {
    if (!celulas || celulas.every((c) => texto(c) === undefined)) return;
    const pega = (campo: CampoDaPlanilha) => (mapa[campo] >= 0 ? celulas[mapa[campo]] : undefined);
    const valorBruto = pega("valor");
    const vencBruto = pega("vencimento");
    const linha: LinhaParaImportar = {
      nome: texto(pega("nome")),
      documento: texto(pega("documento")),
      telefone: texto(pega("telefone")),
      email: texto(pega("email")),
      contato_nome: texto(pega("contato_nome")),
      cidade: texto(pega("cidade")),
      numero: texto(pega("numero")),
      descricao: texto(pega("descricao")),
      valor: lerValor(valorBruto) ?? texto(valorBruto),
      vencimento: lerData(vencBruto) ?? texto(vencBruto),
    };
    saida.push(Object.fromEntries(Object.entries(linha).filter(([, v]) => v !== undefined)) as LinhaParaImportar);
    origem.push(i + 2);
  });
  return { linhas: saida, linhaNaPlanilha: origem };
}
