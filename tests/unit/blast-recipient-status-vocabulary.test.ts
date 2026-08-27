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
 * Era essa asserção que sustentava "nada muda", e ela era um estopim, não uma
 * nota.
 *
 * ── O ESTOPIM QUEIMOU, NA #1724 ─────────────────────────────────────────────
 * Ele funcionou. `fechar-entrega.ts` passou a gravar `delivered`, este arquivo
 * reprovou, e a fatia foi obrigada a tratar a tela ANTES de seguir — nos três
 * alvos que a mensagem de erro nomeava:
 *
 *   · o balde `else p.pending += 1` de `useBlastPlans.ts` MORREU. A agregação
 *     virou `blast-delivery-summary.ts`, que conta os seis estados por nome e
 *     tem um contador `desconhecidos`, para o próximo estado novo APARECER em
 *     vez de se esconder;
 *   · a union `BlastRecipientStatus` cobre os seis;
 *   · o `BlastPlanRecipientsSheet` ganhou as duas abas, e o `Record` voltou a
 *     ser exaustivo.
 *
 * O arquivo NÃO foi apagado quando incomodou — guarda que se apaga ao incomodar
 * não é guarda. Ele mudou de pergunta: de "ninguém escreve os estados novos"
 * para "só quem deve escreve, e a tela sabe de todos".
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
  // O corpo da RESPOSTA HTTP do `notificame-webhook`. Ele entrou nesta varredura
  // na #1724, quando passou a mencionar `blast_plan_recipients` — é o chamador do
  // fechamento de entrega. O `status` dele é o do PROCESSAMENTO DO EVENTO, e o
  // vocabulário não se cruza com o da linha em nenhum valor, o que é a razão de
  // isto ser allowlist e não ambiguidade.
  parked: "status da resposta do notificame-webhook (evento foi para a fila)",
  updated: "status da resposta do notificame-webhook (linha de mensagem tocada)",
  duplicate: "status da resposta do notificame-webhook (evento repetido)",
  stored: "status da resposta do notificame-webhook (evento gravado)",
  connected: "status da instância de WhatsApp, não da linha",
};

/**
 * Quem pode falar de `delivered` / `unconfirmed`, e por quê (#1724).
 *
 * Allowlist COM MOTIVO, no molde de NAO_E_STATUS_DE_DESTINATARIO acima: lista sem
 * motivo vira depósito, e depósito esconde o próximo defeito igual.
 */
