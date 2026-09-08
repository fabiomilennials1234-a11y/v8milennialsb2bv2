---
type: changelog
title: Lei da Relação com ganho e perdido
status: draft
created: 2026-09-08
tags: [leads, pipelines, migration]
owner: gabriel
---

# Lei da Relação com ganho e perdido

Implementação em revisão; **não aplicada em produção**.

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
