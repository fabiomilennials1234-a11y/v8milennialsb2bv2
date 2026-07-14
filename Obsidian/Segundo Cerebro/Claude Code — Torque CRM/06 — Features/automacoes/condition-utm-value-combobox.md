# Node Condição — Combobox de valor UTM

## O que é
No node "Condição" das automações, quando o campo escolhido é um UTM
(`utm_campaign`, `utm_source`, `utm_medium`, `utm_content`, `utm_term`), o input
de "Valor" deixa de ser texto livre e vira um **Combobox creatable**: lista os
valores UTM que **já existem** nos leads da org logada e ainda permite digitar um
valor arbitrário. Objetivo: parar de errar acento/colchete/pontuação em valores
que vêm do Meta (ex.: `[TESTE CRIATIVOS] BATERIA.`).

## Como funciona
- Hook `src/modules/workflows/hooks/useOrgUtmValues.ts` (read-only):
  - `queryKey: ["org-utm-values", field, orgId]`, `enabled` só com `orgId` +
    campo na allowlist.
  - Query: `leads.select(<field>).eq(organization_id).not(<field>,is,null).neq(<field>,"").limit(1000)`.
    Postgrest não tem DISTINCT → dedup com `Set` + sort `localeCompare("pt-BR")`
    no client.
  - **Allowlist ESTRITA** (`UTM_VALUE_FIELDS`) validada antes de interpolar o
    nome da coluna no `select` — evita column-injection a partir de `data.field`
    (que carrega valores livres como `custom.<x>`).
  - org vem de `useOrganization` — **NÃO** `useAuth` (este não expõe
    `organizationId`; usar ele desabilitaria a query silenciosamente).
- Componente `UtmValueCombobox.tsx` (Command + Popover, padrão do
  `carteira/.../ProductCombobox`). Estados: **loading** ("Carregando valores…"),
  **vazio** ("Nenhum valor de UTM encontrado nesta org — digite manualmente") e
  **lista + creatable** (opção `Usar "<texto>"` quando o texto não bate com item).
- `ConditionPanel.tsx`: bloco "Valor" tem 3 ramos — responsible → Select de
  membros; UTM → `UtmValueCombobox`; senão → Input livre. Em `handleFieldChange`,
  ao entrar num campo UTM vindo de operador numérico/incompatível, o operador cai
  em `contains` (valor salvo tem `.`/`[]`/acento; `equals` é frágil); um operador
  de texto já sensato (`contains`/`not_contains`/`starts_with`/`ends_with`/
  `is_empty`/`is_not_empty`) é preservado.

## Regras de negócio
- Seleção de item da lista → `data.value` = valor exato do item.
- Texto inexistente + confirmar creatable → `data.value` = texto cru digitado.
- Org sem UTM ainda salva valor livre (não bloqueia — maioria das orgs não recebe UTM).

## Edge cases
- Sem `orgId`: query desabilitada, combobox mostra estado vazio, input continua funcional.
- Campo fora da allowlist: hook não consulta (retorna `[]`).

## Áreas frágeis
- Backend **não muda**: `_shared/workflow-condition-evaluator.ts` já resolve
  `leadData[utm_*]` (colunas reais de `leads`). A condição continua avaliando
  string vs string; só a UX de escolha do valor mudou.

## Histórico
- 2026-07-14 — feature criada (hook + combobox + wiring no ConditionPanel + testes).
