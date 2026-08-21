/**
 * Validação do rascunho de template ANTES de submeter à Meta.
 *
 * ─── POR QUE ISTO EXISTE, SE A META JÁ VALIDA ───────────────────────────────
 *
 *   Porque a recusa dela é ASSÍNCRONA E GENÉRICA. O template entra `PENDING`,
 *   volta `REJECTED` horas depois, e o motivo raramente diz qual regra foi
 *   quebrada. Quem escreveu fica com um template morto, nenhuma pista, e o
 *   caminho de descoberta é tentativa e erro em ciclos de horas.
 *
 *   Cada regra abaixo é uma que a Meta recusa e que o node do fornecedor NÃO
 *   checa — ele repassa o que receber. Validar aqui troca "horas até uma recusa
 *   opaca" por "vermelho no formulário, com o motivo".
 *
 * ⚠️ Os limites numéricos vêm da documentação da Meta, não de medição contra
 *    conta viva — como todo o resto desta integração até o primeiro canal real.
 *    Se algum estiver errado, o efeito é recusarmos o que a Meta aceitaria; o
 *    erro na direção oposta (deixar passar) é o caro, e é por isso que na dúvida
 *    a regra fica.
 */

export interface TemplateDraftComponent {
  type: string;
  format?: string | null;
  text?: string | null;
  buttons?: unknown[] | null;
  /**
   * O exemplo que a Meta EXIGE quando o texto tem `{{n}}`.
   *
   * Formato dela, e não nosso: `{ body_text: [["Maria", "1234"]] }` — repare na
   * lista DENTRO da lista, uma linha de exemplos — e `{ header_text: ["Maria"] }`,
   * lista simples. Submeter variável sem isto é recusa certa, assíncrona e
   * genérica: exatamente o que este validador existe para evitar.
   */
  example?: unknown;
}

export interface TemplateDraft {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components: TemplateDraftComponent[];
}

export interface TemplateProblem {
  code: string;
  message: string;
  field?: string;
}

/** Tetos da Meta para botões. Documentados, não medidos contra conta viva. */
const BUTTONS_MAX = 10;
const BUTTONS_PHONE_MAX = 1;
const BUTTONS_URL_MAX = 2;
const BUTTON_TEXT_MAX = 25;
const BUTTON_URL_VARIABLE = /\{\{\s*\d+\s*\}\}/;
const BUTTON_URL_VARIABLE_AT_END = /\{\{\s*\d+\s*\}\}$/;

const CATEGORIES = new Set(["MARKETING", "UTILITY", "AUTHENTICATION"]);

/** Nome aceito pela Meta: minúscula, número e underscore. Nada mais. */
const NAME_RE = /^[a-z0-9_]+$/;

const VARIABLE_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const BODY_MAX = 1024;
const HEADER_TEXT_MAX = 60;
const FOOTER_MAX = 60;

interface Variables {
  positional: number[];
  named: string[];
}

/** Extrai `{{1}}` e `{{nome}}` de um texto. Só dígitos ⇒ posicional. */
function readVariables(text: string | null | undefined): Variables {
  const positional: number[] = [];
  const named: string[] = [];
  if (!text) return { positional, named };

  for (const match of text.matchAll(VARIABLE_RE)) {
    const token = match[1];
    if (/^\d+$/.test(token)) positional.push(Number(token));
    else named.push(token);
  }
  return { positional, named };
}

function componentsOfType(draft: TemplateDraft, type: string): TemplateDraftComponent[] {
  return draft.components.filter((c) => (c.type ?? "").trim().toUpperCase() === type);
}

