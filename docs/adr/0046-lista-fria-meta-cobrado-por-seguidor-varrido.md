# 46. Lista Fria: crédito Meta cobrado por seguidor varrido (e não por contato achado)

Date: 2026-10-30

## Status

Accepted (CTO, 2026-10-30). **Implementada no código (2026-10-30); aguarda implantação** (ordem na seção Implementação). Substitui a cobrança por contato do crédito Meta definida no ADR-0044. O crédito Google (Maps e CNPJ) não muda.

## Context

O ADR-0044 cobra o Instagram por **contato novo e válido** (R$ 1,00). O custo, porém, é por **seguidor processado**: a Apify cobra US$ 0,012 por seguidor (≈ R$ 0,066 com câmbio de R$ 5,50, premissa), venha ou não um contato. Uma busca analisa até ~50 seguidores (teto medido do acesso sem login) e custa ≈ R$ 3,30, com ou sem resultado.

Como o rendimento varia de 2% a 21,6% conforme a conta-alvo, a margem por busca variou de **−230% a +69%**. O cliente escolhe a conta e, se escolhe uma genérica, o Torque paga a diferença (seleção adversa). O CTO pediu uma margem **estável e previsível**.

## Decision

1. **1 crédito Meta = 1 seguidor varrido.** O consumo é medido pelo que a Apify processou, não pelo que achamos.
2. **Preço de lista: R$ 0,15 por crédito** (o mesmo do crédito Google). Os pacotes e descontos de 5% e 10% do ADR-0045 se aplicam: Meta 100 = R$ 15,00, Meta + 500 = R$ 71,25, Meta Max 1.000 = R$ 135,00.
3. **Modelo puro:** só se paga a varredura. Contato achado não gasta crédito, e todo contato dos seguidores varridos entra na lista.
4. **Rendimento zero devolve metade:** se a busca termina **sem nenhum contato**, voltam ao saldo **metade dos créditos gastos**, arredondada para baixo (a casa fica com pelo menos metade).
5. **Reserva por busca:** 50 créditos Meta (o teto de seguidores). O consumo é progressivo e monotônico: o worker informa o total de varridos e o banco debita até a reserva; a sobra volta ao fim, como hoje. Ao chegar na reserva, o worker aborta a execução na Apify.
6. **Auditoria da margem:** cada busca grava `varridos` e o custo real da Apify (`custo_usd`, de `usageTotalUsd`). A margem real se mede por consulta, não por suposição.
7. **Compatível e aditivo:** a busca grava o modo de cobrança (`por_contato` ou `por_varredura`, padrão `por_contato`) e os seguidores por crédito no momento da criação, então buscas em andamento e mudanças futuras de preço não interferem. O Instagram nasce `por_varredura` só depois de migration e worker implantados.

## Cálculos (câmbio R$ 5,50; Apify US$ 0,012 por seguidor; custo R$ 0,066 por seguidor)

**Uma busca de 50 seguidores (R$ 7,50 de receita cheia, R$ 3,30 de custo):**

| Caso | Cobra | Custo | Margem |
|---|---|---|---|
| Com contatos | R$ 7,50 | R$ 3,30 | R$ 4,20 (**56,0%**) |
| Zero contatos (devolve 25 créditos) | R$ 3,75 | R$ 3,30 | R$ 0,45 (**12,0%**) |
| 30 seguidores, com contatos | R$ 4,50 | R$ 1,98 | R$ 2,52 (56,0%) |
| 30 seguidores, zero contatos | R$ 2,25 | R$ 1,98 | R$ 0,27 (12,0%) |

**Por pacote:**

| Pacote | R$ por crédito | Margem cheia | Margem com zero contatos |
|---|---|---|---|
| Meta | 0,1500 | 56,0% | +12,0% |
| Meta + | 0,1425 | 53,7% | +7,4% |
| Meta Max | 0,1350 | 51,1% | +2,2% |

