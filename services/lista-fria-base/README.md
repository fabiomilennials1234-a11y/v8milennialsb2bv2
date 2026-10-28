# Base de CNPJ da Lista fria

Gera e publica o arquivo que a fonte "Empresas por CNAE" consulta (ADR-0043). É um artefato
construído uma vez por mês a partir da base aberta da Receita Federal, não um dado do produto.

| | |
|---|---|
| Entrada | `Cnaes`, `Municipios`, `Empresas0-9`, `Estabelecimentos0-9` do mês (≈ 6,4 GB compactados) |
| Saída | 14 partes `cnpj-enxuto-NNN-<hash>.parquet` (≈ 35 MB cada, 0,47 GB no total, 10,9 milhões de linhas em 2026-10) e `manifesto.json` |
| Filtro | ativo, sem empresário individual (natureza 2135), com e-mail ou telefone |
| Ordem | `uf, cnae, municipio, cnpj` (o worker lê só as fatias que a busca pede) |
| Tempo | ≈ 10 min numa máquina de desenvolvimento (4 threads) |
| Disco | pico ≈ 8 GB por CSV extraído, um arquivo por vez |

## Colunas

`cnpj, razao, fantasia, cnae, cnae_desc, uf, municipio, bairro, endereco, tel, email, porte, matriz,
celular, email_compartilhado`

- `matriz`: a busca só devolve matrizes (uma empresa com cinco filiais não vira cinco contatos).
- `celular`: telefone de 11 dígitos com o nono dígito (serve para WhatsApp).
- `email_compartilhado`: o mesmo e-mail em 6 ou mais CNPJs (contador provável). O worker anula esse
  e-mail e mantém o telefone.
- Fora, por desenho: sócios, CPF, qualquer dado que não seja o contato da empresa.

## Rodar

```
pip install duckdb==2.0.0
python construir.py --saida ./saida                    # baixa o mês mais recente da Receita
python construir.py --saida ./saida --mes 2026-10      # um mês específico
python construir.py --saida ./saida --zips ./zips      # zips já baixados (desenvolvimento)
python construir.py --saida ./saida --dividir base.parquet --mes 2026-10   # só refatia um Parquet já pronto

SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python publicar.py --saida ./saida
```

`publicar.py` valida tudo antes de enviar, sobe só as partes que ainda não estão no bucket, depois o manifesto (que nunca aponta para arquivo ausente) e por último apaga as partes que o manifesto novo não cita.
O job `.github/workflows/lista-fria-base.yml` faz os dois todo dia 12, e sob demanda
(`workflow_dispatch`). **Ainda não foi exercitado no GitHub Actions**: o primeiro disparo manual é o teste.

## Antes do primeiro uso em produção

1. **Limite de arquivo do Storage: não mexa.** O Supabase limita cada arquivo no projeto inteiro (aqui
   52.428.800 bytes). É por isso que a base são partes de até 50 MB. O `publicar.py` recusa uma parte maior
   que o teto antes de enviar qualquer coisa, e o bucket é criado com o mesmo teto.
2. **Secrets do repositório** `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (produção).
3. **Volume do worker** em `/data/base` (o compose já define). Primeiro boot: baixa as 14 partes (≈ 50 s).

## Onde a base da Receita vive

Link público de compartilhamento do Nextcloud do Serpro (`arquivos.receitafederal.gov.br`, pasta
`Dados/Cadastros/CNPJ/AAAA-MM`), lido por WebDAV. O token do link é público e está em
`construir.py` (`RFB_SHARE`); se a Receita mudar o link, o script para com "Nenhuma pasta AAAA-MM
encontrada" em vez de publicar uma base vazia. `versao_layout` do manifesto (hoje 2) trava o worker contra um
layout que ele não conhece.

## O que a base NÃO garante

- Qualidade do contato: é o que a empresa declarou à Receita, e pode estar defasado. A checagem de MX
  (no worker) prova que o domínio recebe e-mail, não que a caixa existe.
- Telefone: 77% a 82% parecem fixos; só `celular` serve para WhatsApp.
- E-mail de contador com poucos clientes passa pelo filtro de repetição.
