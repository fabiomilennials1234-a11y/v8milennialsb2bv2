# Decisão de arquitetura — #1207 (casca da TV): célula legada + semeadura

> Arquiteto (Cais) · 2026-07-24 · addendum ao macro `macro-composable-metrics-layer2-engine.md` · ADR-0023
> Responde às 2 perguntas do Forja antes da implementação da casca.

Estado verificado em prod (não presumido): `dashboard_widgets` tem `measure_kind CHECK IN ('leaf','ratio')`, `recorte_id`/`format_id` **NOT NULL**, e `kind_coherence` com **`ELSE false`** — ou seja, qualquer kind novo já é rejeitado hoje. Diagnóstico do Forja **confirmado**: célula reservada é impossível de gravar.

---

## Decisão 1 — Célula legada reservada: **APROVADA**, com 1 correção de mecanismo

A forma proposta (a)–(f) está certa. **Uma mudança obrigatória:**

### `renderer_id` vai por FK a tabela de catálogo, NÃO por allowlist no trigger

Criar `metric_catalog_renderers(id text PK, label text, ...)` — read-only, deny-all de escrita, semeada por migration com exatamente `legacy:closer-performance` e `legacy:thermometer`. `dashboard_widgets.renderer_id` faz **FK** para ela.

**Por quê:** o mecanismo de fronteira do #1194 é *FK para catálogo read-only* (decisão A do macro). Allowlist hardcoded dentro de trigger seria um **segundo mecanismo, mais fraco, para o mesmo trabalho** — duas fontes do mesmo conjunto fechado, que divergem no primeiro renderer novo. FK dá a mesma garantia de forma **declarativa**, mantém o vocabulário fechado vivendo só em migration (ADR §2), e deixa o conjunto visível para `fn_metric_catalog()` — de que o Composer vai precisar depois, para **não** oferecer renderer legado como composível.

### Invariantes que a migration precisa preservar

Ao tornar `recorte_id`/`format_id` NULLABLE, o `kind_coherence` passa a ser o **único** guardião deles. Então ele tem que carregar isso explicitamente:

```
leaf   → measure_id NOT NULL, num/den NULL,  recorte_id NOT NULL, format_id NOT NULL, renderer_id NULL
ratio  → measure_id NULL, num/den NOT NULL,  recorte_id NOT NULL, format_id NOT NULL, renderer_id NULL
legacy → measure_id/num/den/recorte_id/format_id TODOS NULL,      renderer_id NOT NULL
ELSE   → false        (mantém: kind desconhecido continua rejeitado)
```

`renderer_id NULL` em leaf/ratio é simetria necessária — sem isso um leaf poderia carregar renderer e o snapshot ficaria ambíguo sobre qual caminho seguir.

### Snapshot

`fn_dashboard_snapshot` emite a célula legada com `position`/`weight`/`pinned`/`eyebrow_override`/`renderer_id` e `value: null`, **sem chamar `fn_metric_measure`**. Isolamento de erro por widget continua valendo.

### Nota para o Crivo (não é brecha)

`renderer_id` é **ID de catálogo fechado**, igual a `measure_id`/`recorte_id`/`format_id`. A fronteira do ADR — *"a composição só referencia identificadores do catálogo; nunca SQL, nome de tabela, nome de coluna nem `organization_id`"* — fica **preservada, não enfraquecida**. O invariante **ZERO EXECUTE** é intocado: `renderer_id` nunca entra em SQL, é resolvido no frontend para um componente legado.

Área frágil (fronteira de composição) → **rubric de segurança bloqueante**. Rollback pareado obrigatório.

### Alternativa descartada, ratificada

"Legado fora do grid" — descartada. §8.4.3 está certa: geraria dois sistemas de posicionamento na parede e o Comando herdaria a bagunça.

---

## Decisão 2 — CORRIGIDA em 2026-07-24: era **(A)**, virou **(B)** por premissa falsa

