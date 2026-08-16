// @vitest-environment node
/**
 * Todo identificador `p_*` / `v_*` usado no corpo de uma função plpgsql precisa
 * estar DECLARADO nela — como parâmetro ou em DECLARE.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Um bug real passou por todas as guardas: a dedup de
 * `create_lead_from_social_conversation` chamava
 * `link_social_conversation_to_lead(p_org, p_channel, p_contact_external_id, …)`,
 * mas o parâmetro se chama `p_external_user_id`. O Postgres ACEITA o CREATE
 * FUNCTION — plpgsql só resolve identificador quando o ramo EXECUTA —, então a
 * migration aplica limpa e o erro só aparece em produção, no primeiro vendedor que
 * digitar um telefone já existente: `42703: column "p_contact_external_id" does
 * not exist`.
 *
 * Os testes existentes não pegariam nunca: eles casam EXPRESSÃO REGULAR sobre o
 * TEXTO do .sql e jamais executam SQL. Uma asserção que a ferramenta não lê não é
 * asserção. Este arquivo não roda SQL também — mas confere o que o regex não
 * consegue: a COERÊNCIA entre o que a função declara e o que ela usa.
 *
 * NÃO substitui pgTAP. Pega a classe "identificador que não existe", que é
 * justamente a que o CREATE FUNCTION deixa passar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "../../supabase/migrations");

/** Remove comentários e literais de string — `p_` dentro deles não é uso real. */
function limpar(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

interface Fn {
  nome: string;
  declarados: Set<string>;
  corpo: string;
}

/** Extrai cada função plpgsql com seus parâmetros, DECLAREs e corpo. */
function extrairFuncoes(sql: string): Fn[] {
  const out: Fn[] = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*\n\s*RETURNS[\s\S]*?AS\s+(\$[a-z]*\$)([\s\S]*?)\3/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const [, nome, params, , corpoBruto] = m;
    const corpo = limpar(corpoBruto);
    const declarados = new Set<string>();

    // Parâmetros: `p_algo tipo [DEFAULT ...]`, separados por vírgula no topo.
    for (const p of limpar(params).split(",")) {
      const nomeParam = p.trim().match(/^([a-z][a-z0-9_]*)\s+/i);
      if (nomeParam) declarados.add(nomeParam[1].toLowerCase());
    }

    // DECLARE ... BEGIN — pega o primeiro identificador de cada linha.
    const decl = corpo.match(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/i);
    if (decl) {
      for (const linha of decl[1].split(";")) {
        const v = linha.trim().match(/^([a-z][a-z0-9_]*)\s+/i);
        if (v) declarados.add(v[1].toLowerCase());
      }
    }
    out.push({ nome, declarados, corpo });
  }
  return out;
}

const ARQUIVOS = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => /notificame|lead_social/i.test(f));

describe("identificadores p_/v_ declarados nas funções plpgsql", () => {
  it("há migrations desta branch para conferir (controle de coleta vazia)", () => {
    // Sem este caso, o arquivo passaria verde varrendo ZERO funções — o modo de
    // falha clássico de suíte que não roda nada e parece aprovada.
    expect(ARQUIVOS.length).toBeGreaterThan(0);
    const total = ARQUIVOS.flatMap((f) =>
      extrairFuncoes(readFileSync(join(DIR, f), "utf8")),
    ).length;
    expect(total).toBeGreaterThan(0);
  });

  it.each(ARQUIVOS)("%s — nenhum identificador órfão", (arquivo) => {
    const sql = readFileSync(join(DIR, arquivo), "utf8");
    const orfaos: string[] = [];

    for (const fn of extrairFuncoes(sql)) {
      const usados = fn.corpo.match(/\b[pv]_[a-z0-9_]+\b/gi) ?? [];
      for (const u of new Set(usados.map((x) => x.toLowerCase()))) {
        if (!fn.declarados.has(u)) orfaos.push(`${fn.nome}() usa ${u}`);
      }
    }

    expect(
      orfaos,
      `identificador usado sem declaração — o CREATE FUNCTION aceita e o erro só ` +
        `aparece quando o ramo executa:\n  ${orfaos.join("\n  ")}`,
    ).toEqual([]);
  });
});
