---
title: Protocolo de Execução
type: protocolo
status: ativo
tags:
  - protocolo
  - obrigatorio
updated_at: 2026-04-13
---

# Protocolo de Execução de Agentes

Este protocolo é **obrigatório**. Toda task de desenvolvimento passa pelas 3 fases abaixo antes de qualquer ação. Sem exceção.

O protocolo é executado **automaticamente** - a seção "Team de Agentes" no `CLAUDE.md` garante que o Conductor é invocado em toda task. O usuário não precisa invocar nada manualmente.

---

## Fase 1 - Triagem

O Conductor (skill `agent-conductor`) analisa a task:

1. **Classifica o domínio** - qual parte do sistema é afetada
2. **Seleciona agente(s)** - qual especialista é o mais adequado (ver tabela em [[README]])
3. **Determina escopo** - Small/Medium/Large/Complex via `tlc-spec-driven`
4. **Define ordem** - se cruza domínios, define sequência de execução

Se a task cruza domínios (ex: mudança de schema + UI), todos os agentes envolvidos são identificados e a ordem segue dependências:
```
Architect → DBA → Backend → Frontend → QA
```

---

## Fase 2 - Execução

Com agente ativado e SDD configurado:

1. **Carrega contexto** - o agente lê `.specs/` e Obsidian conforme definido em suas instruçoes
2. **Segue SDD** - `tlc-spec-driven` guia o fluxo: Specify → (Design) → (Tasks) → Execute
3. **Invoca skills incorporadas** - cada agente tem skills específicas (TDD, debugging, design validation, etc.)
4. **Respeita regras** - os "NUNCA" e "SEMPRE" de cada agente são inegociáveis

---

## Fase 3 - Documentação

Após resolver a task:

1. **SDD** - `.specs/` já foi atualizado durante a execução (spec, design, tasks)
2. **Obsidian** - Atualizar notas relevantes:
   - Feature notes em `06 - Features/<domínio>/<feature>.md`
   - Changelog diário em `07 - Changelog/YYYY-MM-DD.md`
   - Backlog em `08 - Backlog/` (mover de `em-progresso/` para `concluido/` se aplicável)
   - Decisoes em `04 - Decisoes/` (se decisão arquitetural foi tomada)
3. **STATE.md** - Registrar decisoes, blockers, e liçoes em `.specs/project/STATE.md`

---

## Resumo Visual

```
Task
 │
 ├─ 1. TRIAGEM ──────── Conductor classifica domínio, seleciona agente(s), define escopo SDD
 │
 ├─ 2. EXECUÇÃO ─────── Agente opera com persona + SDD + skills + contexto
 │
 └─ 3. DOCUMENTAÇÃO ─── .specs/ + Obsidian + STATE.md atualizados
```

---

## Navegação Relacionada

- [[README]] - agentes disponíveis e tabela de roteamento
- [[00 - INDEX]] - índice geral do vault
