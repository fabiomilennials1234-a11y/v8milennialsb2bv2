/**
 * Todo `<Popover>` que vive dentro de um `Dialog`/`Sheet` precisa de `modal`.
 *
 * ── O DEFEITO ─────────────────────────────────────────────────────────────
 * Radix `Dialog` e `Sheet` montam um `react-remove-scroll` que engole o evento
 * `wheel` de tudo que estiver FORA do nó de conteúdo do diálogo. Um Radix
 * `Popover` portaliza seu `PopoverContent` para o `document.body` — ou seja,
 * para fora desse nó. Resultado: com o mouse, a lista dentro do popover **não
 * rola** (`scrollTop` fica em 0). A prop `modal` conserta porque faz o próprio
 * popover instalar seu `react-remove-scroll` com o conteúdo dele como nó
 * permitido.
 *
 * Segundo eixo, só no celular: `SheetContent` é `z-[51]` e o `PopoverContent`
 * do primitivo é `z-50` (`components/ui/popover.tsx:22`). Onde o painel vira
 * folha, a lista existe no DOM, com retângulo e `visibility: visible`, e mesmo
 * assim não pinta. Aí é preciso `z-[70]` além do `modal`.
 *
 * ── POR QUE ESTE ARQUIVO, E NÃO UM TESTE POR COMPONENTE ───────────────────
 * O defeito foi consertado três vezes em arquivos diferentes — #1862
 * (`client/ProductCombobox`), #1867 (`proposal/ProductCombobox`) e o sweep que
 * criou este arquivo — e as três vezes a lista de telas atingidas saiu errada,
 * porque nome de componente não diz onde ele é montado. Um teste de
 * comportamento por componente prova o caso que alguém lembrou de escrever; o
 * que faltava era a lista, e a garantia de que ela não encolhe sozinha.
 *
 * jsdom não tem layout nem rolagem, então medir "a lista rolou" aqui é
 * impossível de qualquer jeito. O que se trava é a CAUSA, no código-fonte.
 *
 * ── COMO MANTER ───────────────────────────────────────────────────────────
 * `<Popover>` novo faz `TOTAL_DE_POPOVERS` estourar. Isso é de propósito: a
 * pergunta "ele é montado dentro de um Dialog/Sheet?" precisa ser respondida
 * uma vez, por quem escreveu. Suba a cadeia com
 * `grep -rn "<NomeDoComponente" src --include=*.tsx` **até chegar num
 * `<Route>` do `App.tsx`** — não pare no primeiro `DialogContent` que aparecer,
 * e não pare antes. Depois: se fecha dentro de diálogo E o conteúdo é rolável,
 * entra na lista abaixo; senão, só o total sobe.
 *
 * 🚨 Duas armadilhas medidas no sweep, as duas custaram diagnóstico errado:
 *   1. **parar cedo demais.** O roteador `LeadDetailDialog` (V1/V2 do modal de
 *      lead) tem `DialogContent` e `SheetContent` de verdade — e **nenhuma
 *      página o monta**. Toda cadeia que morre nele é código morto, e três
 *      "defeitos" caíram por isso;
 *   2. **`<Popover` seguido de quebra de linha.** Um grep por `<Popover[ >]`
 *      perde os que abrem atributo na linha de baixo — foram 3, e um deles
 *      (`LeadCardEtiquetas`) era defeito real.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = process.cwd();
const SRC = join(RAIZ, "src");

/**
 * Os `<Popover>` que fecham cadeia dentro de um `Dialog`/`Sheet` VIVO — cada um
 * com a rota pela qual um usuário logado chega nele.
 *
 * `folha` = a cadeia passa por um `SheetContent` no celular, e portanto o
 * `PopoverContent` também precisa de `z-[70]`. Onde é só `Dialog`, o `z-50` do
 * primitivo empata com o do `DialogContent` e o portal, que entra depois no
 * DOM, pinta por cima — medido, não suposto.
 */
