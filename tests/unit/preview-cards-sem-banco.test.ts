/**
 * A rota `/preview.html` não pode ter caminho até banco nenhum.
 *
 * Prova `inv:H5-17` (SCRUM-121).
 *
 * A rota existe para o desenho dos dois cards ser julgado sem login. Isso só é
 * seguro por uma razão: ela **não constrói client de Supabase**. Não é "auth
 * desligada num app que lê dado de cliente" — é uma tela que não tem de onde
 * ler. A diferença entre as duas frases é a única coisa que separa uma
 * ferramenta de desenho de uma porta aberta para PROD, porque
 * `VITE_SUPABASE_*` está no bundle e a chave anon vale para quem abrir a
 * página.
 *
 * A garantia é **transitiva**, e é aí que ela se perde sozinha: ninguém vai
 * escrever `import { supabase }` no `Preview.tsx`. O que acontece é alguém
 * trocar `LeadCard` por `LeadCardContainer` para "ver com dado real", ou um dos
 * componentes de dentro do card ganhar um `useQuery` — e o client entra pela
 * terceira aresta do grafo, sem nenhuma linha suspeita no arquivo de entrada.
 * Por isso este teste caminha o grafo inteiro a partir de `src/preview/main.tsx`
 * em vez de olhar o arquivo de entrada.
 *
 * O segundo caso coberto é o inverso: a entrada de preview não pode vazar para
 * dentro do app (`index.html`), senão o bundle de produção passa a carregar as
 * fixtures.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const RAIZ = process.cwd();
const ENTRADA = join(RAIZ, "src", "preview", "main.tsx");

/**
 * Módulos que, uma vez alcançáveis, significam que a tela fala com banco, com
 * o app inteiro, ou com a sessão de quem abriu.
 */
const PROIBIDOS_EXTERNOS = [
  "@supabase/supabase-js",
  "@tanstack/react-query",
  "react-router-dom",
];

/** Caminhos do `src/` que não podem aparecer no grafo, por prefixo. */
const PROIBIDOS_INTERNOS = [
  "src/App.tsx",
  "src/integrations/supabase",
  "src/contexts",
  "src/core",
  "src/main.tsx",
];

const EXTENSOES = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Tira comentários antes de procurar por menção a banco. Sem isto o próprio
 * cabeçalho de `main.tsx` — que explica que NÃO importa Supabase — reprovaria
 * o teste, e a lição aprendida seria "não escreva o porquê".
 */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Só interessa código; `.css` e afins entram no bundle sem trazer client. */
function ehCodigo(caminho: string): boolean {
  return EXTENSOES.some((e) => caminho.endsWith(e));
}

function resolverArquivo(base: string): string | null {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSOES) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSOES) {
    const idx = join(base, "index" + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

/** `import ... from "x"`, `export ... from "x"` e `import("x")`. */
function especificadores(codigo: string): string[] {
  const achados: string[] = [];
  const estaticos = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?from\s*["']([^"']+)["']/g;
  const soEfeito = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  const dinamicos = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [estaticos, soEfeito, dinamicos]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(codigo)) !== null) achados.push(m[1]);
  }
  return achados;
}

interface Grafo {
  /** Arquivos de `src/` alcançáveis, relativos à raiz, com `/`. */
  internos: Set<string>;
  /** Pacotes bare alcançáveis. */
  externos: Set<string>;
  /** Quem importou quem — para a mensagem de falha apontar a aresta culpada. */
  origem: Map<string, string>;
}

