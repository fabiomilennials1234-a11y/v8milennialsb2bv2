# Relatório do ensaio #1721 — execução de 2026-08-23

Saída literal de `scripts/ensaio-1721.sh` contra **produção** (`jsjsmuncfkbsbzqzqhfq`),
autorizada pelo CTO para aquela execução. **14/14 asserções passaram, `ROLLBACK` executado,
nada aplicado.** O relatório abaixo só é impresso se nenhuma asserção tiver disparado antes dele —
uma que dispare aborta a transação e nada é impresso.

Este arquivo existe porque o `/code-review` apontou, com razão, que os números viviam só como prosa
no `PLANO-1721.md`: prova que não pode ser reconferida a partir do repo não é prova, é afirmação.
O artefato montado (`.ensaio-*.montado.sql`) segue fora do git — ele é derivado, reconstituível a
qualquer momento com `scripts/ensaio-1721.sh --montar`.

**Ressalva de proveniência, dita com todas as letras:** este é o texto que a execução devolveu,
transcrito. Não é um arquivo que o script escreveu sozinho — o `ensaio-1721.sh` imprime em stdout e
não captura. Quem quiser reconferir tem de reexecutar, e reexecutar contra produção exige nova
autorização. Melhoria óbvia para o próximo ensaio: `tee` para um arquivo datado.

```json
{
    "tabela": "public.blast_plan_recipients",
    "ticket": 1721,
    "policies": [
        { "cmd": "SELECT", "nome": "master_select_all_blast_plan_recipients" },
        { "cmd": "SELECT", "nome": "tenant_isolation_select" }
    ],
    "grants_antes": [
        "authenticated.DELETE=true",
        "authenticated.INSERT=true",
        "authenticated.SELECT=true",
        "authenticated.UPDATE=true",
        "mcp_readonly.SELECT=true",
        "service_role.DELETE=true",
        "service_role.INSERT=true",
        "service_role.SELECT=true",
        "service_role.UPDATE=true"
    ],
    "colunas_novas": [
        "actual_cost",
        "claimed_at",
        "delivered_at",
        "estimated_cost",
        "provider_message_id",
        "sent_at"
    ],
    "indices_antes": [
        {
            "def": "CREATE UNIQUE INDEX blast_plan_recipients_pkey ON public.blast_plan_recipients USING btree (id)",
            "nome": "blast_plan_recipients_pkey"
        },
        {
            "def": "CREATE INDEX idx_blast_plan_recipients_instance ON public.blast_plan_recipients USING btree (plan_id, lot_index, instance_id) WHERE (status = 'pending'::text)",
            "nome": "idx_blast_plan_recipients_instance"
        },
        {
            "def": "CREATE INDEX idx_blast_plan_recipients_lot ON public.blast_plan_recipients USING btree (plan_id, lot_index, status)",
            "nome": "idx_blast_plan_recipients_lot"
        }
    ],
    "nada_foi_aplicado": "a proxima instrucao e ROLLBACK",
    "destinatarios_total": {
        "antes": 235,
        "final": 235,
        "depois": 235
    },
    "check_depois_do_rollback": "CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))",
    "check_depois_da_migration": "CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text, 'delivered'::text, 'unconfirmed'::text])))",
    "indices_depois_da_migration": [
        {
            "def": "CREATE UNIQUE INDEX blast_plan_recipients_pkey ON public.blast_plan_recipients USING btree (id)",
            "nome": "blast_plan_recipients_pkey"
        },
        {
            "def": "CREATE INDEX idx_blast_plan_recipients_instance ON public.blast_plan_recipients USING btree (plan_id, lot_index, instance_id) WHERE (status = 'pending'::text)",
            "nome": "idx_blast_plan_recipients_instance"
        },
        {
            "def": "CREATE INDEX idx_blast_plan_recipients_lot ON public.blast_plan_recipients USING btree (plan_id, lot_index, status)",
            "nome": "idx_blast_plan_recipients_lot"
        },
        {
            "def": "CREATE UNIQUE INDEX idx_blast_plan_recipients_provider_message_id ON public.blast_plan_recipients USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL)",
            "nome": "idx_blast_plan_recipients_provider_message_id"
        }
    ],
    "check_vivo_medido_em_producao": "CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))",
    "distribuicao_por_org_e_status": [
        { "n": 1,   "org": "1ec200ca-d928-4b0c-bcd0-a9f4189876f5", "status": "failed" },
        { "n": 71,  "org": "1ec200ca-d928-4b0c-bcd0-a9f4189876f5", "status": "pending" },
        { "n": 59,  "org": "1ec200ca-d928-4b0c-bcd0-a9f4189876f5", "status": "sent" },
        { "n": 104, "org": "1ec200ca-d928-4b0c-bcd0-a9f4189876f5", "status": "skipped" }
    ]
}
```

## O que isto prova, linha por linha

- **`check_vivo_medido_em_producao`** — resposta ao item A do CTO. `failed` existe no CHECK vivo.
- **`check_depois_da_migration`** — os seis valores, superconjunto estrito.
- **`check_depois_do_rollback`** — de volta aos quatro. O rollback fecha.
- **`destinatarios_total`** — 235 nos três momentos. A migration não moveu linha.
- **`distribuicao_por_org_e_status`** — uma organização, quatro estados. Idêntica antes e depois
  (asserções 5 e 14 comparam por igualdade de conjunto, com dois `EXCEPT`).
- **`indices_antes` vs `indices_depois_da_migration`** — os três antigos com `pg_get_indexdef`
  literalmente igual, mais **um** novo, `UNIQUE` e parcial.
- **`policies` e `grants_antes`** — inalterados (asserções 9, 10 e 13).
