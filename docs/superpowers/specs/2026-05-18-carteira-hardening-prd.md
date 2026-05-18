# PRD: Carteira de Clientes — Hardening Pré-Ativação

**Data**: 2026-05-18
**Origem**: Grill de arquitetura (10 achados)
**Objetivo**: Resolver todos gaps de segurança, dados e funcionalidade antes de ativar o módulo Carteira em produção.

---

## Problem Statement

O módulo Carteira de Clientes (portfolio + order approval) foi construído com boa fundação — schema limpo, separação de concerns, cron robusto, approval gate com trigger. Porém um grill de arquitetura revelou 10 achados que impedem ativação segura em produção:

- **Brecha de segurança**: RPCs SECURITY DEFINER permitem qualquer usuário autenticado ler dados financeiros de qualquer organização.
- **Dados incorretos**: KPI "Receita Recorrente" calcula soma de médias ao invés de receita real. Cron de health nunca foi agendado.
- **Funcionalidade quebrada**: Modal de pedido rápido não está integrado, cache queries desatualiza, pedidos rejeitados aparecem em "Repetir último".
- **UX subótima**: Approval queue sem paginação, botões bloqueiam globalmente, sem notificações nem audit trail.

## Solution

Executar 10 fixes organizados em 4 camadas de prioridade (crítico → baixo), entregando:

1. RPCs blindadas com validação de org membership
2. Métrica de receita recorrente correta
3. Cron de health agendado
4. QuickOrderModal integrado no fluxo
5. Cache invalidation e filtros corrigidos
6. Approval UX com optimistic updates e paginação
7. Notificação in-app ao criador de pedido
8. Audit trail imutável de aprovações

## User Stories

1. Como admin de uma organização, quero que meus dados financeiros de carteira sejam inacessíveis a usuários de outras organizações, para que informações sensíveis permaneçam isoladas.
2. Como admin de uma organização, quero que o KPI "Receita Recorrente" reflita a receita mensal real (ticket × frequência), para tomar decisões de negócio baseadas em dados corretos.
3. Como admin de uma organização, quero que health scores, segmentos e tendências dos clientes atualizem automaticamente via cron, para que a carteira reflita o estado atual sem intervenção manual.
4. Como vendedor na tabela de clientes, quero clicar "Novo pedido" e abrir modal com contexto do cliente pré-preenchido, para registrar pedidos rapidamente.
5. Como vendedor repetindo último pedido, quero ver apenas pedidos aprovados como sugestão, para não repetir um pedido que já foi rejeitado.
6. Como vendedor que acabou de criar pedido manual, quero ver o badge "Aprovações" atualizar imediatamente, para ter confiança que o pedido entrou na fila.
7. Como aprovador com 50+ pedidos pendentes, quero aprovar pedidos um a um sem que todos os botões bloqueiem, para processar a fila rapidamente.
8. Como aprovador com volume alto, quero paginação na fila de aprovação, para que a página não trave carregando centenas de cards.
9. Como vendedor que criou pedido, quero receber notificação quando meu pedido for aprovado ou rejeitado (com motivo se rejeitado), para saber o resultado sem ficar checando.
10. Como admin/auditor, quero um registro imutável de cada decisão de aprovação/rejeição (quem, quando, motivo), para rastrear decisões mesmo que alguém edite o registro original.
11. Como aprovador processando fila rápido, quero que cards aprovados desapareçam imediatamente com opção de undo, para feedback visual instantâneo.
12. Como vendedor usando "Repetir último pedido", quero que o pedido criado apareça automaticamente na aba de aprovações, sem precisar dar refresh.
13. Como usuário do sistema, quero que a carteira funcione com dados atualizados desde o primeiro dia de ativação, para não precisar esperar o primeiro ciclo de cron.

## Implementation Decisions

### Módulo 1: RPC Org Guard (Crítico)

- Adicionar validação `auth.uid() IN (SELECT user_id FROM team_members WHERE organization_id = p_org_id)` no início de cada RPC SECURITY DEFINER: `get_portfolio_kpis`, `get_portfolio_clients`, `get_revenue_at_risk`.
- Retornar NULL (não erro) se validação falhar — comportamento consistente com "sem dados".
- Nova migration única para recriar as 3 funções com guard.
- Extrair helper SQL `assert_org_member(p_org_id UUID)` que faz RAISE EXCEPTION se check falhar — reusável em futuras RPCs.

### Módulo 2: Receita Recorrente Correta (Alto)

- Alterar `get_portfolio_kpis` para calcular `total_recurring` como: `SUM(avg_ticket * (30.0 / GREATEST(reorder_cycle_days, 1)))` ao invés de `SUM(avg_ticket)`.
- Clientes sem `reorder_cycle_days` usam default 30 (1 pedido/mês).
- Renomear label no KPI card para clareza: "Receita Recorrente Estimada".
- Incluído na mesma migration do Módulo 1 (recria a RPC).

### Módulo 3: Cron Schedule (Alto)

