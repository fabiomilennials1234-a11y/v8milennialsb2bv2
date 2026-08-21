# Plano de reconciliação do ledger de migrations em PROD

**Status: DESENHADO, NÃO EXECUTADO.** Requer decisão do CTO antes de qualquer
escrita em `supabase_migrations.schema_migrations`.

Data: 2026-07-22 · Alvo: `jsjsmuncfkbsbzqzqhfq` (produção)

## O problema em uma frase

O repo passou a ter **1 migration** (`20260101000000_baseline_prod_schema.sql`),
mas o ledger de prod tem **655 linhas** que descrevem o histórico antigo. Enquanto
os dois não concordarem, `supabase db push` contra prod vê o baseline como
"nunca aplicado" e tenta aplicá-lo sobre um banco que já tem tudo.

## Por que isso é perigoso e não apenas chato

O baseline emite `CREATE TABLE` (sem `IF NOT EXISTS`) para 256 tabelas. Um push
acidental falharia na primeira tabela existente. **Isso é o bom cenário** — falha
alta e cedo. O cenário ruim é alguém "consertar" o erro adicionando
`IF NOT EXISTS` e rodando de novo: aí o push atravessa o arquivo inteiro
reaplicando GRANTs, policies e owners sobre produção viva.

Nada disso acontece sozinho: exige alguém rodando `db push` contra prod. Mas o
ledger desalinhado é exatamente a armadilha que faz alguém rodar.

## Estado de fato (medido, não presumido)

| Fato | Valor |
|---|---|
| Migrations no repo, antes | 839 arquivos |
| Migrations no repo, agora | 1 (baseline) + 839 em `archive/` |
| Linhas em `schema_migrations` de prod | **655** |
| Diferença repo↔ledger, já antes deste trabalho | 839 vs 655 = **184 de discrepância** |
| Prefixos duplicados no histórico | 20+ (o CLI pula em silêncio) |
| Convenção de prefixo no repo | datas **fictícias de 2027** |
| Convenção de prefixo em prod | relógio real (ex.: `20260722205847`) |

O drift não nasceu com o baseline. Ele já existia: **184 linhas de diferença**
entre o que o repo dizia e o que prod registrava. O baseline é a oportunidade de
zerar, não a causa.

Sobre o #1209: está em prod como `20260722205847` e seu arquivo foi para o
`archive/`. Isso é inofensivo — **o baseline já contém a função corrigida**,
porque o dump foi capturado depois da aplicação (verificado: o corpo de
`assert_org_access` no baseline delega a `get_my_organization_ids()` e traz o
`COMMENT` que cita a issue).

---

## Opção A — Substituir o ledger por uma única linha *(recomendada)*

Deixar `schema_migrations` com exatamente uma linha: o baseline.

**Como**, usando a ferramenta oficial em vez de SQL na mão:

```bash
# 1. SNAPSHOT ANTES DE QUALQUER COISA (fora do banco, não só uma tabela cópia)
psql "$PROD_URL" -Atc \
  "select version||'|'||name from supabase_migrations.schema_migrations order by version" \
  > ledger_prod_backup_20260722.txt
pg_dump "$PROD_URL" --schema=supabase_migrations -f ledger_prod_backup_20260722.sql

# 2. marca o baseline como já aplicado (não executa o SQL, só registra)
supabase migration repair --status applied 20260101000000

# 3. remove as 655 antigas do ledger (não toca no schema)
#    uma por vez, a partir do arquivo de backup
supabase migration repair --status reverted <version>   # ×655
```

**Efeito**: `supabase db push` passa a ver repo e prod idênticos — nada a
aplicar. Migrations futuras aplicam normalmente. Branch criada da plataforma
replaya **só o baseline**, que é o que queremos.

**Risco**: perde-se o `statements` histórico dentro de prod. Mitigado porque (a)
o SQL vive no `archive/` em git, (b) o snapshot do passo 1 permite restaurar a
tabela inteira.

**Reversibilidade**: alta — restaurar a tabela do dump do passo 1.

---

## Opção B — Apenas inserir a linha do baseline, manter as 655

**Efeito**: ledger com 656 linhas. `db push` não tenta aplicar o baseline
(existe remotamente). Aparentemente resolve.

**Por que eu não recomendo**: não resolve o problema que originou este trabalho.
A criação de branch replaya o ledger de prod — com as 655 lá dentro, **a branch
continua falhando exatamente como a de 2026-03-11**. Ficaríamos com o baseline no
repo e o ambiente de validação ainda quebrado.

**Reversibilidade**: máxima (é puramente aditiva). É a opção certa apenas se a
prioridade for "não mexer em prod hoje" e aceitarmos seguir sem branch.

---

## Opção C — Não mexer no ledger; proibir `db push` contra prod

Manter o ledger como está e tratar prod como aplicado-à-mão para sempre (MCP /
`execute_sql`), com um guard-rail que impeça `db push --linked` apontando para
prod.

**Efeito**: zero risco imediato, zero benefício. O ambiente de validação por
branch continua indisponível e todo fix de risco segue indo direto pra prod —
que é precisamente o buraco que nos custou o #1209 sem QA.

**Reversibilidade**: n/a (nada muda).

---

## Recomendação

**Opção A**, com três condições:

1. Snapshot do ledger **para arquivo fora do banco** antes de tocar em qualquer
   linha — não basta duplicar a tabela dentro do mesmo banco.
2. Executar via `supabase migration repair`, não `DELETE`/`INSERT` na mão. A
   ferramenta conhece o formato (incluindo a coluna `statements`).
3. Feito o repair, **provar** com `supabase migration list`: deve mostrar o
   baseline como local+remoto e nada mais pendente. Só então declarar pronto.

Depois disso, adotar timestamp real (`supabase migration new` gera UTC) e
abandonar de vez os prefixos 2027 fictícios — eles morrem junto com o archive.

## O que este plano NÃO cobre

Os **45 cron jobs** de prod. Vivem como linhas em `cron.job`, não são objetos de
schema, e nenhum dump os carrega. Branch criada do baseline sobe sem cron — nada
dispara sozinho lá. Se algum dia for preciso exercitar fluxo dependente de cron
em branch, os jobs terão que ser semeados à parte a partir de `cron.job` de prod.
Fica registrado como limite conhecido, não como pendência deste plano.
