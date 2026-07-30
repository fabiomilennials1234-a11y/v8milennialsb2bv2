# Runbook — validar migration em branch efêmera

**Ambiente de validação canônico.** Docker está fora (decisão CTO 2026-07-27); o dev
`bcfadphgsibjzivtbjvc` está aposentado. Prod é botão do humano. Sobra a branch efêmera
de prod: **US$ 0,01344/hora**, criada para um teste e encerrada no mesmo dia.

Escrito em 2026-07-30 a partir de uma execução real (migration
`20270729000010_pipeline_page_stalled_days_filter`). Cada passo abaixo aconteceu; os
tropeços estão descritos porque todos eles vão acontecer de novo.

---

## Antes de começar

1. **Checkout não pode estar linkado.** `scripts/db-push-branch.sh` recusa se estiver, e
   está certo: link ambiente é o vetor do acidente — um `db push` sem `--db-url` vai
   para onde o link aponta.
   ```bash
   supabase unlink              # se supabase/.temp/project-ref existir
   supabase db push --dry-run   # deve dizer "Cannot find project ref"
   ```
   ⚠️ `scripts/deploy-create-org-user.sh` roda `supabase link` em **prod** sem condição e
   deixa o checkout linkado. Se você rodou aquele script, `unlink` antes deste runbook.

2. **Nunca duas branches.** `list_branches` primeiro.

3. **Saiba o que está pendente.** Compare o ledger de prod com o repo antes de qualquer
   coisa — o número de arquivos em `supabase/migrations/` **não** é o número de
   pendentes, e a diferença muda a receita (ver "Drift", no fim).

---

## Passo a passo

### 1. Criar a branch

Via MCP: `get_cost` → `confirm_cost` → `create_branch`.

**Ela vai nascer `status: MIGRATIONS_FAILED` com `preview_project_status: ACTIVE_HEALTHY`.
Isso é esperado, não é falha sua.** O Postgres está de pé; o que falhou foi o replay do
ledger de prod, porque a linha do baseline em prod é um **marcador de 189 chars**, não o
dump. O replay marca o baseline como aplicado sem criar nada e morre na primeira
migration que depende do schema.

Resultado prático: **banco vazio com um ledger que mente.** Confirme:

```sql
select (select count(*) from supabase_migrations.schema_migrations) as ledger_rows,
       (select count(*) from pg_tables where schemaname='public')   as public_tables;
-- observado: ledger_rows = 3, public_tables = 0
```

### 2. Apagar o ledger que mente

Sem isso o `db push` acha que o baseline já rodou e nunca aplica o dump real (1,8 MB).
Reverta exatamente as versões que o replay registrou:

```bash
supabase migration repair --status reverted <v1> <v2> <v3> --db-url "$URL"
```

### 3. Pegar a credencial da branch

```bash
supabase branches get <branch-id> --project-ref jsjsmuncfkbsbzqzqhfq -o env > branch.env
```

Use **`POSTGRES_URL_NON_POOLING`** (`db.<ref>.supabase.co:5432`) para DDL — não o pooler
na 6543. Os valores vêm entre aspas; tire com `tr -d '"'`.

Guarde fora do repo (o diretório de scratchpad da sessão serve) e **apague ao terminar**.
A credencial morre com a branch, mas não a deixe no disco nem no terminal.

### 4. Aplicar

```bash
scripts/db-push-branch.sh --db-url "$URL" --confirm <ref-da-branch>
```

O script recusa ref de prod, recusa o dev aposentado, recusa checkout linkado, roda
dry-run, imprime **tudo** que seria aplicado, e recusa migration que toque dado sem
`--allow-dml`.

**O baseline exige `--allow-dml`** — o dump carrega seeds. Aqui é legítimo: banco vazio,
zero dado de cliente. O scan é por linha, então também acusa `INSERT` que está *dentro de
corpo de função*; erra para o lado seguro.

