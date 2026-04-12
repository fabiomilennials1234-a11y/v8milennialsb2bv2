---
tags:
  - claude-code
  - feature
  - torque-crm
  - admin
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Onboarding

## O que faz

Wizard de 6 steps para novas orgs: Perfil → Estrutura → Processo → Configuracao → Ativacao → Revisao. Gera sugestoes de config automaticamente baseado nas respostas do quiz.

## Regras de negocio

- Status: pending → in_progress → completed / skipped
- Sugestoes geradas client-side (generateSuggestions, pipeline-config-from-quiz)
- Pode ser pulado (skip)
- Respostas salvas como JSON no banco
- Aplicacao de config acontece na step Revisao

## Como o usuario usa

1. Primeiro login → OnboardingGate redireciona para wizard
2. Responde 6 steps de perguntas sobre o negocio
3. Sistema gera sugestoes de pipelines, automacoes, configs
4. Revisao → aplica configs sugeridas
5. CRM configurado e pronto para uso

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Onboarding.tsx` — Pagina com guards
- `src/components/onboarding/OnboardingWizard.tsx` — Orquestrador (6 steps)
- `StepPerfilOperacao.tsx` — Tipo produto, segmento, ticket
- `StepEstruturaComercial.tsx` — Tamanho time, SDR/Closer
- `StepProcessoVendas.tsx` — Modo apresentacao, ciclo, propostas
- `StepConfiguracaoInicial.tsx` — Config inicial
- `StepAtivacao.tsx` — Ativacao
- `StepRevisao.tsx` — Revisao e aplicacao
- `OnboardingGate.tsx` — Guard de redirect
- `OnboardingQuestion.tsx` — Componente de pergunta

### Hooks

- `useOnboarding()` — saveStepAnswers(), complete(), skip(), markApplied(), update()

### Tabelas

- `org_onboarding` — status, current_step, answers JSON, applied_at, completed_at, completed_by

---

## Historico de mudancas

## Links relacionados

- [[Configuracoes]]
- [[Funis Hub]]