const QUEM_PODE_FALAR_DE_ENTREGA: Record<string, string> = {
  "supabase/functions/_shared/quick-blast/fechar-entrega.ts":
    "ESCREVE. O módulo que o callback de status usa para fechar a linha (#1724)",
  "src/modules/campaigns/hooks/useBlastPlanRecipients.ts":
    "LÊ. A union BlastRecipientStatus, que o último teste amarra ao CHECK",
  "src/modules/campaigns/components/BlastPlanRecipientsSheet.tsx":
    "LÊ. As abas Entregues e Não confirmadas, e o Record exaustivo",
  "src/modules/campaigns/hooks/useBlastPlans.ts":
    "LÊ. O progresso por plano, agora sem balde de desconhecido",
  "src/modules/campaigns/components/disparo-wizard/StepMonitor.tsx":
    "LÊ. O relatório do Disparo e o estado pessoa a pessoa",
  "src/modules/campaigns/components/BlastPlanCard.tsx":
    "LÊ. O card do painel Disparos",
  "src/modules/campaigns/lib/blast-recipient-view.ts":
    "LÊ. unconfirmedLabel() — a frase que diz que o prazo venceu sem confirmação",
  "supabase/functions/_shared/blast-official-runner.ts":
    "NÃO escreve nem lê: CITA. O comentário do 23505 explica que a linha sem id " +
    "termina como `unconfirmed`. A varredura casa crase também, e prosa entra — " +
    "é bluntness deliberada: o custo é uma linha aqui, e afinar a regex para " +
    "ignorar comentário abriria a porta para o literal de verdade se esconder " +
    "num deles",
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

  it("só os escritores previstos gravam os estados novos", () => {
    const vocabulario = new Set<string>([...ESTADOS_VIVOS, ...ESTADOS_NOVOS]);
    const arquivos = arquivosQueTocamADestinatarios();

    // Controle: se a varredura não achasse arquivo nenhum, todas as asserções
    // abaixo passariam por ausência de sujeito.
    expect(arquivos.length, "a varredura não achou nenhum arquivo da tabela").toBeGreaterThan(0);

    const forasteiros: string[] = [];
    for (const { caminho, texto } of arquivos) {
      for (const estado of ESTADOS_NOVOS) {
        if (!new RegExp(`["'\`]${estado}["'\`]`).test(texto)) continue;
        if (caminho in QUEM_PODE_FALAR_DE_ENTREGA) continue;
        forasteiros.push(`${caminho} fala de '${estado}' sem estar na allowlist`);
      }
    }

    expect(
      forasteiros,
      `Um arquivo novo passou a falar de entrega. Se ele ESCREVE o estado, ele ` +
        `precisa de motivo nesta allowlist — e, antes disso, de uma resposta para ` +
        `"a tela sabe mostrar isso?". Se ele só LÊ, o motivo é igualmente barato. ` +
        `Allowlist sem motivo vira depósito, e depósito esconde o próximo defeito.`,
    ).toEqual([]);

    // CONTROLE POSITIVO — e é ele o coração deste teste depois da #1724.
    //
    // A versão anterior afirmava AUSÊNCIA ("ninguém escreve"), e asserção de
    // ausência passa por vacuidade no dia em que a varredura deixa de achar o
    // arquivo — por renomeação, por mudança de pasta, por qualquer coisa. Agora
    // que existe um escritor, ele tem de ser ENCONTRADO.
    const fechador = arquivos.find((a) =>
      a.caminho.endsWith("_shared/quick-blast/fechar-entrega.ts")
    );
    expect(
      fechador,
      "o módulo que fecha a entrega sumiu da varredura — sem ele, este arquivo " +
        "volta a provar ausência, que é o que se prova sozinho",
    ).toBeDefined();
    expect(fechador!.texto).toMatch(/status:\s*"delivered"/);

    // E nenhum literal fora do vocabulário, que é como 'membro' nasceu no #1541.
    //
    // DUAS formas, porque este código escreve status das duas maneiras e uma
    // varredura que só conhece a primeira deixa passar exatamente o filtro que
    // mais aparece aqui:
    //   objeto  -> .update({ status: "skipped", reason })   (blast-plan-control:144)
    //   filtro  -> .eq("status", "sent")                    (mass-send-status:75)
    const FORMAS_DE_STATUS = [
      /status:\s*["'`]([a-z_]+)["'`]/g,        // { status: "x" }
      /\.eq\(\s*["'`]status["'`]\s*,\s*["'`]([a-z_]+)["'`]/g, // .eq("status", "x")
    ];

    const desconhecidos: string[] = [];
    for (const { caminho, texto } of arquivos) {
      for (const forma of FORMAS_DE_STATUS) {
        for (const m of texto.matchAll(forma)) {
          if (m[1] in NAO_E_STATUS_DE_DESTINATARIO) continue;
          if (!vocabulario.has(m[1])) desconhecidos.push(`${caminho}: status '${m[1]}'`);
        }
      }
    }
    expect(desconhecidos, "literal de status fora do CHECK").toEqual([]);
  });


  it("a união do frontend cobre os SEIS, e a tela tem balde para cada um", () => {
    const uniao = readFileSync(
      join(RAIZ, "src/modules/campaigns/hooks/useBlastPlanRecipients.ts"),
      "utf8",
    ).match(/export type BlastRecipientStatus\s*=\s*([^;]+);/);

    expect(uniao, "a union BlastRecipientStatus sumiu ou mudou de forma").not.toBeNull();

    const valores = [...uniao![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(
      valores,
      "A union e o CHECK do banco têm de dizer a mesma coisa. Divergir aqui é " +
        "como o comentário de blast-plan.ts:59 seguiu dizendo `pending | sent | " +
        "skipped` depois que `failed` entrou.",
    ).toEqual([...ESTADOS_VIVOS, ...ESTADOS_NOVOS].sort());

    // E a tela tem de ter um balde NOMEADO para cada um. O
    // `Record<BlastRecipientStatus, number>` do Sheet faz o compilador reprovar
    // quem ampliar a union e esquecer da tela — mas um status sem balde vira
    // `undefined + 1 = NaN`, que a tela mostra sem reclamar, e o compilador não
    // é quem roda nesta suíte.
    const sheet = readFileSync(
      join(RAIZ, "src/modules/campaigns/components/BlastPlanRecipientsSheet.tsx"),
      "utf8",
    );
    const contadores = sheet.match(
      /const c: Record<BlastRecipientStatus, number> = \{([^}]*)\}/,
    );
    expect(contadores, "o contador exaustivo do Sheet sumiu ou mudou de forma").not.toBeNull();

    const comBalde = [...contadores![1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
    expect(comBalde, "estado sem balde no Sheet vira NaN na tela").toEqual(
      [...ESTADOS_VIVOS, ...ESTADOS_NOVOS].sort(),
    );

    // E o balde de DESCONHECIDO morreu: nenhum status pode cair num `else`.
    const agregacao = readFileSync(
      join(RAIZ, "src/modules/campaigns/hooks/useBlastPlans.ts"),
      "utf8",
    );
    expect(
      agregacao,
      'o `else p.pending += 1` voltou. Ele é o balde que faria o primeiro ' +
        '`delivered` de produção aparecer como "Aguardando".',
    ).not.toMatch(/else\s+p\.pending\s*\+=/);
  });

});
