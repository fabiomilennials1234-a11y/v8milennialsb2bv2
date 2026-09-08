---
type: changelog
title: Lei da Relação com ganho e perdido
status: active
created: 2026-09-08
tags: [leads, pipelines, migration]
owner: gabriel
---

# Lei da Relação com ganho e perdido

Banco aplicado em produção; frontend será liberado pelo merge do PR #2043.

Decisão do CTO: Cliente exige ganho. Ganho prevalece sobre perdas. Perdido
recebe apenas quem tem negócios perdidos e nenhum aberto ou ganho. Quem não
fechou negócio permanece Lead. Pedido de ERP isolado não promove a Cliente
na Lei da Relação; a Lei do ERP mantém sua classificação própria.

O cálculo antigo de primeira venda aceitava `sale_lost`: 1.362 marcas sem venda
líquida confirmadas por leitura em produção. Nova migration filtra `sale`, e o
campo calculado `relacao_negocios(leads)` governa lista, contagens e exportação.
Seletor ganha Perdido; menu de classificação manual é exclusivo da Lei do ERP.

Teste PostgreSQL em preview usa transação desfeita, incluindo grants e RLS.
Recuperação de marcas antigas é separada, com backup. Migration precede o
frontend e exige autorização de produção antes do apply.

Detalhes: `.specs/fixes/lei-relacao-ganho-perdido.md`.

## Aplicação em produção

- Autorização explícita na sessão: “Aplique tudo em prod e faça o merge, quero disponibilizar isso para os usuários”.
- Migration aplicada em 2026-09-08 17:37:41 UTC, ref `jsjsmuncfkbsbzqzqhfq`.
- Ledger: `20271018000000`, nome `lead_relacao_ganho_perdido`; versão confere com o arquivo.
- SHA-256: `9521330af8b27ff49d7eaf354a4109e55cb068a6f5d1eb72565081a829e209a1`.
- Recuperação: 1.362 registros corrigidos, com valores anteriores em `backup.lead_first_sale_20260908`.
- Smoke PostgREST: os três filtros retornam sucesso; amostra Chiquê contém 4.266 Leads, 15 Clientes e 22 Perdidos.
- Grants conferidos: authenticated pode ler o campo; anon não pode; authenticated não pode executar o recálculo de escrita.