export function validateTemplateDraft(draft: TemplateDraft): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const add = (code: string, message: string, field?: string) =>
    problems.push({ code, message, field });

  // ── Identidade ─────────────────────────────────────────────────────────────
  const name = (draft.name ?? "").trim();
  if (!name) {
    add("name_required", "Dê um nome ao template", "name");
  } else if (!NAME_RE.test(name)) {
    add(
      "name_invalid",
      "O nome aceita apenas letras minúsculas, números e _ (ex.: boas_vindas)",
      "name",
    );
  }

  if (!(draft.language ?? "").trim()) {
    add("language_required", "Escolha o idioma do template", "language");
  }

  if (!CATEGORIES.has(draft.category)) {
    add("category_invalid", "Escolha uma categoria válida", "category");
  }

  // ── Estrutura ──────────────────────────────────────────────────────────────
  // A Meta aceita no máximo um de cada. Dois corpos não são "mais conteúdo":
  // são um template que ela recusa inteiro.
  for (const type of ["HEADER", "BODY", "FOOTER", "BUTTONS"]) {
    if (componentsOfType(draft, type).length > 1) {
      add("duplicate_component", `O template tem mais de um bloco de ${type}`, type.toLowerCase());
    }
  }

  const body = componentsOfType(draft, "BODY")[0];
  if (!body) {
    add("body_required", "O template precisa de um corpo", "body");
  } else {
    const text = (body.text ?? "").trim();
    if (!text) add("body_empty", "Escreva o texto do corpo", "body");
    else if (text.length > BODY_MAX) {
      add("body_too_long", `O corpo passa de ${BODY_MAX} caracteres`, "body");
    }
  }

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  // ── Botões ────────────────────────────────────────────────────────────────
  //
  // ⚠️ ESTAS REGRAS EXISTEM DUAS VEZES: aqui e em
  // `src/modules/communication/lib/template-buttons.ts`, que é quem avisa o
  // vendedor enquanto ele digita. Duplicar não é descuido — o editor não é o
  // único caminho até esta função, e regra que só mora na tela não existe para
  // quem chama a edge function direto. `tests/unit/notificame-template-buttons-twin.test.ts`
  // roda os mesmos casos nas duas e fica vermelho se elas divergirem.
  const blocoDeBotoes = componentsOfType(draft, "BUTTONS")[0];
  if (blocoDeBotoes) {
    const botoes = (Array.isArray(blocoDeBotoes.buttons) ? blocoDeBotoes.buttons : [])
      .map((b) => (b ?? {}) as Record<string, unknown>);

    if (botoes.length > BUTTONS_MAX) {
      add("buttons_too_many", `No máximo ${BUTTONS_MAX} botões por template`, "buttons");
    }

    const tipo = (b: Record<string, unknown>) =>
      typeof b.type === "string" ? b.type.trim().toUpperCase() : "";
    const contar = (t: string) => botoes.filter((b) => tipo(b) === t).length;

    if (contar("PHONE_NUMBER") > BUTTONS_PHONE_MAX) {
      add("buttons_too_many_phone", `No máximo ${BUTTONS_PHONE_MAX} botão de telefone`, "buttons");
    }
    if (contar("URL") > BUTTONS_URL_MAX) {
      add("buttons_too_many_url", `No máximo ${BUTTONS_URL_MAX} botões de link`, "buttons");
    }

    for (const b of botoes) {
      const texto = typeof b.text === "string" ? b.text.trim() : "";
      if (texto.length > BUTTON_TEXT_MAX) {
        add(
          "button_text_too_long",
          `O botão "${texto}" passa de ${BUTTON_TEXT_MAX} caracteres`,
          "buttons",
        );
      }

      if (tipo(b) === "URL") {
        const url = typeof b.url === "string" ? b.url.trim() : "";
        if (!url) {
          add("button_url_required", `O botão "${texto}" está sem endereço`, "buttons");
        } else if (BUTTON_URL_VARIABLE.test(url)) {
          // As duas regras da parte variável são SILENCIOSAS na Meta: ela aceita
          // a criação e recusa horas depois, sem dizer qual foi.
          if (!BUTTON_URL_VARIABLE_AT_END.test(url)) {
            add(
              "button_url_variable_position",
              `No botão "${texto}", a parte variável do link só pode ficar no fim`,
              "buttons",
            );
          }
          const exemplo = Array.isArray(b.example) ? b.example : [];
          if (exemplo.length === 0) {
            add(
              "button_url_example_required",
              `O botão "${texto}" precisa de um exemplo para a parte variável do link`,
              "buttons",
            );
          }
        }
      }

      if (tipo(b) === "PHONE_NUMBER" && !(typeof b.phone_number === "string" && b.phone_number.trim())) {
        add("button_phone_required", `O botão "${texto}" está sem número`, "buttons");
      }
    }
  }

  const header = componentsOfType(draft, "HEADER")[0];
  if (header && (header.format ?? "TEXT").trim().toUpperCase() === "TEXT") {
    const text = (header.text ?? "").trim();
    if (text.length > HEADER_TEXT_MAX) {
      add("header_too_long", `O cabeçalho passa de ${HEADER_TEXT_MAX} caracteres`, "header");
    }
    const vars = readVariables(text);
    if (vars.positional.length + vars.named.length > 1) {
      add("header_too_many_variables", "O cabeçalho aceita no máximo uma variável", "header");
    }
  }

  // ── Rodapé ─────────────────────────────────────────────────────────────────
  const footer = componentsOfType(draft, "FOOTER")[0];
  if (footer) {
    const text = (footer.text ?? "").trim();
    if (text.length > FOOTER_MAX) {
      add("footer_too_long", `O rodapé passa de ${FOOTER_MAX} caracteres`, "footer");
    }
    const vars = readVariables(text);
    if (vars.positional.length + vars.named.length > 0) {
      add("footer_no_variables", "O rodapé não pode conter variáveis", "footer");
    }
  }

  // ── Exemplo das variáveis ──────────────────────────────────────────────────
  //
  // A Meta exige um valor de exemplo por variável, e recusa sem ele. A recusa
  // chega HORAS depois e não diz qual regra caiu — o template fica morto e quem
  // escreveu não tem pista. Esta regra troca isso por um campo vermelho.
  //
  // Vale só para TEXTO: cabeçalho de mídia usa `header_handle`, que esta fatia
  // não cobre.
  const contaExemplos = (exemplo: unknown, chave: "body_text" | "header_text"): number => {
    const e = (exemplo ?? {}) as Record<string, unknown>;
    const bruto = e[chave];
    if (!Array.isArray(bruto)) return 0;
    // `body_text` é lista de LINHAS de exemplo; contamos a primeira linha.
    // `header_text` é lista simples.
    const linha = chave === "body_text"
      ? (Array.isArray(bruto[0]) ? bruto[0] : [])
      : bruto;
    return linha.filter((v) => typeof v === "string" && v.trim()).length;
  };

  if (body) {
    const vars = readVariables((body.text ?? ""));
    const quantas = vars.positional.length + vars.named.length;
    if (quantas > 0) {
      const exemplos = contaExemplos(body.example, "body_text");
      if (exemplos < quantas) {
        add(
          "body_example_required",
          exemplos === 0
            ? "Dê um exemplo para cada variável do corpo — a Meta recusa sem isso"
            : `Faltam exemplos: ${quantas} variáveis no corpo, ${exemplos} exemplo(s)`,
          "body",
        );
      }
    }
  }

  if (header && (header.format ?? "TEXT").trim().toUpperCase() === "TEXT") {
    const vars = readVariables((header.text ?? ""));
    const quantas = vars.positional.length + vars.named.length;
    if (quantas > 0 && contaExemplos(header.example, "header_text") < quantas) {
      add(
        "header_example_required",
        "Dê um exemplo para a variável do cabeçalho — a Meta recusa sem isso",
        "header",
      );
    }
  }

  // ── Variáveis, olhando o template INTEIRO ──────────────────────────────────
  // O formato é uma propriedade do TEMPLATE, não de cada bloco: misturar
  // `{{1}}` com `{{nome}}` é recusado mesmo que cada bloco isolado pareça certo.
  const all: Variables = { positional: [], named: [] };
  for (const c of draft.components) {
    const vars = readVariables(c.text);
    all.positional.push(...vars.positional);
    all.named.push(...vars.named);
  }

  if (all.positional.length > 0 && all.named.length > 0) {
    add(
      "parameter_format_mixed",
      "Use só variáveis numeradas ({{1}}) ou só nomeadas ({{nome}}), nunca as duas",
      "body",
    );
  } else if (all.positional.length > 0) {
    // A sequência tem de ser COMPLETA e começar em 1. `{{1}}` + `{{3}}` é
    // recusado, e a mensagem de recusa não menciona o buraco — é a armadilha
    // mais cara desta tela.
    const distintas = [...new Set(all.positional)].sort((a, b) => a - b);
    const esperado = distintas.length;
    const completa = distintas.every((n, i) => n === i + 1);
    if (!completa) {
      add(
        "positional_gap",
        `As variáveis precisam ser {{1}} até {{${esperado}}}, sem pular números`,
        "body",
      );
    }
  }

  return problems;
}
