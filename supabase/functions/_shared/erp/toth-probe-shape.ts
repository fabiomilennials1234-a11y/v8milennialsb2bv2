/**
 * Descrição de forma de payload — como descobrir o contrato do ERP sem exportar
 * a base de clientes do cliente.
 *
 * O fornecedor do Toth não nos mandou exemplo de resposta. Em vez de esperar,
 * `toth-probe` lê uma página e passa por aqui. A saída diz QUAIS campos existem,
 * de que tipo e com que cara — o suficiente para fixar os mapeadores — sem
 * devolver nome, telefone ou e-mail de ninguém.
 *
 * Regra que governa este arquivo: **nunca devolver um valor legível**. Um campo
 * de PII vira `{ tipo, tamanho, formato }`, nunca o conteúdo. A tela de
 * diagnóstico e o log de runtime são lugares onde dado de cliente não deve
 * parar.
 */

export interface FieldShape {
  name: string;
  type: "string" | "number" | "boolean" | "null" | "array" | "object";
  /** Formato inferido do valor — a pista que identifica o campo. */
  looksLike: string;
  /** Comprimento, para string e array. */
  length?: number;
  /** Fração das linhas em que o campo vem preenchido (0 a 1). */
  fillRate: number;
  /** Verdadeiro quando o valor foi igual em todas as linhas amostradas. */
  constantAcrossRows: boolean;
}

function classify(value: unknown): { type: FieldShape["type"]; looksLike: string; length?: number } {
  if (value === null || value === undefined) return { type: "null", looksLike: "vazio" };
  if (Array.isArray(value)) return { type: "array", looksLike: "lista", length: value.length };
  if (typeof value === "boolean") return { type: "boolean", looksLike: "booleano" };
  if (typeof value === "number") {
    return { type: "number", looksLike: Number.isInteger(value) ? "inteiro" : "decimal" };
  }
  if (typeof value === "object") return { type: "object", looksLike: "objeto" };

  const str = String(value);
  const digits = str.replace(/\D/g, "");
  let looksLike = "texto";

  if (/^\d+$/.test(str)) looksLike = `numérico(${str.length} díg.)`;
  if (str.includes("@") && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str)) looksLike = "e-mail";
  else if (digits.length === 14 && /^[\d./-]+$/.test(str)) looksLike = "CNPJ (14 díg.)";
  else if (digits.length === 11 && /^[\d./-]+$/.test(str)) looksLike = "CPF ou telefone (11 díg.)";
  else if (digits.length === 10 && /^[\d()\s-]+$/.test(str)) looksLike = "telefone (10 díg.)";
  else if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(str)) looksLike = "data ISO";
  else if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) looksLike = "data dd/mm/aaaa";
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(str)) looksLike = "uuid";

  return { type: "string", looksLike, length: str.length };
}

export interface PayloadShape {
  rowCount: number;
  sampled: number;
  fields: FieldShape[];
}

/**
 * Descreve as linhas amostradas. `constantAcrossRows` é o sinal que separa
 * identificador de dado: um campo que muda a cada linha é candidato a id;
 * um que não muda em nenhuma costuma ser status, tipo ou lixo de envelope.
 */
export function describePayload(rows: Record<string, unknown>[], sampleSize = 5): PayloadShape {
  const sample = rows.slice(0, sampleSize);
  const names = new Set<string>();
  for (const row of sample) for (const key of Object.keys(row)) names.add(key);

  const fields: FieldShape[] = [];
  for (const name of names) {
    const present = sample.filter(
      (r) => r[name] !== undefined && r[name] !== null && r[name] !== "",
    );
    const first = present[0];
    const meta = classify(first?.[name]);
    const serialized = present.map((r) => JSON.stringify(r[name]));

    fields.push({
      name,
      type: meta.type,
      looksLike: meta.looksLike,
      length: meta.length,
      fillRate: sample.length === 0 ? 0 : present.length / sample.length,
      constantAcrossRows: serialized.length > 1 && new Set(serialized).size === 1,
    });
  }

  fields.sort((a, b) => a.name.localeCompare(b.name));
  return { rowCount: rows.length, sampled: sample.length, fields };
}

/** Chaves do envelope da resposta (fora do array de linhas) — paginação mora aqui. */
export function describeEnvelope(payload: unknown): Record<string, string> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return Array.isArray(payload) ? { _raiz: "array" } : { _raiz: typeof payload };
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const meta = classify(value);
    // Escalar de envelope (total, página, tamanho) é metadado, não PII — e é
    // exatamente o que precisamos ler para descobrir como paginar.
    out[key] =
      meta.type === "array"
        ? `lista[${meta.length}]`
        : meta.type === "number" || meta.type === "boolean"
          ? `${meta.looksLike} = ${String(value)}`
          : meta.looksLike;
  }
  return out;
}
