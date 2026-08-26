# PLANO — #1846 · Ciclo de dependência: o módulo único de números fecha campaigns ↔ communication

Ticket: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1846 (pai: #1719)
Branch: `fix/1846-move-disparo-numbers-para-shared`, cortada de `feat/1722-disparo-canal-oficial` em `9541499b`
Destrava: PR #1811 (#1722) — verde em tudo menos no `Dep-cruise ratchet`
Antecessores: [`PLANO-1722.md`](./PLANO-1722.md) · [`HANDOFF-1722.md`](./HANDOFF-1722.md)

Escrito antes de qualquer pergunta ao CTO, como manda o ciclo. Tudo que está aqui foi
**medido nesta árvore**; onde é hipótese, está escrito que é.

---

## 1. O que este ticket é

Conserto cirúrgico, não feature. Mover dois arquivos puros de `campaigns` para `src/shared/`,
ajustar imports, e tirar do barrel de `campaigns` o bloco que fecha o ciclo. **Zero mudança de
comportamento.**

---

## 2. Estado medido

### 2.1 O gate reprovado

`npm run lint:deps:check` (o ratchet, que é o gate do CI) — **9 violações NOVAS vs baseline**:

```
[no-circular]         campaigns/components/disparo-wizard/wizard-machine.ts -> communication/index.ts
[no-circular]         leads/components/bulk-actions/BulkActionBar.tsx -> leads/components/bulk-actions/QuickBlastDialog.tsx
[no-circular]         pipelines/components/disparo/DisparoWizard.tsx -> campaigns/index.ts
[no-circular-dynamic] campaigns/components/disparo-wizard/wizard-machine.ts -> campaigns/components/disparo-wizard/audience-resolve.ts
[no-circular-dynamic] communication/hooks/useWhatsAppChat.ts -> campaigns/index.ts
[no-circular-dynamic] communication/index.ts -> communication/components/chat-meta/LinkLeadDialog.tsx
[no-circular-dynamic] communication/index.ts -> communication/components/chat-meta/MetaChatShell.tsx
[no-circular-dynamic] communication/index.ts -> communication/components/chat/LeadContactModal.tsx
[no-circular-dynamic] communication/index.ts -> communication/hooks/useWhatsAppChat.ts
```

`npm run lint:deps` (a contagem crua) — **ANTES: 112 violações (7 errors, 105 warnings)**,
1847 módulos, 7386 dependências.

### 2.2 O ciclo, e qual aresta é NOVA

```
wizard-machine → communication/index → … → pipelines/index → … →
BulkActionBar → QuickBlastDialog → campaigns/index → useBlastPlans → wizard-machine
```

Das arestas acima, **uma só nasceu nesta fatia**: `QuickBlastDialog → campaigns/index`.
As outras são antigas e estão medidas:

- `useWhatsAppChat → campaigns/index` nasceu em `88b93391` *"slice 9 — campaigns"*
  (`git log -S'@/modules/campaigns'`). É de 2026-05, não desta fatia.
- `wizard-machine → communication` (`import type { BlastMediaType }`) já existia antes de #1722.
- `pipelines/…/DisparoWizard.tsx` e `leads/…/BulkActionBar.tsx` estão **INTOCADOS** pelo diff.
  O dep-cruise reporta todo arquivo do ciclo, não só quem o criou. O terceiro seletor é a #1781.

As 9 violações são **o mesmo ciclo visto de 9 ângulos**. Cortar a aresta nova derruba as 9.

### 2.3 O gatilho: o bloco no barrel

`src/modules/campaigns/index.ts:176-195` (20 linhas + a em branco = as 21 do brief):

```ts
// Disparo — o módulo ÚNICO de números, com regime (#1722)
// Público por necessidade: o Disparo Rápido vive em `leads` e precisa OFERECER
// o mesmo conjunto que o wizard. Duas telas, uma decisão (ADR-0028 §6).
export { instancesToNumbers, isBlastableInstance, isConnectedInstance,
         regimeDaInstancia, rotuloDaInstancia, NEW_NUMBER_WINDOW_DAYS } from "./lib/disparo-numbers";
export type { InstanceLike, DisparoNumber, RegimeDeDisparo } from "./lib/disparo-numbers";
```

### 2.4 Os dois arquivos são puros

| Arquivo | Linhas | Imports externos |
|---|---|---|
| `campaigns/lib/disparo-numbers.ts` | 168 | **1**, e é `speed-safety` |
| `campaigns/components/disparo-wizard/speed-safety.ts` | 38 | **0** |

Nenhum React, nenhum Supabase, nenhum relógio (o `now` entra por parâmetro).
Move sem risco de arrastar dependência.

### 2.5 Consumidores — levantamento completo

Grep sobre `src/` e `tests/` por caminho **e** por cada um dos 12 símbolos exportados.
Nenhum import é **misto** (nenhum arquivo pega, no mesmo `import`, símbolo de
`disparo-numbers` e símbolo de outro arquivo do barrel) — logo cada linha é substituição
limpa, não split.

**`speed-safety`** (3 consumidores):

| Arquivo | Linha | Import hoje |
|---|---|---|
| `campaigns/…/StepSpeed.tsx` | 33 | `from "./speed-safety"` |
| `campaigns/…/wizard-machine.ts` | 23 | `from "./speed-safety"` |
| `campaigns/lib/disparo-numbers.ts` | 17 | `from "../components/disparo-wizard/speed-safety"` |
| `tests/unit/speed-safety.test.ts` | 18 | `from "@/modules/campaigns/components/disparo-wizard/speed-safety"` |
| `tests/unit/disparo-numbers.test.ts` | 25 | idem |

**`disparo-numbers`** (relativo, dentro de campaigns):

| Arquivo | Linha | Import hoje |
|---|---|---|
| `campaigns/…/DisparoWizard.tsx` | 30 | `from "../../lib/disparo-numbers"` |
| `campaigns/…/wizard-machine.ts` | 71 (re-export) e 72 (type) | `from "../../lib/disparo-numbers"` |

**`disparo-numbers` via barrel `@/modules/campaigns`** (a aresta do ciclo):

| Arquivo | Linha | Símbolos |
|---|---|---|
| `leads/…/QuickBlastDialog.tsx` | 22-28 | `instancesToNumbers, isBlastableInstance, regimeDaInstancia, rotuloDaInstancia, type InstanceLike` |
| `tests/unit/disparo-numbers.test.ts` | 14-21 | `instancesToNumbers, isConnectedInstance, isBlastableInstance, regimeDaInstancia, NEW_NUMBER_WINDOW_DAYS, type InstanceLike` |
| `tests/unit/notificame-instagram-isolation.test.ts` | 56-60 | `instancesToNumbers, isBlastableInstance, type InstanceLike` |
| `tests/unit/regime-do-disparo-twin.test.ts` | 18 | `regimeDaInstancia` |

`tests/unit/disparo-wizard.test.ts` e `tests/unit/quick-blast-daily-budget.test.ts` casam
no grep por **menção em comentário / tipo re-exportado por `wizard-machine`**, não por
import direto: não precisam de edição de import.

### 2.6 Testes — baseline verde ANTES do move

```
npx vitest run tests/unit/{disparo-numbers,disparo-wizard,notificame-instagram-isolation,
                           quick-blast-daily-budget,regime-do-disparo-twin,speed-safety}.test.ts
→ Test Files 6 passed (6) · Tests 86 passed (86)
```

Se qualquer um destes 86 mudar de resultado ou precisar de asserção nova, **paro** — não
era só um move (regra do brief).

---

## 3. A escolha do destino: `src/shared/disparo/`

`src/shared/` hoje tem `components/`, `errors.ts`, `format/`, `hooks/`,
`permission-actions.ts`, `realtime/`, `supabase/`. **Nenhum serve**: não é componente, não é
hook, não é formatação de string, não é transporte realtime, não é acesso a Supabase.
O brief autoriza criar um.

**Decisão: `src/shared/disparo/`**, com `disparo-numbers.ts` e `speed-safety.ts` lado a lado.

Por quê este nome e este recorte:

1. **Nomeia o concern, como os vizinhos.** `format/`, `realtime/`, `supabase/` — cada subpasta
   de `shared/` é um assunto, não uma camada técnica genérica tipo `lib/` ou `utils/`.
   `disparo/` segue a mesma regra, e "Disparo" é o termo do domínio no produto e nos ADRs
   0028/0029 (a UI diz *Disparo* e *Disparo Rápido*, não *blast*).
2. **Os dois andam juntos.** `disparo-numbers` importa `effectiveCap`/`CAP_RECOMMENDED` de
   `speed-safety` e é o único consumidor fora do wizard. Separá-los recriaria um deep-import
   cruzado dentro de `shared/`.
3. **Sem barrel, como o resto de `shared/`.** Medido: nenhuma subpasta de `src/shared/` tem
   `index.ts` — o import é sempre deep no arquivo (`@/shared/hooks/useDebounce`,
   `@/shared/format/phone`, `@/shared/components/UpgradeModal`). Vou seguir:
   `@/shared/disparo/disparo-numbers` e `@/shared/disparo/speed-safety`.
   Criar um barrel aqui seria inventar convenção nova no meio de um conserto.

### 3.1 Isto é legal no ESLint `boundaries`? Sim — conferido

`eslint.config.js:70` declara `{ type: "shared", pattern: "src/shared/**" }` e
`eslint.config.js:104` dá `{ from: "module", allow: ["ui", "shared", "core", "module"] }`.
Logo `campaigns` e `leads` podem importar `shared` **direto, sem barrel** — e é assim que
já fazem hoje (`QuickBlastDialog.tsx:20` importa `@/shared/components/UpgradeModal`).

`boundaries/no-private` é `error` com `allowUncles: false`, mas `shared` não é `mode: "folder"`,
então não há "privado" a violar — o padrão deep-import de `shared/` já é o vigente no repo.

### 3.2 Isto é legal no dep-cruiser? Sim, e é justamente o ponto

`eslint.config.js:106` — `{ from: "shared", allow: ["shared", "core"] }`. Os dois arquivos têm
**zero** imports de módulo, então `shared/disparo/` nasce numa folha do grafo: ninguém sai dele
para `modules/`. Uma folha não pode participar de ciclo. É esta a razão de o move consertar.

### 3.3 A tensão que registro, sem resolver por conta própria

`src/modules/CLAUDE.md` descreve `src/shared/` como *"utils puros sem dependência de domínio"*,
e `disparo-numbers` **carrega domínio**: as allowlists `CHIP_PROVIDERS`/`OFICIAL_PROVIDERS` e a
regra de regime do ADR-0028.

Registro a tensão, mas **não a trato como premissa quebrada**, por duas medições:

- A decisão do CTO está explícita na #1846 (*"Mover os dois para `src/shared/`. Eles são
  cross-cutting por natureza"*) e no brief. Escopo não é meu.
- A regra escrita **já não descreve a árvore**: `src/shared/components/CreateNewModal.tsx:7`
  importa `@/modules/pipelines`, `src/shared/hooks/useDataExport.ts:3` importa
  `@/modules/identity`, `src/shared/components/CurrencyInput.tsx:6` faz deep-import em
  `@/modules/analytics`. `shared/` na prática já hospeda coisa com domínio — e o que eu ponho
  lá é **mais puro** que esses, não menos.

Vai para o HANDOFF como observação, não como bloqueio.

---

## 4. O diff, arquivo por arquivo

**Move (com `git mv`, para o histórico seguir):**

```
src/modules/campaigns/lib/disparo-numbers.ts                    → src/shared/disparo/disparo-numbers.ts
src/modules/campaigns/components/disparo-wizard/speed-safety.ts → src/shared/disparo/speed-safety.ts
```

**Edições de import (10 linhas, 8 arquivos):**

| # | Arquivo | De | Para |
|---|---|---|---|
| 1 | `shared/disparo/disparo-numbers.ts:17` | `"../components/disparo-wizard/speed-safety"` | `"./speed-safety"` |
| 2 | `campaigns/index.ts:176-195` | bloco de re-export | **removido** |
| 3 | `campaigns/…/DisparoWizard.tsx:30` | `"../../lib/disparo-numbers"` | `"@/shared/disparo/disparo-numbers"` |
| 4 | `campaigns/…/StepSpeed.tsx:33` | `"./speed-safety"` | `"@/shared/disparo/speed-safety"` |
| 5 | `campaigns/…/wizard-machine.ts:23` | `"./speed-safety"` | `"@/shared/disparo/speed-safety"` |
| 6 | `campaigns/…/wizard-machine.ts:71,72` | `"../../lib/disparo-numbers"` | `"@/shared/disparo/disparo-numbers"` |
| 7 | `leads/…/QuickBlastDialog.tsx:28` | `"@/modules/campaigns"` | `"@/shared/disparo/disparo-numbers"` |
| 8 | `tests/unit/disparo-numbers.test.ts:21,25` | barrel + deep campaigns | `@/shared/disparo/…` |
| 9 | `tests/unit/notificame-instagram-isolation.test.ts:60` | `"@/modules/campaigns"` | `"@/shared/disparo/disparo-numbers"` |
| 10 | `tests/unit/regime-do-disparo-twin.test.ts:18` | `"@/modules/campaigns"` | `"@/shared/disparo/disparo-numbers"` |

**Comentários com caminho antigo** (`wizard-machine.ts:67`, `regime-do-disparo-twin.test.ts:6`,
cabeçalho de `disparo-numbers.ts`) são atualizados — texto, não comportamento.

**Fora do diff, de propósito:** `pipelines/components/disparo/DisparoWizard.tsx` e
`leads/…/BulkActionBar.tsx`. Aparecem nas violações, estão intocados, e o terceiro seletor
é a #1781.

---

## 5. Verificação — o que decide se passou

| Sinal | Antes (medido) | Critério depois |
|---|---|---|
| `npm run lint:deps` | 112 (7 err, 105 warn) | **registrar o número**; erros ≤ 7 e sem ciclo novo |
| `npm run lint:deps:check` | **9 NOVAS** | **0 NOVAS** ← este é o gate |
| `vitest` nos 6 arquivos | 6 files / 86 tests ✅ | 6 files / **86** tests ✅, **sem asserção alterada** |
| `npm run typecheck:ratchet` | 76 erros herdados (#1778) | não aumentar |
| `npm run lint:ratchet` | baseline de `origin/main` | não aumentar |
| `npm run build` | verde | verde |

Guardas do brief que eu **não** vou cruzar: não rodar `lint:deps:baseline`, não regenerar
`.eslint-baseline.json` local, não tentar consertar os 76 erros de tipo herdados.

---

## 6. A única pergunta que eu tenho — e por que ela existe

O brief diz as duas coisas:

> *"rebaseie em `origin/main` ANTES do push final"*
> *"Sua branch é descendente direta da do #1722, então o meu fast-forward dela é trivial.
>  Não rebaseie na main de forma que quebre isso sem me dizer."*

Medido: `HEAD = 9541499b`, **15 atrás** de `origin/main` (`5cd1fc9f`), **10 à frente** do
merge-base `84c1c3e6`. Os 10 commits à frente **são os do #1722** — o PR #1811.

Rebasear em `origin/main` reescreve esses 10 commits. Depois disso `feat/1722` deixa de ser
ancestral desta branch, e o `merge --ff-only` de `feat/1722` para cá **falha**. As duas
instruções não podem valer ao mesmo tempo.

Faço o trabalho todo primeiro e pergunto na hora do push (§7, passo 5). Não bloqueia nada
antes disso.

---

## 7. Ordem de execução

1. ✅ Medir `lint:deps` + `lint:deps:check` + testes **antes** (§2).
2. Escrever este plano. ✅
3. `git mv` dos dois arquivos; criar `src/shared/disparo/`.
4. Ajustar as 10 linhas de import + os comentários de caminho.
5. Remover o bloco de `campaigns/index.ts`.
6. Rodar a bateria do §5 e **registrar o depois**.
7. `/code-review`.
8. **Perguntar ao CTO** a questão do §6, em texto, uma por mensagem.
9. Push conforme a resposta.
10. `HANDOFF-1846.md` com as duas contagens.
11. Fechar a #1846 com comentário de resolução.

---

## 8. MEDIÇÃO DEPOIS — e a premissa que não sobreviveu

Executado. O move está feito e verde. Mas a contagem revela que a #1846 descreve **um**
ciclo e existem **dois**.

### 8.1 As duas contagens obrigatórias

| Sinal | ANTES | DEPOIS |
|---|---|---|
| `npm run lint:deps` | **112** violações (7 errors, 105 warnings) · 1847 módulos · 7386 deps | **106** violações (**5** errors, 101 warnings) · 1847 módulos · **7384** deps |
| `npm run lint:deps:check` (o gate) | **9 NOVAS** | **3 NOVAS** |

O move derrubou **6 das 9**, e **2 arestas** saíram do grafo (7386 → 7384): as duas que
`campaigns/index.ts` tinha para `lib/disparo-numbers`. Nenhum ciclo novo apareceu — a troca
que o brief mandava vigiar não aconteceu.

### 8.2 As 3 que sobraram são OUTRO ciclo

```
[no-circular]         pipelines/…/disparo/DisparoWizard.tsx -> campaigns/index.ts
[no-circular-dynamic] campaigns/…/wizard-machine.ts -> campaigns/…/audience-resolve.ts
[no-circular-dynamic] communication/hooks/useWhatsAppChat.ts -> campaigns/index.ts
```

Caminho completo, do `lint:deps`:

```
pipelines/…/disparo/DisparoWizard.tsx → campaigns/index.ts → campaigns/hooks/useBlastPlans.ts
  → campaigns/…/wizard-machine.ts → campaigns/…/audience-resolve.ts → pipelines/index.ts
  → pipelines/components/disparo/index.ts → pipelines/…/disparo/DisparoWizard.tsx
```

Não é `campaigns ↔ communication` (o da issue). É **`campaigns ↔ pipelines`**, e não passa
por `disparo-numbers` em nenhum ponto. A #1846 diz que as 9 são *"o mesmo ciclo visto de
vários arquivos"* e que o gatilho são as *"21 linhas"* do barrel — medido, isso vale para 6.

### 8.3 Qual aresta o fecha, e por que ela é do #1722

Comparação aresta a aresta contra `origin/main` (`5cd1fc9f`):

| Aresta | Existe em `origin/main`? |
|---|---|
| `pipelines/…/DisparoWizard.tsx → campaigns/index` | **sim** (linhas 30 e 36) |
| `wizard-machine → audience-resolve` | **sim** (linha 21) |
| `audience-resolve → pipelines/index` | **sim** (linha 20) |
| `campaigns/index → useBlastPlans` | **sim** (linhas 150-162) |
| **`useBlastPlans → wizard-machine`** | **NÃO** |

`src/modules/campaigns/hooks/useBlastPlans.ts:15`

```ts
import type { TemplateEscolhido } from "@/modules/campaigns/components/disparo-wizard/wizard-machine";
```

Esta linha é do #1722. É a única aresta nova, e é ela que fecha o laço.

**Prova de que `origin/main` está verde** (não é dívida herdada tipo #1778): worktree limpa em
`5cd1fc9f`, `node scripts/dep-cruise-ratchet.cjs` → `Dep-cruise ratchet OK. Baseline pending:
103 violations.` A baseline no meu tree é **byte-idêntica** à de `origin/main`
(`git diff HEAD origin/main -- .dependency-cruiser-baseline.json` → vazio) e **não** contém
nenhuma das 3.

**Ensaio de que essa aresta é suficiente:** troquei o `import type` por uma declaração local
equivalente de `TemplateEscolhido`, rodei o ratchet → `Dep-cruise ratchet OK` (**0 NOVAS**).
Revertido em seguida; o diff desta branch **não** contém essa mudança.

`TemplateEscolhido` é uma `interface` de 6 campos (`wizard-machine.ts:75-82`), sem
dependência nenhuma, com **2 consumidores**: `wizard-machine.ts:113` e `useBlastPlans.ts:79`.

### 8.4 Por que eu parei aqui

O brief enumera **dois** arquivos a mover e diz *"NÃO encoste em
`pipelines/components/disparo/DisparoWizard.tsx`"*. Mover um terceiro símbolo é escopo novo,
e escopo não é meu. Está perguntado ao CTO (§9).

### 8.5 O resto da bateria — verde

| Sinal | Resultado |
|---|---|
| `vitest` nos 6 arquivos | **6 files / 86 tests ✅** — mesma contagem de antes, **zero asserção alterada** |
| `npm run typecheck:ratchet` | **80 introduzidos antes, 80 depois.** Medido em worktree limpa no `9541499b`. Herança da #1778; **zero** arquivo do meu diff na lista |
| `npm run lint:ratchet` | 14 introduzidos — **os 14 em `.agent/skills/**`**, diretório **não rastreado** neste clone (`git ls-files .agent` → vazio). Zero em `src/` |
| `npx eslint` nos arquivos do diff | **0 errors** — `boundaries/element-types` e `boundaries/no-private` limpos na posição nova |
| `npm run build` | **verde** (exit 0, 246 entries no precache) |

Guardas do brief respeitadas: **não** rodei `lint:deps:baseline`, **não** regenerei
`.eslint-baseline.json`, **não** toquei nos 80 erros de tipo herdados, **não** encostei em
`pipelines/…/DisparoWizard.tsx` nem em `leads/…/BulkActionBar.tsx`.

---

## 9. As duas perguntas em aberto para o CTO

1. **§8** — as 3 que sobraram são outro ciclo, fechado por `useBlastPlans.ts:15`. Movo
   `TemplateEscolhido` para `src/shared/disparo/` (mesmo remédio, zero comportamento,
   ratchet a 0) ou paro em 9→3 e abro issue separada?
2. **§6** — rebase em `origin/main` vs. manter o `--ff-only` de `feat/1722` possível.
   As duas instruções do brief não podem valer ao mesmo tempo.