const DENTRO_DE_DIALOGO: ReadonlyArray<{
  arquivo: string;
  rota: string;
  folha: boolean;
}> = [
  // #1862 / #1867 — os dois primeiros, que deram nome ao padrão.
  { arquivo: "src/modules/carteira/components/client/ProductCombobox.tsx", rota: "/upsell", folha: false },
  { arquivo: "src/modules/carteira/components/proposal/ProductCombobox.tsx", rota: "/pipe-propostas", folha: true },

  // O sweep.
  { arquivo: "src/modules/carteira/components/client/ClientChipSelector.tsx", rota: "/upsell", folha: false },
  { arquivo: "src/modules/pipelines/components/disparo/AudienceConditionsControls.tsx", rota: "/pipe-whatsapp", folha: false },
  { arquivo: "src/modules/leads/components/leads/LeadChecklistSection.tsx", rota: "/chat-whatsapp", folha: false },
  { arquivo: "src/modules/leads/components/deal-card/DealCardChecklists.tsx", rota: "/leads", folha: true },
  { arquivo: "src/modules/leads/components/lead-detail/modal/header/ResponsibleSlot.tsx", rota: "/leads", folha: true },
  { arquivo: "src/modules/leads/components/lead-card/LeadCardEtiquetas.tsx", rota: "/leads", folha: true },
];

/**
 * Fecham cadeia dentro de diálogo, mas `modal` NÃO é o conserto deles.
 *
 * São seis seseletores de data. Todos têm a mesma forma: `<Popover>` **não
 * controlado**, com um `<Calendar>` dentro e `onSelect={setX}` — ou seja,
 * **escolher a data não fecha o popover**. Com `modal`, o Radix chama
 * `hideOthers` e o resto do diálogo fica `aria-hidden` + inerte até alguém
 * clicar fora ou apertar Esc. Medido: ligar `modal` nestes seis derruba 8
 * testes de comportamento que já existiam, todos por não achar mais o botão de
 * confirmar do diálogo enquanto o calendário está aberto.
 *
 * E o benefício é especulativo: o conteúdo é uma grade de mês de altura fixa
 * (~300px), não uma lista que cresce com o dado. Ela só transborda se a altura
 * disponível for menor que isso. O critério do sweep é "de fato transborda?",
 * não "é um popover?" — e aqui a resposta não foi medida.
 *
 * **Custo certo × benefício não medido: ficam sem `modal`.**
 *
 * O conserto que serviria aqui é outro e é maior: tornar o Popover controlado e
 * FECHAR no `onSelect`. Aí `modal` não custaria nada, porque o popover sai da
 * frente assim que a data é escolhida. É mudança de comportamento em 6 arquivos
 * e não cabia no sweep — está registrado aqui para não ser redescoberto.
 */
const CALENDARIOS_DEFERIDOS: ReadonlyArray<string> = [
  "src/modules/carteira/components/proposal/CommitmentDateModal.tsx",
  "src/modules/pipelines/components/legacy/confirmacao/AddMeetingModal.tsx",
  "src/modules/pipelines/components/legacy/confirmacao/RescheduleModal.tsx",
  "src/modules/pipelines/components/kanban/SetMeetingDateModal.tsx",
  "src/modules/engagement/components/followups/ScheduleFollowUpModal.tsx",
  "src/modules/communication/components/chat/ScheduleMessageModal.tsx",
];

/**
 * Quantos `<Popover>` raiz existem no `src/` inteiro.
 *
 * Medido em 2026-08-31 sobre `origin/main` (`e20a0b5c`): 54 no total, dos quais
 * 14 estão na lista acima. Os outros 40 são de página/kanban/tabela solta, ou
 * têm conteúdo que cabe inteiro — nos dois casos não há o que rolar.
 */
// SCRUM-637 (flip): as 3 páginas /pipe-* morreram levando 5 popovers de
// board (54 → 49) — nenhum popover novo entrou sem classificação.
// 2026-09-03 (calor fora da interface): `LeadCardCalor` e `CalorSlider` foram
// apagados, levando os 2 popovers de arrastar/ajustar o calor (49 → 47).
const TOTAL_DE_POPOVERS = 47;

function arquivosTsx(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosTsx(caminho, acc);
    else if (nome.endsWith(".tsx")) acc.push(caminho);
  }
  return acc;
}

/**
 * Acha o `<Popover>` RAIZ — não `PopoverContent`/`PopoverTrigger`/etc.
 *
 * `[\s>]` e não `[ >]`: a forma multi-linha (`<Popover\n  open={...}`) é comum
 * neste repo e foi exatamente a que escapou da primeira varredura do sweep.
 */
