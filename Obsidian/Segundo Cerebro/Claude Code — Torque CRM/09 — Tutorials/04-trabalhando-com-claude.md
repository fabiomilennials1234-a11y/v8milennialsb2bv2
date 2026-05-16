---
type: tutorial
title: Trabalhando com Claude Code + Subagentes
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [tutorial, claude-code, subagentes, agente]
related: ["[[Subagentes]]", "[[03-tour-vault]]"]
owner: gabriel
audience: dev-novo
estimated_time_min: 30
---

# Trabalhando com Claude Code + Subagentes

> Como aproveitar os 3 subagentes (arquiteto, design, engenheiro) e o vault
> para acelerar desenvolvimento sem perder qualidade.

## O que você vai aprender

- Quando usar cada subagente
- Como o JIT context funciona
- Como dar contexto eficiente
- Quando NÃO usar Claude

## Pré-requisito

- Claude Code CLI instalado: `claude` no terminal
- Subscription Anthropic ativa
- Ler [[Subagentes]] antes

## Pipeline básica

```
CTO → arquiteto → [design | engenheiro | ambos] → arquiteto (commit+push) → CTO
```

`arquiteto` = entry/exit. Não implementa. Roteia + commita.
`design` = UI/UX world-class. Spec visual.
`engenheiro` = fullstack. Implementação completa.

## Quando invocar cada um

| Sua intenção | Subagente | Exemplo |
|---|---|---|
| Decisão estratégica | arquiteto | "Vale adicionar gamificação?" |
| Bug fix backend | engenheiro | "Botão save não invalida query" |
| Refino visual | design | "Modal de reagendar tá feio" |
| Feature completa nova | design + engenheiro | "Página nova de forecasting" |
| Migration sensível | engenheiro (com flag) | "Muda RLS de products" |

Default: invoca `arquiteto`. Ele roteia.

## JIT context — o segredo da eficiência

Karpathy: *"context window = RAM"*. Encher de lixo degrada.
Anthropic: *"smallest possible set of high-signal tokens"*.

Estratégia do Torque:
- **CLAUDE.md** root: <250 linhas, princípios + gotchas críticos
- **Sub-CLAUDE.md** em módulos: contexto local (planejado F4)
- **Vault Obsidian**: RAM externa, agente acessa via grep/read on-demand

Você **não precisa** colar contexto manual no prompt. Agente busca o que precisa.

## Como dar prompt eficiente

❌ Ruim:
```
Tem um bug no botão de salvar
```

✅ Bom:
```
Em PipeConfirmacao.tsx, o botão "Salvar" não invalida a query de leads após
update. Sintoma: lead atualizado não aparece no kanban até refresh.
Comportamento esperado: invalidação automática (como em PipeWhatsapp).
Suspeito: useUpdatePipeConfirmacao.ts não chama queryClient.invalidateQueries.
```

Bom prompt = problema + sintoma + comportamento esperado + suspeita.

## Skills úteis

| Skill | Quando |
|---|---|
| `/arquiteto` | Decisões arquiteturais |
| `/design` | UI/UX work |
| `/engenheiro` | Implementação |
| `/hm-engineer` | Validar código (todas camadas) |
| `/hm-designer` | Validar interface |
| `/hm-qa` | QA pré-merge |
| `/hm-align` | Checar se é a coisa certa pra construir |

## Regras invioláveis

1. **Default = dev.** Prod (deploy edge fn / migration) só com autorização
   explícita do CTO na sessão. Memória persiste.
2. **Push sempre em branch nova.** Nunca direto em main/develop.
3. **arquiteto commita.** Não você. Não o engenheiro.
4. **Vault tem proteção 8 camadas.** Veja CONTRIBUTING.md.

## Anti-patterns

❌ Pedir agente pra deletar muitos arquivos sem revisar — pode quebrar wikilinks
❌ Confiar 100% no agente em mudança sensível (auth/RLS) sem review humano
❌ Pular branch nova "só dessa vez"
❌ Aprovar deploy prod sem revisar diff
❌ Não atualizar vault depois de mudança grande — divergência cresce

## Como o agente lê o vault

Quando trabalhando em feature WhatsApp, agente naturalmente:
1. Lê `06 — Features/Chat/whatsapp-stability-plan.md`
2. Lê `02 — Arquitetura/Areas Frageis.md`
3. Lê `05 — How-to/debug-whatsapp.md`
4. Lê `03 — Reference/Edge Functions.md`

Sem você pedir. JIT via grep/Read tools.

## Loop de feedback

Após cada task:
- Agente atualiza changelog em `07 — Changelog/`
- Agente atualiza feature doc se mudou comportamento
- Agente abre ADR se decisão arquitetural

Você revisa. Aprova. Merge.

## Quando NÃO usar Claude

- Tarefas que dependem de contexto humano puro (pricing, parceria, hire)
- Decisão de produto não técnica
- Comunicação com cliente
- Refactor exploratório sem critério claro de sucesso (gera bagunça)
- Tasks <5min — overhead de spinup não vale

## Recapitulação

Você sabe:
- Pipeline dos 3 subagentes
- Quando invocar cada
- JIT context (não cole vault manual no prompt)
- Como fazer prompt eficiente
- Skills disponíveis
- Regras invioláveis

## Próximo passo

Tente uma task real. Sugestão:
1. Pegue backlog item LOW
2. Invoca `arquiteto`
3. Deixa rotear pra engenheiro
4. Revisa diff + commit
5. PR aberto pelo arquiteto
6. Aprova + merge

Ao final, atualize este tutorial se aprendeu algo novo. Vault é vivo.