O preço mínimo para a busca de zero contatos não dar prejuízo é R$ 0,132 por crédito (2 × o custo); o pacote mais barato vende a R$ 0,135, **com folga de 2%**.

**Margem média por parcela de buscas sem nenhum contato (pacote Meta):** 0% → 56,0%; 10% → 53,7%; 25% → 49,7%; 50% → 41,3%; 100% → 12,0%.

**Antes (R$ 1,00 por contato) e agora (R$ 0,15 por seguidor), por busca de 50:**

| Rendimento da conta | Antes | Agora |
|---|---|---|
| 2% | R$ 1,00 (−230%) | R$ 7,50 (+56%) |
| 5% | R$ 2,50 (−32%) | R$ 7,50 (+56%) |
| 10% | R$ 5,00 (+34%) | R$ 7,50 (+56%) |
| 21,6% | R$ 10,80 (+69%) | R$ 7,50 (+56%) |

**O que o cliente paga por contato (R$ 7,50 por busca):** a 21,6% de rendimento, R$ 0,69; a 10%, R$ 1,50; a 5%, R$ 3,00; a 2%, R$ 7,50 (se vier zero, R$ 3,75 no total).

**Choque de custo (Apify +25% e câmbio R$ 6,00, custo R$ 0,09 por seguidor):** margem cheia de 40,0% (Meta), 36,8% (Meta +) e 33,3% (Meta Max); com zero contatos, **prejuízo** de 20,0%, 26,3% e 33,3%. O custo por seguidor só pode subir **14%** sobre o atual antes de a busca sem contato dar prejuízo (e a cheia aguenta até R$ 0,15).

**Projeção de um mês, só Meta** (10% das buscas com zero contato, pacote Meta de R$ 0,15, 50 seguidores por busca):

| Cenário | Clientes × buscas | Buscas | Receita | Custo | Margem | Horas do worker |
|---|---|---|---|---|---|---|
| Piloto | 3 × 10 | 30 | R$ 213,75 | R$ 99,00 | R$ 114,75 (53,7%) | 2,4 h |
| Tração | 10 × 20 | 200 | R$ 1.425,00 | R$ 660,00 | R$ 765,00 (53,7%) | 15,9 h |
| Escala | 30 × 40 | 1.200 | R$ 8.550,00 | R$ 3.960,00 | R$ 4.590,00 (53,7%) | 95,3 h |

A margem é a mesma nos três (53,7%) porque não depende do rendimento: só da parcela de buscas sem contato. A receita do Meta cai muito em relação ao ADR-0044 (Meta 1.000 era R$ 900,00, agora é R$ 135,00 e dá 20 buscas).

## Consequences

- **Margem previsível.** Passa de −230% a +69% para **+12% a +56%**, e a faixa depende só de câmbio, preço da Apify e da parcela de buscas sem contato.
- **O risco passa ao cliente.** Ele sabe o preço (R$ 7,50 por busca de 50), mas pode pagar e receber poucos contatos. A tela precisa dizer isso antes da busca. A devolução de metade quando não vem nada é o amortecedor.
- **A folga é curta onde o desconto é maior.** No Meta Max, uma busca sem contato dá só 2,2% de margem. Se o custo da Apify subir mais que ~14%, é preciso reajustar preço ou desconto.
- **O saldo Meta existente muda de significado** (de contatos para seguidores). Só a TorqueCRM tem saldo, de teste; a mudança deve entrar **antes de qualquer cliente comprar**.
- **Os dois saldos ficam separados** (a unidade é outra, seguidor e contato), mesmo agora com o mesmo preço por crédito. Unificá-los é uma decisão futura.
- **"Nenhum contato" precisa de definição exata na implementação.** Premissa deste ADR: zero resultados registrados na busca. Se existirem resultados que já são leads, a busca não é "zero".

## Implementação

Migration `20271221000000_lista_fria_cobranca_por_varredura.sql` (aditiva, com rollback), worker e telas.

