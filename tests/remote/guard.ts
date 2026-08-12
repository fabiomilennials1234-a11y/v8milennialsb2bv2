/**
 * O alvo de qualquer teste que fale com um Supabase REMOTO.
 *
 * DECISÃO DO CTO (2026-08-12): **todo teste aponta para branch efêmera.**
 * Nenhum teste deste repositório pode escrever em produção — nem por acidente,
 * nem por alguém "consertando" um vermelho ao fornecer a chave que faltava.
 *
 * POR QUE UM MÓDULO, E NÃO UMA CONVENÇÃO
 *
 * Até hoje quatro arquivos traziam o ref de produção como DEFAULT:
 *
 *   tests/integration/setup-prod.ts               ← e `ensureTestOrg()` CRIA org
 *   tests/integration/lead-service-prod.test.ts
 *   tests/integration/human-pause.test.ts
 *   tests/integration/copilot-v2/border-regression.test.ts
 *
 * Os quatro estavam dentro do glob de `npm run test:integration`
 * (`vitest run tests/integration/`), que o CI roda a cada push. O que impedia o
 * estrago era a AUSÊNCIA de uma variável de ambiente — uma proteção que some no
 * instante em que alguém adiciona o secret para "deixar o job verde".
 *
 * Agora são duas barreiras independentes:
 *   1. os arquivos vivem em `tests/remote/`, fora do glob de integração;
 *   2. este guard RECUSA o ref de produção, com ou sem chave.
 *
 * Não há escape. Se um dia for preciso medir contra produção, o caminho é
 * leitura — `mcp` read-only ou `db_read_sql` —, não uma suíte que escreve.
 *
 * Como apontar para uma branch efêmera: `.specs/project/runbook-validacao-local.md`
 */

const PROD_REF = "jsjsmuncfkbsbzqzqhfq";
const DEV_APOSENTADO_REF = "bcfadphgsibjzivtbjvc";

/**
 * URL do Supabase que a suíte remota deve usar. Lança se apontar para produção
 * ou para o projeto dev aposentado, e lança se ninguém disser para onde ir —
 * silêncio aqui viraria "caiu no default", que é exatamente o defeito antigo.
 */
export function alvoRemoto(): string {
  const url = process.env.TEST_SUPABASE_URL ?? "";

  if (!url) {
    throw new Error(
      "TEST_SUPABASE_URL não definida. As suítes de tests/remote/ rodam contra uma " +
        "BRANCH EFÊMERA do Supabase, nunca contra produção. " +
        "Crie a branch e exporte a URL — passo a passo em " +
        ".specs/project/runbook-validacao-local.md",
    );
  }

  if (url.includes(PROD_REF)) {
    throw new Error(
      `RECUSADO: TEST_SUPABASE_URL aponta para PRODUÇÃO (${PROD_REF}). ` +
        "Nenhum teste deste repositório escreve em produção — decisão do CTO, 2026-08-12. " +
        "Use uma branch efêmera.",
    );
  }

  if (url.includes(DEV_APOSENTADO_REF)) {
    throw new Error(
      `RECUSADO: TEST_SUPABASE_URL aponta para o dev APOSENTADO (${DEV_APOSENTADO_REF}), ` +
        "que está 404 migrations atrás de produção. Use uma branch efêmera.",
    );
  }

  return url;
}

/** A chave de serviço da branch. Sem ela a suíte não roda — e não deve. */
export function chaveRemota(): string {
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!key) {
    throw new Error(
      "TEST_SUPABASE_SERVICE_ROLE_KEY não definida. Pegue a da branch efêmera com " +
        "`supabase branches get <id> --project-ref <prod-ref> -o env`.",
    );
  }
  return key;
}

/**
 * Para `describe.skipIf(...)`: true quando o ambiente não está configurado.
 * Serve para a suíte ficar QUIETA fora do fluxo de branch, em vez de vermelha —
 * mas sem nunca cair num default de produção.
 *
 * ⚠ ASSIMETRIA DELIBERADA, para ninguém "consertar" errado: `setup-remote.ts`
 * chama `alvoRemoto()` no topo do módulo e portanto ESTOURA sem alvo, enquanto
 * `human-pause` e `copilot-v2-border-regression` PULAM. As duas que pulam já
 * eram gated antes desta mudança, por motivo próprio (a de border-regression é
 * `describe.skip` fixo, esperando migration). A que estoura é a certa para o
 * fluxo novo: `npm run test:remote` é invocação deliberada, e falhar com a
 * instrução exata vale mais do que 18 testes verdes que não rodaram.
 */
export const semAlvoRemoto =
  !process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
