/**
 * O vocabulário de `blast_plan_recipients.status` — amarrado ao CHECK, não a um
 * literal solto.
 *
 * POR QUE ESTE ARQUIVO EXISTE (#1721)
 * -----------------------------------
 * A #1721 é prefactor: ela amplia o CHECK para `delivered` e `unconfirmed` e
 * **não muda comportamento nenhum**. O critério de aceite exige que isso seja
 * *provado*, e prova de inércia é justamente o que um teste comum não dá — um
 * teste que não exercita nada passa por vacuidade.
 *
 * O ensaio transacional (`scripts/ensaio-1721.sh`) provou o lado do banco contra
 * produção: 235 destinatários antes e depois, distribuição idêntica, índices e
 * policies intactos. Este arquivo prova o lado do código, e prova uma coisa que
 * o ensaio não alcança: **ninguém escreve os estados novos ainda**.
 *
 * É essa asserção que sustenta "nada muda". E ela é um estopim, não uma nota:
 * o dia em que alguém gravar `delivered`, ESTE teste reprova — e quem estiver
 * gravando é obrigado a olhar para `useBlastPlans.ts`, cujo `else p.pending += 1`
 * (linha ~162) hoje joga silenciosamente qualquer status desconhecido no balde
 * `pending`. Sem o estopim, o primeiro `delivered` de produção apareceria na tela
 * como "Aguardando", e ninguém saberia por quê.
 *
 * A drift que este ticket combate já aconteceu uma vez aqui: quando `failed`
 * entrou (ADR-0016), o comentário de `blast-plan.ts:59` continuou dizendo
 * `pending | sent | skipped`. Comentário não é amarra; teste é.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../..");

const MIGRATION = join(
  RAIZ,
  "supabase/migrations/20270823000000_blast_recipient_delivery_state.sql",
);
const ROLLBACK = join(
  RAIZ,
  "supabase/migrations/rollback/20270823000000_blast_recipient_delivery_state.sql",
);

/**
 * Os quatro estados que vivem em produção HOJE. Medidos em 2026-08-23 com
 * `pg_get_constraintdef` contra o catálogo de prod, não lidos de arquivo:
 *
 *   CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text,
 *                               'skipped'::text, 'failed'::text])))
 */
const ESTADOS_VIVOS = ["pending", "sent", "skipped", "failed"] as const;

/** Os dois que a #1721 acrescenta, e que ninguém pode escrever ainda. */
const ESTADOS_NOVOS = ["delivered", "unconfirmed"] as const;

/**
 * Literais que aparecem como `status:` nos arquivos desta tabela mas pertencem a
 * OUTRO vocabulário. Cada entrada carrega o motivo — allowlist sem motivo vira
 * depósito, e depósito esconde o próximo bug igual ao `membro` do #1541.
 */
const NAO_E_STATUS_DE_DESTINATARIO: Record<string, string> = {
  // `blast_plans.status` — o plano, não o destinatário.
  active: "status do plano de disparo (blast_plans)",
  paused: "status do plano de disparo (blast_plans)",
  completed: "status do plano de disparo (blast_plans)",
  cancelled: "status do plano de disparo (blast_plans)",
  // `uazapi_sender_jobs.status` — a pasta de envio do fornecedor.
  queued: "status do job da Uazapi (dispatch-router.ts:232)",
  // `runtime_logs.status` — o registro de observabilidade (ADR-0017), que
  // grava module/action/status e não tem relação com a linha do destinatário.
  success: "status do runtime_log, não da linha",
  error: "status do runtime_log, não da linha",
};

/** Extrai o vocabulário de dentro de `CHECK (status IN (...))`. */
function vocabularioDoCheck(sql: string, arquivo: string): string[] {
  const check = sql.match(/CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i);
  if (!check) throw new Error(`sem CHECK de status em ${arquivo}`);
  return [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Todo .ts do produto que fala desta tabela — é onde um literal pode vazar. */
function arquivosQueTocamADestinatarios(): { caminho: string; texto: string }[] {
  const achados: { caminho: string; texto: string }[] = [];

  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome === "dist" || nome.startsWith(".")) continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) {
        andar(caminho);
        continue;
      }
      if (!/\.tsx?$/.test(nome)) continue;
      const texto = readFileSync(caminho, "utf8");
      if (texto.includes("blast_plan_recipients") || texto.includes("BlastRecipientStatus")) {
        achados.push({ caminho: caminho.slice(RAIZ.length + 1), texto });
      }
    }
  };

  andar(join(RAIZ, "src/modules"));
  andar(join(RAIZ, "supabase/functions"));
  return achados;
}