**Banco**
- `lista_fria_buscas` ganha `cobranca` (`por_contato` por padrão, `por_varredura`), `varridos`, `seguidores_por_credito` (1, gravado na criação) e `contatos_novos`. As buscas que já existem ficam `por_contato` e `contatos_novos` recebe o `creditos_usados` delas (até aqui, todo crédito era um contato).
- **O custo real não fica nessa tabela.** O cliente lê `lista_fria_buscas` com `select *`, então `custo_usd` ali mostraria a margem da casa. Vai para `lista_fria_busca_custos` (RLS ligada, sem grant para o usuário; só o serviço lê e escreve).
- `lista_fria_busca_criar`: Instagram reserva **50 créditos Meta fixos** e nasce `por_varredura`; o número pedido pelo cliente não vale para essa fonte. Maps e CNPJ não mudam.
- `lista_fria_worker_varrer(busca, worker, varridos, custo_usd)` (só `service_role`): o total é cumulativo e monotônico (`GREATEST`), o débito sobe até a reserva e para nela. Em busca `por_contato` só audita.
- `lista_fria_worker_registrar`: em busca por varredura não cobra, não corta o lote e devolve `limite_atingido = false` (quem encerra é a varredura).
- `private.lista_fria_encerrar`: busca por varredura que fecha como **`concluida` ou `falhou`** sem **nenhuma linha** em `lista_fria_resultados` devolve `floor(creditos_usados / 2)` além da sobra da reserva. `creditos_usados` passa a ser o que o cliente de fato pagou.

**Decisões que o ADR deixava em aberto**
- "Zero contatos" = zero linhas de resultado (premissa confirmada). Resultado que já é lead conta como resultado.
- **Parada pelo usuário não devolve metade**: ele escolheu parar. Só o que o coletor varreu até ali é cobrado, e a sobra da reserva volta. Se a regra valesse também ali, bastaria parar cedo numa conta ruim para pagar metade do que ela custou.
- **Falha sem resultado devolve metade** (o cliente não fica com a falha do coletor); falha antes de varrer qualquer coisa só devolve a reserva.
- Ao chegar na reserva a busca fecha como **`concluida`** (varreu tudo o que o cliente pagou), não como `parada`.

**Worker**
- A fonte Instagram lê **no máximo a reserva** (`creditos_limite × seguidores_por_credito`). A Apify pode entregar mais; o excedente não é lido nem entregue, porque o cliente não pagou por ele. Na reserva, a execução é abortada.
- A cada volta informa `varridos` (itens do dataset) e o custo (`usageTotalUsd`); ao parar o coletor lê o custo final e grava de novo.
- **Tolera banco antigo**: se `lista_fria_worker_varrer` não existe (404), segue sem cobrança por varredura. Isso permite implantar o worker antes da migration sem janela.

**Telas**
- Crédito Meta a **R$ 0,15**: Meta 100 = R$ 15,00, Meta + 500 = R$ 71,25, Meta Max 1.000 = R$ 135,00.
- Instagram não tem mais campo de créditos: mostra "Esta busca custa 50 créditos Meta (R$ 7,50)", o risco (paga-se por seguidor analisado, venha contato ou não) e a devolução de metade. Com menos de 50 créditos Meta, não inicia e oferece comprar.
- O card mostra contatos entregues, seguidores analisados e "N de 50 créditos Meta". A revisão só é oferecida se vieram contatos.

**Ordem de implantação** (cada passo é seguro sozinho)
1. Worker novo (imagem), tolerante à RPC ausente.
2. Migration. A partir daqui o Instagram novo é por varredura.
3. Front.

Entre 2 e 3, quem ainda tem o front antigo aberto vê o campo de créditos, mas o banco ignora o número e reserva 50.

**Saldo Meta já concedido muda de significado** (de contatos para seguidores): TorqueCRM 10, Improving 100, Milennials 100 na data deste ADR. Com 100, são 2 buscas. Avisar antes de implantar.

**Auditoria**: `scripts/lista-fria-margem-instagram.sql` (receita contra custo real por busca e no total).
