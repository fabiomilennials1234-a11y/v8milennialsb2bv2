# S11 — escopo revisado depois do portão

**Data:** 2026-07-31
**Substitui:** a FASE 3 de `docs/superpowers/specs/2026-07-30-torquecalls-contrato-e-s11-design.md`
**Motivo:** o spec foi escrito antes do teste ao vivo. O portão respondeu as duas perguntas que
travavam o desenho, e o produto mudou embaixo dele.

---

## O que o portão provou (e o spec só supunha)

| Premissa | Como ficou | Evidência |
|---|---|---|
| O volume da VPS persiste? | **Sim** | `up -d` com imagem nova, `torquecalls.db` sobreviveu com o mesmo timestamp. `-db` é caminho absoluto em `/data`, volume nomeado `torquecalls_sqlite` |
| O whatsmeow aceita call-id que não foi ele quem sorteou? | **Sim** | Ligação completa, com áudio, usando `47F3BE7C53C44C9FA810996CF357B117` — cunhado pelo CRM |
| Os eventos saem do broker? | **Sim** | O front os consome hoje em produção |

A **decisão de chave está confirmada**: a privada do webhook pode nascer no processo e viver ao lado
do banco, sem plano B.

A **Opção A do `cid` está confirmada**: o CRM cunha, a VPS adota. Não precisa da alternativa.

---

## O que mudou no escopo, e por quê

### Saiu: alimentar a interface

O spec assumia que o S11 traria os eventos de chamada para o CRM e a UI leria do banco.

