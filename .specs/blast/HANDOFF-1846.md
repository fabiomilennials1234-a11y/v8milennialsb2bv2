# HANDOFF — #1846 · O módulo único de números sai de `campaigns` e vai para `src/shared/`

Branch `fix/1846-move-disparo-numbers-para-shared`, cortada de
`feat/1722-disparo-canal-oficial` em `9541499b` e **descendente direta dela** (conferido:
`origin/feat/1722-disparo-canal-oficial` ainda é `9541499b`, logo o `merge --ff-only` é trivial).
Destrava o PR **#1811** (#1722).
Plano e medições: [`PLANO-1846.md`](./PLANO-1846.md) · Antecessores:
[`HANDOFF-1721.md`](./HANDOFF-1721.md) · [`HANDOFF-1722.md`](./HANDOFF-1722.md)
Decisões do CTO: `~/Dev/.maestri/briefs/1846-decisoes.md`

> **Estado: COMPLETO.** `Dep-cruise ratchet` **verde — 0 violações NOVAS**, de 9.
> Testes verdes sem asserção alterada, build limpo, zero erro de tipo ou de lint introduzido.
> Nada aplicado em produção — este ticket não toca banco, edge function nem migration.

---

## 1. Por que este trabalho existiu

O #1722 fez o Disparo funcionar no Canal Oficial, e para isso precisou que **as duas telas
oferecessem o mesmo conjunto de números**: o wizard (em `campaigns`) e o Disparo Rápido (em
`leads`). A causa do defeito original era exatamente cada tela decidir por conta própria
(ADR-0028 §6) — então o #1722 criou um módulo único, `disparo-numbers.ts`, e o publicou pelo
barrel de `campaigns` para `leads` alcançá-lo.

Publicar pelo barrel foi o que quebrou. `module-internals-private` obriga cross-module a
passar pela API pública, então `leads` passou a importar `campaigns/index.ts` — e essa aresta
fechou um ciclo que o `Dep-cruise ratchet` reprovou com **9 violações novas**. O PR #1811
estava verde em tudo menos nisso.

A decisão do CTO foi **não baselinar**. `lint:deps:baseline` apagaria o vermelho aceitando o
ciclo, e este repositório já paga caro por guardas afrouxadas em vez de obedecidas.

---

## 2. ⚠️ A #1846 descreve o problema errado — são DOIS ciclos, não um

**Quem for ler a issue depois precisa saber disto.** A #1846 afirma que as 9 violações são
*"o mesmo ciclo visto de vários arquivos"* e que o gatilho são as *"21 linhas"* do barrel.

Medido: o barrel era gatilho de **6**. As outras **3** são um segundo ciclo, com outro
gatilho, e não passam por `disparo-numbers` em ponto nenhum.

### Ciclo A — `campaigns ↔ communication` (o que a issue descreve) — 6 violações

```
wizard-machine → communication/index → … → pipelines/index → … →
BulkActionBar → QuickBlastDialog → campaigns/index → useBlastPlans → wizard-machine
```

Aresta nova: `QuickBlastDialog → campaigns/index`. Morreu com o move de `disparo-numbers`.

### Ciclo B — `campaigns ↔ pipelines` (que a issue não menciona) — 3 violações

```
pipelines/…/disparo/DisparoWizard.tsx → campaigns/index → campaigns/hooks/useBlastPlans
  → wizard-machine → audience-resolve → pipelines/index
  → pipelines/components/disparo/index → pipelines/…/disparo/DisparoWizard.tsx
```

Comparação aresta a aresta contra `origin/main` (`5cd1fc9f`):

| Aresta | Em `origin/main`? |
|---|---|
| `pipelines/…/DisparoWizard.tsx → campaigns/index` | sim (linhas 30 e 36) |
| `wizard-machine → audience-resolve` | sim (linha 21) |
| `audience-resolve → pipelines/index` | sim (linha 20) |
| `campaigns/index → useBlastPlans` | sim (linhas 150-162) |
| **`useBlastPlans → wizard-machine`** | **NÃO** — `useBlastPlans.ts:15`, um `import type { TemplateEscolhido }`, do #1722 |