function caminhar(entrada: string): Grafo {
  const internos = new Set<string>();
  const externos = new Set<string>();
  const origem = new Map<string, string>();
  const fila = [entrada];

  const rel = (p: string) => relative(RAIZ, p).replace(/\\/g, "/");

  while (fila.length) {
    const atual = fila.pop()!;
    const chave = rel(atual);
    if (internos.has(chave)) continue;
    internos.add(chave);

    const codigo = readFileSync(atual, "utf8");
    for (const spec of especificadores(codigo)) {
      let alvo: string | null = null;

      if (spec.startsWith("@/")) {
        alvo = resolverArquivo(join(RAIZ, "src", spec.slice(2)));
      } else if (spec.startsWith(".")) {
        alvo = resolverArquivo(resolve(dirname(atual), spec));
      } else {
        if (!externos.has(spec)) origem.set(spec, chave);
        externos.add(spec);
        continue;
      }

      if (!alvo) continue; // `.css`, `.svg`, assets — não trazem código.
      if (!ehCodigo(alvo)) continue;
      const alvoRel = rel(alvo);
      if (!origem.has(alvoRel)) origem.set(alvoRel, chave);
      fila.push(alvo);
    }
  }

  return { internos, externos, origem };
}

describe("/preview.html — a tela dos dois cards não tem de onde ler", () => {
  const grafo = caminhar(ENTRADA);

  it("a entrada existe e é separada do app", () => {
    expect(existsSync(ENTRADA)).toBe(true);
    expect(existsSync(join(RAIZ, "preview.html"))).toBe(true);
  });

  it("não alcança o client do Supabase, nem por três arestas de distância", () => {
    const culpados = [...grafo.internos].filter((f) =>
      PROIBIDOS_INTERNOS.some((p) => f === p || f.startsWith(p + "/")),
    );

    expect(
      culpados.map((c) => `${c}  ← importado por ${grafo.origem.get(c) ?? "?"}`),
      "A rota de visualização passou a alcançar o app/o banco. Ela é aberta sem login: o que ela alcança, qualquer visitante alcança.",
    ).toEqual([]);
  });

  it("não puxa supabase-js, react-query nem o roteador — sem client, sem sessão, sem rota", () => {
    const culpados = PROIBIDOS_EXTERNOS.filter((p) => grafo.externos.has(p));

    expect(
      culpados.map((c) => `${c}  ← importado por ${grafo.origem.get(c) ?? "?"}`),
    ).toEqual([]);
  });

  it("nenhum arquivo alcançável escreve `supabase` ou `createClient` em código", () => {
    const culpados = [...grafo.internos].filter((f) =>
      /\bsupabase\b|\bcreateClient\b/i.test(semComentarios(readFileSync(join(RAIZ, f), "utf8"))),
    );

    expect(
      culpados,
      "Alguém construiu um client dentro da árvore da visualização — ela abre sem login.",
    ).toEqual([]);
  });

  it("monta os DOIS cards a partir de fixture, não de hook de dado", () => {
    expect(grafo.internos.has("src/modules/leads/components/lead-card/LeadCard.tsx")).toBe(true);
    expect(grafo.internos.has("src/modules/leads/components/deal-card/DealCard.tsx")).toBe(true);
    expect(grafo.internos.has("src/modules/leads/components/lead-card/fixtures.ts")).toBe(true);
    expect(grafo.internos.has("src/modules/leads/components/deal-card/fixtures.ts")).toBe(true);

    // Os containers são justamente quem liga ao banco — ficam de fora.
    expect(grafo.internos.has("src/modules/leads/components/lead-card/LeadCardContainer.tsx")).toBe(false);
    expect(grafo.internos.has("src/modules/leads/components/lead-card/useLeadCardData.ts")).toBe(false);
    expect(grafo.internos.has("src/modules/leads/components/deal-card/useDealCardData.ts")).toBe(false);
  });
});

describe("/preview.html — não vaza para o app", () => {
  const previewHtml = readFileSync(join(RAIZ, "preview.html"), "utf8");
  const indexHtml = readFileSync(join(RAIZ, "index.html"), "utf8");

  it("preview.html carrega a própria entrada, não a do app", () => {
    expect(previewHtml).toContain("/src/preview/main.tsx");
    expect(previewHtml).not.toContain("/src/main.tsx");
  });

  it("index.html não conhece a rota de visualização", () => {
    expect(indexHtml).not.toContain("preview");
  });

  it("pede para não ser indexada — tela de trabalho não vira resultado de busca", () => {
    expect(previewHtml).toMatch(/name=["']robots["'][^>]*noindex/i);
  });
});