describe("vocabulário de blast_plan_recipients.status (#1721)", () => {
  it("o CHECK novo é superconjunto ESTRITO do que vive em produção", () => {
    const vocabulario = vocabularioDoCheck(readFileSync(MIGRATION, "utf8"), MIGRATION);

    // Nenhum estado vivo pode ter sido perdido no caminho: perder um
    // invalidaria linha existente e a migration deixaria de ser inerte.
    for (const estado of ESTADOS_VIVOS) {
      expect(vocabulario, `estado vivo '${estado}' sumiu do CHECK`).toContain(estado);
    }
    for (const estado of ESTADOS_NOVOS) {
      expect(vocabulario, `estado novo '${estado}' ausente do CHECK`).toContain(estado);
    }

    // Exatamente seis. Um sétimo valor seria escopo que ninguém decidiu.
    expect([...vocabulario].sort()).toEqual(
      [...ESTADOS_VIVOS, ...ESTADOS_NOVOS].sort(),
    );
  });

  it("o rollback devolve exatamente os quatro estados de hoje", () => {
    // Rollback que não fecha é rollback que mente. O ensaio prova isso rodando
    // (asserção 13); aqui a amarra é estática, para o caso de alguém editar o
    // arquivo sem rodar o ensaio de novo.
    const vocabulario = vocabularioDoCheck(readFileSync(ROLLBACK, "utf8"), ROLLBACK);
    expect([...vocabulario].sort()).toEqual([...ESTADOS_VIVOS].sort());
  });

  it("NINGUÉM escreve os estados novos ainda — é isto que prova que nada muda", () => {
    const vocabulario = new Set<string>([...ESTADOS_VIVOS, ...ESTADOS_NOVOS]);
    const arquivos = arquivosQueTocamADestinatarios();

    // Controle: se a varredura não achasse arquivo nenhum, todas as asserções
    // abaixo passariam por ausência de sujeito.
    expect(arquivos.length, "a varredura não achou nenhum arquivo da tabela").toBeGreaterThan(0);

    const vazamentos: string[] = [];
    for (const { caminho, texto } of arquivos) {
      for (const estado of ESTADOS_NOVOS) {
        if (new RegExp(`["'\`]${estado}["'\`]`).test(texto)) {
          vazamentos.push(`${caminho} escreve '${estado}'`);
        }
      }
    }

    expect(
      vazamentos,
      `A #1721 é prefactor: expande a forma e não muda comportamento. Se você está ` +
        `gravando um estado novo, esta fatia deixou de ser inerte — e antes de seguir, ` +
        `trate o balde de status desconhecido em src/modules/campaigns/hooks/useBlastPlans.ts ` +
        `(o 'else p.pending += 1'), a union BlastRecipientStatus e as abas do ` +
        `BlastPlanRecipientsSheet. Senão o primeiro 'delivered' aparece como "Aguardando".`,
    ).toEqual([]);

    // E nenhum literal fora do vocabulário, que é como 'membro' nasceu no #1541.
    const forasteiros: string[] = [];
    for (const { caminho, texto } of arquivos) {
      for (const m of texto.matchAll(/status:\s*["'`]([a-z_]+)["'`]/g)) {
        if (m[1] in NAO_E_STATUS_DE_DESTINATARIO) continue;
        if (!vocabulario.has(m[1])) forasteiros.push(`${caminho}: status '${m[1]}'`);
      }
    }
    expect(forasteiros, "literal de status fora do CHECK").toEqual([]);
  });

  it("a union do frontend segue nos quatro estados — esta fatia não toca a UI", () => {
    const uniao = readFileSync(
      join(RAIZ, "src/modules/campaigns/hooks/useBlastPlanRecipients.ts"),
      "utf8",
    ).match(/export type BlastRecipientStatus\s*=\s*([^;]+);/);

    expect(uniao, "a union BlastRecipientStatus sumiu ou mudou de forma").not.toBeNull();

    const valores = [...uniao![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(
      valores,
      "Ampliar a union aqui QUEBRA o build: BlastPlanRecipientsSheet.tsx usa " +
        "Record<BlastRecipientStatus, number> com literal exaustivo. É trabalho da " +
        "fatia que for tratar os estados na tela, não desta.",
    ).toEqual([...ESTADOS_VIVOS].sort());
  });
});
