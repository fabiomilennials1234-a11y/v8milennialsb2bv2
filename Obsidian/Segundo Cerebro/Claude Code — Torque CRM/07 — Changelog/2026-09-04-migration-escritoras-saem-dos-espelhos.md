---
type: changelog
title: "SCRUM-674 — escritoras SQL deixam os espelhos"
status: shipped
created: 2026-09-04
updated: 2026-09-04
tags: [changelog, migration, funis, postgres]
related: []
owner: gabriel
branch: refactor/674-trigger-sai-dos-espelhos
pr: 2000
---

# 2026-09-04 — Escritoras SQL deixam os espelhos

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

## Janela 2 — trigger de responsáveis

`sync_responsible_from_lead_to_pipes`, a última escritora SQL, passou a delegar
para `fn_entrada_sistema_atualizar`. O trigger continua habilitado e preserva a
forma que os três adaptadores recebiam; `campanha_leads` continua direta porque
não é espelho.

- Migration: `20271005000000_o_trigger_sai_dos_espelhos.sql`
- PROD apply: `2026-09-04T23:15:00Z`
- Autorizador: Gabriel, pela autorização da sequência nesta sessão
- Commit: `0b6e9560`
- SHA-256: `812d958774050d31a40405fb82e317be5243b62b24e825b569a106243a69f6b7`
- Ledger: versão uma vez, no topo, no mesmo `COMMIT` da função

### Provas da janela 2

- A/B transacional: registro inteiro idêntico nos três funis e campanha.
- Linha esparsa: nulos explícitos materializados como no adaptador antigo.
- Controle positivo: alteração indevida de `assigned_to` detectada.
- Rollback: corpo, comentário, ACL, `SECURITY DEFINER`, `search_path` e trigger
  restaurados antes do apply real.
- Pós-commit: trigger `tgenabled='O'`; **zero funções SQL escrevendo pelos seis
  espelhos**.

## Medição depois da última escritora

Instrumento executado em `2026-09-04T23:15:47Z`. O banco parou de escrever pelos
espelhos, mas leitores continuam ativos: `custom_pipe_entries` +858,
`custom_pipeline_stages` +1.157, `custom_pipelines` +6.929,
`pipe_confirmacao` +1.716, `pipe_propostas` +1.742 e `pipe_whatsapp` +1.681 desde
o snapshot de 2026-09-03. Veredito: `REPROVA`; a janela de sete dias ainda não
começou. SCRUM-673 remove as chamadas de front restantes e SCRUM-639 elimina os
leitores SQL antes de um novo baseline.
