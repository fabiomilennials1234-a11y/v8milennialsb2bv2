# Checklist de aplicação — Etapa 2: aposentar `calor` e `rating` (SCRUM-647)

Resolve a divergência **D3**: duas notas de calor medindo a mesma coisa, com
`COALESCE(..., 5)` inventando "morno" para quem não tem nota.

| Artefato | O que é | Estado |
|---|---|---|
| `supabase/migrations/20270925000000_aposenta_calor_e_rating.sql` | A remoção. Guardas G0–G3, backup, 13 cirurgias, 4 assinaturas, 2 views, DROP COLUMN, asserções 8.1–8.7. | **Escrita, NÃO aplicada** |
| `supabase/migrations/rollback/20270925000000_aposenta_calor_e_rating.sql` | Rollback pareado. Restaura coluna, dados, CHECK, views, parâmetros e grants. | Escrito |
| `scripts/ensaio-etapa2-calor.sh` | Ensaio abortável contra prod. | **Rodado em 2026-09-03: `ENSAIO_OK`** |
| `.specs/features/funis-unificacao/aviso-remocao-rating.md` | Aviso às orgs integradas. | Rascunho, envio do CTO |
| `supabase/functions/_shared/api/routes/leads.ts` + `leads-write.ts` + `public/api/openapi.json` | Contrato público. | Escrito, não deployado |

---

## 0. Estado medido em 2026-09-03

```
leads.rating (integer, DEFAULT 0, sem índice, sem policy)
  = 0        55.988 leads / 78 orgs   ← o default; não é opinião de ninguém
  = 5         1.725 leads / 48 orgs   ← o meio da régua; carimbo de UI
  ∉ {0,5}       275 leads             ← TODA a opinião real do produto
  IS NULL       208 leads / 18 orgs
  total ≠ 0   2.000 leads / 50 orgs

pipeline_entries.metadata->>'calor'
  chave presente   487 entradas / 28 orgs
  valor = 5        227 / 10 orgs
  valor JSON null  197 / 24 orgs
  ∉ {5,null}        63

workflows ATIVOS disparando por rating: 0
```

**A leitura que importa:** de 58 mil leads, **275** carregam uma nota que
alguém de fato escolheu. O resto é o zero do default e o cinco do meio da
régua. Não estamos removendo um sinal — estamos removendo a aparência de um.

---

## 1. Pré-condições (todas, nesta ordem)

- [ ] **1.1 — Etapa 1 (interface) EM PRODUÇÃO.** A UI parou de exibir e, o que
      importa aqui, parou de **enviar** `p_rating_min`, `p_rating_max`,
      `p_calor_min`, `p_calor_max`. Território do agente B.
      **Como conferir, e não é olhando o código:** com a Etapa 1 no ar, chamar
      o board e ver a requisição do PostgREST sem esses parâmetros no corpo.
      Front não deployado + migration aplicada = board vazio para todo mundo
      (ver §2).
- [ ] **1.2 — Aviso enviado** ao grupo A (orgs com integração que toca
      `rating`). Ver `aviso-remocao-rating.md` para o recorte.
- [ ] **1.3 — Janela de depreciação cumprida.** A API serve `rating: null`
      desde o deploy do passo 2; a chave só sai em **03/11/2026**. A migration
      **não precisa esperar** essa data — ela pode ir assim que 1.1 e 1.2
      estiverem prontos, porque `null` é servido por constante, não pela
      coluna. A data trava só a remoção da chave do payload, que é uma outra
      mudança, de 2 linhas, depois.
- [ ] **1.4 — Conferir o drift do ledger.** Vale o mesmo diagnóstico do
      `checklist-demolicao.md`: `supabase db push` é inutilizável neste estado
      (7 versões em prod sem arquivo, 2 arquivos fora do ledger, e a colisão em
      `20270917000000`). **Aplicar cirurgicamente, com ledger explícito.**
- [ ] **1.5 — Ordem entre as duas migrations pendentes.** A `20270920000000`
      (demolição dos espelhos, agente A) e esta comutam **por desenho**: esta
      opera sobre o corpo VIVO das funções (`pg_get_functiondef`), nunca sobre
      um corpo colado neste repositório. Se a demolição for aplicada primeiro,
      as 5 funções que hoje leem espelhos já vêm migradas e as cirurgias
      continuam casando. Se for aplicada depois, idem. **Não colar corpo de
      função nesta migration** — é isso que mantém as duas independentes.

---

## 2. Ordem de aplicação — FRONT → API → MIGRATION

A ordem não é preferência. Invertida, quebra.

| # | Passo | O que quebra se pular |
|---|---|---|
| 1 | **Front** (Etapa 1, agente B) em produção | Front antigo chama a RPC nova com `p_calor_min` e recebe **PGRST202** (`Could not find the function ... in the schema cache`). O board fica vazio para todas as orgs. |
| 2 | **Deploy das edge functions da API** (`leads.ts`, `leads-write.ts`) + `openapi.json` publicado | Nada quebra, mas a janela de depreciação não começa a contar. Este passo é seguro e **independente da migration**: `rating: null` vem de constante. |
| 3 | **Migration** `20270925000000` | — |
| 4 | **Regenerar `types.ts`** (só DEPOIS do apply) | `tsc` só acusa os sítios sobrantes depois da regeneração. É essa passada que produz a lista final do que ficou para trás. |

