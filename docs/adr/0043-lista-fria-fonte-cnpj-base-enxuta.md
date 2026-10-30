# 43. Lista Fria: fonte CNPJ por CNAE, sobre uma base enxuta em Parquet

Date: 2026-10-28

## Status

Accepted (CTO, 2026-10-28: "seguimos com a versão enxuta"). Estende o ADR-0042 com uma terceira fonte, ao lado de Maps e Instagram.

## Context

Maps rende dezenas de contatos por busca e o Instagram sem login, cerca de 10 (ADR-0042, "Medido"). O CTO quer a busca por **CNAE/segmento**, como as ferramentas que vendem lista de empresas.

A origem desse dado é pública: a Receita Federal publica todo mês a base do CNPJ (estabelecimentos, empresas, CNAEs, municípios). Não existe API governamental de listagem por CNAE; a consulta do Serpro e a do site da Receita buscam um CNPJ por vez. O que há é o **arquivo mensal**, em um servidor Nextcloud do Serpro (`arquivos.receitafederal.gov.br`, pasta `Dados/Cadastros/CNPJ/AAAA-MM`).

### Medido em 28/10/2026 (base de 2026-10, São Paulo capital, só ativas, sem empresário individual)

| CNAE | Estabelecimentos | Com e-mail | Com telefone | Celular provável | E-mail repetido em 6+ CNPJs |
|---|---|---|---|---|---|
| 46 (atacadistas) | 57.110 | 91,6% | 94% | 23% | 11,6% |
| 8630 (saúde ambulatorial) | 57.092 | 94% | 98% | 33% | 33,5% |
| 5611 (restaurantes) | 35.839 | 91,6% | 93% | 18% | 24% |

- A base completa carregada pesa 8,4 GB (73,8 milhões de estabelecimentos). A versão **enxuta** (ativas, sem empresário individual, com e-mail ou telefone) tem **10,9 milhões de linhas e 0,40 GB** em Parquet com zstd.
### Validado contra o Parquet real (28/10/2026)

Executor real + DuckDB real + checagem de MX pela rede, sobre o Parquet construído de verdade
(10.893.185 linhas em 14 partes, 0,47 GB, construído em ≈ 10 min). Atacadistas (CNAE 46), São Paulo capital, 400 créditos:

- 475 candidatos lidos, **400 contatos em 12 segundos**.
- 65% com e-mail, 88% com telefone, 53% com os dois.
- 65% `verificado` (celular ou e-mail com domínio que recebe), 35% `nao_verificado`, 0% e-mail sem MX.
- Os domínios mais comuns são provedores pessoais (gmail, uol, hotmail, terra): quem declarou o próprio e-mail, não o contador.
- **O que o MX não prova:** que a caixa existe. 0% sem MX diz que o domínio recebe e-mail, só isso.

- A cobertura de e-mail é alta, a **qualidade não está provada**: o e-mail cadastrado costuma ser do contador. O sinal mais óbvio (o mesmo e-mail em 6+ CNPJs) já derruba de 12% a 34%.

## Decision

1. **Base própria e enxuta, não API paga.** O Torque não paga por contato nem depende de terceiro. A origem é a base da Receita, que é a mesma que as ferramentas de mercado revendem.
2. **Parquet de ~0,5 GB em PARTES de até 50 MB, sem servidor de banco.** Fica no Supabase Storage (bucket privado `lista-fria-base`) e o worker lê com DuckDB. O Storage recusa arquivo acima de 52 MB, limite do projeto inteiro; subir esse limite mexeria na configuração de todos os buckets (inclusive o de mídia, sem retenção), então a base é dividida em partes em vez de o limite ser alterado. As partes seguem em sequência ordenada por `uf, cnae, municipio`, então uma busca lê só as fatias que casam. O nome de cada parte leva o hash do conteúdo (imutável): o worker baixa só as que faltam e nunca mistura versão velha com nova. Nenhuma tabela nova no banco principal: ele já tem pressão de espaço.
3. **A base é um artefato construído, não um dado do produto.** `services/lista-fria-base/construir.py` baixa a base do mês, filtra, marca o que precisa e grava as partes e o manifesto. Roda por job agendado, uma vez por mês, e é idempotente.
4. **Marcas calculadas na construção, para o worker não recalcular:**
   - `email_compartilhado`: o mesmo e-mail aparece em 6 ou mais CNPJs (contador provável). A busca descarta por padrão.
   - `matriz`: só a matriz entra por padrão, para uma empresa com várias filiais não virar vários contatos cobrados.
   - `celular`: telefone de 9 dígitos começando em 9.
5. **Fora da base, por desenho:** empresário individual (natureza jurídica 2135: o CNPJ é uma pessoa física), sócios, e qualquer dado que não seja o de contato da empresa. Sem sócios, sem CPF.
6. **Mesmo contrato das outras fontes.** `lista_fria_buscas.fonte` ganha `'cnpj'` e a busca guarda os filtros em `filtros jsonb` (CNAEs, UF, município, exigência de contato). O worker implementa `Fonte` (`fonteCnpj`) e reaproveita o fluxo todo: validação de MX, deduplicação contra leads, cobrança de 1 crédito por contato novo e válido, devolução da sobra, parada.
7. **O worker ganha UMA dependência**, `@duckdb/node-api`, fixada por versão exata e lockfile. Era "zero dependências"; ler Parquet com filtro em JS puro seria código nosso para manter, e a alternativa (subir um processo Python) é mais peso. Só o worker tem essa dependência, o front e o repo não.

## Consequences

- **Rendimento:** dezenas de milhares de contatos por segmento e cidade, ante cerca de 50 no Maps e 10 no Instagram. A conta de custo marginal é zero (armazenamento de centavos por mês).
- **Frescor:** o contato é o que a empresa declarou à Receita, atualizado mensalmente. Pode estar defasado.
- **LGPD:** o dado é público e de pessoa jurídica; sócios e empresário individual ficam de fora. Antes de ligar qualquer disparo sobre essa fonte é preciso registrar a base legal e oferecer descadastramento; hoje a Lista fria só exporta e importa.
- **Telefone (CORRIGIDO em 30/10/2026):** a versão anterior dizia que 77% a 82% dos telefones eram fixos e que a coluna "Celular provável" acima mostrava a parcela de celulares. **Estava errado:** a heurística exigia 11 dígitos, mas a Receita guarda quase todo celular **sem o nono dígito** (10 dígitos começando em 8 ou 9). Medido nas 9,7 milhões de matrizes com telefone: **45,5% fixo, 49,8% celular de 10 dígitos (8 ou 9), 3,3% de 10 dígitos começando em 6 ou 7 (celular antigo ou rádio, ambíguo), 1,4% outro formato, e só 760 com 11 dígitos**. O worker descartava os 10 dígitos começando em 6 a 9 (54,5% dos telefones) e passou a converter os que começam em 8 ou 9 (ganham o 9). A coluna "Celular provável" da tabela acima **não vale**; a coluna `celular` do Parquet, que só marca 11 dígitos, também não.
- **Ainda sem medição:** a taxa de e-mail que chega à caixa (só se mede enviando, e a Lista fria não envia). O preço do crédito desta fonte deve partir de "verificado" e não de "encontrado".
- **Busca repetida:** duas buscas com o mesmo alvo, sem importar entre elas, devolvem os mesmos contatos e cobram de novo (igual ao Maps). Quem já é lead não é cobrado; a defesa é importar.
- **Quem opera:** o job mensal e o armazenamento do Parquet. Se o arquivo faltar, a busca de CNPJ fecha como indisponível e devolve a reserva, como o Instagram sem provedor.
