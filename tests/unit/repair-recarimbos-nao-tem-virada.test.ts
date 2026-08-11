/**
 * A lista de repair do passo 4 não pode conter migration da virada.
 *
 * ── O DEFEITO QUE ISTO TRAVA ───────────────────────────────────────────────
 * `supabase migration repair --status applied <versão>` marca a versão como já
 * aplicada SEM executá-la. É o certo para as 21 re-carimbadas — o SQL delas já
 * está em prod sob versão `2026…`.
 *
 * Se uma migration NOVA entrar nessa lista, o efeito é o oposto e é silencioso:
 * o `db push` seguinte a considera aplicada e **pula**. Nenhum erro, nenhum
 * aviso — a migration simplesmente não roda, e o banco fica sem o objeto que
 * todo o resto assume existir. Descobre-se quando `abrir_negocio` devolve 404
 * para as 98 organizações, horas depois, com o deploy já feito.
 *
 * É um erro de UMA linha num arquivo de texto, e não há revisão de código que o
 * pegue com confiança: as versões são strings de 14 dígitos que diferem em um
 * caractere no meio (20270730000009 é re-carimbo; 20270730000010 é a virada).
 *
 * ── POR QUE UM TESTE, E NÃO UM COMENTÁRIO ─────────────────────────────────
 * O comentário já existe no topo do arquivo de lista. Comentário não reprova
 * ninguém. Este teste reprova, e reprova no PR — que é antes do dia do apply,
 * quando ainda é barato.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LISTA = join(process.cwd(), "scripts", "repair-recarimbos-virada.txt");

/**
 * As 13 migrations da virada Lead↔Negócio, da spec
 * `.specs/project/spec-virada-leads-negocios.md`. Nenhuma delas está em prod —
 * são o conteúdo que o passo 5 vai empurrar.
 */
const VIRADA = [
  "20270730000010", // deals_rls_org_scope
  "20270730000020", // leads_claim
  "20270730000030", // custom_pipe_entries_deal_id
  "20270730000040", // auto_seed_deal_manual_only
  "20270730000050", // deal_por_lead_destrava
  "20270731000010", // assert_member_same_org
  "20270803000010", // deals_drop_position_columns
  "20270803000020", // abrir_negocio
  "20270803000030", // pipeline_entries_deal_id_unico
  "20270803000040", // sync_pipe_whatsapp_no_move
  "20270803000050", // mover_negocio
  "20270805000010", // aposenta_funis_de_carteira
  "20270806000010", // leads_pipe_whatsapp_sem_default
];

function versoesDaLista(): string[] {
  return readFileSync(LISTA, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

describe("lista de repair do passo 4", () => {
  it("não contém nenhuma das 13 migrations da virada", () => {
    const lista = versoesDaLista();
    const intrusas = lista.filter((v) => VIRADA.includes(v));

    expect(
      intrusas,
      intrusas.length === 0
        ? ""
        : `Estas versões da VIRADA estão na lista de repair: ${intrusas.join(", ")}.\n\n` +
            "`migration repair --status applied` marca como aplicada SEM executar. " +
            "Uma migration nova nessa lista é PULADA pelo db push, em silêncio — o objeto " +
            "nunca é criado e o erro aparece só quando o produto o chama em produção.",
    ).toEqual([]);
  });

  it("só contém versões que existem como arquivo no repo", () => {
    // Versão na lista sem arquivo correspondente é erro de digitação — e um
    // repair de versão inventada polui o ledger com uma linha que nunca vai
    // parear com nada.
    const arquivos = readdirSync(join(process.cwd(), "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 14));

    const orfas = versoesDaLista().filter((v) => !arquivos.includes(v));

    expect(
      orfas,
      orfas.length === 0 ? "" : `Versões sem arquivo em supabase/migrations/: ${orfas.join(", ")}`,
    ).toEqual([]);
  });

  it("a lista não está vazia (o gate não passa por não ter olhado)", () => {
    // Sem isto, apagar o conteúdo do arquivo faria os dois casos acima passarem.
    expect(versoesDaLista().length).toBeGreaterThanOrEqual(20);
  });
});
