# Processo de fix por Chamado

Fonte canônica do processo. A skill `/chamado-diagnosticar`, o painel de
Diagnóstico no Suporte do master e a tool `support.record_diagnosis` do
torque-mcp seguem este documento. Mudou aqui, muda lá.

## As 4 etapas

| # | Quem | O quê | Onde |
|---|------|-------|------|
| 1 | Cliente | Abre o Chamado no CRM | dock de suporte → `support_tickets` |
| 2 | Dev (diagnóstico) | Roda `/chamado-diagnosticar <ticket_id>` no Claude Code: lê o Chamado, investiga o sistema, acha a causa | Claude Code + torque-mcp (só leitura) |
| 3 | Claude Code | Monta o diagnóstico + prompt de resolução e grava no Chamado | `support.record_diagnosis` → `support_ticket_diagnoses` |
| 4 | Dev operacional | Responde o cliente e executa o prompt | Master → Suporte → Chamado → painel **Diagnóstico** |

A etapa 4 não pede investigação. Quem a executa faz três coisas, nesta ordem:

1. **Usar resposta sugerida** → revisa → Enviar (o cliente recebe a resposta).
2. **Copiar setup** → cola no Claude Code (`/model …` e `/effort …`).
3. **Copiar prompt** → cola no Claude Code. No fim, **Execução** → desfecho + custo real (`/cost`).

O comando da etapa 2 aparece no próprio painel, pronto para copiar, enquanto o
Chamado não tem diagnóstico.

## Por que este formato

O desenho segue um estudo controlado de harness para agentes de código
(arXiv 2609.20804, *An Empirical Study of Harness Design for Coding Agents*,
176 configurações, SWE-Bench Verified + Terminal-Bench 2.1). O que ele mediu e
como entra aqui:

| Achado do estudo | Como o processo usa |
|---|---|
| Planejamento sustenta o modelo fraco (+11,6 pp) e, no forte, **corta custo** (~30%) tirando verificação redundante pós-edição | Todo prompt traz plano por fase **e** keystones com o comando que prova cada um — critério de parada definido antes. Verificação roda uma vez, no fim. |
| Ferramentas estruturadas ajudam o modelo fraco; bash-only barateia o forte | Subagente Haiku (`chamado-scout`) recebe só Read/Grep/Glob. A sessão forte tem bash livre. |
| Gestão de contexto vale pela janela; a mais barata é **cortar por regra antes de resumir** | Saída grande vai para arquivo, no contexto fica o caminho. Busca ampla vai para subagente e só a conclusão volta. |
| Recuperar conteúdo cortado quase nunca é usado e não melhora acurácia | Nenhum índice ou "memória por garantia" no prompt. |
| Detecção de loop: aviso em 5 chamadas idênticas, corte em 8 falhas | Regra de parada no prompt: 3 falhas iguais → muda abordagem; 5 → para e reporta. |
| Nenhum componente é bom por padrão — depende de modelo, task e orçamento | Matriz de roteamento por complexidade + registro do desfecho e custo real para calibrar. |

O estudo não testou modelos Claude. A matriz abaixo é o ponto de partida; o
custo real e o desfecho gravados em cada execução são o que a recalibra.

## Matriz de roteamento

Modelo e effort da **sessão de execução** (etapa 4), por tipo e complexidade.
Espelhada em `src/modules/identity/master/lib/ticket-diagnosis.ts` (`routeFor`).

| Complexidade | fix / feature | configuração / dúvida |
|---|---|---|
| trivial | sonnet · low | haiku · low |
| baixa | sonnet · medium | haiku · medium |
| média | opus · medium | sonnet · medium |
| alta | opus · high | sonnet · high |
| crítica | opus · xhigh | sonnet · high |

- **Código nunca vai para o Haiku**: um fix errado em produção custa mais que o token economizado.
- **Fable fica fora da matriz.** Só por escolha explícita, com o porquê escrito no prompt.
- Desviar da matriz é permitido. O painel sinaliza "acima/abaixo da matriz" e o prompt diz o motivo.

Como medir a complexidade:

| Nível | Sinal |
|---|---|
| trivial | 1 arquivo, mudança óbvia (texto, flag, valor), sem migration |
| baixa | 1–3 arquivos, causa confirmada, teste unitário cobre |
| média | várias camadas (front + hook + SQL) ou causa só parcialmente confirmada |
| alta | migration, RLS, trigger, edge function ou dado em produção envolvido |
| crítica | multi-tenant, segurança, perda de dado, ou incidente ativo em várias orgs |

## Estimativa de custo

`custo ≈ tokens_entrada × (0,85 × preço_cache + 0,15 × preço_entrada) + tokens_saída × preço_saída`

Orçamento de tokens por complexidade (ponto de partida; recalibrar pela média
de `actual_cost_usd` depois de ~10 execuções por nível):

