/**
 * O vocabulário de `team_members.role` — amarrado ao enum, não a um literal.
 *
 * POR QUE ESTE ARQUIVO EXISTE (#1541)
 * -----------------------------------
 * Um gate de permissão comparava `role === "membro"`. O banco guarda `member`.
 * A comparação nunca casava, e todo não-admin era negado em silêncio. Sobreviveu
 * porque quem testa costuma ser admin — e porque os dublês dos testes aceitavam
 * QUALQUER string: um objeto em memória não tem CHECK constraint, então
 * `role: "membro"` passava no teste e estouraria `22P02` no banco. **Dublê mais
 * frouxo que o real não é teste, é permissão para o bug existir.**
 *
 * Escrever `expect("member").toBe("member")` provaria apenas que duas strings
 * iguais são iguais. Então a amarra aqui é dupla:
 *
 *   1. TIPO — `Record<AppRole, true>` exaustivo, em
 *      `src/modules/identity/permissions/lib/app-role.ts`. Fica em `src/` de
 *      propósito: `tsconfig.app.json` tem `"include": ["src"]`, então uma
 *      asserção de tipo escrita AQUI nunca seria compilada e o
 *      `typecheck:ratchet` jamais reprovaria por ela.
 *   2. RUNTIME — o mesmo conjunto conferido contra `Constants.public.Enums.app_role`,
 *      que é gerado de `supabase gen types` a partir do catálogo de produção.
 *      Tipo sozinho não pega types.ts defasado; runtime sozinho não pega a
 *      mudança de enum. Juntos, pegam os dois.
 *
 * E a terceira amarra é a varredura do corpo do repositório: nenhum literal de
 * role fora do enum, em nenhum lugar — porque foi exatamente um literal solto
 * que produziu o defeito.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Constants } from "@/integrations/supabase/types";
import { APP_ROLES as ROLES_DO_ENUM, isAppRole } from "@/modules/identity/permissions/lib/app-role";

const APP_ROLES = [...ROLES_DO_ENUM].sort();

/**
 * Literais que aparecem em `role` mas NÃO são `team_members.role`. Cada entrada
 * carrega o motivo — allowlist sem motivo vira depósito, e depósito esconde o
 * próximo bug igual a este.
 */
const NAO_E_APP_ROLE: Record<string, string> = {
  // Papéis de mensagem de LLM/chat (OpenAI-like), outro domínio inteiro.
  user: "papel de mensagem de chat/LLM",
  assistant: "papel de mensagem de chat/LLM",
  system: "papel de mensagem de chat/LLM",
  tool: "papel de mensagem de chat/LLM",
  model: "papel de mensagem de chat/LLM",
  // Papel da ETAPA de funil (pipeline_stages.role), não da pessoa.
  won: "role da etapa de funil",
  lost: "role da etapa de funil",
  open: "role da etapa de funil",
  meeting_booked: "role da etapa de funil",
  meeting_held: "role da etapa de funil",
  // Curinga de filtro de gatilho de automação.
  any: "curinga do filtro de gatilho (workflow-trigger)",
  // Papéis do Postgres/PostgREST, não da aplicação.
  authenticated: "role do Postgres, não do app",
  service_role: "role do Postgres, não do app",
  anon: "role do Postgres, não do app",
  // Rótulo de interface, escrito em português para o vendedor ler.
  Vendas: "rótulo de UI em Performance.tsx, não valor de banco",
  // Ator FORA do enum, guardado em tabela própria — a mesma classe de confusão
  // que produziu o #1541: camada de permissão tratada como valor de role.
  gestor: "Gestor de Portfólio é ator separado (não está em team_members.role)",
  /**
   * `master` NÃO é role, e está aqui declarado como dívida, não como aprovação.
   * É camada à parte (`is_master_user()`, `useMasterAuth()`). Onde aparece hoje:
   *   - src/lib/visible-ranking.ts:24 — filtro defensivo `role !== "master"`,
   *     que nunca remove nada porque a condição é inalcançável;
   *   - tests/unit/visible-ranking.test.ts — fixtures que exercitam esse filtro,
   *     ou seja, afirmam comportamento sobre uma entrada impossível.
   * Os dois são EXCLUSÃO, não concessão: inalcançáveis, mas inofensivos. Os dois
   * ramos que CONCEDIAM por literal impossível (`|| role === "master"` no
   * QuickBlastProgressPanel e `|| role === "owner"` no ElevenLabsSettings) foram
   * removidos neste PR — apagar condição comprovadamente inalcançável não muda
   * quem passa. Fazer master de fato controlar o disparo é mudança de PERMISSÃO
   * (exige `isMaster`) e não entra de carona num PR de doc e teste.
   */
  master: "camada à parte, não é app_role — dívida conhecida, ver #1541",
};