- Nova migration criando pg_cron job para `calculate-portfolio-health`.
- Intervalo recomendado: a cada 30 minutos (`*/30 * * * *`).
- Auth via `x-cron-secret` (padrão existente).
- Seguir template de cron do CLAUDE.md de migrations.

### Módulo 4: QuickOrderModal Integration (Médio)

- Em Upsell.tsx (fluxo portfolio): substituir `NovaVendaModal` por `QuickOrderModal` quando `quickOrderClientId` está setado.
- Passar `clientId` e `clientName` para QuickOrderModal.
- Manter NovaVendaModal para criação genérica (botão header "Nova Venda" sem cliente selecionado).
- Buscar `clientName` dos currentRows ou selectedClient.

### Módulo 5: Cache & Filter Fixes (Médio)

- `useCreateOrder`: adicionar `queryClient.invalidateQueries({ queryKey: ["pending-orders"] })` no onSuccess.
- `useLastOrder`: adicionar `.neq("approval_status", "rejected")` na query.
- Ambos são one-line fixes em hooks existentes.

### Módulo 6: Approval Optimistic UX (Baixo)

- Implementar optimistic updates em `useApproveOrder` e `useRejectOrder`: remover card da lista via `queryClient.setQueryData` antes de mutation resolver.
- Rollback automático via TanStack Query `onError`.
- Track per-order pending state: `mutationKey: ["approve-order", orderId]` ou state local no card.
- Toast com "Desfazer" por 3 segundos antes de confirmar (pattern Linear).

### Módulo 7: Approval Pagination (Baixo)

- Nova RPC `get_pending_orders(p_org_id, p_page, p_page_size)` com org guard.
- Retorna total count + paginated rows com items join.
- Substituir `usePendingOrders` para usar RPC ao invés de client-side query.
- Adicionar pagination bar em CarteiraApprovals (reusar pattern de CarteiraClientTable).
- Mover totalValue para server-side (retornado pela RPC).

### Módulo 8: Approval Notifications (Baixo)

- Nova tabela `order_events` (organization_id, order_id, event_type, actor_id, comment, created_at) com RLS.
- Insert row em `order_events` ao aprovar/rejeitar (pode ser trigger ou inline na mutation).
- Notificação in-app: usar sistema existente de notificações se houver, senão criar bell icon com badge + dropdown.
- Se `order_events` criada como tabela, serve como audit trail imutável (Módulo 9 gratuito).

### Módulo 9: Audit Trail (Baixo)

- Incluído no Módulo 8 via tabela `order_events`. Cada approve/reject insere row imutável.
- RLS: leitura por org, insert por org, sem update/delete policies.
- Exibir em ClienteTimeline ou OrderApprovalCard history expandido.

## Testing Decisions

Bons testes verificam comportamento externo, não implementação interna. Testar o quê o sistema faz, não como faz.

### Módulos com testes obrigatórios:

1. **RPC Org Guard** (Módulo 1): teste de integração — user de org A chama RPC com org B, espera NULL/empty. User de org A com org A retorna dados. Pattern: `tests/integration/rls-*.test.ts`.

2. **Receita Recorrente** (Módulo 2): teste unitário — dados mockados com tickets e cycles conhecidos, verificar cálculo. Pattern: `tests/unit/`.

3. **Cache Invalidation** (Módulo 5): verificação manual — criar pedido, checar badge atualiza. Difícil de testar automatizado.

4. **Approval Pagination RPC** (Módulo 7): teste de integração — inserir N orders pending, chamar RPC com page_size M, verificar pagination metadata.

### Módulos sem testes necessários:

- Módulo 3 (cron schedule): migration declarativa, sem lógica testável.
- Módulo 4 (modal integration): wiring de componente, testar via Playwright e2e se existir.
- Módulo 6 (optimistic UX): UI behavior, testar manualmente.
- Módulo 8/9 (notifications/audit): testar insert em `order_events` via integration test.

## Out of Scope

- **Role-based approval** (quem pode aprovar vs quem não pode) — decisão consciente que qualquer membro aprova.
- **Auto-reject rules** — mencionado no spec original como non-goal.
- **Push notifications** (mobile/browser) — notificação in-app é suficiente para v1.
- **ERP sync on approval** — aprovar pedido não dispara sync automática com TinyERP.
- **Fuzzy matching no ERP webhook** — match por nome case-insensitive é suficiente por agora.
- **Bulk reject** — bulk approve existe, bulk reject não é necessário (rejeição requer motivo individual).
- **Undo reject** — rejeição é final; criar novo pedido se necessário.

## Further Notes

- Módulos 1-3 são bloqueadores de ativação. Módulos 4-6 são necessários para UX funcional. Módulos 7-9 são polish pós-ativação.
- Migration do Módulo 1 recria RPCs existentes — garantir que não quebra queries em uso no dev.
- `calculate-portfolio-health` precisa rodar pelo menos 1x antes de ativar carteira para popular campos derivados iniciais.
- Ordem de execução recomendada: 1 → 2 → 3 → 5 → 4 → 6 → 7 → 8/9.
