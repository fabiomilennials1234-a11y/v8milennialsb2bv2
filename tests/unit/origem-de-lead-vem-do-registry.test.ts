/**
 * A lista de origens oferecida ao usuário vem do registry, não de um literal.
 *
 * O chamado que originou esta guarda (Pesco, 29/09/2026): *"não consigo
 * adicionar a origem Prospecção Ativa, se não for dentro do funil de
 * loteamento"*. A origem nunca foi por funil — `lead_origins` não tem coluna de
 * pipeline. O que havia era `Leads.tsx` com um `originLabels` de **8** slugs
 * governando o Select do formulário e o do filtro, enquanto o cadastro de
 * dentro do funil já lia as 13 do registry via `useLeadOrigins`. Mesma origem,
 * duas listas: pela aba Leads a opção simplesmente não existia, e o lead nascia
 * "Outros" (37 leads num único dia, naquela org).
 *
 * O defeito é sorrateiro porque o literal parcial **funciona** — renderiza,
 * salva, não quebra teste nenhum. Só não oferece tudo. E some da revisão: são
 * oito linhas de aparência inocente no topo de um arquivo de 1400.
 *
 * Por isso o contrato aqui não é "use o hook" (fácil de satisfazer e continuar
 * errado, bastando deixar o literal governando o Select ao lado). É: **um mapa
 * literal que fale de origem tem que falar de TODAS elas.** Mapa de cor pode
 * existir — `originClassName` é classe Tailwind e o registry guarda hex —, mas
 * não pode ser parcial, senão vira de novo a lista que decide o que aparece.
 *
 * Mesmo formato dos guardas que o repo já usa (`leads-sem-imports-mortos`,
 * `role-vocabulary`): contrato varrido no texto, sem montar nada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_LEAD_ORIGINS } from "../../src/modules/leads/hooks/useLeadOrigins";

const RAIZ = process.cwd();

/** Telas onde o usuário ESCOLHE a origem — as que o chamado atravessou. */
const TELAS = [
  "src/modules/leads/pages/Leads.tsx",
  "src/modules/leads/components/leads/LeadModal.tsx",
  "src/modules/leads/components/lead/create/LeadCreateForm.tsx",
];

const SLUGS = BUILTIN_LEAD_ORIGINS.map((o) => o.slug);

/** Abaixo disto o literal não está falando de origem — é coincidência de chave. */
const MINIMO_PARA_SER_LISTA_DE_ORIGEM = 3;

/** `const nome ... = { ... };` no topo do arquivo (não-aninhado). */
const LITERAL_RE = /(?:^|\n)(?:export\s+)?const\s+(\w+)[^=\n]*=\s*\{([\s\S]*?)\n\};/g;

/** Chaves do literal que são slug de origem conhecido. */
function slugsDoLiteral(corpo: string): string[] {
  return SLUGS.filter((slug) => new RegExp(`(?:^|[\\s{,])["']?${slug}["']?\\s*:`, "m").test(corpo));
}

export interface ListaParcial {
  nome: string;
  faltando: string[];
}

/** Literais que falam de origem sem falar de todas. */
export function listasParciais(codigo: string): ListaParcial[] {
  const achados: ListaParcial[] = [];
  LITERAL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LITERAL_RE.exec(codigo)) !== null) {
    const [, nome, corpo] = m;
    const presentes = slugsDoLiteral(corpo);
    if (presentes.length < MINIMO_PARA_SER_LISTA_DE_ORIGEM) continue;
    const faltando = SLUGS.filter((s) => !presentes.includes(s));
    if (faltando.length > 0) achados.push({ nome, faltando });
  }
  return achados;
}

describe("origem de lead — a lista vem do registry, não de um literal parcial", () => {
  it.each(TELAS)("%s oferece as origens da org", (caminho) => {
    expect(existsSync(join(RAIZ, caminho)), `${caminho} sumiu — atualize a lista`).toBe(true);
    const codigo = readFileSync(join(RAIZ, caminho), "utf8");

    expect(
      codigo.includes("useLeadOrigins"),
      `${caminho} não lê useLeadOrigins — a tela vai oferecer uma lista sua, ` +
        `que diverge da origem que o cadastro de dentro do funil enxerga.`,
    ).toBe(true);

    const parciais = listasParciais(codigo);
    const descricao = parciais
      .map((p) => `${p.nome} (sem: ${p.faltando.join(", ")})`)
      .join(" · ");

    expect(
      parciais,
      `${caminho} tem mapa de origem PARCIAL: ${descricao}. ` +
        `Origem que falta no mapa é origem que o usuário não escolhe — foi ` +
        `exatamente assim que "Prospecção Ativa" ficou invisível na aba Leads. ` +
        `Complete o mapa ou tire a decisão dele e deixe com useLeadOrigins.`,
    ).toEqual([]);
  });
});

/**
 * O detector precisa morder. Sem isto, um erro no regex faria a suíte passar
 * para sempre com o literal de 8 slugs de volta no lugar.
 */
describe("o próprio detector", () => {
  it("acusa o literal de 8 slugs que causou o chamado", () => {
    const regressao = `
const originLabels: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  outro: "Outros",
  site: "Site",
  remarketing: "Remarketing",
  google_ads: "Google Ads",
  cal: "Cal.com",
  indicacao: "Indicação",
};
`;
    const [achado] = listasParciais(regressao);
    expect(achado?.nome).toBe("originLabels");
    expect(achado?.faltando).toContain("prospeccao_ativa");
  });

  it("aceita o mapa completo", () => {
    const corpo = SLUGS.map((s) => `  ${s}: "x",`).join("\n");
    expect(listasParciais(`const originColors = {\n${corpo}\n};\n`)).toEqual([]);
  });

  it("ignora literal que não fala de origem", () => {
    const outro = `const tiers = {\n  bronze: 1,\n  prata: 2,\n  ouro: 3,\n};\n`;
    expect(listasParciais(outro)).toEqual([]);
  });
});