**Descartada a hipótese de herança tipo #1778:** worktree limpa em `5cd1fc9f` roda
`node scripts/dep-cruise-ratchet.cjs` → `Dep-cruise ratchet OK`. E a baseline no meu tree é
**byte-idêntica** à de `origin/main` (`git diff HEAD origin/main -- .dependency-cruiser-baseline.json`
→ vazio) e não contém nenhuma das 3. O ciclo B é do #1722, não do repo.

O CTO aprovou fechar o ciclo B neste ticket: *"consertar o próprio trabalho não é expandir
escopo — é fechar o que se abriu"*.

---

## 3. As duas contagens obrigatórias

| Sinal | ANTES (`9541499b`) | Depois do move 1 | **FINAL** |
|---|---|---|---|
| `npm run lint:deps:check` — **o gate** | **9 NOVAS** | 3 NOVAS | **0 NOVAS ✅** |
| `npm run lint:deps` — contagem crua | **112** (7 err, 105 warn) | 106 (5 err, 101 warn) | **103 (4 err, 99 warn)** |
| módulos / dependências | 1847 / 7386 | 1847 / 7384 | 1848 / 7385 |

**Nenhum ciclo novo apareceu** — a troca que o brief mandava vigiar não aconteceu. Os
`errors` de ciclo caíram de 7 para 4; o módulo a mais e a dependência a mais são
`template-escolhido.ts` e a aresta `wizard-machine → template-escolhido`, ambas folha.

---

## 4. O que foi decidido, e por quê

### 4.1 Destino: `src/shared/disparo/` — subdiretório novo

`src/shared/` tinha `components/`, `errors.ts`, `format/`, `hooks/`, `permission-actions.ts`,
`realtime/`, `supabase/`. Nenhum servia: não é componente, hook, formatação, transporte
realtime nem acesso a Supabase. Criei um, como o brief autorizou.

- **Nomeia o concern, como os vizinhos.** Cada subpasta de `shared/` é um assunto, não uma
  camada genérica tipo `lib/` ou `utils/`. "Disparo" é o termo do produto e dos ADRs 0028/0029
  — a UI diz *Disparo* e *Disparo Rápido*, não *blast*.
- **Os três andam juntos.** `disparo-numbers` importa `speed-safety`; `template-escolhido` é o
  contrato do mesmo fluxo. Espalhá-los recriaria deep-import cruzado dentro de `shared/`.
- **Sem barrel, como o resto de `shared/`.** Medido: **nenhuma** subpasta de `src/shared/` tem
  `index.ts` — o import é sempre deep no arquivo. Criar barrel aqui seria inventar convenção
  nova no meio de um conserto.

### 4.2 Por que o move conserta, mecanicamente

`speed-safety` importa **nada**; `disparo-numbers` importa **só** `speed-safety`;
`template-escolhido` importa **nada**. Em `src/shared/` os três são **folha do grafo**, e folha
não participa de ciclo. É essa a razão — não é a pasta, é a ausência de aresta de saída.

Se alguém acrescentar um único `import` de módulo nesses arquivos, o problema volta. Há um
aviso em cada cabeçalho.

### 4.3 `TemplateEscolhido` sai do wizard, mas o wizard continua reexportando

`TemplateEscolhido` é o contrato entre duas pontas que não podem se importar: o wizard, que
escolhe o Template, e a fila, que o persiste em `blast_plans.template`. Virou
`src/shared/disparo/template-escolhido.ts`; `wizard-machine` faz
`export type { TemplateEscolhido } from "@/shared/disparo/template-escolhido"`, então
**nenhum passo do wizard mudou de import** — só `useBlastPlans.ts:15`.

### 4.4 Prova antes de pedir

Antes de perguntar ao CTO se podia mexer no `TemplateEscolhido`, troquei o `import type` por
uma declaração local equivalente e rodei o ratchet: `OK`, 0 NOVAS. Revertido em seguida. O
ensaio é que decidiu, não opinião — e o CTO pediu para continuar assim.

