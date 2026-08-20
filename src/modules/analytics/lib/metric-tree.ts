/**
 * Árvore de métrica personalizada — Emenda 1 do ADR-0023 (aceita 2026-08-11).
 *
 * Este arquivo é o ESPELHO CLIENTE do validador que vive no banco
 * (`fn_metric_tree_validate`, migration 20270813110000). As duas pontas validam
 * a mesma árvore pelas mesmas regras, e é de propósito:
 *
 *   - o banco valida porque a linha gravada sobrevive ao cliente;
 *   - o cliente valida porque "salve e descubra" é uma composição ruim.
 *
 * ⚠ Quando uma regra mudar, mude NOS DOIS. O pgTAP da fatia cobre o lado do
 * banco; `metric-tree.test.ts` cobre este. Divergência entre eles aparece como
 * árvore que o compositor aceita e o `INSERT` recusa — feio, mas seguro: o
 * banco é a autoridade, e o cliente nunca é o único guarda.
 *
 * ⚠ O MOTOR NÃO MULTIPLICA POR 100. Nem aqui, nem no banco. `count ÷ count`
 * deriva `ratio`, não `percent`. Quem quer percentual escreve `(a ÷ b) × 100`
 * na própria árvore — e a profundidade 2 já permite. Isso existe porque o ramo
 * `kind='ratio'` do motor faz o contrário (deriva `percent` e multiplica),
 * enquanto o front apenas SUFIXA '%' sem multiplicar: par incoerente imprime
 * erro de 100× que nada detecta.
 */

// Importa do módulo FOLHA, não de `useMetricMeasure` nem de
// `metrics-studio-engine-map`: os dois dependem (direta ou indiretamente) deste
// arquivo, e o `dependency-cruiser` reprova o ciclo mesmo quando o import é só
// de tipo. Foi assim que o Lint & Build do #1497 caiu na primeira vez.
import type {
  MetricFilters,
  MetricFormatId,
  MetricUnit,
} from "@/modules/analytics/lib/metric-vocabulary";

export type { MetricUnit };

/** Conjunto ENUMERADO. Não é lista aberta — é a fronteira da emenda. */
export const OPERADORES = ["add", "sub", "mul", "div"] as const;
export type MetricTreeOp = (typeof OPERADORES)[number];

export const SIMBOLO_DO_OPERADOR: Record<MetricTreeOp, string> = {
  add: "+",
  sub: "−",
  mul: "×",
  div: "÷",
};

export const ROTULO_DO_OPERADOR: Record<MetricTreeOp, string> = {
  add: "somado a",
  sub: "menos",
  mul: "vezes",
  div: "dividido por",
};

/** Folha = id do catálogo (+ filtro da allowlist) ou número literal. Nunca texto. */
export type MetricTreeNode =
  | { type: "measure"; id: string; filters?: MetricFilters }
  | { type: "literal"; value: number }
  | { type: "op"; op: MetricTreeOp; left: MetricTreeNode; right: MetricTreeNode };

/** Teto da emenda. Três é o menor número que cobre os casos que o grill mediu. */
export const PROFUNDIDADE_MAXIMA = 3;

/** |literal| ≤ 1e12 — mesmo teto do banco. */
export const LITERAL_MAXIMO = 1e12;

/**
 * Espelho EXATO da allowlist de `_metric_tree_unit` no banco. Divergir aqui não
 * abre brecha — o banco valida de novo e recusa — mas faz o compositor prometer
 * o que o servidor nega, ou negar o que ele aceita.
 *
 * `from_stage_key`/`to_stage_key` entraram na 20270820100000 (SCRUM-316).
 */
export const CHAVES_DE_FILTRO = [
  "pipeline_id",
  "member_id",
  "origin",
  "tag_id",
  "product_id",
  "stream",
  "from_stage_key",
  "to_stage_key",
] as const;

/**
 * Tabela-verdade dos operadores. Transcrição literal de
 * `_metric_tree_op_unit` — se divergir, a tela promete número que o banco
 * recusa.
 */
export function unidadeDaOperacao(
  op: MetricTreeOp,
  esquerda: MetricUnit,
  direita: MetricUnit,
): { unit: MetricUnit } | { erro: string } {
  if (op === "add" || op === "sub") {
    if (esquerda !== direita) {
      return { erro: `Não dá para ${op === "add" ? "somar" : "subtrair"} ${rotuloDaUnidade(esquerda)} e ${rotuloDaUnidade(direita)} — são grandezas diferentes.` };
    }
    return { unit: esquerda };
  }

  if (op === "mul") {
    if (direita === "number") return { unit: esquerda };
    if (esquerda === "number") return { unit: direita };
    return { erro: "Multiplicação precisa de um número fixo em um dos lados." };
  }

  // div
  if (direita === "number") return { unit: esquerda };
  if (esquerda === "currency" && direita === "count") return { unit: "currency" };
  if (esquerda === "duration_seconds" && direita === "count") return { unit: "duration_seconds" };
  // count ÷ count cai AQUI — `ratio`, nunca `percent`. Ver o cabeçalho.
  return { unit: "ratio" };
}

