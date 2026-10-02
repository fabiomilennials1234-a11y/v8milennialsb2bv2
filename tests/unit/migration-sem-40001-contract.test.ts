/**
 * Nenhuma migration levanta `40001` à mão.
 *
 * O PostgREST (hasql-transaction) trata `40001` (serialization_failure) como
 * falha transitória e repete a transação SEM LIMITE. Uma recusa de negócio com
 * esse código ("a ficha mudou") nunca deixa de falhar, então um clique vira um
 * laço eterno que ocupa um núcleo inteiro do banco. Em 2026-10-01 dois cliques em
 * `editar_valor_proposta` saturaram os 2 vCPU de produção por 5 h e derrubaram o
 * app (20271101000002_conflito_de_negocio_sem_40001.sql).
 *
 * Conflito de versão é resposta definitiva: `ERRCODE = 'PT409'` → HTTP 409, que o
 * front já lê como `conflict.stale`.
 *
 * Vale para o diretório INTEIRO e para `rollback/`, não só para migrations novas: várias das
 * antigas estão em produção fora do ledger (aplicadas via MCP) e outras nunca
 * rodaram. Um `db push` re-executa qualquer uma delas, e se alguma ainda tivesse
 * `40001` recolocaria o laço por cima da correção.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");
const RAISE_40001 = /ERRCODE\s*=\s*'(40001|serialization_failure)'/i;

// `rollback/` entra: um passo de rollback aplicado sozinho recolocaria o laço.
// `archive/` fica de fora: são as migrations anteriores ao baseline, que não rodam mais.
const PASTAS = ["", "rollback"];

function migrationsAtivas(): string[] {
  return PASTAS.flatMap((pasta) =>
    readdirSync(resolve(MIGRATIONS_DIR, pasta))
      .filter((f) => /^\d{14}_.*\.sql$/.test(f))
      .map((f) => (pasta ? `${pasta}/${f}` : f)),
  );
}

describe("migrations não levantam 40001 como recusa de negócio", () => {
  it("nenhuma migration ativa usa ERRCODE 40001", () => {
    const ofensoras = migrationsAtivas().filter((f) =>
      RAISE_40001.test(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8")),
    );
    expect(ofensoras, "use ERRCODE = 'PT409' para conflito de versão").toEqual([]);
  });

  it("a regra reconhece as duas grafias e ignora PT409", () => {
    expect(RAISE_40001.test("RAISE EXCEPTION 'x' USING ERRCODE = '40001';")).toBe(true);
    expect(RAISE_40001.test("USING ERRCODE='serialization_failure'")).toBe(true);
    expect(RAISE_40001.test("RAISE EXCEPTION 'x' USING ERRCODE = 'PT409';")).toBe(false);
  });

  it("o diretório não está vazio (verde por ausência não vale)", () => {
    expect(migrationsAtivas().length).toBeGreaterThan(50);
  });
});
