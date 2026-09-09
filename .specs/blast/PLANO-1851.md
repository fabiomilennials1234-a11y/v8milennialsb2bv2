# PLANO-1851 — o tipo do cliente admin não descreve o código

> Ticket: [#1851](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1851) · pai #1719 · desbloqueia PR #1811
> Branch: `fix/1851-tipo-do-cliente-admin`, cortada de `feat/1722-disparo-canal-oficial` em `260b7a20`.
> Arquivo único: `supabase/functions/_shared/blast-official-runner.ts`

## 1. O critério, e ele é literal

```bash
cd supabase/functions && deno check _shared/     # === npm run typecheck:edge-shared
```

Nada mais responde a esta pergunta. `typecheck:ratchet` roda `tsc -p tsconfig.app.json`, e esse
tsconfig **inclui só `src/`** — `supabase/functions/` nunca passou por ele. Foi assim que os quatro
erros ficaram mudos desde o #1722. Medido nesta branch, antes de qualquer edição minha:
**80 introduzidos / 15 herdados**, todos em `src/**`, zero em `supabase/functions/**`. Portanto o
ratchet do tsc é *estruturalmente incapaz* de subir ou descer por causa deste conserto; ele é
controle de não-regressão, não evidência de conserto.

## 2. Reprodução (feita, antes de editar)

`deno 2.7.7` local, mesmo comando do CI (`.github/workflows/test.yml:88`). Os 4 erros saem. As
linhas do brief estão trocadas em relação à saída real — registro a saída real:

| Linha real | Código | O quê |
|---|---|---|
| `:157:63` | TS2339 | `error.message` — o `error` do `.rpc()` é `unknown`, estreitado para `{}` |
| `:295:39` | TS2345 | `porInstancia.get(p.instance_id)` — `string \| null` num `Map<string, …>` |
| `:298:34` | TS2322 | `p.template ?? null` — `{} \| null` não é `TemplateDoPlano \| null` |
| `:344:6`  | TS2339 | `.update(patch)` não existe no recorte |

O brief atribui `:157` ao `.update` e `:344` ao `error.message`; é o inverso. A causa-raiz continua
a mesma e a lista de erros é idêntica, então o plano não muda — mas o handoff registra a saída, não
a paráfrase.

## 3. Causa-raiz

`ClienteAdminDoWorker` (linhas 70-77) descreve **três** chamadas. O worker faz **cinco**:

| O worker chama | O recorte descreve |
|---|---|
| `.from().select().in()` | ✅ |
| `.rpc()` | ✅, mas com `error: unknown` |
| `.from().update().eq()` | ❌ — a causa |
| lê `error.message` (2×) | ❌ — `unknown` não tem `.message` |

Os quatro erros são **dois** defeitos de tipo (`update`/`eq` ausentes; `error` opaco) mais **dois**
de linha (`template` opaco; `instance_id` anulável não guardado). Nenhum é defeito de runtime — o
código está certo; o tipo é que mente sobre ele.

## 4. O desenho — seguir `gestor-auth.ts`, não inventar

`_shared/gestor-auth.ts:19-43` já resolveu este problema exato e é o único recorte do repo com
encadeamento nomeado e `error` tipado. O molde:

- um resultado terminal compartilhado, com `error: { message: string } | null`;
- um **filtro que `extends PromiseLike<Resultado>`** e cujos métodos devolvem ele mesmo — é o que
  faz `.update(patch).eq("id", id)` ser encadeável *e* aguardável ao mesmo tempo;
- `from(tabela)` devolvendo `{ select(...): Filtro; update(...): Filtro }`.

Alternativas descartadas, com motivo:

- **`any`** — proibido pelo ticket, e é o que escondeu os 4 erros. Reprovaria o lint:ratchet.
- **`SupabaseClient` real** — `whatsapp-media.ts:14-19` e `auth.ts:202-205` documentam que instanciar
  os genéricos nos defaults do supabase-js 2.10x diverge, e `org-status.ts:30-46` mede que o probe
  em `tsc` não reproduz o que o `deno check`/esm.sh vê. Trocaria 4 erros por um risco não medido.
- **`GovernorSupabaseClient`** (`send-governor/types.ts:160-165`) — é `any` com `eslint-disable`.

## 5. As quatro edições

1. **`ErroDaConsulta` + `ResultadoDaConsulta` + `FiltroDoWorker`** novos, e `ClienteAdminDoWorker`
   ganhando `update()` e `eq()`. Mata `:157` e `:344`.
2. **`LinhaDePlano.template`: `unknown` → `TemplateDoPlano | null`.** Mata `:298`. `post_send_target`
   **fica `unknown`** — a assimetria é de propósito e o próprio arquivo já a documenta (linha 260):
   o template é lido e repassado ao transporte por este módulo, o alvo pós-envio é opaco aqui e só o
   movedor o entende. Declarar a forma que o worker de fato consome é o que `LinhaDoDisparo` já faz
   para o retorno do RPC.
3. **Guarda de nulo no `instance_id`.** Mata `:295`.
   `const instance = p.instance_id ? porInstancia.get(p.instance_id) : undefined;`
   Runtime idêntico: o `Map` é chaveado por `whatsapp_instances.id` (PK, nunca nula), então
   `get(null)` já devolvia `undefined` e caía no `if (!instance) continue` da linha seguinte.
4. **Comentário** dizendo por que o recorte tem esta forma e apontando o precedente — para o próximo
   que precisar de um método novo estender em vez de voltar para `any`.

Zero mudança de comportamento. Nenhuma linha executável muda de efeito.

## 6. O que este conserto NÃO faz

- **Não conserta o TS2589 de `process-blast-recipients/index.ts:84:29`** (`Type instantiation is
  excessively deep and possibly infinite`, no ponto em que o cliente real é atribuído ao recorte).
  **HERDADO**, medido antes de eu editar: aquele arquivo já tem 5 erros (os 4 do runner, por grafo,
  + este). Está **fora do portão** — o CI checa `_shared/` e só (`test.yml:83-87` explica por quê).
  `gestor-auth.ts:44-58` documenta a cura (devolver `unknown` de `from()` e estreitar num único
  helper), mas isso é refactor de outro arquivo e de outro ticket. **Medirei antes/depois e reporto
  o número; se meu diff piorar aquela contagem, paro e aviso.**
- **Não regenera `.eslint-baseline.json`** — proibido pelo brief; o `node_modules` deste clone não
  bate com o do CI.
- **Não encosta** em `src/shared/disparo/` (#1846) nem em `DisparoWizard.tsx` (#1781).
- **Não altera asserção de teste.** `tests/unit/blast-official-runner.test.ts` passa o dublê com
  `as never` em dois níveis (`makeAdmin` linha 122 e cada chamada), então a conferência estrutural
  está desligada: ampliar a interface não pode quebrá-lo — e também não é verificado por ele. Isso é
  uma observação para o handoff, não um conserto a fazer aqui.

## 7. Verificação (a ordem importa)

| # | Comando | Critério |
|---|---|---|
| 1 | `cd supabase/functions && deno check _shared/` | **0 erros. Saída colada no handoff.** É O ACEITE. |
| 2 | `deno check process-blast-recipients/index.ts` | ≤ 5 erros (o TS2589 herdado). Não piorar. |
| 3 | `npx vitest run tests/unit/blast-official-runner.test.ts` | verde, sem asserção tocada |
| 4 | `npm run lint:ratchet` | 0 introduzidos, sem regenerar baseline |
| 5 | `npm run typecheck:ratchet` | delta zero vs. 80/15 medidos no §1 |
| 6 | `/code-review` | — |

## 8. A lição, que é o ponto do ticket

O #1722 verificou com `lint` + `typecheck:ratchet` + vitest e concluiu que estava certo. Os três
estavam verdes e os três eram cegos para `supabase/functions/`. **Ferramenta à mão não é ferramenta
que vale.** O portão que reprova nomeia o comando que o satisfaz — rode aquele.