### 5. O tropeço da migration já-aplicada-sem-registro

Observado: `ERROR: relation "omie_connections" already exists (SQLSTATE 42P07)` em
`20270203000000_omie_foundation.sql`. O objeto já vem no baseline — a migration foi
aplicada em prod sob outra versão e o arquivo ficou órfão no repo.

Não conserte o arquivo aqui. Marque como aplicada e siga, para o push rodar **só** a
migration em teste:

```bash
supabase migration repair --status applied <versões-alheias> --db-url "$URL"
scripts/db-push-branch.sh --db-url "$URL" --confirm <ref>   # agora: 1 migration
```

Isso é o que faz o teste medir a *sua* mudança contra o schema do repo, em vez de medir
nove migrations alheias.

### 6. Conferir ACL — exigência da `/security-rubric`

Contra **o alvo do apply**, não contra prod:

```sql
select p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') as svc_exec,
       count(*) over (partition by p.proname)                    as sig_count
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (<suas funções>);
```

`anon_exec` deve ser `false`, `sig_count` deve ser `1` (mais de 1 = você criou overload).

**Melhor ainda: teste pela borda.** `has_function_privilege` prova o grant; o PostgREST
prova o que o navegador vai ver.

```bash
# anon com os parâmetros novos → esperado HTTP 401 / 42501
# service_role com os parâmetros novos → esperado HTTP 200
# service_role SEM os parâmetros novos → esperado HTTP 200  (aridade antiga viva)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SUPABASE_URL/rest/v1/rpc/<fn>" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '<body>'
```

O terceiro caso é o que pega `PGRST202`: o PostgREST resolve RPC por **nome + argumentos**,
e um parâmetro desconhecido derruba a chamada inteira — que a UI mostra como **coluna
vazia, não erro**.

### 7. Testar a semântica sem semear dado

Branch nasce sem dado (`with_data: false`), então zero linhas não prova filtro correto.
Para predicado, teste a expressão contra uma lista de `VALUES` e compare com a regra
esperada — prova as fronteiras sem montar cadeia de FK:

```sql
with ages as (select v as age from (values (0),(1),(2),(3),(7),(8)) t(v)),
     buckets as (select mind, maxd from (values (0,2),(3,7)) t(mind,maxd))
select count(*) as mismatches from (
  select (<sua expressão SQL>) as sql_says, (<regra esperada>) as should_be
  from buckets cross join ages
) q where sql_says <> should_be;   -- tem que dar 0
```

Se houver equivalente client-side da mesma regra, confira que as duas leituras batem —
funil custom filtra no cliente e funis do sistema no servidor; divergir aqui faz a mesma
faixa, com o mesmo rótulo, devolver recortes diferentes.

### 8. Encerrar **agora**

```
delete_branch <branch-id>
list_branches          # confirme zero efêmeras
```

Apague o `branch.env`. Branch órfã é cobrança à toa e, pior, vira ambiente permanente
por acidente.

---

## Se for subir a INTERFACE contra a branch

A branch replica **o Postgres, e só ele**. Duas coisas faltam, e as duas quebram o app de
formas que não se parecem com a causa.

### 1. Zero edge functions — sintoma é "loading infinito"

`list_edge_functions` na branch devolve `[]`; prod tem 78+. O app pede permissões numa
edge function no boot, então:

```
Access to fetch at '.../functions/v1/get-member-permissions'
blocked by CORS policy: Response to preflight request doesn't pass
access control check: It does not have HTTP ok status.
```

O preflight bate em função inexistente → 404 sem cabeçalho CORS → o navegador bloqueia →
o hook de permissão nunca resolve → **tela em branco, girando pra sempre**. O console
enche de erro de CORS, o que faz parecer problema de configuração de CORS. Não é: é
função ausente.

Mínimo pra logar e navegar:

```bash
supabase functions deploy get-member-permissions --project-ref <branch-ref>
supabase functions deploy attach-to-org-by-pending-invite --project-ref <branch-ref>
```

