/**
 * Resíduo de remoção na página de Leads e nos dois cards — SCRUM-232.
 *
 * A fatia L4 tirou coisa de dentro de `Leads.tsx`: o cluster "Dados" saiu para
 * o card (ADR-0024 §1), o cartão do celular saiu para `LeadMobileCard`, o modal
 * antigo deu lugar ao `LeadCardPanel`. Toda remoção dessas deixa import órfão —
 * o componente sai do JSX, a linha de `import` fica.
 *
 * Por que isso não é cosmético em `Leads.tsx` especificamente: os imports desta
 * página são quase todos de MÓDULO (`@/modules/...`) e de página lazy. Um
 * import vivo por engano segura a dependência no grafo do bundle, e a página de
 * Leads é a mais aberta do produto. Além disso, resíduo é o que faz o próximo
 * leitor acreditar que o código removido ainda roda — foi assim que a coluna
 * "Dados" continuou "existindo" em três conversas depois de ter saído.
 *
 * O `npm run lint` cru não serve de sinal aqui: ele sai 0 e imprime
 * `✖ 29142 problems` do baseline herdado, então um `no-unused-vars` novo se
 * perde no meio. Este teste olha só os arquivos da fatia, e falha por arquivo.
 *
 * Mesmo formato do guarda que o repo já usa em
 * `tests/unit/no-organizationid-from-useauth.test.ts`: contrato varrido no
 * texto, sem montar nada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();

/** Os arquivos que a fatia L4 mexeu — o escopo em que resíduo é regressão dela. */
const ARQUIVOS = [
  "src/modules/leads/pages/Leads.tsx",
  "src/modules/leads/components/leads/LeadListRow.tsx",
  "src/modules/leads/components/leads/LeadMobileCard.tsx",
  "src/modules/leads/components/lead-card/LeadCard.tsx",
  "src/modules/leads/components/lead-card/LeadCardContainer.tsx",
  "src/modules/leads/components/lead-card/LeadCardPanel.tsx",
  "src/modules/leads/components/lead-card/LeadCardDeals.tsx",
  "src/modules/leads/components/lead-card/LeadCardFields.tsx",
  "src/modules/leads/components/lead-card/LeadCardHistory.tsx",
  "src/modules/leads/components/lead-card/LeadCardMetrics.tsx",
  "src/modules/leads/components/lead-card/LeadCardNotes.tsx",
  "src/modules/leads/components/deal-card/DealCard.tsx",
  "src/modules/leads/components/deal-card/DealCardPanel.tsx",
  "src/modules/leads/components/deal-card/DealCardStages.tsx",
  "src/modules/leads/components/deal-card/DealCardTimeline.tsx",
  "src/preview/Preview.tsx",
  "src/preview/main.tsx",
];

/** `import <clausula> from "<origem>"` — inclusive quebrado em várias linhas. */
const IMPORT_RE = /(?:^|\n)[ \t]*import\s+([\s\S]*?)\s+from\s*["'][^"']+["']/g;

function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Os nomes que a cláusula introduz no escopo do arquivo — já com alias resolvido. */
function nomesLigados(clausula: string): string[] {
  const limpa = clausula.replace(/^type\s+/, "");
  const nomes: string[] = [];

  const chaves = limpa.match(/\{([\s\S]*)\}/);
  if (chaves) {
    for (const parte of chaves[1].split(",")) {
      const t = parte.trim().replace(/^type\s+/, "");
      if (!t) continue;
      const [, alias] = t.split(/\s+as\s+/);
      nomes.push((alias ?? t).trim());
    }
  }

  // Default e namespace ficam fora das chaves.
  for (const parte of limpa.replace(/\{[\s\S]*\}/, "").split(",")) {
    const t = parte.trim().replace(/^type\s+/, "");
    if (!t) continue;
    const ns = t.match(/^\*\s+as\s+(\w+)$/);
    if (ns) {
      nomes.push(ns[1]);
      continue;
    }
    if (/^\w+$/.test(t)) nomes.push(t);
  }

  return nomes;
}

function importsMortos(caminho: string): string[] {
  const bruto = readFileSync(join(RAIZ, caminho), "utf8");

  const nomes: string[] = [];
  let corpo = bruto;
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(bruto)) !== null) {
    nomes.push(...nomesLigados(m[1]));
    corpo = corpo.replace(m[0], "\n");
  }

  // Comentário não conta como uso: `LeadCard` citado num bloco de explicação
  // não segura o import. É exatamente o caso desta fatia, cheia de comentário
  // que nomeia componente removido.
  const codigo = semComentarios(corpo);

  return nomes.filter((nome) => {
    const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\b${escapado}\\b`).test(codigo);
  });
}

describe("Leads e os dois cards — nenhum import sobreviveu ao que foi removido", () => {
  it.each(ARQUIVOS)("%s não tem import morto", (caminho) => {
    expect(existsSync(join(RAIZ, caminho)), `${caminho} sumiu — atualize a lista`).toBe(true);

    const mortos = importsMortos(caminho);

    expect(
      mortos,
      `${caminho} importa e nunca usa: ${mortos.join(", ")}. Resíduo de remoção — apague a linha.`,
    ).toEqual([]);
  });
});

/**
 * O detector precisa morder. Sem isto, um bug no parser (por exemplo, contar
 * menção em comentário como uso) faria a suíte inteira passar para sempre com
 * qualquer resíduo em pé.
 */
describe("o próprio detector", () => {
  it("acha o import que só aparece dentro de comentário", () => {
    const arquivo = "src/modules/leads/pages/Leads.tsx";
    const original = readFileSync(join(RAIZ, arquivo), "utf8");

    // Simula o resíduo clássico: o componente saiu do JSX, a linha ficou e
    // sobrou uma menção num comentário.
    const sujo = `import { CountRing } from "./CountRing";\n// CountRing saiu com o cluster Dados\n${original}`;
    expect(sujo).toContain("CountRing");

    const nomes: string[] = [];
    let corpo = sujo;
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(sujo)) !== null) {
      nomes.push(...nomesLigados(m[1]));
      corpo = corpo.replace(m[0], "\n");
    }
    const vivos = semComentarios(corpo);

    expect(nomes).toContain("CountRing");
    expect(/\bCountRing\b/.test(vivos)).toBe(false);
  });

  it("não confunde alias com o nome original", () => {
    expect(nomesLigados('{ LeadCard as CardAntigo }')).toEqual(["CardAntigo"]);
    expect(nomesLigados('React, { useState, type ReactNode }')).toEqual([
      "useState",
      "ReactNode",
      "React",
    ]);
    expect(nomesLigados('* as DialogPrimitive')).toEqual(["DialogPrimitive"]);
  });
});
