# Runbook — ativar a chamada de voz (TorqueCalls)

Da fundação até um vendedor clicar e falar. Ver `docs/adr/0024-torquecalls-voice-call-plane.md` para o porquê de cada peça.

**Estado ao escrever isto:** S8/S9 já em produção; S10, S12 e S14 no PR #1317; S5 no PR #16 do repo `torquecalls`. `voice_calls_enabled = false` nas 137 instâncias — nada disca até o passo 6.

**Tempo:** ~30 min, sendo um passo humano (ler o QR).

---

## Regra que vale para o runbook inteiro

> **Deploy de edge function empacota `_shared/` do WORKING TREE.**
> Deployar de um checkout atrasado REVERTE em produção o que está na `main`. Já aconteceu neste repo: um doc do Marcelo ficou morto de 14 a 21 de julho.

Antes de qualquer `functions deploy`, confirme onde você está:

```bash
cd ~/Dev/wt-torquecalls-s8       # o worktree desta branch
git log --oneline -1             # tem que ser o commit da S14
```

---

## 1. Gerar o par de chaves

A privada assina no Supabase; a VPS só recebe a pública. **VPS comprometida verifica, não cunha.**

```bash
cat > /tmp/genkey.ts <<'EOF'
const kid = Deno.args[0] ?? "tc1";
const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/") + "=".repeat((4-s.length%4)%4)), c=>c.charCodeAt(0));
const seed = b64u(jwk.d!), pub = b64u(jwk.x!);
const sk = new Uint8Array(64); sk.set(seed,0); sk.set(pub,32);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
console.log("TORQUECALLS_SIGNING_SK=" + b64(sk));
console.log("TORQUECALLS_TOKEN_PUBKEY=" + kid + ":" + b64(pub).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""));
EOF
deno run --allow-env /tmp/genkey.ts tc1
```

Confira o formato — errar aqui só aparece lá na frente, como "a chamada não completa":

- `TORQUECALLS_SIGNING_SK` → **88 caracteres** (64 bytes em base64: seed‖pub, o formato do `ed25519.GenerateKey` do Go)
- `TORQUECALLS_TOKEN_PUBKEY` → `tc1:` + **43 caracteres** em base64url

> A privada nunca sai do gerenciador de segredos. Se ela vazar, qualquer um autoriza chamada em nome de qualquer organização. Rotação: gere um `tc2`, ponha as DUAS no `TORQUECALLS_TOKEN_PUBKEY` da VPS separadas por vírgula, troque a `SK` do Supabase, e só então remova a `tc1`.

---

## 2. Segredos no Supabase (produção)

```bash
supabase secrets set --project-ref jsjsmuncfkbsbzqzqhfq \
  TORQUECALLS_SIGNING_SK='<a SK do passo 1>' \
  TORQUECALLS_SIGNING_KID='tc1' \
  TORQUECALLS_AUDIENCE='calls.torquecrm.com.br' \
  TORQUECALLS_ENV='prod' \
  TORQUECALLS_VPS_URL='http://127.0.0.1:8080' \
  TORQUECALLS_PUBLIC_URL='https://calls.torquecrm.com.br'
```

- `AUDIENCE` é o host EXATO da VPS. A VPS recusa token cuja `aud` não seja ela.
- `ENV=prod` impede que um token de desenvolvimento disque em produção, mesmo que alguém copie o segredo.
- `VPS_URL` é por onde a edge function alcança a VPS; `PUBLIC_URL` é o que vai para o navegador. Enquanto não houver porta pública, os dois apontam para o túnel.

---

## 3. Deployar as duas edge functions

```bash
cd ~/Dev/wt-torquecalls-s8
supabase functions deploy torquecalls-signal  --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy torquecalls-control --project-ref jsjsmuncfkbsbzqzqhfq
```

**Verificação** — sem sessão nenhuma, a resposta certa é uma recusa limpa, não um 500:

```bash
curl -s -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/torquecalls-signal \
  -H "Authorization: Bearer <JWT de um admin>" -H "Content-Type: application/json" \
  -d '{"action":"streamToken","tc_session_id":"nao-existe"}'
# esperado: {"error":"Sessão não encontrada"}  (404)
```

---

### Chave em uso (gerada e aplicada em 2026-07-30)

A privada está nos segredos do Supabase e **não existe em mais lugar nenhum** —
`secrets list` mostra digest, não valor. A pública fica registrada aqui porque
é ela que a VPS precisa, e derivá-la de novo exigiria a privada:

```
TORQUECALLS_TOKEN_PUBKEY=tc1:Yy8olykAFXM1zTWly9C15raWKsGfC88K5NhefK_jGUo
```

---

## 4. VPS — variáveis e imagem