---

## 5. Tensão registrada, não resolvida

`src/modules/CLAUDE.md` descreve `src/shared/` como *"utils puros sem dependência de domínio"*,
e `disparo-numbers` **carrega domínio**: as allowlists `CHIP_PROVIDERS`/`OFICIAL_PROVIDERS` e a
regra de regime do ADR-0028.

Não tratei como premissa quebrada, por dois motivos medidos:

1. A decisão está explícita na #1846 e no brief. Escopo não é do operário.
2. **A regra escrita já não descreve a árvore.** `src/shared/components/CreateNewModal.tsx:7`
   importa `@/modules/pipelines`; `src/shared/hooks/useDataExport.ts:3` importa
   `@/modules/identity`; `src/shared/components/CurrencyInput.tsx:6` faz deep-import em
   `@/modules/analytics`. `shared/` já hospeda coisa com domínio — e o que entrou aqui é
   **mais puro** que esses, não menos: zero imports.

**Fica como issue para quem decidir:** ou `src/modules/CLAUDE.md` passa a descrever o que
`src/shared/` realmente é, ou alguém decide o que fazer com os 10 imports `shared → module` que
já existem. As duas coisas são maiores que este ticket.

---

## 6. O diff

**Movidos (`git mv`, histórico preservado):**

```
src/modules/campaigns/lib/disparo-numbers.ts                    → src/shared/disparo/disparo-numbers.ts
src/modules/campaigns/components/disparo-wizard/speed-safety.ts → src/shared/disparo/speed-safety.ts
```

**Criado:** `src/shared/disparo/template-escolhido.ts` (a `interface` saiu de `wizard-machine.ts:75-82`).

**Removido:** o bloco de 21 linhas em `src/modules/campaigns/index.ts` (linhas 175-195) que
publicava os 9 símbolos de `disparo-numbers`.

**Imports reescritos (11 linhas, 9 arquivos):** `disparo-numbers.ts`, `DisparoWizard.tsx`
(o de `campaigns`), `StepSpeed.tsx`, `wizard-machine.ts` (4 linhas), `QuickBlastDialog.tsx`,
`useBlastPlans.ts`, e 4 arquivos em `tests/unit/`.

**Comentários com caminho velho, atualizados** (texto, não comportamento): `wizard-machine.ts:66`,
`tests/unit/regime-do-disparo-twin.test.ts:6`, `supabase/functions/_shared/decisao-do-disparo.ts:34`.

**Fora do diff, de propósito:** `pipelines/components/disparo/DisparoWizard.tsx` e
`leads/components/bulk-actions/BulkActionBar.tsx`. Aparecem nas violações porque o dep-cruise
reporta todo arquivo do ciclo, não só quem o criou. O terceiro seletor é a **#1781**.

---

## 7. Verificação

| Sinal | Resultado |
|---|---|
| `npm run lint:deps:check` | **`Dep-cruise ratchet OK`** — 0 NOVAS (de 9) |
| `npm run lint:deps` | 112 → **103** (7 → 4 errors) |
| `vitest` — 6 arquivos do move | **86/86 ✅**, mesma contagem de antes, **zero asserção alterada** |
| `vitest` — 20 arquivos que tocam blast/template | **343/343 ✅** |
| `npm run typecheck:ratchet` | **80 introduzidos antes, 80 depois** — medido em worktree limpa no `9541499b`. Herança da #1778; zero arquivo do diff na lista |
| `npm run lint:ratchet` | 14 introduzidos, **os 14 em `.agent/skills/**`** — diretório não rastreado neste clone (`git ls-files .agent` → vazio). Zero em `src/` |
| `npx eslint` nos arquivos do diff | **0 errors** — `boundaries/element-types` e `boundaries/no-private` limpos na posição nova |
| `npm run build` | **verde** |

Guardas do brief, todas respeitadas: **não** rodei `lint:deps:baseline`, **não** regenerei
`.eslint-baseline.json`, **não** toquei nos 80 erros de tipo herdados, **não** encostei nos dois
arquivos proibidos. Nenhum dos dois arquivos de baseline aparece no diff.

