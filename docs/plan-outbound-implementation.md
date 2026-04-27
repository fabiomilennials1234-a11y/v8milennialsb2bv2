# Plano de Implementação: Tipo de Organização OUTBOUND

**Data:** 2026-02-21
**Referência:** [design-outbound-org-type.md](design-outbound-org-type.md)

---

## Fases de Implementação

O trabalho está dividido em **6 fases** sequenciais. Cada fase entrega valor incremental e pode ser testada independentemente.

---

## Fase 1: Banco de Dados (Migration)

**Arquivo:** `supabase/migrations/20260221000000_outbound_org_type.sql`

### Tarefas:

1. Criar enum `org_type` (`'crm' | 'outbound'`)
2. Adicionar coluna `org_type` em `organizations` (default `'crm'`)
3. Estender enum `app_role` com `'agency'`, `'bdr'`, `'cliente'`
4. Criar tabela `client_sidebar_permissions` com RLS
5. Criar tabelas `badges` e `user_badges` com RLS
6. Criar índices para as novas tabelas
7. Adicionar novas tabelas ao Realtime (`supabase_realtime`)

**Dependências:** Nenhuma
**Impacto:** Apenas cria objetos novos. A coluna `org_type` tem default `'crm'`, então orgs existentes não são afetadas.

---

## Fase 2: Criação de Org OUTBOUND no Master

### Tarefas:

1. **`src/hooks/useMasterOrganizations.ts`** — Estender a mutation `useMasterCreateOrganization`:
   - Aceitar campo `org_type` no payload
   - Se `outbound`: inserir `client_sidebar_permissions` com defaults
   - Se `outbound`: inserir badges base (`is_system = true`)

2. **`src/pages/master/MasterOrganizations.tsx`** — Alterar dialog de criação:
   - Adicionar toggle/radio CRM | OUTBOUND antes dos campos nome/slug
   - Passar `org_type` para a mutation
   - Exibir coluna "Tipo" na listagem de orgs (badge CRM/OUTBOUND)

**Dependências:** Fase 1
**Teste:** Criar org OUTBOUND pelo Master, verificar no banco que `org_type = 'outbound'`, sidebar permissions e badges foram inseridos.

---

## Fase 3: Roles e Contexto Organizacional

### Tarefas:

1. **`src/hooks/useOrganization.ts`** — Expor `orgType` no contexto:
   - Buscar `org_type` da org junto com os dados atuais
   - Retornar no `OrganizationContext`

2. **`src/hooks/useTeamMembers.ts`** — Atualizar `useCurrentTeamMember`:
   - Incluir join com `organizations.org_type` na query
   - Expor `orgType` no retorno

3. **`src/hooks/useUserRole.ts`** — Adaptar hooks de role:
   - `useIsAdmin()` deve retornar `true` também para role `agency`
   - Criar `useIsAgency()`, `useIsBDR()`, `useIsCliente()`
   - `useCanManageCopilot()` incluir `agency`
   - `useCanManageWhatsApp()` incluir `agency`

4. **`src/pages/Equipe.tsx`** — Adaptar formulário de criação de membro:
   - Se `orgType === 'outbound'`: mostrar roles `agency | bdr | cliente`
   - Se `orgType === 'crm'`: manter roles `admin | sdr | closer`
   - Validação no frontend para impedir role incompatível

**Dependências:** Fase 1 e 2
**Teste:** Criar team members com roles `agency`, `bdr`, `cliente` em org OUTBOUND. Verificar que hooks retornam `orgType` corretamente.

---

## Fase 4: Org Switcher no Layout

### Tarefas:

1. **`src/hooks/useOrgSwitcher.ts`** — Novo hook:
   - Query: buscar todas as orgs onde o `user_id` tem `team_member.is_active = true`
   - Retornar: lista de orgs, org atual, função `switchOrg(orgId)`
   - `switchOrg`: atualizar o contexto de org + invalidar todas as queries do React Query

2. **`src/components/layout/OrgSwitcher.tsx`** — Novo componente:
   - Dropdown (Radix `DropdownMenu`) com nome da org atual + chevron
   - Lista orgs disponíveis, org atual com checkmark
   - Só renderiza se `orgs.length > 1`
   - Usar componentes Shadcn existentes (DropdownMenu, Badge)

