/**
 * Regra: chave composta em `useRealtimeSubscription` vai ANINHADA.
 *
 * `useRealtimeSubscription(t, ["pipeline_stages", pipelineType])` parecia
 * invalidar a chave `["pipeline_stages", pipelineType]`. Não invalidava: o hook
 * lia cada string como uma chave de UM segmento — invalidava `["pipeline_stages"]`
 * inteiro (todas as famílias, todos os funis) e, 2 s depois, `[pipelineType]`,
 * que não casa com nada. Sete call sites tinham esse formato em 2026-10-05.
 *
 * O teste usa o ESLint de verdade com o `eslint.config.js` do repo — não um
 * Linter isolado com a regra copiada. A armadilha que ele protege é de
 * CONFIGURAÇÃO: no flat config, um bloco posterior que redefine
 * `no-restricted-syntax` SUBSTITUI a lista do anterior. Por isso a regra mora
 * nos dois blocos, e os três caminhos abaixo exercitam cada combinação.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ESLint } from "eslint";

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

/** Arquivo comum (os dois blocos casam; vale a lista do bloco do `wa.me`). */
const COMUM = "src/modules/leads/hooks/__lint_fixture__.ts";
/** Ignorado pelo bloco do `wa.me`: vale só a lista do bloco ADR-0038. */
const SO_BLOCO_ERROS = "src/modules/communication/components/chat/AbrirConversaButton.tsx";
/** Ignorado pelo bloco ADR-0038: vale só a lista do bloco do `wa.me`. */
const SO_BLOCO_WAME = "src/shared/errors/__lint_fixture__.ts";

async function compositeViolations(code: string, filePath = COMUM) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter(
    (m) => m.ruleId === "no-restricted-syntax" && m.message.includes("useRealtimeSubscription"),
  );
}

const PRELUDE = `
declare function useRealtimeSubscription(t: string, k: unknown, o?: unknown): void;
declare const organizationId: string | undefined;
declare const pipelineType: string;
declare const slug: string;
declare const queryKey: unknown[];
declare const UNREAD_KEY: string;
declare const SOCIAL_KEYS: string[];
declare const keys: { root: string; slug: string; all: readonly string[] };
declare const QUERY_KEYS: { LEADS: string; PIPELINE: string };
declare function rootOf(s: string): string;
`;

describe("composto plano é erro", () => {
  // Um aviso por segmento fora do lugar — aponta exatamente o que aninhar.
  it.each([
    ['["activities", organizationId ?? ""]', "variável depois da raiz", 1],
    ['["pipeline_stages", pipelineType]', "identificador depois da raiz", 1],
    ['["pipeline_entries", slug, organizationId]', "dois segmentos variáveis", 2],
    ['["copilot-pause", `${slug}`]', "template literal com expressão", 1],
    ['[UNREAD_KEY, organizationId]', "raiz constante, segmento variável", 1],
    ['[keys.root, slug]', "raiz em acesso a membro", 1],
    ['[keys.all[0], organizationId]', "raiz em acesso indexado", 1],
    ['[keys.root, keys.slug]', "raiz e segmento em acesso a membro", 1],
    ['[rootOf(slug), organizationId]', "raiz vinda de chamada", 1],
  ] as const)("%s (%s)", async (keys, _why, expected) => {
    const msgs = await compositeViolations(`${PRELUDE}useRealtimeSubscription("t", ${keys});`);
    expect(msgs).toHaveLength(expected);
    expect(msgs.every((m) => m.severity === 2)).toBe(true);
  });

  it("chave inteira passada como variável solta (`queryKey`) também", async () => {
    const msgs = await compositeViolations(`${PRELUDE}useRealtimeSubscription("conversations", queryKey);`);
    expect(msgs).toHaveLength(1);
  });

  it.each([SO_BLOCO_ERROS, SO_BLOCO_WAME])("vale também em %s (o outro bloco)", async (filePath) => {
    const msgs = await compositeViolations(`${PRELUDE}useRealtimeSubscription("t", ["pipeline_stages", pipelineType]);`, filePath);
    expect(msgs).toHaveLength(1);
  });
});

describe("formas corretas passam", () => {
  it.each([
    ['["leads", "pipeline"]', "várias raízes literais"],
    ['[["pipeline_entries", slug, organizationId]]', "composto aninhado"],
    ['[queryKey]', "chave inteira dentro da lista"],
    ['[UNREAD_KEY, "user-alerts"]', "constante de raiz em CAIXA ALTA"],
    ["SOCIAL_KEYS", "lista constante em CAIXA ALTA"],
    ["[QUERY_KEYS.LEADS, QUERY_KEYS.PIPELINE]", "raízes constantes em acesso a membro"],
    ['[{ queryKey: ["leads", "count", organizationId], minAgeMs: 60000 }]', "alvo com idade mínima"],
  ])("%s (%s)", async (keys) => {
    expect(await compositeViolations(`${PRELUDE}useRealtimeSubscription("t", ${keys});`)).toHaveLength(0);
  });

  it("não engole as regras que já moravam nos dois blocos", async () => {
    const [comum] = await eslint.lintText(`const u = "https://wa.me/5511999999999";`, { filePath: COMUM });
    expect(comum.messages.some((m) => m.ruleId === "no-restricted-syntax" && m.message.includes("wa.me"))).toBe(true);

    const toastCode = `declare const toast: { error(m: string): void }; declare const err: Error; toast.error(err.message);`;
    const [erros] = await eslint.lintText(toastCode, { filePath: SO_BLOCO_ERROS });
    expect(erros.messages.some((m) => m.ruleId === "no-restricted-syntax" && m.message.includes("ADR-0038"))).toBe(true);
  });
});
