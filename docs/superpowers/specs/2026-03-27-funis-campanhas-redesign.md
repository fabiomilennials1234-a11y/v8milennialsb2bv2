# Funis + Campanhas Temporárias — Design Spec

**Data:** 2026-03-27
**Objetivo:** Extinguir o conceito atual de "Campanhas" e substituir por dois conceitos claros: **Funis Estruturais** (permanentes) e **Campanhas Temporárias** (com prazo, meta, incentivos). Renomear funis padrão, adaptar por quiz, preparar gates por plano.

---

## 1. Modelo de Domínio

### Dois conceitos centrais

| | Funil Estrutural | Campanha Temporária |
|---|---|---|
| **Natureza** | Permanente, contínuo | Tem início, deadline, encerramento |
| **Propósito** | Processo comercial da empresa | Ação comercial específica com objetivo |
| **Stages** | Fixos (editáveis pelo admin) | Próprios da campanha (template como base) |
| **Leads** | Vivem ali permanentemente | Entram e saem; ao encerrar, admin decide destino |
| **Incentivos** | Não | Sim (meta, bônus, prêmio) |
| **Analytics** | Métricas do funil (conversão, tempo) | Analytics de campanha (participantes, ranking, ROI) |
| **Após encerrar** | N/A | Fica como "encerrada", acessível em modo leitura |
| **Exemplos** | Oportunidades, Agendamentos, Orçamentos, Carteira, Custom | Prospecção Q1, Indicação Março, Reativação Inativos |

### Entidades no banco

**Reutilizar e evoluir:**
- `pipeline_stages` → continua para funis padrão (whatsapp/confirmacao/propostas)
- `custom_pipelines` + `custom_pipeline_stages` + `custom_pipe_entries` → continuam para funis customizados
- `campanhas` + `campanha_stages` + `campanha_leads` + `campanha_members` → evoluem para campanhas temporárias

**Novo:**
- `pipeline_display_config` — nome, visibilidade e posição de cada funil padrão por org

**Carteira:** Continua como módulo separado (`upsell_clients`, `upsell_campanhas`, pipes `upsell_base`/`upsell_gestao`). Mantém lógica própria de segmentação. Muda de posição no sidebar: entra dentro do grupo "Funis".

---

## 2. Renomeação e Visibilidade dos Funis Padrão

### Nova nomenclatura base

| Pipe interno | Nome antigo | Nome novo (default) | Pode mudar por quiz |
|---|---|---|---|
| `pipe_whatsapp` | Qualificação | **Oportunidades** | Sim |
| `pipe_confirmacao` | Confirmação | **Agendamentos** | Sim |
| `pipe_propostas` | Propostas | **Orçamentos** | Sim |
| `upsell` | Carteira | **Carteira** | Não (fixo) |

### Tabela `pipeline_display_config`

```sql
CREATE TABLE pipeline_display_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipe_type TEXT NOT NULL, -- 'whatsapp', 'confirmacao', 'propostas', 'upsell'
  display_name TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, pipe_type)
);
```

### Renomeação é apenas display

- Rotas internas mantidas: `/pipe-whatsapp`, `/pipe-confirmacao`, `/pipe-propostas`, `/upsell`
- Tabelas mantidas: `pipe_whatsapp`, `pipe_confirmacao`, `pipe_propostas`
- Variáveis e RPCs mantidos
- Sidebar lê `pipeline_display_config.display_name` para labels
- Sidebar lê `pipeline_display_config.is_visible` para mostrar/ocultar

### Reativação de funis ocultos

Se um funil está `is_visible = false`, o admin pode:
1. "Criar novo" → ver funis padrão ocultos como templates disponíveis (com hint "oculto no seu perfil — ativar?")
2. Ao selecionar, muda `is_visible = true`
3. Ou em Configurações > Funis, toggle a visibilidade

---

## 3. Impacto do Quiz na Configuração Inicial

### Mapeamento quiz → funis