3. **`src/components/layout/MainLayout.tsx`** — Incluir OrgSwitcher:
   - Adicionar um header bar acima do conteúdo principal
   - Posicionar OrgSwitcher à direita, ao lado do nome do usuário
   - Manter layout responsivo

4. **`src/contexts/OrganizationContext.tsx`** (se existir) ou `useOrganization.ts`:
   - Suportar troca dinâmica de `organization_id`
   - Ao trocar: invalidar cache do React Query (`queryClient.invalidateQueries()`)

**Dependências:** Fase 3
**Teste:** Login com BDR que tem team_member em 2+ orgs. Verificar switcher aparece. Trocar de org e verificar dados recarregam corretamente. Login com CLIENTE em 1 org — switcher não aparece.

---

## Fase 5: Sidebar Condicional + Configuração

### Tarefas:

1. **`src/hooks/useClientSidebarPermissions.ts`** — Novo hook:
   - `useClientSidebarPermissions()`: buscar permissões da org atual
   - `useUpdateClientSidebarPermissions()`: mutation para atualizar `is_visible`

2. **`src/components/layout/Sidebar.tsx`** — Lógica condicional:
   - Se `orgType === 'crm'`: comportamento atual (sem mudança)
   - Se `orgType === 'outbound'`:
     - `agency`: tudo visível (como admin)
     - `bdr`: filtro fixo (sem Equipe, Comissões, Config, Produtos, TV)
     - `cliente`: itens fixos (sem Campanhas, Equipe, Config, Comissões, Produtos, TV) + itens configuráveis via `client_sidebar_permissions`
   - Usar o array de `navItems` existente e filtrar com base no role + permissions

3. **`src/components/settings/ClienteSidebarConfig.tsx`** — Novo componente:
   - Lista de checkboxes com os sidebar_keys configuráveis
   - Seção informativa com itens fixos (não editáveis)
   - Botão salvar → mutation `useUpdateClientSidebarPermissions`

4. **`src/pages/Configuracoes.tsx`** — Nova aba:
   - Adicionar tab "Acesso do Cliente" (visível apenas para role `agency` em org `outbound`)
   - Renderizar `<ClienteSidebarConfig />`

**Dependências:** Fase 3 e 4
**Teste:** Login como AGENCY, configurar sidebar do CLIENTE. Login como CLIENTE, verificar que só vê os itens permitidos. Alterar config e verificar que CLIENTE reflete a mudança.

---

## Fase 6: Dashboards por Papel + Badges

### Tarefas:

1. **`src/hooks/useBadges.ts`** — Novo hook:
   - `useBadges()`: listar badges da org
   - `useCreateBadge()`: mutation para criar badge custom
   - `useDeleteBadge()`: mutation para deletar badge custom (apenas `is_system = false`)

2. **`src/hooks/useUserBadges.ts`** — Novo hook:
   - `useUserBadges(teamMemberId)`: listar badges desbloqueados
   - `useCheckAndUnlockBadges()`: calcular progresso de cada badge, desbloquear se atingiu threshold
   - Critérios calculados via queries:
     - `leads_quentes`: COUNT leads com status qualificado/quente
     - `vendas_count`: COUNT pipe_propostas com status vendido
     - `vendas_recorrentes`: COUNT vendas de clientes que já compraram antes
     - `faturamento_total`: SUM sale_value de propostas vendidas

3. **`src/pages/DashboardBDR.tsx`** — Nova página:
   - Métricas: Leads Prospectados, Leads Quentes, Campanhas Ativas, Taxa Conversão, Disparos
   - Tabela de campanhas ativas com métricas
   - Funil de prospecção (gráfico Recharts)
   - Hooks: reusar `useDashboardMetrics` adaptado + dados de campanhas

4. **`src/pages/DashboardCliente.tsx`** — Nova página:
   - Métricas: Leads Recebidos, Agendamentos, Propostas, Vendas, Faturamento
   - `<BadgeGrid />` com progresso
   - Funil de vendas (gráfico Recharts)
   - Feed de atividades recentes
   - Chamar `useCheckAndUnlockBadges()` no mount