/** `typeof x === "string"` e afins não são vocabulário de role. */
const TIPOS_JS = new Set(["string", "number", "boolean", "object", "undefined", "function", "symbol", "bigint"]);

const RAIZ = resolve(__dirname, "../..");
const DIRS = ["src", "tests", "supabase/functions"];
const EXT = /\.(ts|tsx)$/;
const IGNORAR = new Set(["node_modules", "dist", ".git", "coverage", "archive"]);

function arquivos(dir: string): string[] {
  let out: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out = out.concat(arquivos(caminho));
    else if (EXT.test(nome)) out.push(caminho);
  }
  return out;
}

/** `role: "x"`, `role === "x"`, `role !== "x"`, `userRole: "x"`. */
const PADROES = [
  /\b(?:user)?[Rr]ole\??\s*:\s*"([A-Za-z_]+)"/g,
  /\b(?:user)?[Rr]ole\b\s*[!=]==?\s*"([A-Za-z_]+)"/g,
];

interface Achado {
  arquivo: string;
  linha: number;
  literal: string;
}

/**
 * Apaga comentários, preservando a numeração de linha.
 *
 * Sem isto a guarda acusa a própria prosa que documenta o defeito — e uma regra
 * que proíbe *escrever sobre* o bug é pior que não ter regra: empurra o
 * conhecimento para fora do código, que é de onde ele saiu quando a doc do
 * repositório passou a mentir sobre o enum.
 */
function semComentarios(fonte: string): string[] {
  const saida: string[] = [];
  let emBloco = false;
  for (const linha of fonte.split("\n")) {
    let out = "";
    for (let i = 0; i < linha.length; i++) {
      if (emBloco) {
        if (linha[i] === "*" && linha[i + 1] === "/") { emBloco = false; i++; }
        continue;
      }
      if (linha[i] === "/" && linha[i + 1] === "/") break;
      if (linha[i] === "/" && linha[i + 1] === "*") { emBloco = true; i++; continue; }
      out += linha[i];
    }
    saida.push(out);
  }
  return saida;
}

function varrer(): Achado[] {
  const achados: Achado[] = [];
  for (const dir of DIRS) {
    for (const arquivo of arquivos(join(RAIZ, dir))) {
      // Este próprio arquivo declara o vocabulário; varrer a si mesmo é ruído.
      if (arquivo.endsWith("role-vocabulary.test.ts")) continue;
      const linhas = semComentarios(readFileSync(arquivo, "utf8"));
      linhas.forEach((linha, i) => {
        if (/typeof\s/.test(linha)) return;
        for (const padrao of PADROES) {
          padrao.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = padrao.exec(linha)) !== null) {
            const literal = m[1];
            if (TIPOS_JS.has(literal)) continue;
            if (isAppRole(literal)) continue;
            if (literal in NAO_E_APP_ROLE) continue;
            achados.push({ arquivo: arquivo.slice(RAIZ.length + 1), linha: i + 1, literal });
          }
        }
      });
    }
  }
  return achados;
}

describe("vocabulário de team_members.role", () => {
  it("o conjunto declarado bate com o enum app_role gerado do catálogo", () => {
    // Fonte independente: Constants vem de `supabase gen types`, não daqui.
    expect(APP_ROLES).toEqual([...Constants.public.Enums.app_role].sort());
  });

  it('"membro" não é um valor legal — o banco recusa com 22P02', () => {
    expect(Constants.public.Enums.app_role).not.toContain("membro");
    expect(APP_ROLES).not.toContain("membro");
  });

  it('"master" não é role — é camada à parte, fora do enum', () => {
    expect(Constants.public.Enums.app_role).not.toContain("master");
  });

  it("nenhum literal de role fora do enum em src/, tests/ e supabase/functions/", () => {
    const achados = varrer();
    const relato = achados
      .map((a) => `  ${a.arquivo}:${a.linha} → "${a.literal}"`)
      .join("\n");
    expect(
      achados,
      achados.length === 0
        ? ""
        : `Literal de role fora do enum app_role (${APP_ROLES.join(", ")}).\n` +
            `Se for outro domínio (papel de mensagem, role de etapa), declare em NAO_E_APP_ROLE com o motivo.\n${relato}`,
    ).toEqual([]);
  });
});
