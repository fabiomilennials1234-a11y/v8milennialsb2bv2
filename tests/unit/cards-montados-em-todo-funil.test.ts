/**
 * SCRUM-124 — o Card do Negócio é montado nos QUATRO funis e na aba de Leads.
 *
 * POR QUE ESTÁTICO
 * ----------------
 * O que a task pede é COBERTURA DE SÍTIO, não comportamento: "hoje só no
 * pipe-whatsapp". O comportamento dos dois cards já tem prova própria e cara —
 * `cards-nunca-empilham.test.tsx` monta os dois de verdade e afirma que nunca
 * coexistem. Repetir aquela montagem cinco vezes custaria ~5 × 3,5s de jsdom
 * para reafirmar o que ela já afirma.
 *
 * O que NÃO está coberto por lugar nenhum é a pergunta desta task: *todas* as
 * portas abrem a mesma ficha? Essa é uma propriedade da ÁRVORE, e o modo de
 * falha é sempre o mesmo — alguém cria a quinta página de funil copiando uma
 * antiga, e ela nasce com o diálogo legado. Nenhum teste de render pega isso,
 * porque o arquivo novo simplesmente não aparece em nenhuma suíte.
 *
 * O DEFEITO QUE ISTO TRAVA
 * ------------------------
 * Antes do SCRUM-124, abrir o MESMO negócio pela aba de Leads e por dentro do
 * funil dava duas telas diferentes. A diferença não era o negócio: era a porta
 * de entrada. Do lado do usuário isso não tem explicação possível — ele vê o
 * sistema mostrar coisas diferentes para a mesma coisa, e não há nada na
 * interface que diga por quê.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * As cinco portas para a ficha do Negócio. Lista explícita, não glob: se um
 * funil novo nascer, ele NÃO é pego por este arquivo — é pego pela revisão que
 * vier perguntar por que a lista não cresceu. Um glob esconderia a pergunta.
 */
const PORTAS = [
  // SCRUM-637 (flip): as 3 páginas de sistema morreram — /pipe-* redireciona
  // pra rota única, e a porta de TODO funil é a página unificada.
  { rotulo: "página unificada /funil/:slug", arquivo: "src/modules/pipelines/pages/Funil.tsx" },
  { rotulo: "aba de Leads", arquivo: "src/modules/leads/pages/Leads.tsx" },
];

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Só o código: comentários citam os nomes para explicar a troca. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("SCRUM-124 — toda porta para um Negócio abre a MESMA ficha", () => {
  it.each(PORTAS)("$rotulo monta <DealCardPanel />", ({ arquivo }) => {
    expect(semComentarios(ler(arquivo))).toContain("<DealCardPanel />");
  });

  it.each(PORTAS)("$rotulo NÃO monta o <DealDetailDialog /> legado", ({ arquivo }) => {
    // Não basta ter o card novo: montar os dois deixaria duas fichas de negócio
    // vivas na mesma página, e qual aparece viraria questão de ordem de render.
    expect(semComentarios(ler(arquivo))).not.toContain("<DealDetailDialog />");
  });

  it.each(PORTAS)("$rotulo monta <LeadCardPanel /> junto — o vaivém precisa dos dois", ({ arquivo }) => {
    // Clicar na pessoa dentro do card do Negócio fecha esse e abre o do Lead.
    // Sem o segundo painel montado, o clique fecha a ficha e não abre nada — e o
    // sintoma é "sumiu", que ninguém liga a um painel faltando.
    expect(semComentarios(ler(arquivo))).toContain("<LeadCardPanel />");
  });

  it.each(PORTAS)("$rotulo tem LeadPanelProvider POR FORA do DealPanelProvider", ({ arquivo }) => {
    // Ordem, não presença. `DealCardPanel.abrirLead` chama `useLeadSheet`, que
    // procura contexto acima dele na árvore. Com os providers invertidos os dois
    // cards ainda montam e a página abre normalmente — quebra só no clique na
    // pessoa, que é o caminho menos testado à mão.
    const src = semComentarios(ler(arquivo));
    const lead = src.indexOf("<LeadPanelProvider>");
    const deal = src.indexOf("<DealPanelProvider>");

    expect(lead, "LeadPanelProvider ausente").toBeGreaterThanOrEqual(0);
    expect(deal, "DealPanelProvider ausente").toBeGreaterThanOrEqual(0);
    expect(lead).toBeLessThan(deal);
  });

  it("a varredura de fato lê os arquivos (o gate não passa por caminho errado)", () => {
    // Sem isto, um rename de página faria `readFileSync` estourar — o que ao
    // menos falha alto — mas um caminho que aponte para arquivo vazio passaria
    // calado em `not.toContain`. Ancorar num marcador que todo funil tem.
    for (const { arquivo } of PORTAS) {
      expect(ler(arquivo).length, `${arquivo} veio vazio`).toBeGreaterThan(1000);
      expect(ler(arquivo), `${arquivo} não parece uma página`).toContain("export default function");
    }
  });
});

describe("SCRUM-124 — os cards saem pelo barrel, não por deep-import", () => {
  const BARREL = "src/modules/leads/index.ts";

  it.each(["DealCardPanel", "LeadCardPanel"])("o barrel de leads exporta %s", (nome) => {
    expect(ler(BARREL)).toContain(`export { ${nome} }`);
  });

  it.each(PORTAS.filter((p) => p.arquivo.includes("/pipelines/")))(
    "$rotulo importa os cards de @/modules/leads, sem furar a fronteira",
    ({ arquivo }) => {
      // `boundaries/element-types` é `error` desde a slice 17: cross-module só
      // pelo barrel. Enquanto só o pipe-whatsapp montava os cards, ele os
      // alcançava por deep-import; replicar aquilo em mais três páginas seria
      // multiplicar a violação por quatro em vez de fechá-la.
      const src = ler(arquivo);
      expect(src).not.toMatch(/from\s+["']@\/modules\/leads\/components\/(deal-card|lead-card)\//);
    },
  );
});
