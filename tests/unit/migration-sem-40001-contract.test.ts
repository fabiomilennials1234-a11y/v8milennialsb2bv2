/**
 * Nenhuma migration nova levanta `40001` à mão.
 *
 * O PostgREST (hasql-transaction) trata `40001` (serialization_failure) como
 * falha transitória e repete a transação SEM LIMITE. Uma recusa de negócio com
 * esse código ("a ficha mudou") nunca deixa de falhar, então um clique vira um
 * laço eterno que ocupa um núcleo inteiro do banco. Em 2026-10-01 dois cliques em
 * `editar_valor_proposta` saturaram os 2 vCPU de produção por 4 h e derrubaram o
 * app (20271101000002_conflito_de_negocio_sem_40001.sql).
 *
 * Conflito de versão é resposta definitiva: `ERRCODE = 'PT409'` → HTTP 409, que o
 * front já lê como `conflict.stale`.
 *
 * As migrations anteriores ficam de fora: a 20271101000002 reescreveu em produção
 * toda função que ainda levantava `40001`. O risco daqui para a frente é copiar um
 * corpo antigo para uma migration nova — é isso que este teste pega.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");
const CORRECAO = "20271101000002";
const RAISE_40001 = /ERRCODE\s*=\s*'(40001|serialization_failure)'/i;

function migrationsDepoisDaCorrecao(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => {
    const m = /^(\d{14})_.*\.sql$/.exec(f);
    return m !== null && m[1] > CORRECAO;
  });
}

describe("migrations não levantam 40001 como recusa de negócio", () => {
  it("nenhuma migration posterior à correção usa ERRCODE 40001", () => {
    const ofensoras = migrationsDepoisDaCorrecao().filter((f) =>
      RAISE_40001.test(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8")),
    );
    expect(ofensoras, "use ERRCODE = 'PT409' para conflito de versão").toEqual([]);
  });

  it("a regra reconhece as duas grafias e ignora PT409", () => {
    expect(RAISE_40001.test("RAISE EXCEPTION 'x' USING ERRCODE = '40001';")).toBe(true);
    expect(RAISE_40001.test("USING ERRCODE='serialization_failure'")).toBe(true);
    expect(RAISE_40001.test("RAISE EXCEPTION 'x' USING ERRCODE = 'PT409';")).toBe(false);
  });

  it("a migration de correção existe (o corte não aponta para o vazio)", () => {
    expect(readdirSync(MIGRATIONS_DIR).some((f) => f.startsWith(`${CORRECAO}_`))).toBe(true);
  });
});