5. **`src/components/badges/BadgeCard.tsx`** — Novo componente:
   - Renderiza badge individual: ícone, nome, status (desbloqueado/travado)
   - Se travado: mostra progresso atual/meta em cinza
   - Se desbloqueado: colorido, com data de desbloqueio

6. **`src/components/badges/BadgeGrid.tsx`** — Novo componente:
   - Grid responsivo de `<BadgeCard />`
   - Barra de progresso geral (desbloqueados / total)
   - Animação com framer-motion ao desbloquear

7. **`src/pages/Dashboard.tsx`** — Roteamento condicional:
   - Se `orgType === 'crm'`: renderizar dashboard atual (sem mudança)
   - Se `orgType === 'outbound'`:
     - `agency` → dashboard atual (visão completa)
     - `bdr` → `<DashboardBDR />`
     - `cliente` → `<DashboardCliente />`

8. **`src/components/settings/BadgesConfig.tsx`** — Novo componente:
   - Lista badges do sistema (não editáveis)
   - CRUD de badges customizados
   - Form: nome, ícone (seletor), critério (select), valor (input numérico)

9. **`src/pages/Configuracoes.tsx`** — Nova aba:
   - Adicionar tab "Badges" (visível apenas para role `agency` em org `outbound`)
   - Renderizar `<BadgesConfig />`

**Dependências:** Todas as fases anteriores
**Teste:** Login como CLIENTE, verificar dashboard com badges. Desbloquear badge ao atingir critério. Login como AGENCY, criar badge custom. Login como BDR, verificar dashboard de prospecção.

---

## Resumo de Arquivos

### Novos (14 arquivos)

| Arquivo | Fase |
|---------|------|
| `supabase/migrations/20260221000000_outbound_org_type.sql` | 1 |
| `src/hooks/useOrgSwitcher.ts` | 4 |
| `src/hooks/useClientSidebarPermissions.ts` | 5 |
| `src/hooks/useBadges.ts` | 6 |
| `src/hooks/useUserBadges.ts` | 6 |
| `src/components/layout/OrgSwitcher.tsx` | 4 |
| `src/components/settings/ClienteSidebarConfig.tsx` | 5 |
| `src/components/settings/BadgesConfig.tsx` | 6 |
| `src/components/badges/BadgeCard.tsx` | 6 |
| `src/components/badges/BadgeGrid.tsx` | 6 |
| `src/pages/DashboardBDR.tsx` | 6 |
| `src/pages/DashboardCliente.tsx` | 6 |

### Modificados (9 arquivos)

| Arquivo | Fase | Mudança |
|---------|------|---------|
| `src/hooks/useMasterOrganizations.ts` | 2 | Aceitar `org_type`, seed sidebar + badges |
| `src/pages/master/MasterOrganizations.tsx` | 2 | Toggle CRM/OUTBOUND + coluna tipo |
| `src/hooks/useOrganization.ts` | 3 | Expor `orgType` |
| `src/hooks/useTeamMembers.ts` | 3 | Join com `org_type` |
| `src/hooks/useUserRole.ts` | 3 | Novos hooks de role |
| `src/pages/Equipe.tsx` | 3 | Roles condicionais |
| `src/components/layout/MainLayout.tsx` | 4 | Incluir header com OrgSwitcher |
| `src/components/layout/Sidebar.tsx` | 5 | Filtro condicional |
| `src/pages/Dashboard.tsx` | 6 | Roteamento por orgType/role |
| `src/pages/Configuracoes.tsx` | 5+6 | Novas abas |

---

## Ordem de Execução

```
Fase 1 (Migration)
  ↓
Fase 2 (Master - criação de org)
  ↓
Fase 3 (Roles + contexto)
  ↓
Fase 4 (Org Switcher)
  ↓
Fase 5 (Sidebar condicional)
  ↓
Fase 6 (Dashboards + Badges)
```

Cada fase deve ser commitada separadamente para facilitar review e rollback.
