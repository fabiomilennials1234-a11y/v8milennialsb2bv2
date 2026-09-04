---
type: changelog
title: "SCRUM-674 — RPCs deixam de escrever pelos espelhos"
status: shipped
created: 2026-09-04
updated: 2026-09-04
tags: [changelog, migration, funis, postgres]
related: []
owner: gabriel
branch: feat/674-invariantes-viram-funcao
pr: pendente
---

# 2026-09-04 — RPCs deixam de escrever pelos espelhos

## Mudança

Quatro RPCs de entrada passaram a delegar a criação dos cards às funções
compartilhadas `fn_entrada_sistema_criar` e `fn_entrada_custom_criar`:

- `abrir_negocio`
- `create_lead_with_pipe`
- `create_lead_from_social_conversation`
- `import_lead_into_custom_pipeline`

Elas não escrevem mais em `pipe_whatsapp`, `pipe_confirmacao`,
`pipe_propostas` ou `custom_pipe_entries`. O único escritor SQL restante pelos
espelhos é `sync_responsible_from_lead_to_pipes`, reservado para a janela 2 do
passo 3 da SCRUM-674.

## Apply em PROD

- Migration: `20271004000000_as_escritoras_saem_dos_espelhos.sql`
- PROD apply: `2026-09-04T19:33:16Z`
- Autorizador: Gabriel, explicitamente nesta sessão
- SHA-256: `51cbba172c0397e90df1ce26f066b3c951bfb95738419057ebdbeed4f999467d`
- Ledger: migration e registro gravados na mesma transação; versão confirmada
  uma vez e no topo

## Provas

- A/B transacional em PROD: 8/8 caminhos idênticos antes/depois.
- Negativos de tenancy: as quatro RPCs continuaram recusando acesso cruzado.
- Rollback executado em PROD: 4/4 corpos e atributos restaurados.
- Bundle final ensaiado com `ROLLBACK` antes do apply real.
- Pós-commit em conexão nova: 4/4 RPCs delegando, 0/4 escrevendo pelos
  espelhos, uma escritora global restante (`sync_responsible_from_lead_to_pipes`).
- ACL, `SECURITY DEFINER` e `search_path` preservados byte a byte no apply.

## Desvio de QA

Não existe ambiente preview disponível. O QA foi substituído por baseline de
PROD, A/B dentro de transação, rollback executado, apply atômico com guardas e
verificação imediata por conexão nova.

## Débito encontrado

`create_lead_with_pipe` já referenciava `leads.meeting_date`, coluna removida.
O A/B neutralizou somente essa referência nos dois lados para medir a troca dos
escritores sem alterar comportamento fora desta janela. Correção funcional exige
card separado.
