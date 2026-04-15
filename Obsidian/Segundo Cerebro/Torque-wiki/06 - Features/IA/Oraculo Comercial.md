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

# Oraculo Comercial

## O que faz

Coaching IA e forecasting de vendas. Analisa conversation summaries e metricas do time (reunioes para SDRs, receita para closers). Gera recomendacoes personalizadas, estrategias de objecao, e previsoes de performance.

## Regras de negocio

- Rate limiting via `oraculo_usage` por org (previne abuso)
- Usa OpenRouter LLM para geracao de insights
- Respostas baseadas em dados reais do CRM (nao inventados)
- Disponivel apenas na tab Inteligencia do Dashboard

## Como o usuario usa

1. Dashboard → Tab Inteligencia
2. Chat interativo com Oraculo
3. Faz perguntas sobre performance, objecoes, estrategia
4. Recebe recomendacoes contextuais baseadas nos dados reais

## Edge cases

- Rate limit atingido → mensagem de erro amigavel
- Sem conversation summaries → respostas mais genericas
- Dados insuficientes (org nova) → coaching limitado

---

## Como funciona (tecnico)

### Componentes

Integrado no Dashboard (`TabInteligencia.tsx`), chat interativo com input e historico.

### Hooks

- `useOraculoChat()` - Gerencia estado do chat e invocacao da edge function

### Edge Functions

- `oraculo-comercial` - Recebe pergunta + contexto, consulta summaries e metricas, gera resposta via OpenRouter LLM

### Tabelas

- `conversation_summaries` - summary, key_points, sentiment, lead_temperature, objections, questions_asked, next_action, coaching_tips
- `oraculo_usage` - Rate limiting por org (count, last_used)

### Fluxo de dados

```
Usuario faz pergunta no chat
  → Frontend invoca edge function oraculo-comercial
    → Busca conversation_summaries recentes
      → Busca metricas do time (pipes, leads, conversao)
        → Monta prompt com contexto real
          → OpenRouter LLM gera resposta
            → Retorna para o chat → exibe ao usuario
```

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[OpenRouter Setup]]

- [[Dashboard]]
- [[Copilot]]
