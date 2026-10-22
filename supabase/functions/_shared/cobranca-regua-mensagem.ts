/**
 * Texto da régua de cobrança: {variável} → valor, em português do Brasil.
 *
 * ⚠️ GÊMEO NO FRONT: `src/modules/cobranca/lib/regua.ts` (`renderizarMensagem`)
 * faz exatamente isto para a prévia da tela. Mudou aqui, muda lá — os dois têm
 * o mesmo caso de teste (tests/unit/cobranca-regua-mensagem.test.ts) para que
 * a pessoa veja na prévia o texto que o devedor vai receber.
 *
 * Regras:
 *  - variável desconhecida ou vazia vira nada (nunca "{nome}" cru para o devedor);
 *  - substituição por FUNÇÃO, não por string: valor com "$" não corrompe o texto;
 *  - linha que ficou vazia some (ex.: {como_pagar} não preenchido), espaços
 *    duplicados colapsam, e o resultado sai aparado.
 */

export type VariaveisDaRegua = Record<string, unknown>;

export const VARIAVEIS_DA_REGUA = [
  "nome", "primeiro_nome", "empresa", "valor", "vencimento", "dias_atraso",
  "titulos", "como_pagar", "parcela_valor", "parcela_vencimento", "quando",
] as const;

const DINHEIRO = new Set(["valor", "parcela_valor"]);
const DATA = new Set(["vencimento", "parcela_vencimento"]);

function reais(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
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

export function renderizarMensagem(modelo: string, variaveis: VariaveisDaRegua): string {
  const linhas: string[] = [];
  for (const original of modelo.replace(/\r\n?/g, "\n").split("\n")) {
    const linha = original
      .replace(/\{([a-z_]+)\}/g, (_inteiro, chave: string) => formatarVariavel(chave, variaveis[chave]))
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    // Linha que ficou vazia por causa de variável some; a que já era vazia
    // (parágrafo) fica.
    if (linha === "" && original.trim() !== "") continue;
    linhas.push(linha);
  }
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
