---
tags:
  - torque-crm
  - docs
  - reference
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/design-outbound-org-type.md
---

# Design: Tipo de Organização OUTBOUND

**Data:** 2026-02-21
**Status:** Aprovado

---

## Resumo

Adicionar um novo tipo de organização **OUTBOUND** ao sistema, voltado para agências/consultorias de prospecção que atendem empresas clientes. O tipo **CRM** continua funcionando exatamente como hoje.

### O que é

Uma agência de outbound usa o sistema para prospectar leads (via campanhas, disparos, IA) e entrega os leads quentes para a empresa contratante (CLIENTE) operar nos funis de vendas.

### Para quem

Agências de prospecção outbound com três papéis distintos:

| Role | Descrição |
|------|-----------|
| **AGENCY** | Dono/gestor da agência. Visão completa do sistema |
| **BDR** | Prospector da agência. Foco em campanhas. Pode atuar em múltiplas orgs |
| **CLIENTE** | Empresa contratante. Opera funis de vendas. Visibilidade controlada |

### Fluxo principal

```
BDR prospecta via Campanhas → Lead esquenta → Vai para o funil → CLIENTE atende nos funis
```

---

## Premissas

- O tipo da org (CRM/OUTBOUND) é definido na criação e **não muda** depois
- O CRM não sofre nenhuma alteração
- Roles CRM (`admin`, `sdr`, `closer`) e OUTBOUND (`agency`, `bdr`, `cliente`) são mutuamente exclusivos por tipo de org
- AGENCY não precisa de self-service para criação de usuários CLIENTE - ele cria pelo sistema
- O CLIENTE nunca vê: Campanhas, Equipe, Configuraçoes de roles, quantidade de BDRs
- Múltiplos usuários CLIENTE por org, todos criados pelo AGENCY
- Modelo de isolamento: **uma org por cliente** (reutiliza `organization_id` + RLS existente)

---

## Decision Log

| # | Decisão | Alternativas consideradas | Motivo |
|---|---------|--------------------------|--------|
| 1 | Modelo agência para clientes | Outbound interno, outro cenário | Contexto real do negócio do usuário |
| 2 | CLIENTE opera funis ativamente (como closer) | Read-only, parcial, configurável por ação | Simplicidade - se tem acesso ao módulo, opera por completo |
| 3 | Uma org por cliente (isolamento existente) | Multi-client na mesma org, configurável | Reutiliza `organization_id` + RLS sem refatoração do core |
| 4 | Seletor de org no header (ao lado do nome) | Na sidebar, tela pós-login | Acessível e limpo |
| 5 | Roles separados: agency/bdr/cliente | Reusar admin/sdr/closer | Evita confusão entre tipos de org |
| 6 | Permissão CLIENTE = checkboxes de sidebar | Granular por ação, perfis pré-definidos | Se tem acesso ao módulo, opera por completo |
| 7 | Abordagem extensão mínima (estender enum existente) | Enum separado, config-driven | YAGNI - menor risco e complexidade |
| 8 | Badges: base pré-definidos + customizáveis pelo AGENCY | Só fixos, só customizáveis | Valor imediato + flexibilidade |
| 9 | Desbloqueio de badges on-demand (ao abrir dashboard) | Trigger no banco, cron job | Simples, sem infra extra, volume baixo |
| 10 | Campanhas e Equipe hardcoded como invisível para CLIENTE | Tudo configurável | Proteção da estrutura interna da agência |
| 11 | Switcher visível para qualquer user com +1 org ativa | Apenas BDR | AGENCY também precisa alternar entre orgs de clientes |
| 12 | Visibilidade do CLIENTE configurável pelo AGENCY | Fixa, por perfil | Flexibilidade para a agência decidir |
| 13 | Dashboards separados por papel | Dashboard único com seçoes | Cada papel tem foco diferente (prospecção vs resultados) |

---

## Modelagem de Banco

### 1. Enum e coluna `org_type`

```sql
CREATE TYPE org_type AS ENUM ('crm', 'outbound');

ALTER TABLE organizations
  ADD COLUMN org_type org_type NOT NULL DEFAULT 'crm';
```

### 2. Extensão do enum `app_role`

```sql
ALTER TYPE app_role ADD VALUE 'agency';
ALTER TYPE app_role ADD VALUE 'bdr';
ALTER TYPE app_role ADD VALUE 'cliente';
```

