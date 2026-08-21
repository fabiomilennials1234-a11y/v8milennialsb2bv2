# Merge de leads — o que muda quando a `develop` subir

**Escrito em 2026-08-14, antes de construir o merge na `main`.**

A fusão de leads está sendo construída contra a **`main`**. A `develop` traz um modelo
diferente de Lead↔Negócio que **ainda não está em produção** mas sobe em breve. Este
documento existe para que quem for adaptar o merge depois não precise redescobrir a
divergência — e para que ninguém aplique o código da `main` na `develop` achando que é a
mesma coisa.

> **Não é conflito de texto.** `git merge` não vai acusar nada. A divergência é de
> comportamento: os mesmos arquivos, com a mesma forma, operando sobre um modelo de dados
> diferente.

---

## Medição (2026-08-14)

```
merge-base main..develop : d4bbb5b8
commits só na develop    : 207
commits só na main       : 103
migrations só na develop : 29
```

`lead_social_identities` **não existe** na `develop` — não há colisão de nome nem de
timestamp com a migration da fatia de Instagram. O que colide é o *significado* de mesclar.

---

## O que a `develop` muda no modelo

### 1. O Negócio vira a entidade que ocupa posição no funil

`pipeline_entries` ganha `deal_id`, com índice único parcial
(`uq_pipeline_entries_deal_id ... WHERE deal_id IS NOT NULL`). O COMMENT da migration
declara a regra, citando a ADR-0023, decisão 5:

> *"um Negócio ocupa uma posição. Parcial porque `deal_id` NULL é o estado normal do card
> ainda não backfillado, e NULL não conflita — é o que permite o rollout org a org."*

`custom_pipe_entries` recebe `deal_id` pelo mesmo caminho (nullable, sem default).

**Consequência para o merge:** na `main`, mesclar dois leads significa reconciliar
*posições de funil*. Na `develop`, significa reconciliar *negócios* — e cada negócio tem
posição própria, dono próprio e valor próprio.

### 2. Um lead pode ter VÁRIOS negócios

A migration `20270730000050_deal_por_lead_destrava` remove a restrição de um negócio por
lead. `bulk_move_stage(p_lead_ids uuid[], p_target_pipe, p_target_stage)` foi reescrita
em cima disso.

**Consequência para o merge:** juntar dois leads que têm negócios abertos **no mesmo
funil** não é mover um card. É uma decisão de produto que não existe na `main`:

- vira um negócio só, somando valor? (perde histórico de um)
- ficam os dois, no mesmo funil, do mesmo lead? (o modelo permite)
- quem fica sendo o dono, se os negócios têm donos diferentes?

Nenhuma dessas perguntas tem resposta hoje, e **nenhuma delas aparece na `main`**.

### 3. `leads` ganha `claimed_by` / `claimed_at`

```sql
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS claimed_by uuid,   -- FK team_members ON DELETE SET NULL
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
```

O COMMENT declara a semântica, e ela é a chave para entender o merge:

> *"Vendedor que ASSUMIU o lead para si (decisão C: **o lead é da organização, o negócio é
> do vendedor**). NÃO é atribuição formal de responsabilidade — para isso existem
> `responsible_id` / `sdr_id` / `closer_id`, que carregam comissão e roteamento."*

E uma sutileza que o merge precisa respeitar:

> *"quando o vendedor sai da equipe a FK zera só `claimed_by` e `claimed_at` fica como
> resíduo histórico. Logo: lead não assumido é `claimed_by IS NULL`, NUNCA
> `claimed_at IS NULL`."*

**Consequência para o merge:** mesclar dois leads assumidos por vendedores **diferentes**
é tirar um lead de um vendedor. Isso é decisão de gente, não de código — provavelmente
precisa de confirmação explícita na UI, e de trilha em `lead_history`.

### 4. RPCs novas que o merge precisa usar em vez de escrever direto

| RPC | Assinatura |
|---|---|
| `abrir_negocio` | `(p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid DEFAULT NULL, p_value numeric DEFAULT NULL, …)` |
| `mover_negocio` | `(p_entry_id uuid, p_target_pipeline_id uuid, p_target_stage_key text, p_stage_origem text DEFAULT NULL, p_assigned_to uuid DEFAULT NULL) RETURNS uuid` |
| `bulk_move_stage` | `(p_lead_ids uuid[], p_target_pipe text, p_target_stage text)` — reescrita |
| `fn_negocio_titulo_padrao` | `(p_when timestamptz, p_timezone text DEFAULT 'America/Sao_Paulo') RETURNS text` |

Na `main` o merge pode mover `pipeline_entries` com UPDATE. Na `develop`, **não deveria**:
essas RPCs carregam regra (título padrão, dono, trilha) que um UPDATE direto pularia em
silêncio.

### 5. O negócio deixou de nascer sozinho

`20270730000040_auto_seed_deal_manual_only` reescreve
`fn_auto_assign_lead_default_pipe`. O gatilho passa a respeitar
`app.skip_default_pipe` e um modo **manual-only**.

**Consequência para o merge:** o lead resultante da fusão pode nascer sem negócio nenhum,
dependendo da configuração da org — e isso é o comportamento CORRETO lá, não um bug.
Na `main`, o `create_lead_from_social_conversation` já usa
`set_config('app.skip_default_pipe','1', true)` pelo mesmo motivo; o mecanismo existe nas
duas, o default é que muda.

---

## O que fazer quando a `develop` subir

1. **Reler este documento antes de tocar no merge.** As decisões abaixo não foram tomadas.
2. **Responder as três perguntas da seção 2** — são de produto, não de engenharia:
   negócios no mesmo funil viram um ou dois; quem fica dono; o que acontece com o valor.
3. **Trocar UPDATE direto por `mover_negocio` / `abrir_negocio`** onde o merge mexer em
   posição de funil.
4. **Tratar `claimed_by` divergente** como caso que exige confirmação humana explícita.
5. **Reconciliar a implementação da `main`** — ela vai existir e vai estar errada para o
   modelo novo. Não é conflito de texto; é reescrita da parte que move entradas de funil.

## O que NÃO muda

`lead_social_identities`, a RPC de vínculo, o gate `can_link_or_read_lead` e a sugestão
de "é a mesma pessoa?" **não dependem do modelo de negócios**. Foram construídos na `main`
e atravessam a `develop` sem adaptação — o que muda é só o que acontece com os funis na
hora de fundir.
