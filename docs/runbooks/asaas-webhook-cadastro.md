# Runbook — cadastrar o webhook do Asaas

Como ligar o `asaas-webhook` (SCRUM-287) sem descobrir o erro pela receita que não chega.

> **A falha aqui é silenciosa.** Cadastro errado não dá erro na tela do Asaas: dá **15 falhas consecutivas e a fila PAUSA**. Em modo `SEQUENTIALLY`, um evento envenenado **bloqueia todos os seguintes**, e evento pausado **morre em 14 dias**. Quem cadastra errado descobre por cliente que pagou e não recebeu acesso.

## 1. Os dois segredos são NOSSOS, e não existem ainda

O Asaas **não assina o corpo** — não há HMAC. A autenticação é composta, e as duas primeiras camadas são strings que **nós escolhemos**:

| segredo | onde vive | quem escolhe |
|---|---|---|
| `ASAAS_WEBHOOK_PATH_SECRET` | último segmento da URL do webhook | **nós** |
| `ASAAS_WEBHOOK_TOKEN` | header `asaas-access-token` | **nós** — 32 a 255 chars |

Nenhum dos dois existe hoje. Gere:

```bash
openssl rand -hex 24   # ASAAS_WEBHOOK_PATH_SECRET
openssl rand -hex 32   # ASAAS_WEBHOOK_TOKEN  (>= 32 chars, exigência do Asaas)
```

**O token tem que bater dos DOIS lados**: o valor gravado no Supabase e o valor digitado no painel do Asaas são o mesmo. Divergiu, todo evento é recusado — e a fila pausa em 15.

## 2. Gravar como secret do Supabase

O `.env` da raiz **não chega em edge function**. Ele serve para `supabase functions serve` local.

```bash
supabase secrets set \
  ASAAS_WEBHOOK_PATH_SECRET='<o hex de 24>' \
  ASAAS_WEBHOOK_TOKEN='<o hex de 32>' \
  ASAAS_ENV='production' \
  --project-ref jsjsmuncfkbsbzqzqhfq
```

⚠️ **`ASAAS_ENV` falha FECHADO por desenho**: só o valor exato `sandbox` dispensa a allowlist de IP. Ausente, vazio ou escrito errado ⇒ o IP é **exigido**. Em produção isso é o que se quer; em ambiente de teste, `ASAAS_ENV=sandbox` é obrigatório, senão o sandbox nunca entra (ele entrega de IPs fora da lista publicada).

## 3. Deployar a função

**Merge não sobe edge function.** Sempre:

```bash
supabase functions deploy asaas-webhook --project-ref jsjsmuncfkbsbzqzqhfq
```

## 4. Cadastrar no painel do Asaas

`Integrações → Webhooks → Adicionar`:

| campo | valor |
|---|---|
| **URL** | `https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/asaas-webhook/<ASAAS_WEBHOOK_PATH_SECRET>` |
| **Token de autenticação** | o `ASAAS_WEBHOOK_TOKEN`, idêntico ao gravado no Supabase |
| **Tipo de envio** | `SEQUENTIALLY` |
| **E-mail** | um endereço monitorado — é por ele que o Asaas avisa fila pausada |
| **Eventos** | os `PAYMENT_*`. No mínimo: `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED` |

O segredo vai **no fim da URL** — é ele que a função compara em tempo constante. URL sem o segmento responde **404**, de propósito: para quem varre, a porta não existe. Isso significa que um cadastro com URL errada **não parece erro de autenticação**, parece endereço inexistente.

Sobre `SEQUENTIALLY`: ele garante ORDEM, e é o que permite confiar na sequência `CONFIRMED → RECEIVED`. O preço é que um evento preso bloqueia a fila. A função foi escrita para **nunca** devolver erro justamente por isso — mas a escolha do modo é sua.

## 5. Verificar que ligou

```sql
-- deve aparecer linha em segundos após o primeiro evento
select provider_event_id, event_type, status, received_at
from public.payment_webhook_events
order by received_at desc limit 10;
```

| `status` | significa |
|---|---|
| `applied` | evento reconhecido e aplicado |
| `unknown_type` | tipo que o handler ainda não mapeia — **absorvido de propósito**, esperando inspeção |
| `failed` | falha ao gravar; o Asaas reentrega em 30s |

Nada aparecendo, nesta ordem:

1. a função foi deployada? (`supabase functions list`)
2. a URL do painel tem o segmento secreto **e ele bate** com o secret?
3. o token do painel bate com `ASAAS_WEBHOOK_TOKEN`?
4. `ASAAS_ENV` está correto? Em produção, o IP de origem está entre `52.67.12.206`, `18.230.8.159`, `54.94.136.112`, `54.94.183.101`? Recusa por IP fica em `runtime_logs` com `action='asaas_webhook_ip_rejected'`.

```sql
select action, status, error_message, created_at
from public.runtime_logs
where module = 'billing' and action like 'asaas_webhook%'
order by created_at desc limit 20;
```

**O token nunca aparece nesses logs** — por desenho. Se você precisa conferi-lo, compare o do painel com o do `supabase secrets`, não procure no log.

## 6. Se a fila pausar

O Asaas avisa por e-mail (o do cadastro) e a fila fica parada até alguém reativar no painel. Antes de reativar, descubra **por que** falhou: a função responde 200 em corpo ilegível, evento sem id, tipo desconhecido e até falha de banco. Se ainda assim pausou, a causa está **antes** do handler — URL, token ou IP.

Reativada a fila, os eventos represados chegam de uma vez. A idempotência é do banco (`UNIQUE (provider, provider_event_id)`), então a enxurrada é segura: re-entrega não duplica linha.

## O que este runbook NÃO cobre

Criar cobrança. Isso é a fatia do link, usa a `ASAAS_API_KEY` e é outro segredo — o webhook **recebe**, não chama, e por isso não precisa da chave da API.