const POPOVER_RAIZ = /<Popover(?=[\s>])/g;

/**
 * O `<Popover ...>` inteiro, da abertura até o `>` que a fecha.
 *
 * ⚠️ Não dá para usar o primeiro `>` depois de `<Popover`: a forma comum aqui é
 * `onOpenChange={(v) => { ... }}`, e a seta traz um `>` DENTRO da tag. Cortar
 * ali devolve um pedaço que não contém os atributos seguintes — foi assim que
 * a primeira versão deste teste declarou `LeadCardEtiquetas` sem `modal`
 * estando ele consertado. Por isso o `>` só conta com as chaves fechadas.
 */
function tagsDePopover(fonte: string): string[] {
  const tags: string[] = [];
  for (const m of fonte.matchAll(POPOVER_RAIZ)) {
    let chaves = 0;
    for (let i = m.index!; i < fonte.length; i++) {
      const c = fonte[i];
      if (c === "{") chaves++;
      else if (c === "}") chaves--;
      else if (c === ">" && chaves === 0 && fonte[i - 1] !== "=") {
        tags.push(fonte.slice(m.index!, i + 1));
        break;
      }
    }
  }
  return tags;
}

describe("Popover dentro de Dialog/Sheet", () => {
  it.each(DENTRO_DE_DIALOGO)(
    "$arquivo é `modal` — sem isso a lista não rola em $rota",
    ({ arquivo }) => {
      const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
      const tags = tagsDePopover(fonte);

      expect(tags.length).toBeGreaterThan(0);
      expect(tags.some((t) => /\bmodal\b/.test(t))).toBe(true);
    },
  );

  it.each(DENTRO_DE_DIALOGO.filter((p) => p.folha))(
    "$arquivo pinta ACIMA da folha — `z-[70]` contra o `z-[51]` do SheetContent",
    ({ arquivo }) => {
      const fonte = readFileSync(join(RAIZ, arquivo), "utf8");

      // O `z-50` do primitivo perde para `SheetContent`, e a lista existe no
      // DOM sem nunca pintar. `elementsFromPoint` MENTE sobre isso: no sweep
      // ele disse "lista no topo" nos dois casos, inclusive no quebrado.
      expect(fonte).toMatch(/<PopoverContent[^>]*z-\[70\]/s);
    },
  );

  /**
   * O ratchet. Ver "COMO MANTER" no topo antes de só subir o número.
   */
  it("todo `<Popover>` novo passa por classificação", () => {
    const total = arquivosTsx(SRC).reduce(
      (n, f) => n + tagsDePopover(readFileSync(f, "utf8")).length,
      0,
    );

    expect(total).toBe(TOTAL_DE_POPOVERS);
  });

  /**
   * A lista acima é de caminho, não de nome — e é essa a lição que custou duas
   * PRs: existem DOIS `ProductCombobox`, em pastas irmãs, e a #1862 consertou
   * só um enquanto o corpo da PR afirmava ter coberto os dois.
   */
  it("as duas listas apontam arquivos que existem", () => {
    for (const arquivo of [
      ...DENTRO_DE_DIALOGO.map((p) => p.arquivo),
      ...CALENDARIOS_DEFERIDOS,
    ]) {
      expect(() => statSync(join(RAIZ, arquivo)), arquivo).not.toThrow();
      expect(relative(RAIZ, join(RAIZ, arquivo)).replace(/\\/g, "/")).toBe(arquivo);
    }
  });

  /**
   * O deferimento é uma DECISÃO, não um esquecimento — então ele é medido.
   *
   * Se alguém ligar `modal` num destes sem antes fazer o popover fechar no
   * `onSelect`, os testes de comportamento daquele diálogo caem junto. Este
   * caso diz o porquê antes de o outro dizer "não achei o botão".
   */
  it.each(CALENDARIOS_DEFERIDOS)(
    "%s segue SEM `modal` — ver CALENDARIOS_DEFERIDOS antes de ligar",
    (arquivo) => {
      const tags = tagsDePopover(readFileSync(join(RAIZ, arquivo), "utf8"));

      expect(tags.length).toBeGreaterThan(0);
      expect(tags.some((t) => /\bmodal\b/.test(t))).toBe(false);
    },
  );
});