> ⚠️ **A decisão original abaixo estava errada e fica registrada para rastreabilidade.**
> Ela assumia `org_onboarding.answers` — **essa tabela não existe**. Verificado por 3 vias
> independentes (Forja) e reconferido por mim contra prod:
> tabelas `%onboarding%` = `onboarding_pipeline_templates`, `onboarding_automation_templates`,
> `org_onboarding_progress` (só checklist de passos); **nenhuma coluna `answers` em todo o schema**;
> `useOnboarding.ts:48` consulta `.from("org_onboarding")` → erro → `undefined` →
> `generateTVConfig` linha 71 `if (!answers) return DEFAULT_CONFIG`.
>
> **Consequência: a derivação do quiz NUNCA rodou em prod.** Toda org recebe hoje `DEFAULT_CONFIG`.
>
> **Portanto (B) é a correta — não por preferência, mas por falta de insumo.** Semear a composição
> padrão *é* literalmente "semear da derivação atual", porque é o que a derivação atual produz para
> todas as orgs. Implementar os 4 sinais teria criado comportamento que a TV de hoje **não tem**,
> sem fonte de dado — feature nova disfarçada de paridade. A chamada do Forja está certa.
>
> **Efeito colateral bom:** o meu receio de "duplicação temporária durante o rollout" **evapora**.
> Não há duplicação alguma — o ramo de derivação do TS nunca executa. O seed em SQL é a única
> derivação que jamais rodou. `fn_seed_default_dashboard` segue como o ponto único onde a variação
> entra **se** aparecer fonte de respostas.
>
> **Gatilho também corrigido:** "conclusão do onboarding" não tem onde pendurar. O flip da flag
> `organizations.composable_metrics_enabled` false→true é o instante em que a TV montável passa a
> existir para a org — **ratificado**. Backfill por migration mantido. Nunca lazy-on-read.
>
> **Duas guardas obrigatórias no gatilho:**
> 1. **Seed é "criar se ausente", nunca "resetar".** Um re-flip (ON→OFF→ON) não pode sobrescrever a
>    composição que o cliente já editou. Idempotência aqui significa *não clobber*, não *reescrever igual*.
> 2. **Trigger estreito:** condicionar a `OLD.composable_metrics_enabled IS DISTINCT FROM NEW... AND NEW = true`,
>    para não disparar escrita de widgets em todo `UPDATE` de `organizations` (tabela quente).

### (registro histórico — decisão original, superada)

**(A)**, com reenquadramento

**Não é duplicação permanente — é relocação.** Verificado: `tv-config-from-quiz.ts` tem **um único consumidor de runtime**, `src/modules/analytics/pages/TVDashboard.tsx` (a TV legada), mais o barrel de `platform`. Quando a TV montável assume, a derivação TS vira **código morto**.

Portanto:
- `fn_seed_default_dashboard(p_org_id)` em SQL passa a ser a **fonte única** da derivação daqui pra frente. `SECURITY DEFINER`, `assert_org_access` 1ª instrução, **idempotente**.
- `tv-config-from-quiz.ts` recebe `@deprecated` apontando para a função SQL, e sua **remoção é fatia agendada** (quando a flag estiver ON em todas as orgs).
- Durante o rollout as duas coexistem (org com flag OFF ainda usa o TS). Duplicação **temporária, limitada a 4 booleanos**, com prazo de morte. Aceita.

**(C) rejeitada — ratifico o teu motivo.** Escrita disparada por leitura da TV, e composição autorada pelo cliente: fere o mandamento de segurança do ADR. Não fazer.

**(B) rejeitada.** A issue pede a derivação, o custo de (A) é pequeno, e o painel estático teria que ser refeito depois de qualquer jeito.

### Gatilho da semeadura (a AC "ninguém acorda com tela vazia")

Semear **não** pode ser lazy-on-read (é o vício de (C) por outra porta). Dois pontos:
1. Na **conclusão do onboarding** da org.
2. **Backfill por migration** para as orgs que já existem.

---

## Decisão 3 — "semeado da derivação" = mesma **decisão de composição**, não os mesmos 6 KPIs

**Confirmado.** Com uma correção ao teu levantamento:

| KPI legado | Mapeia? | Como |
|---|---|---|
| Reuniões | ✅ | `reunioes_realizadas` / `reunioes_marcadas` |
| Conversão | ✅ | razão `num_vendas / leads_criados` |
| Leads p/ Trabalhar | ✅ | `leads_na_etapa` |
| Leads Novos | ✅ | `leads_criados` |
| **Respostas / "Leads Abordados"** | ✅ **corrige teu levantamento** | o próprio comentário do arquivo (linhas 49–51) diz que **mede o stage `abordado` do kanban, não respostas reais**. Logo é `leads_na_etapa` com recorte `etapa` no estágio abordado — **expressível** |
| No-Show | ❌ | exige `(marcadas − realizadas) / marcadas`; a razão do catálogo é prof-1 com 2 filhos, não faz `a−b`. Só existe como comparecimento (`realizadas/marcadas`) |
| Propostas Enviadas | ❌ | é **fluxo de entrada em etapa**; o catálogo só tem `leads_na_etapa`, que é **estado**. Mapear seria trocar a âncora |
| Ticket MRR vs Projeto | ❌ (parcial) | ticket = `receita/num_vendas` existe, mas o corte recorrência-vs-projeto não: `stream` é novo_negocio/carteira, não MRR/projeto |

**Regra:** mapear fielmente o que mapeia; **descartar** o que não mapeia em vez de mis-mapear. Conflar estado com fluxo é exatamente o defeito que a spec da TV aponta como *"leitura errada acontecendo em produção agora"* (§4.2). Não inventar medida.

Ampliar o catálogo (ex.: `entradas_na_etapa`, medida de no-show, recorte recorrência/projeto) é **decisão separada do CTO** — o catálogo é gargalo **por desenho** (ADR §Consequências).

Flag OFF mantém a TV de hoje intacta → **sem regressão**. O painel semeado reproduz a *decisão de composição* (quais sinais → quais widgets), não a lista literal de KPIs.
