/**
 * CNAE na tela da Lista fria (ADR-0043): busca por código ou texto, grupo por prefixo e rótulos.
 *
 * A lista oficial (1.359 subclasses, da Receita) fica em `data/cnaes.json` e só é baixada quando o
 * usuário abre a busca por CNAE. O alvo da busca é uma lista de PREFIXOS de 2 a 7 dígitos: "46" pega
 * o grupo todo, "4639701" um código só. ESPELHA `lista_fria_busca_criar` (migration 20271219000000):
 * o banco decide; aqui só se avisa antes de gastar uma ida ao servidor.
 */

/** [código de 7 dígitos, descrição]. */
export type Cnae = readonly [codigo: string, descricao: string];

export const MAX_CNAES = 20;
const PREFIXO = /^\d{2,7}$/;

/** "4639701" -> "4639-7/01"; prefixo curto fica como está com "*": "4639" -> "4639-*". */
export function formatarCnae(codigo: string): string {
  if (codigo.length === 7) return `${codigo.slice(0, 4)}-${codigo[4]}/${codigo.slice(5)}`;
  if (codigo.length >= 5) return `${codigo.slice(0, 4)}-${codigo.slice(4)}*`;
  return `${codigo}*`;
}

export const semAcento = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O que o usuário digitou como código, só dígitos (aceita "46.39-7/01"); null se não for código. */
export function digitosDoCodigo(termo: string): string | null {
  if (!/^[\d.\-/\s]+$/.test(termo.trim())) return null;
  const d = termo.replace(/\D/g, "");
  return PREFIXO.test(d) ? d : null;
}

/** Subclasses que casam com o termo: por prefixo de código ou por todas as palavras da descrição. */
export function buscarCnaes(lista: readonly Cnae[], termo: string, limite = 40): Cnae[] {
  const t = termo.trim();
  if (t.length < 2) return [];
  const cod = digitosDoCodigo(t);
  if (cod) return lista.filter(([c]) => c.startsWith(cod)).slice(0, limite);
  const palavras = semAcento(t).split(/\s+/).filter((p) => p.length >= 2);
  if (palavras.length === 0) return [];
  const achou: Cnae[] = [];
  for (const item of lista) {
    const d = semAcento(item[1]);
    if (palavras.every((p) => d.includes(p))) {
      achou.push(item);
      if (achou.length >= limite) break;
    }
  }
  return achou;
}

/** Quantas subclasses um prefixo cobre. */
export const contarDoPrefixo = (lista: readonly Cnae[], prefixo: string): number => lista.filter(([c]) => c.startsWith(prefixo)).length;

/**
 * Adiciona um prefixo à seleção. Um prefixo mais amplo absorve os que já estão dentro dele ("46"
 * engole "4639701") e um já coberto não entra. Respeita o teto do banco. Devolve a seleção nova.
 */
export function adicionarPrefixo(selecionados: readonly string[], prefixo: string): string[] {
  if (!PREFIXO.test(prefixo)) return [...selecionados];
  if (selecionados.some((s) => prefixo.startsWith(s))) return [...selecionados];
  const sem = selecionados.filter((s) => !s.startsWith(prefixo));
  if (sem.length >= MAX_CNAES) return [...selecionados];
  return [...sem, prefixo];
}

export const removerPrefixo = (selecionados: readonly string[], prefixo: string): string[] => selecionados.filter((s) => s !== prefixo);

/** Descrição de um prefixo para o chip: a da subclasse, ou a da primeira do grupo + quantas são. */
export function descricaoDoPrefixo(lista: readonly Cnae[], prefixo: string): string {
  const doGrupo = lista.filter(([c]) => c.startsWith(prefixo));
  if (doGrupo.length === 0) return "";
  if (doGrupo.length === 1) return doGrupo[0][1];
  return `${doGrupo[0][1]} e mais ${doGrupo.length - 1}`;
}

/** Texto curto de uma lista de prefixos para títulos: "4639-7/01" ou "3 CNAEs". */
export function resumoDosCnaes(prefixos: readonly string[]): string {
  if (prefixos.length === 0) return "";
  if (prefixos.length === 1) return `CNAE ${formatarCnae(prefixos[0])}`;
  return `${prefixos.length} CNAEs`;
}
