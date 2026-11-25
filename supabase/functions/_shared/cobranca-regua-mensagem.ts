/**
 * Texto da régua de cobrança: {variável} → valor, em português do Brasil.
 *
 * ⚠️ GÊMEO NO FRONT: `src/modules/cobranca/lib/regua.ts` (`renderizarMensagem`)
 * faz exatamente isto para a prévia da tela. Mudou aqui, muda lá — os dois têm
 * o mesmo caso de teste (tests/unit/cobranca-regua-edge.test.ts) para que
 * a pessoa veja na prévia o texto que o devedor vai receber.
 *
 * Regras:
 *  - variável desconhecida ou vazia vira nada (nunca "{nome}" cru para o devedor);
 *  - substituição por FUNÇÃO, não por string: valor com "$" não corrompe o texto;
 *  - linha que ficou vazia some (ex.: {como_pagar} não preenchido), espaços
 *    duplicados colapsam, e o resultado sai aparado;
 *  - linhas seguidas que usam variável de título ({titulo_vencimento},
 *    {titulo_valor}, {titulo_numero}) formam um bloco que se repete para cada
 *    item de `lista_titulos`. Bloco de uma linha vira lista; de várias, os
 *    blocos saem separados por linha em branco. Sem título, o bloco some. Se
 *    a lista veio cortada (o banco manda no máximo 20), fecha com
 *    "E mais N títulos em aberto." — N = {titulos} menos os listados.
 */

export type VariaveisDaRegua = Record<string, unknown>;

export const VARIAVEIS_DA_REGUA = [
  "nome", "primeiro_nome", "empresa", "valor", "vencimento", "dias_atraso",
  "titulos", "como_pagar", "parcela_valor", "parcela_vencimento", "quando",
  "prazo_data", "prazo_horario",
] as const;

/** Variável de título → campo do item de `lista_titulos`. */
export const VARIAVEIS_DO_TITULO = {
  titulo_vencimento: "vencimento",
  titulo_valor: "valor",
  titulo_numero: "numero",
} as const;

const DINHEIRO = new Set(["valor", "parcela_valor", "titulo_valor"]);
const DATA = new Set(["vencimento", "parcela_vencimento", "prazo_data", "titulo_vencimento"]);
const MARCA_DE_TITULO = /\{titulo_(?:vencimento|valor|numero)\}/;

function reais(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
}

function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function formatarVariavel(chave: string, valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (DINHEIRO.has(chave)) {
    const n = typeof valor === "number" ? valor : Number(valor);
    return Number.isFinite(n) ? reais(n) : "";
  }
  if (DATA.has(chave)) return dataBr(String(valor));
  return String(valor).trim();
}

/** A linha pronta, ou null quando ela ficou vazia por causa de variável (some). */
function renderizarLinha(original: string, variaveis: VariaveisDaRegua): string | null {
  const linha = original
    .replace(/\{([a-z_]+)\}/g, (_inteiro, chave: string) => formatarVariavel(chave, variaveis[chave]))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  // Linha que ficou vazia por causa de variável some; a que já era vazia
  // (parágrafo) fica.
  return linha === "" && original.trim() !== "" ? null : linha;
}

function titulosDaLista(variaveis: VariaveisDaRegua): VariaveisDaRegua[] {
  const lista = variaveis.lista_titulos;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
    .map((t) => {
      const v: VariaveisDaRegua = { ...variaveis };
      for (const [chave, campo] of Object.entries(VARIAVEIS_DO_TITULO)) v[chave] = t[campo];
      return v;
    });
}

export function renderizarMensagem(modelo: string, variaveis: VariaveisDaRegua): string {
  const originais = modelo.replace(/\r\n?/g, "\n").split("\n");
  const titulos = titulosDaLista(variaveis);
  const total = Number(variaveis.titulos);
  const linhas: string[] = [];
  const empurrar = (linha: string | null) => {
    if (linha !== null) linhas.push(linha);
  };

  for (let i = 0; i < originais.length; ) {
    if (!MARCA_DE_TITULO.test(originais[i])) {
      empurrar(renderizarLinha(originais[i], variaveis));
      i++;
      continue;
    }
    let fim = i;
    while (fim < originais.length && MARCA_DE_TITULO.test(originais[fim])) fim++;
    const bloco = originais.slice(i, fim);
    const separar = bloco.length > 1;
    titulos.forEach((doTitulo, n) => {
      if (separar && n > 0) linhas.push("");
      for (const original of bloco) empurrar(renderizarLinha(original, doTitulo));
    });
    const resto = Number.isFinite(total) ? total - titulos.length : 0;
    if (titulos.length > 0 && resto > 0) {
      if (separar) linhas.push("");
      linhas.push(`E mais ${resto} ${resto === 1 ? "título" : "títulos"} em aberto.`);
    }
    i = fim;
  }
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