**O front passou a ouvir o stream SSE direto** (PR #1326). Ele já sabe quando toca, quando atende e
quando o outro lado desliga — sem passar pelo servidor. Fazer o S11 alimentar a UI seria duplicar um
caminho que já funciona, e mais lento.

### Saiu: o varredor de chamada travada

Era da fase 3 no spec. **Foi puxado e está em produção** (`voip-sweep-stuck-calls`), porque sem ele
o operador travava depois da primeira ligação que não terminasse pelo botão. Já provou seu valor:
4 das 7 chamadas registradas foram recolhidas por ele.

### Saiu: a fila durável (S13)

Decisão do CTO em 2026-07-31. Sem outbox, um evento perdido é coberto por duas redes que já
existem: o varredor fecha a linha, e a reconciliação corrige a sessão. O custo de construir fila,
retry e dead-letter no Go — onde **tudo é greenfield** — não se paga nesta fatia.

Fica registrado como trabalho futuro, não como esquecimento.

### Fica: os dois trabalhos que ninguém mais faz

**1. Promover a sessão sem mão humana.**
Hoje `voip_sessions.status` só chega a `open` porque alguém escreveu no banco. Enquanto for assim, o
produto não funciona para cliente nenhum sem intervenção.

**2. Encher o ledger com o que aconteceu de verdade.**
Medido em 2026-07-31, depois do primeiro áudio funcionar:

```
7 chamadas registradas
0 com connected_at
4 fechadas por 'no_terminal_event' (o varredor)
3 fechadas por 'user_ended' (o operador clicou)
```

**Nem a ligação que teve áudio tem `connected_at`.** O CRM não sabe a duração de nenhuma chamada —
não há taxa de atendimento, tempo médio, nem base para comissão por ligação. É o buraco que só o
webhook fecha, porque o stream do navegador morre quando a aba fecha.

---

## O desenho, agora

### Envelope

Segundo par Ed25519, sentido oposto ao de hoje: **a VPS assina, o CRM verifica**.

A privada nasce no processo Go na primeira subida sem chave, gravada com `0600` ao lado do banco
(caminho absoluto, volume confirmado). Só a pública vai para o log e para os segredos do Supabase.

Assinatura sobre os **bytes crus** do corpo. Claims: `bh` (SHA-256 do corpo), `jti`, `iat`, `exp`
(300 s), `aud`, `env`, `kid`, `sid`, e o par `(epoch, seq)` para ordem.

`epoch` é global do processo, persistido no SQLite e incrementado uma vez por boot; `seq` é por
sessão. Sem `epoch`, o primeiro reinício faria o CRM recusar tudo para sempre como "evento velho".

**Gate da chave pública: auto-teste no boot**, não blocklist. Ao carregar cada `kid`, verificar um
par de fixtures — assinatura boa tem que dar `true`, ruim tem que dar `false`. Falhou, a função
recusa servir. Pega chave de ordem pequena, trocada, truncada e runtime sem Ed25519 com um
mecanismo só.

### Eventos que interessam

| Evento | Para quê |
|---|---|
| `auth-state` com `paired: true` | promove a sessão para `open` |
| `auth-state` com `logged_out` | fecha a sessão |
| `call-status` `connected` | grava `connected_at` — **é o que falta hoje** |
| `call-ended` | grava `ended_at` e o motivo real, no lugar de `no_terminal_event` |

### Webhook

`supabase/functions/torquecalls-webhook/index.ts`, `verify_jwt = false`.

**Sem CORS e sem OPTIONS** — quem chama é a VPS, não um navegador. Mesmo desvio que o
`whatsapp-webhook` já faz.

Ordem das barreiras, deliberada:

1. Limite de rajada em memória, por isolate
2. Teto de tamanho do corpo
3. **Assinatura, antes de qualquer consulta ao banco** — Ed25519 é barato; consultar o Postgres com
   payload não autenticado é o que vira amplificação. O limitador persistente do projeto falha
   **aberto** em erro de banco, então ele não pode ser a primeira barreira
4. Só então derivar a organização

**A organização sai de `voip_sessions`, nunca do corpo.** A claim `org` não autoriza — serve para
comparar; divergiu, é 403 com registro de tentativa cross-tenant.

### Máquina de estados

Mora numa RPC `SECURITY DEFINER`, `service_role` apenas. Numa transação: reivindica o `jti`, barra
`seq`/`epoch` velho, aplica a transição, escreve no ledger.

Transições de sessão (a VPS emite `qr`, `open`, `logged_out` — não emite `connecting` nem
`quarantined`):

| Estado no CRM | `qr` | `open` | `logged_out` |
|---|---|---|---|
| `pending` | → `pairing` | → **`open`** | → `closed` |
| `pairing` | → `pairing` | → **`open`** | → `closed` |
| `open` | recusa ¹ | no-op | → `closed` |
| `closed` | → `pairing` | recusa ² | no-op |
| `quarantined` | recusa e alarma | recusa e alarma | recusa e alarma |

¹ Re-pareamento legítimo passa pelo CRM, que escreve `pairing` antes. QR numa sessão `open` sem isso
é replay ou sequestro. Aceito dentro de 5 min após um `pairSession` originado aqui.

² `closed` é o único status que **não** ocupa vaga no teto. Promover direto da VPS re-consome vaga
passando por fora do gate comercial.

**`pending` promove** — sessão adotada fica em `pending` para sempre, e promover só a partir de
`pairing` produziria um bug indistinguível do de hoje.

A fonte é o `AuthSnapshot` do evento, nunca `info()` — este calcula `Paired: a.Paired || jid != ""`,
que diverge no restore e no re-pareamento.

### Ledger

| VPS emite | CRM aceita | Tradução |
|---|---|---|
| `starting` | — | → `ringing` |
| `ringing` | sim | direto |
| `connected` | sim | direto, **grava `connected_at`** |
| `ended` | sim | direto, grava `ended_at` |
| motivo terminal (`rejected`, `no_answer`, …) | — | → `ended` + motivo em `end_reason` |

Casamento por `(tc_session_id, tc_call_id)`. **Nunca por `peer`** — o JID perde o 9º dígito do
celular brasileiro.

**A corrida com o varredor.** Ele fecha `ringing` com mais de 2 min. Um `connected` que chegue
depois encontra a linha já `ended`. Regra: evento de vida **ressuscita** linha fechada por
`no_terminal_event` (e só por esse motivo), desde que o operador não tenha outra viva. A
ressurreição é registrada — ela significa que a entrega está lenta.

### Reconciliação

Cron no CRM, um token de plano de controle **por organização**, não de alcance global. A VPS já
filtra no lado dela quando o token traz uma org; com alcance global ela devolveria as sessões de
todos os tenants para dentro da edge function.

O próprio CRM já recusou essa rota por escrito (`torquecalls-control/index.ts:300-304`).

**Não é anomalia:** no boot, a VPS apaga sessões sem `jid`. "Sumiu da VPS" é estado esperado
pós-restart.

### Recusa barulhenta

Toda recusa vira linha em `runtime_logs` com `module: 'voip'`.

O alerta no WhatsApp **não** funciona hoje (issue #1320, token inválido desde 13/07). Quando voltar:
passa pelo client compartilhado — **não** pelo `support-notify-staff`, que é o único envio do
produto sem disjuntor e foi exatamente o que falhou calado por 17 dias. Janela de dedup própria,
porque a função de dedup existente devolve "não é duplicado" quando falta org ou telefone.

---

## Fora de escopo, explicitamente

- **Fila durável (S13)** — decisão do CTO nesta data
- **Descoberta de sessão órfã** na reconciliação — exige mudança no Go
- **Alimentar a UI** — o stream já faz
- **#1319, #18, #19** — continuam na fila
