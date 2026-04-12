---
tags:
  - claude-code
  - feature
  - torque-crm
  - ia
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Lead Score

## O que faz

Score automatico 0-100 via IA. Analisa atributos do lead (nome, empresa, origem, segmento, faturamento, urgencia, rating, idade, telefone/email), progressao em pipes, e historico de interacoes. Roda individual ou batch (leads sem score recente >24h).

## Regras de negocio

- Score de 0 a 100 (qualification_score no lead)
- Factors armazenados como JSONB para explicabilidade
- `predicted_conversion` separado do score (0-100)
- Batch processa leads sem score recente (>24h)
- Score alimenta workflow triggers (`score_reached`) e priorizacao em campanhas
- `recommended_action` sugere proximo passo

## Como o usuario usa

Automatico — score calculado em background. Visivel no detalhe do lead, dashboards, e analytics. Admin pode forcar recalculo individual. Workflows podem usar score como trigger.

## Edge cases

- Lead sem dados (nome vazio, sem empresa) recebe score baixo
- Score nao atualiza automaticamente quando lead muda (precisa recalculo)
- Batch pode demorar se muitos leads sem score

---

## Como funciona (tecnico)

### Hooks

- `useLeadScore(leadId)` — Score de um lead
- `useLeadScores()` — Lista todos os scores
- `useCalculateLeadScore()` — Trigger calculo individual
- `useCalculateBatchScores()` — Trigger batch
- `useLeadScoresMap()` — Indexed lookup para performance

### Edge Functions

- `calculate-lead-score` — Recebe lead data, analisa via OpenRouter LLM, retorna score + factors + predicted_conversion + recommended_action

### Tabelas

- `lead_scores` — lead_id (UNIQUE), score (0-100), factors JSONB, predicted_conversion (0-100), recommended_action, last_calculated, created_at, updated_at

### Fluxo de dados

```
Trigger (manual ou batch)
  → Edge function calculate-lead-score
    → Busca dados do lead (atributos, pipes, interacoes)
      → OpenRouter LLM analisa e gera score
        → UPSERT lead_scores (score, factors, prediction)
          → Score visivel no frontend
            → Workflows podem reagir (trigger score_reached)
```

---

## Historico de mudancas

## Links relacionados

- [[Copilot]]
- [[Workflow Builder]]
- [[Pipe WhatsApp]]
