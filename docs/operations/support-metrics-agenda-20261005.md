# Suporte: reuniões e atribuição da Agenda — 2026-10-05

Escopo: chamados #3, #15 e #16 do diagnóstico de suporte. Implementação na interface V5; publicação e verificação autenticada ficam a cargo da entrega integrada.

## Decisões

- Seguir [ADR-0007](../adr/0007-event-sourced-meeting-metrics.md): reuniões marcadas no KPI, atividade do período e metas usam `useCommandMetrics`, que lê o ledger de eventos. Removido o override Milennials que substituía apenas alguns desses números pela coorte de Saúde.
- Manter [ADR-0013](../adr/0013-productivity-activity-in-period-indicator.md): Saúde e sua análise de coorte continuam independentes. Não foram alterados RPCs, datas ou snapshots históricos.
- O quadro de atividade usa a mesma janela e o mesmo `filterMemberId` do KPI, inclusive para comparação anterior e resultados zero. Seus rótulos explicam que as razões são proporções entre volumes do período, não conversões de uma coorte. Sem denominador, a razão é exibida como traço.
- Metas continuam mensais e da equipe. O Estúdio compartilhado continua passando filtro de membro nulo, conforme seu contrato; selecionar uma pessoa nas superfícies que aceitam o filtro mantém esse escopo explícito.
- Na Agenda, a autoria histórica de uma reunião aparece como “Agendado por”. Follow-up e confirmação mantêm “Responsável”; calendários externos mostram “Agenda”. O detalhe exibe separadamente “Pré-venda atual” e “Venda atual”, consultados do lead com escopo de organização. Ausência, erro e carregamento têm estados distintos.
- `useUpdateLead` invalida a consulta de responsáveis ao alterar os campos canônicos de atribuição, sem reatribuir eventos ou modificar o acesso à agenda.

## Regressões verificadas

O comando abaixo passou em 7 suites e 52 testes. Em seguida, uma regressão adicional para atividade sem novos leads foi adicionada; as três suites `support-*` passaram com 12 testes. Total de casos distintos verificados: 53.

```text
npx vitest run tests/unit/support-meeting-metrics.test.tsx tests/unit/support-agenda-attribution.test.tsx tests/unit/support-agenda-responsibles-cache.test.tsx tests/unit/agenda-page-escopo.test.tsx tests/unit/agenda-popover-resultado.test.tsx tests/unit/agenda-month-view.test.tsx tests/unit/comando-v5-visao-e-espera.test.tsx --reporter=dot
```

Cobertura: eventos89 versus coorte61; filtro por pessoa e zero; janela anterior; meta mensal da equipe; atividade em leads antigos; autoria nas superfícies Dia/Mês/Próximo/Comando; responsáveis atuais e estados de consulta; reatribuição e limpeza de responsabilidade; isolamento do cache entre organizações; consulta desabilitada sem lead; agenda e comparecimento existentes.

ESLint nos arquivos alterados deste escopo: zero erros, 13 avisos `any` preexistentes em `useLeads.ts`. `git diff --check`: sem erros. Typecheck, build, revisão integrada e eventual backport clássico são verificados pelo responsável pela entrega. Os testes usam dados controlados, não constituem validação autenticada em produção.