| Step do Quiz | Pergunta | Impacto |
|---|---|---|
| StepProcessoVendas | Como apresenta o produto? (reunião/call/visita/WhatsApp direto) | Se só WhatsApp → `confirmacao.is_visible = false` |
| StepProcessoVendas | Usa proposta formal? | Se não → `propostas.display_name = "Fechamento"` |
| StepProcessoVendas | Ciclo de venda (curto/médio/longo) | Afeta stages sugeridos dentro de cada funil |
| StepEstruturaComercial | Tem SDR/pré-venda? | Se não → Oportunidades com stages simplificados |
| StepEstruturaComercial | Tipo de vendedor | Afeta labels dos stages |
| StepConfiguracaoInicial | Quer gestão de carteira? (nova pergunta) | `upsell.is_visible = true/false` |

### Templates de stages por contexto

**Oportunidades (pipe_whatsapp):**
- Default: Novo → Abordado → Respondeu → Esfriou → [Agendado ✓]
- Venda curta/direta: Novo → Contatado → Interessado → [Qualificado ✓]
- Sem SDR: Novo → Em Contato → Respondeu → [Qualificado ✓]

**Agendamentos (pipe_confirmacao):**
- Default (reunião): Marcada → Confirmar D-3 → Confirmar D-1 → Confirmada → [Compareceu ✓]
- Visita: Visita Agendada → Confirmar → [Realizada ✓]
- Call: Call Marcada → Confirmar → [Realizada ✓]

**Orçamentos (pipe_propostas):**
- Default: Compromisso → Proposta Enviada → Em Negociação → [Vendido ✓]
- Sem proposta formal: Em Negociação → Fechando → [Vendido ✓] (renomeia para "Fechamento")

### Quando os stages são aplicados

1. Quiz é respondido
2. `generateSuggestions()` é estendido para gerar `pipeline_display_config` + `pipeline_stages` customizados
3. Admin revisa no step de Revisão
4. Ao confirmar, insere tudo atomicamente

---

## 4. Ciclo de Vida da Campanha Temporária

### Estados

```
draft → active → paused → active (retomar)
                    ↓
                  ended
         active → ended
```

| Estado | Significado | UI |
|---|---|---|
| `draft` | Criada mas não iniciou. Configurando stages, membros, meta | Badge cinza, editável |
| `active` | Em andamento. Leads entram, vendedores trabalham | Badge verde, Kanban ativo |
| `paused` | Congelada temporariamente | Badge amarelo, Kanban view-only |
| `ended` | Prazo expirou ou admin encerrou | Badge vermelho, read-only, analytics acessíveis |

### Fluxo de encerramento

1. Deadline chega OU admin clica "Encerrar campanha"
2. Modal: "A campanha encerrou. O que fazer com os X leads restantes?"
   - Opção A: "Mover para funil" → dropdown para escolher funil + stage destino
   - Opção B: "Manter na campanha" → ficam congelados, campanha read-only
3. Admin confirma
4. Campanha muda para `status = 'ended'`, `ended_at = now()`, `end_action` salva a escolha

### Evolução da tabela `campanhas`

**Campos novos:**
- `status`: enum `draft | active | paused | ended` (substitui `is_active` boolean)
- `campaign_template_type`: `indicacao | prospeccao | reativacao | livre`
- `started_at`: TIMESTAMPTZ — quando foi ativada
- `ended_at`: TIMESTAMPTZ — quando encerrou
- `end_action`: JSONB — `{ "type": "move_to_funnel", "pipeline_id": "...", "stage_id": "..." }` ou `{ "type": "freeze" }`

**Campos deprecados (mantidos por compatibilidade):**
- `objective` → substituído por `campaign_template_type`
- `free_target_pipe`, `free_target_stage` → campanha tem funil próprio
- `is_active` → substituído por `status`, mantido como computed (`status = 'active'`)

### Templates pré-definidos de stages

**Indicação:**
```
Indicado → Contatado → Qualificado → [Convertido ✓]
```

**Prospecção:**
```
Importado → Pesquisado → Abordado → Respondeu → [Qualificado ✓]
```

**Reativação:**
```
Selecionado → Abordado → Reengajado → [Reativado ✓]
```

**Livre:**
```
Novo → Em andamento → [Concluído ✓]
```

