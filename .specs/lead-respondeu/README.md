# Prova do gatilho "lead respondeu" contra banco

O que não roda local (Docker e Supabase local são banidos) e por isso mora aqui:
a **revalidação do contexto persistido** em `process-workflow-executions`, que é
exatamente onde o filtro de funil já morreu uma vez.

## Como rodar

```bash
./scripts/supabase-branch.sh criar lead-respondeu          # anota o <ref>
node scripts/branch-apply-migrations.mjs --ref <ref>       # ~15 min
node scripts/branch-sql.mjs --ref <ref> --file .specs/lead-respondeu/seed.sql

BRANCH_URL="https://<ref>.supabase.co" BRANCH_KEY="<service_role>" \
  ORG_ID=11111111-1111-4111-8111-111111111111 \
  LEAD_ID=22222222-2222-4222-8222-222222222222 \
  STAGE_CERTA=55555555-5555-4555-8555-555555555555 \
  STAGE_ERRADA=66666666-6666-4666-8666-666666666666 \
  deno run --allow-net --allow-env --allow-read .specs/lead-respondeu/prova-branch-1-filtros.ts

BRANCH_URL=... BRANCH_KEY=... \
  deno run --allow-net --allow-env --allow-read .specs/lead-respondeu/prova-branch-2-cooldown.ts

./scripts/supabase-branch.sh derrubar <ref>                # preview custa por hora
```

## Resultado — branch `uxozdcumipbnwxpsikbn`, 2026-09-03

Replay: **293/295 migrations, 302 tabelas**. As 2 falhas são guardas que exigem
estado de prod (`demolicao_dos_espelhos` e `aposenta_calor_e_rating`) e não
tocam nenhuma tabela deste gatilho.

Arquivo 1 — 15 asserções, todas verdes:

| Prova | Resultado |
|---|---|
| Controle positivo: sem filtro, dispara e a revalidação aprova | ok |
| Instância certa dispara; `instance_id` sobrevive no context persistido | ok |
| Instância errada não dispara | ok |
| Evento sem instância não dispara (fail-closed) | ok |
| Etapa certa dispara — a posição é **lida do banco**, não vem no evento | ok |
| `lead_stage_ids` sobrevive no context persistido | ok |
| **A revalidação do worker aprova — o filtro não morre no round-trip** | ok |
| Etapa errada não dispara | ok |
| `after_outbound` dentro da janela dispara; `hours_since_outbound` persiste | ok |
| `after_outbound` fora da janela não dispara | ok |

Arquivo 2 — dedup e janela, 5 asserções verdes:

- Segunda resposta na mesma janela **não cria segunda execução**, medido com a
  execução anterior já FECHADA — sem isso o verde vinha da guarda de "workflow
  já ativo para o lead" e não do dedup. Foi o que aconteceu na primeira versão
  desta prova.
- O retorno do `fireTrigger` é a contagem **tentada**, não a criada: devolve 1
  no segundo disparo enquanto o banco mantém 1 linha só. É o que o módulo já
  documenta na linha do upsert, e nenhum caller usa o número para decidir nada
  (só entra num corpo de resposta HTTP).
- `cooldown_minutes: 1` produz balde de 60s e `cooldown_minutes: 60` produz
  balde de 3600s — controle positivo de que o valor da config chega até a chave.
- Sem `cooldown_minutes` na config, o padrão é 60 min (e não os 60s do resto do
  motor).

## Janela de deploy

Uma execução criada **antes** das edge functions subirem chega ao worker com
contexto antigo. Medido: com filtro novo o matcher **reprova** (fail-closed, não
dispara errado) e sem filtro continua passando. Por isso a ordem do deploy é
edge functions primeiro, front depois.
