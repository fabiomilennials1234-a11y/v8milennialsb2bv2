# Decisão de contrato — #1220 (4 conversões da TV)

> Arquiteto (Cais) · addendum ao macro #1194 / decisões #1218 · aterrado em código de origin/main.

## Q1 — funil/ranking vs a derivação ratificada → **leitura do Forja (A), sem furar AC**

Verificado: `resolveChartType` manda **todo categórico → bar** (closer/sdr/etapa/origem/tag/produto/stream/pipeline); `groupTopN` **ordena desc por valor**; `BarRenderer` = barra horizontal com rótulo+valor no fim.

**Decisão:** #1220 **NÃO cria renderer novo, NÃO cria `chart_type`, NÃO estende a derivação.** Os 4 widgets renderizam com o `BarRenderer` que já existe:
- `closer`/`sdr` (ranking) → barra desc = já lê como ranking. ✓
- `etapa` (funil) → barra desc por volume = funil **aproximado**.

`"não dependem de renderer novo"` da issue = isto. #1220 entrega (1) os widgets certos no snapshot e (2) **paridade numérica**. Nada de AC furada.

**Perda visual v1, registrada como decisão (não dívida escondida):**
- **Taxa entre etapas** (funil, spec §3.2) e **avatar/iniciais** (ranking §2.6c) são enriquecimentos do formato barra → **adiados para fatia de renderer dedicado**, onde entram como **formato explícito escolhido pelo Composer** (mesmo padrão do donut no #1218: componente existe, a derivação nunca o alcança).
- **`etapa` é barra ordenada por volume, NÃO por ordem de pipeline** — não é um funil verdadeiro. Um `FunnelRenderer` stage-ordered com taxa é o follow-up. Rotular honesto ("por etapa"), nunca fingir funil.

**Alternativa REJEITADA** (estender derivação `etapa→funnel`/`member→ranking` + 2 renderers): fura a AC literal e o `categórico→bar` ratificado no #1251, e reintroduz o mapa-por-recorte que é o schema-especulativo-disfarçado que recusei no #1218. Não fazer sem ok explícito do CTO.

## Q2 — remoção de legados no caminho flag-OFF → **NÃO remover componentes; só hooks genuinamente órfãos**

Os 4 componentes (KPICard/SalesFunnel/TVRankingSimple/SDRPerformanceBlock) vivem em `TVDashboardInner` = **caminho flag-OFF** = "TV de hoje byte a byte" das **92 orgs OFF** (invariante do #1207). Removê-los **REGRIDE as 92**. Milennials (única ON) roda a parede composable semeada, não os legados.

**Decisão:** a AC "hooks substituídos removidos, não órfãos" aplica-se **só a hooks que ficarem GENUINAMENTE sem referência** após #1220. Os **componentes legados FICAM** até o flag virar ON em todas as orgs (fatia de decomissionamento futura). Como os legados permanecem, eles ainda usam seus hooks → **espera-se remover ~zero hooks**. Só remover o que `grep` provar sem referência. Não forçar remoção pra satisfazer uma AC escrita presumindo cutover completo. Mesmo princípio do #1207 ("flag OFF = intacta, sem regressão").

## Q3 — no-show como razão → **ship "Comparecimento" (realizadas/marcadas); no-show fica pro CTO**

A razão é prof-1/2-filhos: **não faz `(marcadas − comparecidas)/marcadas`**. Só `reunioes_realizadas / reunioes_marcadas` (comparecimento) é expressível.

**Decisão:** v1 entrega o widget de razão como **"Comparecimento"** (`reunioes_realizadas / reunioes_marcadas`) — honesto, expressível, sem inversão, sem fabricar subtração. **NÃO** shippar "No-show %" em v1: exigiria (a) uma medida `no_show` no catálogo, ou (b) inverter `1 − comparecimento` no display — e inversão-no-rótulo com valor de comparecimento = mislabel (o defeito que a spec §4.2 chama de "leitura errada em produção"). Mapear o que mapeia, **descartar/adiar** o que não mapeia, nunca mis-mapear (stance do #1218).

**Fica pro CTO:** se "No-show %" é requisito de produto, decidir entre medida nova no catálogo (gargalo por desenho, ADR) OU complemento-de-display explícito. Não invento.
