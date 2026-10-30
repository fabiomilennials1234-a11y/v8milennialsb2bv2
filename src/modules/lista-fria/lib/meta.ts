/**
 * Arquivo de lista de clientes para criar um Público Personalizado no Meta
 * (Gerenciador de Anúncios → Públicos → Lista de clientes).
 *
 * O Meta lê o arquivo, normaliza e aplica o hash SHA-256 no upload. Por isso o
 * arquivo vai em texto puro, mas já normalizado como ele espera:
 *   - separador `,` e UTF-8 SEM BOM (o BOM suja o nome da 1ª coluna; o `;` do
 *     CSV de planilha não é lido);
 *   - `email` minúsculo; `phone` só dígitos, com DDI;
 *   - `fn`/`ln` minúsculos, sem pontuação; `ct` só a-z, sem espaço; `st` com 2
 *     letras; `country` com 2 letras.
 *
 * Os resultados não guardam CEP, então não há coluna `zip`. `fn`/`ln` só entram
 * no Instagram: em Maps e CNPJ o nome é de empresa, não de pessoa.
 *
 * Todo valor passa por normalização que só deixa letras, dígitos e `@._+-`: não
 * sobra `=`, `+` ou `@` no começo de célula, então não há CSV injection.
 */
import type { FonteDaBusca, Resultado } from "./tipos";

export interface LocalDaBusca {
  /** "São Paulo" — vazio quando a busca não é por cidade. */
  cidade: string | null;
  /** "SP" */
  uf: string | null;
}

export const SEM_LOCAL: LocalDaBusca = { cidade: null, uf: null };

const COLUNAS = ["email", "phone", "fn", "ln", "ct", "st", "country"] as const;
type Coluna = (typeof COLUNAS)[number];
type Linha = Record<Coluna, string>;

const EMAIL_SEGURO = /^[a-z0-9_][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/;
const UF = /^[a-z]{2}$/;

/** "São Paulo - SP" → { cidade: "São Paulo", uf: "SP" }. Sem UF no fim, tudo é cidade. */
export function localDoTextoDeCidade(texto: string | null | undefined): LocalDaBusca {
  const t = (texto ?? "").trim();
  const m = /^(.*?)\s*[-–]\s*([A-Za-z]{2})$/.exec(t);
  if (m && m[1]) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
  return { cidade: t || null, uf: null };
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export function normalizarEmail(v: string | null): string {
  const e = (v ?? "").trim().toLowerCase();
  return EMAIL_SEGURO.test(e) ? e : "";
}

/** Telefones do banco já são `^[0-9]{10,15}$`; aqui só se tira zero à esquerda e se confere de novo. */
export function normalizarTelefone(v: string | null): string {
  const d = (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return d.length >= 10 && d.length <= 15 ? d : "";
}

/** Letras e espaços, minúsculo. Hífen e apóstrofo colam ("Ana-Paula" → "anapaula"); o resto da pontuação, emoji e dígitos saem. */
function normalizarNome(v: string): string {
  return v
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’-]/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primeiroEUltimoNome(nome: string): { fn: string; ln: string } {
  const partes = normalizarNome(nome).split(" ").filter(Boolean);
  if (partes.length === 0) return { fn: "", ln: "" };
  if (partes.length === 1) return { fn: partes[0], ln: "" };
  return { fn: partes[0], ln: partes[partes.length - 1] };
}

/** `ct`: só a-z, sem acento nem espaço ("são paulo" → "saopaulo"). */
export function normalizarCidade(v: string | null): string {
  return semAcento((v ?? "").toLowerCase()).replace(/[^a-z]/g, "");
}

function normalizarUf(v: string | null): string {
  const uf = (v ?? "").trim().toLowerCase();
  return UF.test(uf) ? uf : "";
}

export interface ArquivoMeta {
  csv: string;
  /** Linhas gravadas no arquivo. */
  linhas: number;
  /** Resultados que ficaram de fora: sem e-mail nem telefone aproveitável, ou repetidos. */
  descartados: number;
}

function celula(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function montarArquivoMeta(
  resultados: readonly Resultado[],
  fonte: FonteDaBusca,
  local: LocalDaBusca = SEM_LOCAL,
): ArquivoMeta {
  const pessoa = fonte === "instagram";
  const localizada = fonte !== "instagram";
  const ct = normalizarCidade(local.cidade);
  const st = normalizarUf(local.uf);
  const country = localizada ? "br" : "";

  const emailsVistos = new Set<string>();
  const telefonesVistos = new Set<string>();
  const linhas: Linha[] = [];

  for (const r of resultados) {
    // Repetido em outra linha: o identificador sai desta, o resto da linha fica.
    let email = r.qualidade === "email_invalido" ? "" : normalizarEmail(r.email);
    let phone = normalizarTelefone(r.telefone);
    if (email && emailsVistos.has(email)) email = "";
    if (phone && telefonesVistos.has(phone)) phone = "";
    if (!email && !phone) continue;
    if (email) emailsVistos.add(email);
    if (phone) telefonesVistos.add(phone);

    const { fn, ln } = pessoa ? primeiroEUltimoNome(r.nome) : { fn: "", ln: "" };
    linhas.push({ email, phone, fn, ln, ct, st, country });
  }

  // Coluna que ficou vazia em todas as linhas não vai no arquivo: o Meta a mostraria como campo sem dados.
  const usadas = COLUNAS.filter((c) => linhas.some((l) => l[c] !== ""));
  const corpo = linhas.map((l) => usadas.map((c) => celula(l[c])).join(","));
  const csv = [usadas.join(","), ...corpo].join("\r\n");

  return { csv: linhas.length > 0 ? csv : "", linhas: linhas.length, descartados: resultados.length - linhas.length };
}

export function nomeDoArquivoMeta(titulo: string, quando: Date = new Date()): string {
  const base = semAcento(titulo)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `publico-meta-${base || "busca"}-${quando.toISOString().slice(0, 10)}.csv`;
}