Só quando o PR #16 (S5) estiver mergeado e a imagem reconstruída. **Antes disso a VPS ignora o token** e os passos 5–8 já funcionam.

Em `/opt/torquecalls/.env`:

```
TORQUECALLS_TOKEN_PUBKEY=tc1:<a pública do passo 1>
TORQUECALLS_AUDIENCE=calls.torquecrm.com.br
TORQUECALLS_ENV=prod
TC_ALLOWED_ORIGINS=https://torquecrm.com.br
```

> Com a S5, **faltar qualquer uma delas impede o processo de subir**. É de propósito: "sobe sem auth quando falta config" é como um serviço fica aberto por meses.

```bash
docker compose -f /opt/torquecalls/docker-compose.yml up -d
docker logs --tail 20 torquecalls   # tem que aparecer "HTTP server listening"
```

---

## 5. Registrar a sessão no CRM

Escolha a instância de WhatsApp que vai receber voz — **é dela que saem as chaves de desligar**.

```sql
-- Qual instância? (Milennials, para o piloto)
select id, instance_name, phone_number, status, voice_calls_enabled, daily_call_cap
from whatsapp_instances
where organization_id = '6030520a-2ca7-477d-be89-55758e2cd808'
order by created_at;
```

Criar a sessão pelo plano de controle (preferido — a VPS e o CRM nascem em acordo):

```bash
curl -s -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/torquecalls-control \
  -H "Authorization: Bearer <JWT de um admin da org>" -H "Content-Type: application/json" \
  -d '{"action":"createSession","whatsapp_instance_id":"<id da instância>","name":"Voz Milennials"}'
# devolve {"tc_session_id":"...","status":"pending"}
```

> Se a sessão já existir na VPS (o caso do spike), use `adoptSession` com o `tc_session_id` dela em vez de criar outra.

---

## 6. Ligar a chave

**Este é o passo que tira a feature do estado inerte.** Antes dele nada disca; depois dele, a org pilota está viva.

```sql
update whatsapp_instances
   set voice_calls_enabled = true,
       daily_call_cap = 20          -- comece baixo: risco de ban só é medível em dias
 where id = '<id da instância>';
```

Desligar num incidente é a mesma linha com `false`. É o primeiro lugar a olhar, e fica ao lado do `daily_blast_cap`, que governa mensagem.

---

## 7. Parear (único passo humano)

```bash
curl -s -X POST .../torquecalls-control -H "Authorization: Bearer <JWT admin>" \
  -H "Content-Type: application/json" \
  -d '{"action":"pairSession","tc_session_id":"<sid>"}'
```

O QR chega pelo stream de eventos. **Ele é credencial** — quem lê, pareia o WhatsApp da organização; por isso só sai para quem tem `voip.session.manage`.

Leia o QR no WhatsApp do número (Aparelhos conectados → Conectar aparelho). Depois:

```sql
select tc_session_id, status, jid from voip_sessions where organization_id = '...';
-- status tem que virar 'open' e jid ser preenchido
```

> Lembre do limite: 1 celular + **4 aparelhos vinculados**. O Uazapi já ocupa um. Cliente com 4 vinculados falha aqui.

---

## 8. Consentimento do lead de teste

Chamada exige opt-in **separado** do de mensagem. E ele não é auto-serviço: `source` `manual` é recusado de propósito — vendedor afirmando o consentimento do lead não é consentimento.

```sql
select public.fn_voip_consent_record(
  '6030520a-2ca7-477d-be89-55758e2cd808'::uuid,  -- org
  '<lead_id>'::uuid,
  true,
  'api',                                          -- form | api | webhook
  '<telefone do lead>'
);
```

---

## 8b. Expor a VPS — decisão (a), preparada em 2026-07-30

`torquecalls-signal` roda na nuvem do Supabase, não na sua máquina. Quando ela
disca, faz `POST` na VPS — e o túnel SSH só serve ao SEU navegador. Sem essa
perna, `startCall` sempre devolve `vps_refused`.

### O que já está pronto

- O container foi conectado à rede overlay `easypanel` (attachable), então o
  Traefik alcança `http://torquecalls-torquecalls-1:8080`. **Verificado**: a
  requisição interna já responde.
- A rota está escrita em `/etc/easypanel/traefik/config/torquecalls.yaml.disabled`,
  YAML validado, sem colisão de router/service com o `main.yaml` e sem outro app
  disputando o domínio.

O arquivo é SEPARADO de propósito: o EasyPanel regenera `main.yaml` e sobrescreve
edição manual, mas o Traefik roda com `TRAEFIK_PROVIDERS_FILE_DIRECTORY=/data/config`
— **diretório**, não arquivo — e `WATCH=true`. Um segundo arquivo ali é carregado
junto e sobrevive à regeneração.