| Complexidade | Entrada | Saída |
|---|---|---|
| trivial | 0,5 M | 10 k |
| baixa | 1,5 M | 30 k |
| média | 4 M | 80 k |
| alta | 10 M | 200 k |
| crítica | 20 M | 400 k |

Preços por 1 M de tokens (entrada / saída), conforme
<https://platform.claude.com/docs/en/about-claude/pricing>, lidos em
2026-10-01. **Confira a página antes de confiar no número.** Leitura de cache
foi tomada como 0,1 × entrada.

| Modelo | Entrada | Saída |
|---|---|---|
| haiku | US$ 1 | US$ 5 |
| sonnet | US$ 2 | US$ 10 |
| opus | US$ 4 | US$ 20 |
| fable | US$ 10 | US$ 50 |

## Template do prompt de resolução — v1

`template_version = 1` em `support_ticket_diagnoses`. Mudar o template é subir a
versão, para comparar acurácia e custo entre versões.

```markdown
# Chamado <ticket_id> — <título curto>
<!-- template v1 · <tipo> · complexidade <nível> · rota <modelo>/<effort> · estimado US$ <x> -->

## Sessão
Esta task roda em **<modelo> · effort <effort>**. Antes deste prompt o dev rodou
`/model <modelo>` e `/effort <effort>`. Se a sessão estiver em outro modelo, pare e avise.
<se desviar da matriz: uma linha com o porquê>

## Objetivo
<uma frase: o resultado observável, não a atividade>

## Contexto do Chamado
- Org: <nome> · rota: <rota> · versão: <app_version>
- Sintoma relatado: "<citação literal do cliente>"
- Reprodução: <passos mínimos>

## Diagnóstico (feito na etapa 2 — não refaça)
<evidência: arquivo:linha, query + resultado resumido, log, commit que introduziu>

## Causa raiz
<a causa, em 2–5 linhas>
Confiança: **confirmada** | **hipótese** (se hipótese, a Fase 1 confirma antes de qualquer edição)

## Escopo
- Muda: <arquivos/módulos>
- Não toca: <o que fica de fora>
- Regras do repo que se aplicam: <ex.: escrever stage_id E stage_key; RLS só-master>

## Plano
| Fase | O quê | Quem roda | Modelo · effort | Termina quando |
|---|---|---|---|---|
| 1. Confirmar | <reproduzir / confirmar a causa> | subagente `chamado-scout` | haiku · low | <evidência X> |
| 2. Teste | teste que falha antes do fix | sessão | <rota> | teste vermelho pelo motivo certo |
| 3. Implementar | <mudança> | sessão | <rota> | teste verde |
| 4. Verificar | roda cada keystone | subagente `chamado-verifier` | sonnet · low | todos verdes, output literal |

Troca de modelo e effort: as fases delegadas rodam no subagente indicado, que
fixa modelo e effort no próprio frontmatter (`.claude/agents/`). A sessão não
troca de modelo no meio. Se uma fase falhar duas vezes pelo mesmo motivo,
escale **só aquela fase**: chame o Agent com `model: "opus"`.

## Gestão de contexto
- Busca ampla (mais de 3 arquivos ou nomes incertos) vai para o `chamado-scout`; só a conclusão volta.
- Saída acima de ~2 k tokens (log, SQL, diff, suíte) vai para arquivo no scratchpad; no contexto ficam o caminho e uma linha.
- Rode só os testes dos keystones, nunca a suíte inteira.
- Não releia arquivo que já está no contexto.

## Orçamento
- Estimado: US$ <x>. Ao chegar a 1,5× (veja com `/cost`), pare e reporte o estado.
- Mesma chamada falhando 3× seguidas: mude de abordagem. 5×: pare e reporte.

## Pronto quando (keystones)
- [ ] K1 — <o que prova> · `<comando/query>`
- [ ] K2 — …
Verifique cada um **uma vez**, no fim (+1 re-run se falhar). Nada de verificação além destes.

## Entrega
- Branch nova a partir de `origin/main`: `fix/chamado-<8 primeiros do id>`; commit; PR citando o Chamado.
- Sem deploy, sem migration em produção, sem push em main.
- Resposta final: keystones com o output literal, custo (`/cost`), arquivos alterados, PR.

## Se travar
Pare e descreva: o que tentou, a evidência e o que falta. Não amplie o escopo.
```

## Registro

- Quem grava normalmente é o Claude Code, via `support.record_diagnosis`
  (dry-run → plano → `confirm_token` → aplica; auditado em `master_audit_logs`).
- Sem o torque-mcp deployado, a skill entrega o payload e o dev registra à mão
  no painel (**Ou registre o diagnóstico à mão**).
- Re-diagnosticar sobrescreve o diagnóstico e limpa o desfecho da execução.
- O cliente nunca vê o diagnóstico: RLS só-master em `support_ticket_diagnoses`
  (`supabase/tests/support_ticket_diagnoses_test.sql`).