---

## 8. O que ficou de fora

- **#1781 — o terceiro seletor.** `pipelines/components/disparo/DisparoWizard.tsx` reimplementa
  a escolha de instância. Está no ciclo, mas o ticket é outro.
- **A tensão do §5** — `src/shared/` documentado como sem domínio vs. o que a árvore faz.
- **Os 10 imports `shared → module` existentes.** `boundaries/element-types` declara
  `{ from: "shared", allow: ["shared", "core"] }`, mas com `default: "allow"` e nenhuma entrada
  `disallow` a regra é **inerte** — nada reprova. *HERDADO — `eslint.config.js:101-109` — a
  regra de boundaries não morde; a intenção declarada não é a vigente.* Vira issue; não é desta
  branch e não a bloqueia.
- **`isConnectedInstance`** é exportado por `disparo-numbers` e nenhum consumidor de produção o
  usa — só `tests/unit/disparo-numbers.test.ts`. Deixei como estava: apagar seria mudança de
  superfície pública, e o brief proíbe.
- **`docs/adr/0028-…md:39` aponta `disparo-wizard/instances-to-numbers.ts:31`**, arquivo que o
  #1722 apagou. O `/code-review` sugeriu corrigir; **rejeitado de propósito**: a frase descreve
  o estado *anterior* ao #1722 ("Hoje ele é o único lugar onde dá para tentar"), e o CLAUDE.md
  raiz define `docs/adr/` como **imutável**. Corrigir o caminho reescreveria o registro do
  problema que o ADR existe para datar.

---

## 9. O que o `/code-review` apontou, e o que virou mudança

Dois eixos, ambos sem bloqueio.

| Achado | Eixo | Resolução |
|---|---|---|
| `src/shared/disparo/` não documentado em nenhum CLAUDE.md | Standards | **Corrigido** — `src/modules/CLAUDE.md` §Cross-cutting agora nomeia o diretório, o invariante (folha do grafo) e a tensão do §5 |
| `PLANO §8.3` dizia "interface de 6 campos"; são **5** | Spec | **Corrigido** no `PLANO-1846.md`. Erro só de documentação — o tipo é idêntico antes e depois |
| `PLANO §8.4/§9` estavam estáticos, escritos antes do segundo move | Spec | **Corrigido** — §9 agora registra as duas decisões do CTO e a contagem final 9 → 0 |
| A frase "utils puros sem dependência de domínio" está stale; a árvore a quebra em 5+ lugares | Standards | **Não corrigido, por escopo** — §5 e §8 desta nota. Reescrever a regra é decisão de arquitetura, não de operário |
| `campaigns/CLAUDE.md` não lista `lib/disparo-numbers.ts` nem os 9 símbolos na API pública | Standards | **Nada a fazer** — conferido: o doc **nunca** os listou (stale desde o #1722). Meu diff os **remove**, então o doc fica mais correto, não menos |
| `wizard-machine` virou Middle Man dos 3 tipos que reexporta | Standards (julgamento) | **Deliberado** — a condição do CTO era "nenhum consumidor alterado". O par `export type … from X` + `import type … from X` já era o padrão do arquivo antes do diff |
| Único arquivo fora da lista do brief: `_shared/decisao-do-disparo.ts` | Spec | **Uma linha de comentário**, o ponteiro do gêmeo Deno. Zero comportamento; manter o ponteiro certo era parte do move |

---

## 10. Para quem pegar depois

O `merge --ff-only` de `feat/1722-disparo-canal-oficial` para esta branch é trivial:
`origin/feat/1722-disparo-canal-oficial` continua em `9541499b`, que é a base desta. **Não
rebaseei em `origin/main`** — decisão do CTO em `1846-decisoes.md` §2, porque rebasear ali
reescreveria os 10 commits do #1722 e quebraria justamente esse fast-forward. A branch está 15
commits atrás de `origin/main`; o rebase na main é do CTO, depois do ff.