```bash
# passo 4, depois do apply
supabase gen types typescript --project-id jsjsmuncfkbsbzqzqhfq > src/integrations/supabase/types.ts
npm run typecheck:ratchet
```

**O PGRST202 é deliberado.** Preferimos o erro alto e imediato a um filtro que
silenciosamente para de filtrar. Nenhum dado é corrompido no caminho: o pior
caso é uma tela vazia até o front certo subir.

---

## 3. Verificação pós-apply

- [ ] **3.1 — As asserções já rodaram.** 8.1 a 8.7 estão DENTRO da migration:
      se ela commitou, elas passaram. Não repetir à mão.
- [ ] **3.2 — Editar um lead pela tela.** É a prova que nenhuma asserção
      substitui: `fn_track_lead_field_changes` e `trigger_workflow_field_changed`
      leem os campos por nome em tempo de execução
      (`EXECUTE format('($1).%I', v_field)`). Se `rating` tivesse ficado num
      dos dois arrays, **todo UPDATE de lead do produto** quebraria com
      `column "rating" not found in data type leads` — e só no primeiro
      UPDATE, não no apply. O ensaio cobre isso (prova P8); repetir na tela
      real depois do apply.
- [ ] **3.3 — Abrir um board de funil** e paginar. Exercita
      `get_pipeline_page` + `get_pipeline_stage_counts_by_id` recriadas.
- [ ] **3.4 — `GET /api/v1/leads`** com uma chave real: `rating` presente e
      `null`; **`PATCH`** com `rating` no corpo: responde 200 e ignora o campo.
- [ ] **3.5 — Backup fechado.** A asserção 8.5 já conferiu, mas confirmar de
      fora, com os olhos:
      ```sql
      SELECT has_schema_privilege('anon','backup','USAGE'),
             has_table_privilege('anon','backup.leads_rating_20270925','SELECT');
      -- as duas TÊM que ser false
      ```
- [ ] **3.6 — Contagem do backup** bate com o que existia:
      ```sql
      SELECT count(*), count(*) FILTER (WHERE e_opiniao) FROM backup.leads_rating_20270925;
      -- esperado: ~57.988 e ~2.000 (o número exato varia com o tráfego do dia —
      -- a migration compara contra a origem viva, não contra este número)
      ```
- [ ] **3.7 — `runtime_logs`** sem `PGRST202` nas 2h seguintes. Se aparecer, é
      front antigo em cache: alguém pulou o passo 1.

---

## 4. Rollback

O backup é o que permite voltar. Ele é **atômico com o DROP**: se a migration
abortar, o backup aborta junto; se ela commitou, o backup commitou.

```bash
node scripts/prod-sql.mjs --file supabase/migrations/rollback/20270925000000_aposenta_calor_e_rating.sql
```

O arquivo restaura, nesta ordem: a coluna → **os valores, do backup** → o
CHECK → as duas views → as 13 cirurgias ao contrário → as 4 assinaturas com
os parâmetros de volta → os grants. E confere tudo no fim (§5 do arquivo).

**O núcleo da restauração**, se algum dia precisar ser feito à mão:

```sql
ALTER TABLE public.leads ADD COLUMN rating integer DEFAULT 0;

UPDATE public.leads l
SET    rating = b.rating
FROM   backup.leads_rating_20270925 b
WHERE  b.lead_id = l.id;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_rating_check CHECK (rating >= 0 AND rating <= 10);
```

O CHECK **depois** do UPDATE: antes, ele validaria 58 mil linhas contra o
DEFAULT em vez do dado restaurado.

**O que o rollback NÃO devolve:** as notas que alguém teria dado entre o apply
e o rollback. Depois do DROP não existe onde escrever nota, então não há perda
de escrita — mas há um buraco no tempo, e ele é permanente. Rodar cedo.

**O rollback não apaga o backup.** As duas tabelas são a evidência e
sobrevivem à volta. Apagar só quando a decisão estiver estável:

```sql
DROP TABLE backup.leads_rating_20270925, backup.entry_calor_20270925;
```

---

## 5. O que esta migration NÃO faz

- **Não apaga a chave `calor` das 487 entradas de `pipeline_entries`.**
  Decisão registrada na Seção 7 da migration: remover destrói e é
  irreversível na linha viva; deixar não custa nada, porque nenhum leitor
  sobra (asserções 8.2 e 8.3 provam). O SQL de remoção está no rollback,
  comentado, caso a decisão mude.
- **Não toca em `pipe_propostas_insert_fn` / `pipe_propostas_update_fn`.** São
  os gatilhos INSTEAD OF do espelho `pipe_propostas`, território da
  `20270920000000`, que os apaga inteiros. Escrevem `calor` no metadata a
  partir de `NEW.calor` — coluna da **view**, não de `leads` — e por isso não
  quebram com este DROP. Estão explicitamente excluídos da asserção 8.2.
- **Não mexe em `src/`.** Território do agente B (Etapa 1).
