# 47. Lista Fria: a busca de Instagram tem o tamanho dos créditos escolhidos

Date: 2026-10-30

## Status

Accepted (CTO, 2026-10-30). Ajusta o ADR-0046 (reserva fixa de 50 créditos Meta). Cobrança por seguidor varrido, devolução de metade e auditoria de custo **não mudam**.

## Context

O ADR-0046 fixou a reserva do Instagram em 50 créditos Meta, porque em 28/10 o Actor parou em ~50 seguidores por conta-alvo e atribuímos o teto ao acesso sem login do Instagram. Em 30/10 duas buscas reais mostraram que não era isso: terminaram em `TIMED-OUT` com `timeoutS: 300` (30 e 37 itens), por uma falha de fiação do prazo (corrigida no #2425). O teto de 50 era **configuração nossa** (`maxPages: 1`, `maxItems: 50`); o cadastro do Actor aceita até 100 páginas (~5.000 contas). Que ele entregue acima de 50 **ainda não foi medido**.

## Decision

1. **A busca de Instagram reserva o que o cliente escolhe**, de 10 a 1.000 créditos Meta (1 crédito = 1 seguidor varrido). Abaixo de 10 não vale a execução; acima de 1.000 ainda não foi medido.
2. O worker pede à Apify **exatamente** o reservado (`maxItems` = reserva, `maxPages` = ⌈reserva ÷ 50⌉), sem arredondar para a página, e lê no máximo a reserva.
3. `INSTAGRAM_MAX_SEGUIDORES` padrão 1.000 e `APIFY_MAX_USD_POR_BUSCA` padrão 15 (1.000 seguidores custam ~US$ 12). O freio por busca continua `min(teto, itens × preço × 1,15)`.
4. Se a Apify entregar menos do que o reservado (conta pequena, prazo, bloqueio), a busca conclui com o que veio, **o cliente paga só o varrido** e a sobra volta. Isso já era assim.
5. A tela volta a ter o campo de créditos no Instagram ("Seguidores a analisar"), com o preço do que foi escolhido (créditos × R$ 0,15) e o aviso do risco.

## Consequences

- **Risco de promessa:** se o Actor não entregar acima de 50, quem pedir 500 recebe ~50 e a sobra volta. Não há prejuízo financeiro, mas a expectativa é maior que a entrega. A primeira busca grande de teste deve medir isso antes de divulgar.
- **Custo nosso por busca sobe até US$ 12** no teto, em troca de receita proporcional (R$ 150). A devolução de metade quando não vem nenhum contato limita a perda de uma busca grande sem resultado a metade da receita.
- **Prazo:** 20 s por conta; 1.000 seguidores = 20.000 s (5,5 h), no limite de 6 h do executor. Busca grande ocupa o worker (uma por vez) por horas.
- **Imagem do worker e variáveis do EasyPanel** precisam subir juntas com a migration: sem `INSTAGRAM_MAX_SEGUIDORES`/`APIFY_MAX_USD_POR_BUSCA` novos, o compose antigo fixa 50 e US$ 2, e a busca grande entrega só 50 (seguro, mas não é o prometido).