Validação no nível de aplicação: CRM só aceita `admin/sdr/closer`, OUTBOUND só aceita `agency/bdr/cliente`.

### 3. Tabela `client_sidebar_permissions`

```sql
CREATE TABLE client_sidebar_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sidebar_key     TEXT NOT NULL,
  is_visible      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, sidebar_key)
);

ALTER TABLE client_sidebar_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_sidebar_permissions_select_org" ON client_sidebar_permissions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "client_sidebar_permissions_insert_org" ON client_sidebar_permissions
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "client_sidebar_permissions_update_org" ON client_sidebar_permissions
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "client_sidebar_permissions_delete_org" ON client_sidebar_permissions
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());
```

**Sidebar keys configuráveis:**

| sidebar_key | Default |
|-------------|---------|
| `marketing` | true |
| `chat_whatsapp` | true |
| `funis` | true |
| `follow_ups` | true |
| `leads` | true |
| `performance` | false |
| `copilot` | true |

**Itens fixos (não entram na tabela):**
- `dashboard` - sempre visível para CLIENTE
- `campanhas` - nunca visível para CLIENTE
- `equipe` - nunca visível para CLIENTE
- `configuracoes` - nunca visível para CLIENTE
- `comissoes` - nunca visível para CLIENTE
- `produtos` - nunca visível para CLIENTE
- `tv_dashboard` - nunca visível para CLIENTE

### 4. Tabelas de Badges

```sql
CREATE TABLE badges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT,
  criteria_type   TEXT NOT NULL,
  criteria_value  INTEGER NOT NULL DEFAULT 1,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_badges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id        UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  team_member_id  UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(badge_id, team_member_id)
);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badges_select_org" ON badges
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "badges_insert_org" ON badges
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "badges_update_org" ON badges
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "badges_delete_org" ON badges
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "user_badges_select" ON user_badges
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM badges
      WHERE badges.id = user_badges.badge_id
      AND badges.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "user_badges_insert" ON user_badges
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM badges
      WHERE badges.id = user_badges.badge_id
      AND badges.organization_id = public.get_user_organization_id()
    )
  );
```

### 5. Badges base do sistema

Inseridos automaticamente na criação de org OUTBOUND:

| Badge | `criteria_type` | `criteria_value` |
|-------|----------------|-----------------|
| Primeiro Lead Quente | `leads_quentes` | 1 |
| Primeira Venda | `vendas_count` | 1 |
| 10 Leads Convertidos | `leads_quentes` | 10 |
| Primeira Venda Recorrente | `vendas_recorrentes` | 1 |
| R$ 50k Faturados | `faturamento_total` | 50000 |
| 50 Leads Convertidos | `leads_quentes` | 50 |
| R$ 100k Faturados | `faturamento_total` | 100000 |
| 5 Vendas Fechadas | `vendas_count` | 5 |

### 6. Índices

```sql
CREATE INDEX idx_client_sidebar_permissions_org ON client_sidebar_permissions(organization_id);
CREATE INDEX idx_badges_org ON badges(organization_id);
CREATE INDEX idx_badges_system ON badges(is_system);
CREATE INDEX idx_user_badges_member ON user_badges(team_member_id);
CREATE INDEX idx_user_badges_badge ON user_badges(badge_id);
```

---

## Camada Frontend

### Arquivos novos

| Arquivo | Descrição |
|---------|-----------|
| `src/components/layout/OrgSwitcher.tsx` | Dropdown de troca de org no header |
| `src/pages/DashboardBDR.tsx` | Dashboard focado em prospecção |
| `src/pages/DashboardCliente.tsx` | Dashboard focado em resultados + badges |
| `src/components/badges/BadgeCard.tsx` | Card individual de badge (desbloqueado/travado) |
| `src/components/badges/BadgeGrid.tsx` | Grid de badges com progresso geral |
| `src/pages/configuracoes/ClienteSidebarConfig.tsx` | Checkboxes de sidebar para CLIENTE |
| `src/pages/configuracoes/BadgesConfig.tsx` | CRUD de badges customizados |
| `src/hooks/useOrgSwitcher.ts` | Listar orgs do user, trocar contexto |
| `src/hooks/useClientSidebarPermissions.ts` | Buscar/atualizar checkboxes |
| `src/hooks/useBadges.ts` | Listar badges da org |
| `src/hooks/useUserBadges.ts` | Verificar e desbloquear badges |

### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `src/pages/master/MasterOrganizations.tsx` | Seletor CRM/OUTBOUND no dialog de criação |
| `src/hooks/useMasterOrganizations.ts` | Mutation inclui `org_type`, seed de sidebar e badges |
| `src/components/layout/Sidebar.tsx` | Lógica condicional por `org_type` + `role` |
| `src/components/layout/Header.tsx` | Incluir `OrgSwitcher` |
| `src/pages/Dashboard.tsx` | Roteamento para dashboard correto por org_type/role |
| `src/pages/Equipe.tsx` | Mostrar roles corretos por org_type (agency/bdr/cliente vs admin/sdr/closer) |
| `src/hooks/useCurrentTeamMember.ts` | Expor `org_type` da organização |
| `src/contexts/OrganizationContext.tsx` | Suportar troca de org |

---

## Fluxo: Criação de Org OUTBOUND

1. Master abre dialog em `MasterOrganizations`
2. Seleciona tipo **OUTBOUND**, preenche nome e slug
3. Sistema cria org com `org_type = 'outbound'`
4. Insere `client_sidebar_permissions` com valores default (7 keys)
5. Insere 8 badges base com `is_system = true`
6. Insere pipeline stages padrão (mesmos do CRM)
7. Org pronta para receber membros (AGENCY, BDR, CLIENTE)

## Fluxo: Troca de Org (Switcher)

1. Usuário faz login
2. Sistema busca todas as orgs onde `team_member.user_id = auth.uid() AND is_active = true`
3. Se > 1 org → mostra `OrgSwitcher` no header
4. Usuário clica no switcher, seleciona outra org
5. Atualiza `organization_id` no contexto
6. React Query invalida todas as queries
7. RLS garante isolamento automaticamente

## Fluxo: Desbloqueio de Badges

1. CLIENTE abre o dashboard
2. Hook `useUserBadges` carrega badges da org + badges já desbloqueados
3. Para cada badge não desbloqueado, calcula valor atual via queries (contagem de leads, vendas, faturamento)
4. Se valor atual >= `criteria_value` → insere em `user_badges`
5. UI mostra badge como desbloqueado com animação

---

## Sidebar por Role (OUTBOUND)

| Item | AGENCY | BDR | CLIENTE |
|------|--------|-----|---------|
| Dashboard | Sempre | Sempre | Sempre |
| Campanhas | Sempre | Sempre | **Nunca** |
| Marketing | Sempre | Sempre | Configurável |
| Chat WhatsApp | Sempre | Sempre | Configurável |
| Funis | Sempre | Sempre | Configurável |
| Follow-ups | Sempre | Sempre | Configurável |
| Leads | Sempre | Sempre | Configurável |
| Performance | Sempre | Configurável | Configurável |
| Comissoes | Sempre | Nunca | Nunca |
| Copilot | Sempre | Sempre | Configurável |
| Equipe | Sempre | **Nunca** | **Nunca** |
| Produtos | Sempre | Nunca | Nunca |
| TV Dashboard | Sempre | Nunca | Nunca |
| Configuraçoes | Sempre | Nunca | Nunca |

---

## Dashboards

### BDR (Prospecção)

- Leads Prospectados / Leads Quentes / Campanhas Ativas
- Taxa de Conversão frio → quente
- Disparos Enviados
- Tabela de campanhas ativas com métricas
- Funil de prospecção (gráfico)

### CLIENTE (Resultados + Badges)

- Leads Recebidos / Agendamentos / Propostas / Vendas / Faturamento
- Grid de badges (desbloqueados + travados com progresso)
- Barra de progresso geral
- Funil de vendas (gráfico)
- Últimas atividades
- **Não mostra:** BDRs, campanhas, disparos, estrutura interna

### AGENCY

- Visão completa (mesmo dashboard do admin CRM atual)

---

## Impacto

- **Apenas cria objetos novos** (tabelas, enum values, componentes)
- **Nenhuma tabela existente é alterada destrutivamente**
- **Nenhum fluxo CRM é modificado**
- A coluna `org_type` em `organizations` é a única alteração em tabela existente (ADD COLUMN com default 'crm')


## Links relacionados

- [[Dashboard Outbound]]

- [[Chat WhatsApp]]

- [[Produtos]]

- [[Visao Geral]]

- [[TV Dashboard]]

- [[Gestao de Time]]

- [[Comissoes]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Follow-ups]]

- [[Campanhas]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
