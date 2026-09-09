---
type: changelog
title: "Oráculo · Onda 1 — a espinha e a autoria da mensagem"
status: shipped
created: 2026-08-31
updated: 2026-08-31
tags: [changelog, copilot, oraculo, permissions, whatsapp]
related: []
owner: gabriel
branch: feat/oraculo-onda-1
pr: ""
---

# 2026-08-31 — Oráculo · Onda 1

SCRUM-588: SCRUM-593 (autoria da mensagem enviada) e SCRUM-594 (espinha do
Oráculo). Regidos por ADR-0032 e ADR-0033.

## O que passa a existir

**Escopo resolvido no servidor.** `admin` e Master alcançam a organização;
`member` alcança o que atende. Derivado do JWT, nunca do corpo. Fecha o
vazamento em que qualquer `member` recebia o ranking, as conversas dos colegas e
os negócios perdidos da organização inteira.

**Conversa com memória.** `oraculo_conversations` + `oraculo_turns`: últimos
turnos na íntegra mais um resumo acumulado. A segunda pergunta deixa de
esquecer a primeira.

**Uma ferramenta.** `oraculo_metricas`, consultada sob demanda pelo laço de
function-calling, no lugar do dump fixo de seis consultas montado antes de saber
a pergunta. Receita sai de `sale_events`, líquida de estornos (ADR-0017).

**Teto que permite explorar.** 25 turnos do usuário por dia, ajustável por
organização em `organizations.oraculo_daily_turn_limit`. O teto antigo era 3.

**Procedência e telemetria.** Cada turno grava modelo, tokens, ferramentas
consultadas, ferramentas recusadas e latência. Foi a ausência disso que deixou
81 perguntas em cinco meses passarem despercebidas.

**Rota própria.** `/oraculo`, tela cheia, histórico reabrível. A função antiga
(`oraculo-comercial`) continua no ar — a contração é a Onda 5 (SCRUM-606).

## O achado que muda o alcance do SCRUM-593

O ticket assume que gravar o autor no caminho de envio dá dono à atividade do
vendedor. Medido em prod, 30 dias:

| | |
|---|---|
| Mensagens humanas `outgoing` | 268.735 |
| Saíram pela caixa do CRM | **53 — 0,020%** |
| Orgs que enviam / que usam a caixa | 31 / **2** |
| Instâncias que enviam / com dono único | 101 / **5 (1,5% das msgs)** |

Por origem (7 dias): `unknown` 27.526 · `web` 24.642 · `android` 9.293 · `ios`
200. O vendedor conversa pelo WhatsApp dele; o provedor espelha para cá. O CRM
quase nunca é o remetente, e a instância é da empresa, não da pessoa.

A autoria foi implementada assim mesmo — não há backfill, e ADR-0033 §4 manda —
mas **a dimensão `pessoa` do Gargalo (SCRUM-604) não fica desbloqueada por esta
fatia**. O que fazer com os 99,98% restantes é decisão de produto.

## Como a autoria viaja

O proxy manda o `team_members.id` em `track_id`; o provedor ecoa no payload do
webhook; o webhook lê de volta e grava `sent_by_team_member_id`. Sem fila e sem
casar dois espaços de id depois — que nesta base já rendeu zero coincidências.
`send-meta-message` grava direto, porque ali a linha nasce no próprio envio.

## Furo encontrado pelo teste

`oraculo_turns` e `oraculo_conversations` nasceram com `INSERT/UPDATE/DELETE`
para `authenticated` e `SELECT` para `anon` — o DEFAULT PRIVILEGES do
`supabase_admin` concede tudo em toda tabela nova de `public`. A RLS barrava o
efeito, mas o grant não deveria existir. Revogado na migration, com asserção.

## Verificação

- 795 casos Deno (`test:edge`), incluindo 34 novos do Oráculo e da autoria.
- 29 asserções pgTAP contra uma branch do Supabase com as migrations aplicadas.
- Delta de typecheck zero; lint sem erros.
- Controle positivo executado nas guardas de segurança: sabotagem deixa vermelho.