Cada tela que usa outra função vai precisar da sua. Implante sob demanda, guiado pelo
console.

### 2. `subscription_plans` nasce vazia — sintoma é "recurso bloqueado"

O dump traz o schema, não as linhas. Sem plano, o portão de features fecha tudo e a tela
diz *"Leads está bloqueado — esse recurso não está no seu plano atual"*.

⚠️ O portão lê **`organizations.subscription_plan` (texto) casado com
`subscription_plans.name`** — **não** `organizations.feature_flags`. Confundir os dois leva
a conclusão errada sobre quem enxerga o quê.

Semeie um plano espelhando o `torque-v8` de prod e aponte a org pra ele.

### 3. O seed do repo não serve

`supabase/seed.sql` referencia `organization_role_permissions`, que **não existe mais** no
schema — ou seja, está podre (e `npm run test:integration` provavelmente também está).
E `supabase db query -f` roda o arquivo como statement único, morrendo com
`42601 cannot insert multiple commands into a prepared statement`.

Use **`node scripts/seed-branch.mjs --db-url <url> --file <arquivo>`** (recusa prod, usa o
`pg` do projeto, aceita múltiplos comandos). Crie o usuário pela **Auth Admin API**, não
espelhando o GoTrue na mão:

```bash
curl -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE" -H "Authorization: Bearer $SERVICE_ROLE" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@torque.local","password":"...","email_confirm":true}'
```

### 4. Apontar o front

`npm run dev:branch` resolve a branch e escreve `.env.development.local` (topo da
precedência do Vite). `npm run dev` recusa se o alvo for prod. Ao encerrar a branch,
**apague o arquivo** — senão o dev aponta pra um projeto que não existe mais.

## O que a branch NÃO prova

Ela é construída **do repo**, e o repo não é prod.

Em 2026-07-30: prod tinha **38** versões no ledger, o repo **36** arquivos, com **10**
pendentes e **12** versões em prod **sem arquivo** no repo. Uma branch reconstruída do
repo não tem o efeito dessas 12.

Portanto: "aplicou limpo na branch" prova que **a sua migration é SQL válido e as suas
asserções passam**. Não prova "aplica limpo em prod". Diga isso ao reportar; não deixe
o verde da branch parecer cobertura de prod.

## O que a branch não licencia

Ela valida a migration. Ela **não** libera os passos de front que dependem do apply em
**prod**:

- `supabase gen types` — gerar a partir da branch **corrompe** `src/integrations/supabase/types.ts`,
  porque a branch não tem as 12 versões órfãs de prod. Gere só depois do apply em prod,
  apontando para prod.
- Remover pontes de compatibilidade (casts que existem porque os tipos ainda não conhecem
  o parâmetro novo) — mesma razão.
- Virar flag que assume o parâmetro disponível — enquanto prod não recebeu a migration, a
  flag ligada devolve coluna vazia ao operador.

Esses três andam juntos, num commit, **depois** do apply em prod.

---

## Drift de migration — cheque antes, não durante

```bash
# ledger de prod: MCP list_migrations (leitura, seguro)
ls supabase/migrations/*.sql | xargs -n1 basename | sed 's/_.*//' | sort -u > /tmp/repo.txt
comm -23 /tmp/repo.txt /tmp/prod.txt   # pendentes: vão rodar no push
comm -13 /tmp/repo.txt /tmp/prod.txt   # órfãs: existem em prod, sem arquivo
```

Três classes, todas já vistas neste repo:

| Classe | Sintoma | Ação |
|---|---|---|
| Ledger sub-registrado | `42P07 already exists` | `repair --status applied` |
| Renumeração | mesmo nome, duas versões (uma 2026, uma 2027) | reconciliar antes de aplicar em prod |
| Órfã em prod | versão no ledger sem arquivo no repo | recuperar do ledger ou aceitar a lacuna |
