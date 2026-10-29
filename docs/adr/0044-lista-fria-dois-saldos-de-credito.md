# 44. Lista Fria: dois saldos de crédito (normal e Meta) e o preço de lista

Date: 2026-10-29

## Status

Accepted (CTO, 2026-10-29: "Custo de crédito META: R$1,00 / Custo de crédito padrão: R$0,15"). Estende o ADR-0042 (créditos) e o ADR-0043 (fonte CNPJ). Migration `20271220000000_lista_fria_creditos_meta.sql`.

## Context

O ADR-0042 criou um saldo único: 1 crédito = 1 contato novo e válido, qualquer que seja a fonte. As três fontes não custam o mesmo:

| Fonte | Custo por contato | Previsível? |
|---|---|---|
| Maps (gosom), CNPJ (Parquet) | ≈ R$ 0 (infra já paga) | Sim |
| Instagram (Apify) | R$ 0,31 a R$ 3,30 | **Não** |

O Instagram é cobrado pela Apify por **seguidor processado** (US$ 0,012 no plano grátis, ≈ R$ 0,066 com câmbio de R$ 5,50, premissa), **não por contato achado**. Uma busca processa ~50 seguidores (teto medido do acesso sem login) e custa ≈ R$ 3,30 seja qual for o resultado. O rendimento medido em duas contas foi de 21,6% (conta de nicho: R$ 0,31 por contato) e 2% (conta genérica: R$ 3,30 por contato).

Com um saldo só, o Maps e o CNPJ pagariam o Instagram (ou o contrário), e não haveria como precificar nenhum dos dois direito.

"Meta" aqui é a plataforma dona do Instagram; não existe outro conceito de "crédito Meta" no Torque.

## Decision

1. **Dois saldos por organização**, no mesmo livro (`lista_fria_creditos.tipo`: `normal` ou `meta`).
   - **Normal:** Maps e CNPJ. **Meta:** Instagram. A fonte decide o tipo (`private.lista_fria_tipo_da_fonte`); o usuário não escolhe.
2. **Preço de lista (CTO, 29/10/2026):** crédito normal **R$ 0,15**; crédito Meta **R$ 1,00**. Sem degraus de volume por enquanto.
3. **O preço NÃO mora no banco.** Não há cobrança no produto: os créditos entram só quando um master os concede (`lista_fria_creditos_conceder`, agora com `p_tipo`). O banco garante apenas que cada fonte gasta do saldo certo.
4. **A busca reserva do saldo da fonte e a sobra volta para o mesmo saldo.** Saldo insuficiente recusa com mensagem distinta (`creditos_meta_insuficientes`), para a tela dizer qual faltou.
5. **Compatibilidade na troca de versão:** `lista_fria_saldo(uuid)` continua devolvendo um número (o saldo normal), então o front já publicado não quebra; `lista_fria_saldos(uuid)` (jsonb `{normal, meta}`) é a nova. A concessão antiga de 3 argumentos segue valendo (o 4º tem default `'normal'`). **A migration entra ANTES do front.**
6. **Risco do Instagram aceito, com o saldo como teto.** O cliente escolhe a conta-alvo, e uma conta genérica rende ~2%. A cobrança é por contato (não por busca). A exposição de cada organização é, no máximo, o saldo Meta que um master concedeu: no piloto, conceder pouco.

### Margem do crédito Meta a R$ 1,00 (por contato)

| Rendimento da conta-alvo | Custo para nós | Resultado |
|---|---|---|
| 2% | R$ 3,30 | prejuízo de R$ 2,30 |
| 5% | R$ 1,32 | prejuízo de R$ 0,32 |
| 10% | R$ 0,66 | +34% |
| 21,6% | R$ 0,31 | +69% |

O equilíbrio fica em ≈ 7% de rendimento. **Só duas contas foram medidas**; o rendimento real do conjunto de clientes é desconhecido. O preço da Apify é o do plano grátis.

## Consequences

- O Instagram segue **desligado** na tela (`INSTAGRAM_DISPONIVEL=false`) e o worker da VPS não tem `APIFY_TOKEN`. Esta decisão prepara a cobrança; não liga a fonte.
- O crédito Meta custa 6,7 vezes o normal, na ordem da diferença de custo. Se o rendimento real ficar abaixo de ~7%, subir o preço ou passar a cobrar por busca (ver alternativas).
- **Falta o fluxo de compra** (checkout, nota fiscal, entrada automática do saldo). Para o piloto, o master concede e a cobrança é por fora.

## Alternativas consideradas

- **Saldo único com peso por fonte** (Instagram = N créditos por contato): uma unidade só, mas o cliente não vê o que está gastando e o preço de cada fonte não aparece separado.
- **Cobrar por busca de Instagram** (taxa fixa, rendendo ou não): elimina o risco de prejuízo, mas o cliente pode pagar e sair com 0 contatos. Fica de reserva se o rendimento real for baixo.
- **Degraus de volume** (pacotes com preço por crédito decrescente): proposto, não decidido pelo CTO.
