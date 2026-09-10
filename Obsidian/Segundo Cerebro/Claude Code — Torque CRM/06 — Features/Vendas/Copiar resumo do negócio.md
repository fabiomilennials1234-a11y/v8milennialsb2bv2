---
type: feature
title: Copiar resumo do negócio
status: active
created: 2026-09-10
updated: 2026-09-10
tags: [negocios, produtividade]
---

# Copiar resumo do negócio

O card atual de negócio (`DealCardPanel`) oferece **Copiar resumo** na barra de ações. A ação reúne dados persistidos, gera texto simples e copia para o clipboard. Não usa IA nem envia mensagem a terceiros.

## Conteúdo

Identificação e campos preenchidos, tags, responsáveis por pré-venda e venda, pré-qualificação e qualificação, pipelines e estágios, campos personalizados, orçamentos e produtos, reuniões, comentários, checklists, origem/rastreamento e histórico. Responsáveis e classificações ausentes aparecem como “Não definido”. Valores zero e booleanos negativos são preservados. Campos vazios são omitidos.

Comentários mantêm autor, data/hora e texto integral. Comentários apagados são excluídos. Eventos de criação/exclusão de comentários não duplicam o bloco de comentários. Coleções são paginadas em lotes de 500, sem limite total artificial.

## Consistência e acesso

Consultas usam a sessão autenticada, RLS e organização atual. Tabelas filhas sem organização usam IDs de pais autorizados. Falhas abortam a operação; nenhum resumo parcial é copiado. Acesso ao lead é checado novamente ao fim. Mudança no `updated_at` do lead, entrada ou negócio durante leitura exige nova tentativa.

Campos com edição pendente sinalizam `data-summary-pending` no modal. O botão verifica essa sinalização e mutations em andamento antes e depois da leitura. Anotação, edição de produtos e comentários sinalizam pendências. Novos editores devem sinalizar pendências para preservar esse contrato. O botão descarta resultados se o card fechar ou seu contexto mudar.

Navegadores que bloqueiam clipboard recebem diálogo com texto integral selecionável para cópia manual. Sucesso só é informado após `writeText` concluir.

## Escopo

Disponível no card atual aberto pelos funis e lista de leads. Consulta a entrada aberta, `deals` e `deal_items`; usa a mesma conta de total/desconto e mesma interpretação de reunião do card. Estágios são resolvidos por pipeline e UUID/slug. Comentários de outro negócio são identificados, checklists ficam limitados ao negócio aberto e à pessoa. Modais legados não são alterados. Não requer migration, Edge Function ou mudança de permissões.

## Verificação

Testes em `src/modules/leads/components/lead-detail/modal/summary/` cobrem formato, níveis de qualificação, responsáveis, campos vazios/zero/booleanos, paginação, falhas de consulta/acesso, interação, edição pendente e fallback do clipboard. Regressões adjacentes cobrem orçamento, reunião, campos personalizados e feed de atividade.