### A ordem que não dá para furar

A imagem no ar é `sha-062d577`, herdada do espelho AstraCalls. Ela autentica por
`WACALLS_API_KEY` — **uma chave global, sem noção de tenant** — e não entende o
token assinado que o CRM manda. Expor essa imagem seria publicar a API errada, e
o `startCall` do CRM levaria 401 de qualquer jeito.

Então:

1. **Mergear o PR #16** (S5) no repo `torquecalls`.
2. Construir e publicar a imagem nova.
3. Em `/opt/torquecalls/.env`, acrescentar as quatro variáveis do passo 4 e
   trocar, na mesma janela:
   ```
   WACALLS_PUBLIC_IP=46.202.148.241      # era 127.0.0.1
   ```
   e publicar a porta de mídia no compose:
   ```yaml
   ports:
     - "127.0.0.1:8080:8080"
     - "50000:50000/udp"
     - "50000:50000/tcp"
   ```
   Sem isso o navegador do vendedor até sinaliza, mas o áudio não passa: o ICE
   precisa alcançar a VPS na 50000. A sessão do WhatsApp sobrevive ao recreate
   (já foi observado aguentar 4 restarts).
4. `docker compose up -d` e conferir `docker logs` — com a S5, faltar variável
   impede o processo de subir.
5. **Só então** ativar a rota:
   ```bash
   cd /etc/easypanel/traefik/config
   mv torquecalls.yaml.disabled torquecalls.yaml
   # o watch pega em segundos; não reinicie o Traefik
   ```
6. Verificar de fora:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://calls.torquecrm.com.br/api/sessions
   # esperado: 401 (sem token) — e certificado válido, emitido pelo letsencrypt
   ```

Desfazer é `mv torquecalls.yaml torquecalls.yaml.disabled`. Nada do que o
EasyPanel gerencia foi tocado.

---

## 9. Front

Merge **não** deploya. Depois do merge do PR #1317, subir a imagem nova pelo EasyPanel, à mão.

---

## 10. Primeira chamada

1. Abrir o chat do lead de teste no CRM.
2. O botão **Ligar** aparece no cabeçalho — se não aparecer, a sessão não está `open` (passo 7).
3. Clicar. O navegador pede microfone **antes** de discar: é assim de propósito, para uma permissão negada não deixar o telefone do lead tocando sem ninguém do outro lado.
4. O painel mostra `Chamando…` e depois `Em chamada`, com cronômetro.

Enquanto isso, o que olhar:

```sql
-- a chamada no ledger
select id, status, direction, peer_phone, authorized_at, ringing_at, connected_at, end_reason
from voip_calls order by authorized_at desc limit 5;

-- o contador do dia
select * from voip_call_usage order by usage_date desc limit 3;

-- negativas do governor, se houver
select action, status, payload_snapshot, created_at
from runtime_logs where module = 'voip' order by created_at desc limit 20;
```

### Se recusar, o código diz onde parou

| Código | O que fazer |
|---|---|
| `voice_calls_disabled` | passo 6 |
| `session_not_open` | passo 7 — o pareamento não completou |
| `consent_missing` | passo 8 |
| `not_lead_owner` | o lead não é do operador; use um lead dele ou entre como admin |
| `lead_without_phone` | o lead não tem telefone utilizável |
| `daily_cap_reached` | `daily_call_cap` na instância |
| `operator_busy` | há chamada viva do mesmo operador; encerre antes |

---

## Desfazer

Ordem inversa, e a primeira linha já basta para parar tudo:

```sql
update whatsapp_instances set voice_calls_enabled = false where id = '<id>';
```

Depois, se for para desmontar mesmo: `logoutSession` → `deleteSession` → apagar a linha de `voip_sessions` → `docker compose down` na VPS.

O rollback do banco é `supabase/migrations/rollback/20270730000000_torquecalls_voip_foundation.sql`, mas leia o cabeçalho dele antes: a segunda metade desfaz endurecimento de `consent_records` e `call_logs` que **não tem nada a ver com voz**.

---

## O que ainda não existe

- **Webhook VPS→CRM (S11/S13).** A chamada funciona e o áudio também, mas o CRM não fica sabendo que tocou, atendeu ou encerrou por conta própria: `voip_calls` só avança pelo que o operador faz na tela, e `call_logs` não é escrito. É a próxima fatia.
- **Porta pública.** Tudo acima roda por túnel SSH. Expor é o último passo, por decisão de desenho.
- **Chamada de entrada.** Toca na VPS, mas sem `session.policy` uma org com a voz desligada continuaria tocando. Vai junto com o webhook.
