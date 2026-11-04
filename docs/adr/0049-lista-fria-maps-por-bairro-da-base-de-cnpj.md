# 49. Lista Fria: busca no Maps por bairro, com os bairros vindos da base de CNPJ

Date: 2026-11-03

## Status

Proposed. Estende o ADR-0042 (fonte Maps) e usa a base do ADR-0043. Sem migration: só o worker muda.

## Context

Em 03/11/2026 uma busca de "Contabilidade" em "Florianópolis - SC" pediu até 150 créditos e terminou com 20 contatos. Não foi limite de crédito (usou 20 de 150), nem de tempo (137 s de um teto de ~675 s), nem erro (status `concluida`), nem filtro do worker (0 já eram lead, 0 sem contato). Na mesma VPS, "Indústrias" em São José achou 109. O gosom devolveu 20 lugares e acabou sozinho.

Sem a IA de expansão (desligada no worker da VPS), `montarKeywords` gera **uma** palavra-chave: `Contabilidade em Florianópolis - SC`. O Maps responde à consulta, não à cidade: uma consulta de categoria genérica devolve os resultados mais próximos do centro geocodificado, e o resto da cidade não aparece. O código já previa a cobertura por bairro (`Expansao.bairros`), mas só a IA preenchia.

## Medição (gosom real, mesma imagem da VPS, 03/11/2026, máquina local)

Mesma busca, "Contabilidade" em "Florianópolis - SC", limite 150, e-mail desligado para isolar a contagem:

| | Consultas | Lugares únicos | Tempo |
|---|---|---|---|
| Como era (1 consulta, `depth` 15) | 1 | 35 | 116 s |
| Cidade + 19 bairros mais densos (`depth` 1) | 20 | 207 | 317 s |

Cerca de 6 vezes mais lugares, 2,7 vezes mais tempo. A medição local deu 35 onde a VPS deu 20 na mesma consulta: o IP e o ambiente mudam o piso, então o ganho na VPS precisa ser confirmado rodando a mesma busca lá depois do deploy.

## Decision

1. **Quando a IA não traz bairros, os bairros saem da base de CNPJ que o worker já carrega** (ADR-0043). Cada estabelecimento tem `uf`, `municipio` e `bairro`. A consulta agrupa por bairro e ordena por quantidade de matrizes: os primeiros são onde há comércio de fato (Florianópolis: Centro 19.885, Campeche 3.580, Estreito 3.546, Saco Grande 3.442, Trindade 3.243…). Medido na base real: 0,1 s, 408 grafias distintas.
2. **A palavra-chave da cidade inteira continua indo primeiro**, depois uma por bairro: `Contabilidade em Trindade, Florianópolis - SC`.
3. **Quantos bairros:** `ceil(limite / 8)`, entre 4 e 29 (a cidade inteira completa as 30 do teto). Cada consulta por bairro rende ~10 lugares novos depois de deduplicar; o `depth` cai sozinho com mais consultas (`ceil(limite*2 / (consultas*20))`).
4. **Limpeza dos nomes:** o campo é digitado pelo contador. Junta grafias ("CENTRO", "Centro.", "BAIRRO CENTRO"), descarta o que não é bairro (S/N, ZONA RURAL, "QD 12", o próprio nome da cidade, menos de 3 empresas) e capitaliza.
5. **Cidade sem UF** ("São José"): se o nome existe em mais de um estado, **não expande** (misturar bairros de duas cidades é pior que não expandir). O nome da cidade só entra na consulta depois de validado como letras, números, espaço, hífen, ponto, apóstrofo, vírgula ou barra, e vai por parâmetro SQL.
6. **Falha nunca derruba a busca:** sem base, base sem dados da cidade, cidade ambígua ou erro do DuckDB, a busca segue como antes (uma consulta só) e o motivo vai no log `bairros_da_base`. `LISTA_FRIA_BAIRROS=0` desliga.
7. **Por que não OpenStreetMap/Overpass:** foi medido, o servidor público respondeu 502 ("at capacity") em todas as tentativas. Uma fonte externa gratuita e sem SLA como dependência de cada busca é pior que um dado que já está no disco.

## Consequences

- **Mais consultas por busca**, logo mais tempo de gosom (19 consultas em vez de 1) e mais carga no Chromium da VPS. O teto de 3.600 s e a parada ao atingir o limite de créditos continuam valendo.
- **O ranking é de empresas em geral, não do nicho.** Bairros densos em comércio vêm primeiro; um nicho concentrado em um bairro pouco denso (ex.: clínicas em um bairro residencial) pode ficar fora do corte de `ceil(limite/8)`. Um pedido maior cobre mais bairros.
- **Resultado repetido entre consultas** é esperado (o Maps devolve os mais próximos do bairro e os de bairros vizinhos se sobrepõem); o executor já deduplica por `ref`.
- **O nome do bairro vem sem acento** (a Receita guarda assim). O Maps tolera.
- **Depende de a base de CNPJ estar sincronizada** na VPS; sem ela, volta ao comportamento anterior.
