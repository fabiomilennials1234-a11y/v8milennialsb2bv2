import { isValidBrDocument, onlyDigits } from "./document";

/**
 * Documentos do lead: 1 CPF OU vários CNPJ (decisão do CTO).
 *
 * Mora em `lead_documents` e só é escrito pela RPC `salvar_documentos_do_lead`
 * (lista completa) ou pelo wrapper `set_lead_document` (só o principal). Aqui
 * ficam as regras puras da tela: o espelho do que o banco recusa, para não
 * gastar uma ida ao banco com o que já se sabe que volta recusado. Quem decide
 * é sempre a RPC.
 *
 * Sem linha principal, o principal EFETIVO é o do ERP (`upsell_clients.cnpj`).
 * Extras (e qualquer documento daqui) NUNCA entram em casamento do Toth.
 */

export const MAX_DOCUMENTOS = 50;
const MAX_ROTULO = 120;

export interface LeadDocumentItem {
  id: string;
  document: string;
  label: string | null;
  isPrimary: boolean;
  source: string;
}

/** O que a ficha manda de volta: a lista inteira, sem id (a RPC casa por documento). */
export interface DocumentoEditado {
  document: string;
  label: string | null;
  isPrimary: boolean;
}

export interface LeadDocumentRow {
  id: string;
  document: string;
  label: string | null;
  is_primary: boolean;
  source: string;
}

export function leadDocumentFromRow(row: LeadDocumentRow): LeadDocumentItem {
  return {
    id: row.id,
    document: row.document,
    label: row.label,
    isPrimary: row.is_primary,
    source: row.source,
  };
}

/** Principal primeiro; o resto na ordem em que chegou (já vem por criação). */
export function ordenarDocumentos<T extends { isPrimary: boolean }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

export function paraEditado(lista: LeadDocumentItem[]): DocumentoEditado[] {
  return lista.map((d) => ({ document: d.document, label: d.label, isPrimary: d.isPrimary }));
}

/** Payload de `p_docs`. */
export function documentosParaRpc(lista: DocumentoEditado[]) {
  return lista.map((d) => ({
    document: onlyDigits(d.document),
    label: d.label?.trim() ? d.label.trim() : null,
    is_primary: d.isPrimary,
  }));
}

const MSG_CPF = "Um lead com CPF não aceita outros documentos";

/** Mensagem de recusa, ou `null` se a lista pode ir ao banco. */
export function validarDocumentosEditados(lista: DocumentoEditado[]): string | null {
  if (lista.length > MAX_DOCUMENTOS) return `Limite de ${MAX_DOCUMENTOS} documentos por lead`;
  const vistos = new Set<string>();
  let principais = 0;
  let cpfs = 0;
  for (const item of lista) {
    const digitos = onlyDigits(item.document);
    if (!isValidBrDocument(digitos)) return "CPF/CNPJ inválido";
    if (vistos.has(digitos)) return "Documento repetido na lista";
    vistos.add(digitos);
    if (item.isPrimary) principais += 1;
    if (digitos.length === 11) cpfs += 1;
    if ((item.label?.trim().length ?? 0) > MAX_ROTULO) return `Rótulo longo demais (máximo ${MAX_ROTULO} caracteres)`;
  }
  if (principais > 1) return "Só pode haver um documento principal";
  if (cpfs > 0 && lista.length > 1) return MSG_CPF;
  return null;
}

export type ResultadoDaEdicao =
  | { ok: true; lista: DocumentoEditado[] }
  | { ok: false; erro: string };

/**
 * Acrescenta um CNPJ extra. Só CNPJ: CPF múltiplo não existe, e lead com CPF
 * não aceita outro documento. Duplicado na própria lista é recusado aqui; o
 * duplicado em OUTRO lead da org só o banco enxerga (PT409).
 */
export function adicionarCnpj(
  lista: LeadDocumentItem[],
  valorDigitado: string,
  rotulo: string,
): ResultadoDaEdicao {
  const digitos = onlyDigits(valorDigitado);
  if (lista.some((d) => d.document.length === 11)) return { ok: false, erro: MSG_CPF };
  if (digitos.length !== 14 || !isValidBrDocument(digitos)) return { ok: false, erro: "Informe um CNPJ válido" };
  if (lista.some((d) => d.document === digitos)) return { ok: false, erro: "Este CNPJ já está na lista" };
  if (lista.length >= MAX_DOCUMENTOS) return { ok: false, erro: `Limite de ${MAX_DOCUMENTOS} documentos por lead` };
  const limpo = rotulo.trim();
  if (limpo.length > MAX_ROTULO) return { ok: false, erro: `Rótulo longo demais (máximo ${MAX_ROTULO} caracteres)` };
  return {
    ok: true,
    lista: [...paraEditado(lista), { document: digitos, label: limpo || null, isPrimary: false }],
  };
}

/** Marca um documento como principal; o principal anterior vira extra. */
export function tornarPrincipal(lista: LeadDocumentItem[], id: string): DocumentoEditado[] {
  return paraEditado(lista).map((d, i) => ({ ...d, isPrimary: lista[i].id === id }));
}

export function removerDocumento(lista: LeadDocumentItem[], id: string): DocumentoEditado[] {
  return paraEditado(lista.filter((d) => d.id !== id));
}

/** Troca o rótulo de um documento; vazio apaga o rótulo. */
export function renomearDocumento(lista: LeadDocumentItem[], id: string, rotulo: string): ResultadoDaEdicao {
  const limpo = rotulo.trim();
  if (limpo.length > MAX_ROTULO) return { ok: false, erro: `Rótulo longo demais (máximo ${MAX_ROTULO} caracteres)` };
  return {
    ok: true,
    lista: paraEditado(lista).map((d, i) => (lista[i].id === id ? { ...d, label: limpo || null } : d)),
  };
}