export function rotuloDaUnidade(u: MetricUnit): string {
  switch (u) {
    case "currency": return "dinheiro";
    case "count": return "contagem";
    case "duration_seconds": return "tempo";
    case "percent": return "percentual";
    case "ratio": return "razão";
    case "number": return "número fixo";
  }
}

/** Formatos coerentes com a unidade. Espelha `_metric_tree_formats_for_unit`. */
export function formatosDaUnidade(u: MetricUnit): MetricFormatId[] {
  switch (u) {
    case "currency": return ["currency_brl"];
    case "count": return ["integer"];
    case "duration_seconds": return ["duration_human"];
    case "percent": return ["percent_1"];
    // `ratio`/`number` aceitam os dois: `percent_1` é legítimo quando a própria
    // árvore já multiplicou por 100.
    default: return ["ratio_2", "percent_1"];
  }
}

/** Profundidade = operadores empilhados. Folha = 0. */
export function profundidade(node: MetricTreeNode): number {
  if (node.type !== "op") return 0;
  return 1 + Math.max(profundidade(node.left), profundidade(node.right));
}

/** Quantos nós a árvore tem — usado só para o rótulo do compositor. */
export function contarNos(node: MetricTreeNode): number {
  if (node.type !== "op") return 1;
  return 1 + contarNos(node.left) + contarNos(node.right);
}

export type ResultadoValidacao = { unit: MetricUnit } | { erro: string };

export function ehErro(r: ResultadoValidacao): r is { erro: string } {
  return "erro" in r;
}

/**
 * Valida e deriva a unidade. `unidadeDaMedida` vem do catálogo carregado — a
 * lista de medidas que o motor calcula, não um mapa hardcoded, para que medida
 * nova entre sem tocar neste arquivo.
 */
export function validarArvore(
  node: MetricTreeNode | null,
  unidadeDaMedida: (id: string) => MetricUnit | undefined,
  nivel = 1,
): ResultadoValidacao {
  if (!node || typeof node !== "object") {
    return { erro: "Composição incompleta." };
  }

  if (node.type === "literal") {
    if (typeof node.value !== "number" || !Number.isFinite(node.value)) {
      return { erro: "Número fixo inválido." };
    }
    if (Math.abs(node.value) > LITERAL_MAXIMO) {
      return { erro: "Número fixo grande demais." };
    }
    return { unit: "number" };
  }

  if (node.type === "measure") {
    const unit = unidadeDaMedida(node.id);
    if (!unit) return { erro: `A métrica “${node.id}” não está no catálogo.` };
    if (node.filters) {
      const invalida = Object.keys(node.filters).find(
        (k) => !(CHAVES_DE_FILTRO as readonly string[]).includes(k),
      );
      if (invalida) return { erro: `Filtro “${invalida}” não é permitido.` };
    }
    return { unit };
  }

  if (node.type === "op") {
    if (nivel > PROFUNDIDADE_MAXIMA) {
      return { erro: `A composição passou de ${PROFUNDIDADE_MAXIMA} operações encaixadas.` };
    }
    if (!(OPERADORES as readonly string[]).includes(node.op)) {
      return { erro: `Operador “${node.op}” não existe.` };
    }
    const esq = validarArvore(node.left, unidadeDaMedida, nivel + 1);
    if (ehErro(esq)) return esq;
    const dir = validarArvore(node.right, unidadeDaMedida, nivel + 1);
    if (ehErro(dir)) return dir;
    return unidadeDaOperacao(node.op, esq.unit, dir.unit);
  }

  return { erro: "Peça desconhecida na composição." };
}

/**
 * Texto legível da composição, para o cabeçalho da janela e para o compositor.
 * Parênteses só onde mudam a leitura — `a + b × c` sem parênteses seria mentira,
 * porque a árvore não tem precedência: ela tem forma.
 */
export function descreverArvore(
  node: MetricTreeNode,
  rotuloDaMedida: (id: string) => string,
  interno = false,
): string {
  if (node.type === "literal") return formatarLiteral(node.value);
  if (node.type === "measure") return rotuloDaMedida(node.id);
  const texto = `${descreverArvore(node.left, rotuloDaMedida, true)} ${SIMBOLO_DO_OPERADOR[node.op]} ${descreverArvore(node.right, rotuloDaMedida, true)}`;
  return interno ? `(${texto})` : texto;
}

function formatarLiteral(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
}
