/**
 * template-buttons — os botões de um template, no formato da Meta.
 *
 * ─── O QUE ESTE MÓDULO EXISTE PARA EVITAR ───────────────────────────────────
 *
 * A Meta recusa o template INTEIRO por regra de botão violada, horas depois da
 * criação e com uma mensagem que não diz qual regra foi. Cada validação aqui é
 * uma recusa que o vendedor não descobre no dia seguinte.
 *
 * ⚠️ A doc do fornecedor só exemplifica `QUICK_REPLY`. `URL` e `PHONE_NUMBER`
 * são da Cloud API e o fornecedor repassa `components` cru — o que torna
 * provável que funcionem, e não medido que funcionem.
 */

export type TipoDeBotao = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

/** A parte variável de uma URL de botão. A Meta aceita uma só, e no fim. */
const VARIAVEL = /\{\{\s*\d+\s*\}\}/;

function temVariavel(url: string): boolean {
  return VARIAVEL.test(url);
}

/** A variável está no FIM? É a única posição que a Meta aceita. */
function variavelNoFim(url: string): boolean {
  return /\{\{\s*\d+\s*\}\}$/.test(url.trim());
}

/** O botão como o editor o coleta — em português, porque é forma nossa. */
export interface BotaoDoEditor {
  tipo: TipoDeBotao;
  texto: string;
  /** Só em `URL`. Pode terminar com `{{1}}` para a parte variável. */
  url?: string;
  /**
   * O valor de exemplo da parte variável — o que entra no lugar de `{{1}}`.
   *
   * A Meta EXIGE exemplo para toda variável, e a recusa por falta dele chega
   * horas depois sem dizer o motivo. Foi exatamente essa regra, no `body_text`,
   * que derrubou um template em 2026-08-19.
   */
  exemploDaUrl?: string;
  /** Só em `PHONE_NUMBER`, no formato internacional. */
  telefone?: string;
}

export interface ComponenteDeBotoes {
  type: "BUTTONS";
  buttons: Array<Record<string, unknown>>;
}

/**
 * Monta o componente. `null` quando não há botão.
 *
 * ⚠️ `{type:"BUTTONS", buttons:[]}` é recusado pela Meta — um componente
 * declarado e vazio não é "template sem botão", é template inválido.
 */
export function montarComponenteDeBotoes(
  botoes: BotaoDoEditor[],
): ComponenteDeBotoes | null {
  const usaveis = botoes.filter((b) => b.texto.trim() !== "");
  if (usaveis.length === 0) return null;

  return {
    type: "BUTTONS",
    buttons: usaveis.map((b) => {
      const base = { type: b.tipo, text: b.texto.trim() };
      if (b.tipo === "URL") {
        const url = (b.url ?? "").trim();
        const exemplo = (b.exemploDaUrl ?? "").trim();
        // O `example` da Meta é a URL INTEIRA já resolvida, não só o pedaço
        // variável — e é lista, mesmo com uma variável só.
        return temVariavel(url) && exemplo
          ? { ...base, url, example: [url.replace(VARIAVEL, exemplo)] }
          : { ...base, url };
      }
      if (b.tipo === "PHONE_NUMBER") return { ...base, phone_number: (b.telefone ?? "").trim() };
      return base;
    }),
  };
}

/** Teto de caracteres do rótulo, imposto pela Meta. */
const MAX_TEXTO = 25;
const MAX_BOTOES = 10;
const MAX_TELEFONE = 1;
const MAX_LINK = 2;

/**
 * O que impede este conjunto de botões de ser aceito. Lista vazia = pode enviar.
 *
 * Devolve FRASES, não códigos: quem lê é o vendedor montando o template, e
 * "No máximo 2 botões de link" é acionável enquanto `INVALID_BUTTON_COUNT` não
 * é. Cada item corresponde a uma recusa que a Meta daria horas depois.
 */
export function problemasDosBotoes(botoes: BotaoDoEditor[]): string[] {
  const usaveis = botoes.filter((b) => b.texto.trim() !== "");
  if (usaveis.length === 0) return [];

  const problemas: string[] = [];

  if (usaveis.length > MAX_BOTOES) {
    problemas.push(`No máximo ${MAX_BOTOES} botões por template.`);
  }

  const contar = (t: TipoDeBotao) => usaveis.filter((b) => b.tipo === t).length;
  if (contar("PHONE_NUMBER") > MAX_TELEFONE) {
    problemas.push(`No máximo ${MAX_TELEFONE} botão de telefone.`);
  }
  if (contar("URL") > MAX_LINK) {
    problemas.push(`No máximo ${MAX_LINK} botões de link.`);
  }

  for (const b of usaveis) {
    const texto = b.texto.trim();
    if (texto.length > MAX_TEXTO) {
      problemas.push(`"${texto}" passa de ${MAX_TEXTO} caracteres.`);
    }
    if (b.tipo === "URL") {
      const url = (b.url ?? "").trim();
      if (!url) {
        problemas.push(`"${texto}" é um botão de link e está sem endereço.`);
      } else if (temVariavel(url)) {
        // Duas regras distintas, e as duas silenciosas: a Meta aceita a criação
        // e recusa depois. Separadas de propósito — a ação é diferente em cada.
        if (!variavelNoFim(url)) {
          problemas.push(
            `"${texto}": a parte variável do link só pode ficar no fim do endereço.`,
          );
        }
        if (!(b.exemploDaUrl ?? "").trim()) {
          problemas.push(`"${texto}": preencha um exemplo para a parte variável do link.`);
        }
      }
    }
    if (b.tipo === "PHONE_NUMBER" && !(b.telefone ?? "").trim()) {
      problemas.push(`"${texto}" é um botão de telefone e está sem número.`);
    }
  }

  return problemas;
}
