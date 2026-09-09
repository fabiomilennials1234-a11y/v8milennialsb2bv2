/**
 * A mensagem da trava do banco é contrato com a tela.
 *
 * `fn_exige_valor_no_negocio` (migration 20270916000010) recusa fechar como
 * ganho sem valor. `DealCardPanel` reconhece essa recusa por
 * `isSaleValueRequiredError` e abre o campo de valor em vez de mostrar erro
 * de banco cru.
 *
 * Se alguém reescrever a frase na migration sem reescrever o marcador no
 * TypeScript, nada quebra em compilação, nenhum teste de unidade reclama, e o
 * usuário volta ao estado que esta fatia veio consertar: a tela pede um valor
 * que a tela não deixa digitar. Este teste é a única coisa que liga as pontas.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isSaleValueRequiredError,
  SALE_VALUE_REQUIRED_MARKER,
} from "@/lib/rpc-errors";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** A migration que define a trava — buscada por nome, não por número fixo. */
function corpoDaTrava(): string {
  const arquivos = readdirSync(MIGRATIONS).filter((f) =>
    f.endsWith("trava_de_valor_pergunta_ao_negocio.sql") ||
    f.endsWith("a_trava_enxerga_a_lista.sql"),
  );
  // Sentinela: se o nome do arquivo mudar, o teste não pode passar por vazio.
  expect(arquivos.length).toBeGreaterThan(0);
  return arquivos.map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");
}

describe("contrato da trava de valor", () => {
  it("a migration levanta a recusa com o marcador que a tela procura", () => {
    const sql = corpoDaTrava();
    // A frase tem de estar num RAISE EXCEPTION, não só num comentário.
    const raises = sql.match(/RAISE EXCEPTION\s+'[^']*'/g) ?? [];
    expect(raises.length).toBeGreaterThan(0);
    expect(raises.some((r) => r.includes(SALE_VALUE_REQUIRED_MARKER))).toBe(true);
  });

  it("a recusa da trava é reconhecida", () => {
    expect(
      isSaleValueRequiredError({
        code: "23514",
        message: "Informe o valor antes de marcar o negócio como ganho.",
      }),
    ).toBe(true);
  });

  it("outro CHECK da mesma tabela NÃO é confundido com a trava", () => {
    expect(
      isSaleValueRequiredError({
        code: "23514",
        message: 'new row violates check constraint "deals_source_check"',
      }),
    ).toBe(false);
  });

  it("a mesma frase com outro código não passa", () => {
    expect(
      isSaleValueRequiredError({
        code: "P0001",
        message: "Informe o valor antes de marcar o negócio como ganho.",
      }),
    ).toBe(false);
  });

  it("erro ausente não é a trava", () => {
    expect(isSaleValueRequiredError(null)).toBe(false);
    expect(isSaleValueRequiredError(undefined)).toBe(false);
  });
});
