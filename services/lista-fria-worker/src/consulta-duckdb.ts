/**
 * `ConsultaCnpj` sobre o Parquet enxuto, com DuckDB (única dependência do worker, ADR-0043).
 *
 * O arquivo é ordenado por (uf, cnae, municipio), então os filtros de UF e CNAE leem só os grupos de
 * linhas que casam. O que é dado do usuário (UF, município, cursor) vai por parâmetro; os CNAEs só
 * entram como texto depois de validados como dígitos; o caminho do arquivo vem da configuração.
 */
import { DuckDBInstance } from "@duckdb/node-api";

import type { ConsultaCnpj, ExigeContato, FiltrosCnpj, LinhaCnpj } from "./fonte-cnpj.ts";

const CONDICAO_DE_CONTATO: Record<ExigeContato, string> = {
  qualquer: "(email IS NOT NULL OR tel IS NOT NULL)",
  email: "email IS NOT NULL",
  telefone: "tel IS NOT NULL",
  ambos: "(email IS NOT NULL AND tel IS NOT NULL)",
};

const literal = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** SQL e parâmetros de uma página. Exportado para o teste conferir o que vai ao banco. */
export function sqlDaBusca(arquivo: string, f: FiltrosCnpj, depois: string | null, limite: number): { sql: string; valores: Array<string | number> } {
  const cnaes = f.cnaes.map((c) => {
    if (!/^\d{2,7}$/.test(c)) throw new Error("CNAE inválido");
    return `cnae LIKE '${c}%'`;
  });
  const valores: Array<string | number> = [f.uf];
  let n = 1;
  let onde = `uf = $${n} AND (${cnaes.join(" OR ")}) AND matriz`;
  if (f.municipio) {
    valores.push(f.municipio);
    onde += ` AND municipio = $${++n}`;
  }
  if (depois) {
    valores.push(depois);
    onde += ` AND cnpj > $${++n}`;
  }
  valores.push(limite);
  const sql = `
    SELECT * FROM (
      SELECT cnpj, razao, fantasia, cnae, cnae_desc, uf, municipio, bairro, endereco, tel,
             CASE WHEN email_compartilhado THEN NULL ELSE email END AS email, porte, celular
        FROM read_parquet(${literal(arquivo)})
       WHERE ${onde}
    ) WHERE ${CONDICAO_DE_CONTATO[f.contato]}
    ORDER BY cnpj
    LIMIT $${++n}`;
  return { sql, valores };
}

export async function consultaDuckdb(arquivo: string): Promise<ConsultaCnpj & { fechar(): void }> {
  const instancia = await DuckDBInstance.create(":memory:");
  const conexao = await instancia.connect();
  return {
    async buscar(filtros, depois, limite) {
      const { sql, valores } = sqlDaBusca(arquivo, filtros, depois, limite);
      const leitor = await conexao.runAndReadAll(sql, valores);
      return leitor.getRowObjectsJson() as unknown as LinhaCnpj[];
    },
    fechar() {
      conexao.closeSync();
      instancia.closeSync();
    },
  };
}