Todos editáveis antes de ativar (template como ponto de partida).

---

## 5. Experiência de Criação

### Tela de escolha (Design C — mini-cards com legenda)

Ao clicar "Criar novo" no sidebar ou na página:
- Dois mini-cards lado a lado diferenciados por cor
- **Funil** (azul/roxo): ícone 🔀, label "Permanente"
- **Campanha** (laranja): ícone 🎯, label "Temporária"
- Legenda abaixo: "Funil = processo contínuo da operação / Campanha = ação com prazo, meta e incentivos"

### Fluxo "Criar Funil"

1. Tela de templates:
   - "Em branco" → cria custom pipeline com 3 stages default
   - Funis padrão ocultos aparecem como templates (ex: "Agendamentos — oculto no seu perfil, ativar?")
   - Ao selecionar padrão oculto → muda `is_visible = true` na `pipeline_display_config`
2. Se "Em branco": formulário de nome, ícone, cor → cria `custom_pipeline`
3. Redireciona para o Kanban do funil criado

### Fluxo "Criar Campanha"

1. Tela de templates:
   - Indicação, Prospecção, Reativação, Livre
   - Cada um com descrição e nº de stages sugeridos
   - Templates bloqueados por plano (futuro) mostram lock icon
2. Formulário de criação:
   - Nome, descrição, deadline
   - Stages pré-populados do template (editáveis)
   - Meta de equipe, meta individual, bônus
   - Membros participantes
   - Modo de distribuição de leads
3. Salva como `status = 'draft'`
4. Botão "Ativar campanha" → muda para `status = 'active'`, `started_at = now()`

---

## 6. Estrutura do Sidebar

### Layout novo

```
- Central de Comandos (/)
- Chat (/chat-whatsapp)
- Funis (grupo)
  ├ Oportunidades (/pipe-whatsapp)        ← de pipeline_display_config
  ├ Agendamentos (/pipe-confirmacao)       ← oculto se is_visible=false
  ├ Orçamentos (/pipe-propostas)
  ├ Carteira (/upsell)                     ← mecânica própria, dentro do grupo
  ├ [Funis customizados] (/pipe/custom/:slug)
  └ + Criar novo                           ← modal de escolha C
- Campanhas (/campanhas)                   ← APENAS campanhas temporárias
- Agenda (/agenda)
- Revisão (/follow-ups)
- Leads (/leads)                           ← renomear de "Combustível"
- Pódio (/performance)
- Comissões (/comissoes)
- Copilot (/copilot)
- Automações (/automacoes)
```

### Mudanças vs sidebar atual

| Item | Antes | Depois |
|---|---|---|
| Campanhas | Lista campanhas (mistura conceitos) | Lista só campanhas temporárias |
| Criar funil | Cria custom pipeline | Modal de escolha (Funil vs Campanha) |
| Carteira | Item separado | Dentro do grupo "Funis" |
| Labels dos pipes | Hardcoded | Lidos de `pipeline_display_config` |
| "Combustível" | Label de Leads | "Leads" |
| Funis ocultos | Não existia | Reativáveis via "Criar novo" |

---

## 7. Preparação para Gates por Plano

### Novas FeatureKeys (tudo liberado por enquanto)

| Key | Descrição | Plano futuro |
|---|---|---|
| `funnels_custom` | Criar funis customizados | starter+ |
| `carteira` | Módulo Carteira visível | automation+ |
| `campaigns_indicacao` | Template Indicação | starter+ |
| `campaigns_prospeccao` | Template Prospecção | pro+ |
| `campaigns_reativacao` | Template Reativação | pro+ |

### Novos LimitKeys (limites altos por enquanto)

| Key | Descrição | Plano futuro |
|---|---|---|
| `max_funnels` | Funis custom por org | free=1, starter=3, pro=10, enterprise=∞ |
| `max_active_campaigns` | Campanhas ativas simultâneas | free=1, starter=3, pro=10, enterprise=∞ |

### Pontos de checagem no código

