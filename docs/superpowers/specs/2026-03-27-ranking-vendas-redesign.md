# Ranking de Vendas — Design Spec

**Data:** 2026-03-27
**Objetivo:** Unificar Ranking + Metas + Prêmios em uma experiência única "Ranking de Vendas" com gamificação forte, competições por colocação, e adaptação para TV Dashboard. Corrigir bug da foto de perfil no pódio.

---

## 1. Nova Estrutura de Tabs

| Antes (4 tabs) | Depois (2 tabs) |
|---|---|
| Ranking | **Ranking de Vendas** (unificado) |
| Metas | (integrado no ranking) |
| Prêmios | (integrado no ranking) |
| Gestão | **Gestão** (admin only, + seção Competições) |

## 2. Modelo de Dados — Competições

### Tabela `competitions`
- id, organization_id, name, description
- criteria: 'absolute_value' | 'goal_percentage'
- metric_type: 'sales' | 'meetings'
- month, year, start_date, end_date
- status: 'draft' | 'active' | 'ended'
- created_by, created_at, updated_at

### Tabela `competition_participants`
- id, competition_id FK, team_member_id FK, created_at

### Tabela `competition_prizes`
- id, competition_id FK, position (1-5)
- prize_name, prize_description, prize_value, prize_icon
- created_at

### Lógica de ranking
- Usa RPC `get_ranking_data` existente
- Frontend filtra por participantes da competição
- Se criteria='goal_percentage' → reordena por goalProgress DESC
- Se criteria='absolute_value' → mantém ordem por value DESC

## 3. Layout — Ranking de Vendas

### Pódio top 3 (cards verticais)
- 1º: borda dourada, glow pulsante, crown, card maior
- 2º: borda prata, slide-in esquerda
- 3º: borda bronze, slide-in direita
- Prêmio embaixo de cada card (desbloqueado se ≥100% meta, senão semi-transparente)

### Lista 4º+ (horizontal compacta)
- Posição + avatar + nome + valor + barra progress + %
- Flame se ≥80%, seta ↑↓ vs dia anterior

### Animações de eventos
- Subida de posição: spring + flash na borda
- Meta batida: confetti + ring verde + badge "META BATIDA!"
- Nova venda: pulse no valor + barra avança
- Troca de liderança: coroa desce + flash dourado
- Competição encerrada: confetti geral + modal parabéns

## 4. Gestão — Competições

### Criação (4 steps)
1. Básico: nome, mês/ano, critério, tipo
2. Participantes: checkboxes de vendedores
3. Prêmios: 1-5 posições com emoji + nome + valor
4. Confirmação: resumo visual

### Regras
- Editar ativa: pode mudar nome/descrição/prêmios, não participantes/critério
- Sem participantes: não permite ativar
- Sem prêmios: permite ativar (ranking puro)

## 5. TV Dashboard

- Bloco central substituído por ranking de competição
- Fonts 2x, cards com floating idle, badge "AO VIVO"
- Auto-rotate Closers/SDRs a cada 30s
- Flash no card que atualiza
- Sem competição ativa: ranking puro com metas

## 6. Bug da Foto de Perfil

**Causa:** Performance.tsx linha 670 — `podiumUsers` não inclui `avatarUrl: avatarMap.get(c.id)`
**Correção:** Adicionar o campo ao mapeamento

## 7. Branch e Banco
- Branch: `feature-podio`
- Banco: DEV only