| Ação | Checagem |
|---|---|
| Sidebar: Carteira | `hasFeature("carteira")` + `is_visible` |
| Criar funil custom | `checkLimit("max_funnels")` |
| Criar campanha | `checkLimit("max_active_campaigns")` + `hasFeature("campaigns_" + type)` |
| Templates bloqueados | Lock icon + "Disponível no plano X" |

---

## 8. Migração de Dados Existentes

### Campanhas existentes

1. Campanhas com `is_active = true` → `status = 'active'`, `started_at = created_at`
2. Campanhas com `is_active = false` → `status = 'ended'`, `ended_at = updated_at`
3. Todas recebem `campaign_template_type = 'livre'`
4. Campo `objective` mantido por compatibilidade mas não mais usado pelo frontend

### Orgs existentes (sem quiz)

Migration cria `pipeline_display_config` com defaults para todas as orgs:
- `whatsapp`: display_name="Oportunidades", is_visible=true, position=1
- `confirmacao`: display_name="Agendamentos", is_visible=true, position=2
- `propostas`: display_name="Orçamentos", is_visible=true, position=3
- `upsell`: display_name="Carteira", is_visible=true, position=4

### Orgs futuras (com quiz)

`pipeline_display_config` é gerada pelo quiz com nomes e visibilidade customizados.

---

## 9. Fases de Implementação

### Fase 1 — Backend (migrations + RPCs)
1. Criar tabela `pipeline_display_config`
2. Alterar tabela `campanhas`: adicionar `status`, `campaign_template_type`, `started_at`, `ended_at`, `end_action`
3. Adicionar novas feature/limit keys (tudo liberado)
4. Migration de dados: campanhas existentes + display_config para orgs existentes

### Fase 2 — Sidebar e renomeação
1. Sidebar lê `pipeline_display_config` para labels e visibilidade
2. Carteira entra dentro do grupo "Funis"
3. "Combustível" → "Leads"
4. "Criar novo" abre modal de escolha

### Fase 3 — Experiência de criação
1. Modal de escolha (design C: mini-cards + legenda)
2. Tela de templates de Funil
3. Tela de templates de Campanha
4. Formulário de criação com stages editáveis do template
5. Gates preparados (checam feature/limit, tudo retorna true)

### Fase 4 — Ciclo de vida da campanha
1. Status machine: draft → active → paused → ended
2. Modal de encerramento (mover leads ou congelar)
3. Campanhas encerradas em modo leitura
4. Analytics continuam para encerradas

### Fase 5 — Quiz e configuração automática
1. Estender `generateSuggestions()` para gerar `pipeline_display_config`
2. Mapear respostas → nomes, visibilidade, stages
3. Nova pergunta: "Quer gestão de carteira?"
4. Stage templates por contexto

---

## 10. O Que NÃO Muda

- Tabelas `pipe_whatsapp`, `pipe_confirmacao`, `pipe_propostas` — intocadas
- Rotas `/pipe-whatsapp`, `/pipe-confirmacao`, `/pipe-propostas` — mantidas
- `custom_pipelines` e infraestrutura — reutilizada como está
- Kanban dos pipes padrão — mesma UI, só labels diferentes
- Métricas da dashboard — apontam para as mesmas tabelas
- RLS e multi-tenancy — padrão existente
- Edge functions e RPCs existentes — sem breaking changes

---

## 11. Riscos e Edge Cases

| Risco | Mitigação |
|---|---|
| Campanhas existentes quebram | Migration conservadora: adiciona campos, não remove. `objective` mantido |
| Sidebar confuso com muitos itens | `is_visible` controla o que aparece. Só mostra o relevante |
| Custom pipelines vs funis padrão: dois sistemas | Mantém separados. Não unificar forçado — complexidade não justifica |
| Quiz já respondido por orgs existentes | Migration cria `pipeline_display_config` com defaults para todas as orgs |
| Campanha encerrada com leads | Modal obrigatório no encerramento: mover ou congelar |
| Performance sidebar (query extra) | 4 rows por org, cache react-query com staleTime longo |

---

## 12. Branch e Banco

- **Branch:** `feature-funis` (sem push para main ou develop)
- **Banco:** Apenas DEV (`bcfadphgsibjzivtbjvc`)
