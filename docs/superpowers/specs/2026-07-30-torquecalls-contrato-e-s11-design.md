# TorqueCalls — consertar o contrato, provar ao vivo, e só então o S11

**Data:** 2026-07-30
**Autor:** sessão de brainstorm com o CTO
**Referências:** ADR-0024, `.specs/torquecalls/HANDOFF-S11-E-PENDENCIAS.md`, issue #1320
**Repositórios:** CRM `fabiomilennials1234-a11y/v8milennialsb2bv2` @ `c3598cb3` · Go `torquecalls` @ `86c9502`

---

## Por que este spec não é o que foi pedido

O pedido era projetar o S11 — o webhook VPS→CRM com confiança invertida. A verificação de premissas
que precedeu o desenho derrubou a premissa central: **o S11 não tem sujeito.**

Três defeitos no contrato CRM↔VPS, ambos os lados já mergeados, matam o fluxo antes de qualquer
webhook. Nenhum foi observado em runtime porque **nada nunca rodou**:

| Medição em produção (`jsjsmuncfkbsbzqzqhfq`), 2026-07-30 | Valor |
|---|---|
| Linhas em `voip_sessions` | 0 |
| Linhas em `voip_calls` | 0 |
| Linhas em `runtime_logs` com `module='voip'` | 0 |
| Invocações de `torquecalls-control` / `torquecalls-signal` em 24h | 0 |

O handoff afirma que a tela de pareamento "opera hoje" (Caixa 1). Não opera. A afirmação veio de
teste local com dublê, não de medição.

Este spec cobre, numa sequência só: as três correções, o portão de prova ao vivo, e o S11.

---

## Decisões do CTO travadas nesta sessão

1. **Escopo do S11:** os três eventos de uma vez — `auth-state`, `call-status`, `call-ended`.
2. **Durabilidade:** outbox na VPS **mais** reconciliação no CRM.
3. **Recusa:** `runtime_logs` **mais** alerta no WhatsApp, com janela de dedup própria.
4. **Chave privada do webhook:** nasce no processo Go, vive no volume, nunca é lida por humano.
5. **Ordem:** corrigir contrato → provar ao vivo → S11. (Esta sessão.)

Decisões anteriores que continuam valendo (handoff de 2026-07-30):

- Confiança invertida: a VPS assina, o CRM verifica. Segundo par de chaves.
- **Sem atalho pela palavra do navegador.** Promover a sessão a partir do `auth-state` que o
  navegador recebe pelo SSE foi oferecido e **recusado**: é o vetor que a S5 matou. Identidade e
  fato nunca vêm do cliente.

---

# FASE 1 — Contrato

Três correções. Sem elas nada abaixo tem sujeito.

## 1.1 `pair_sid` — o pareamento por QR toma 401 e não existe

### O defeito

`signStreamToken` grava a claim `pair_sid` quando o modal de pareamento pede o token
(`_shared/voip/internal/sign.ts:255`, acionado por `torquecalls-signal/index.ts:133-146` quando
`body.pair === true`).

O decoder do Go recusa claim desconhecida por decisão explícita:

```go
// cmd/server/token.go:163
dec.DisallowUnknownFields() // claim que não conhecemos é erro, não ruído
```

E a struct `claims` (`cmd/server/token.go:49-71`) não tem esse campo. `git grep pair_sid` em todos
os `.go` da `origin/main`: **zero ocorrências**.

O campo existe no `principal` e está morto:

```go
// cmd/server/authz.go:47
pairSID    string // sessão autorizada a receber QR
```

Nunca é atribuído (o construtor em `authz.go:81-90` não o preenche) e nunca é lido.

**Consequência:** todo token de stream pedido com `pair: true` é recusado como `errTokenMalformed`,
o SSE nunca abre, o QR nunca chega. E o 401 é mudo de propósito (`authz.go:63-78`, log só em
`Debug`), então o sintoma chega ao operador como "a conexão com o servidor de voz caiu".

### A correção

**(a)** Campo na struct `claims`:

```go
// cmd/server/token.go, dentro de type claims struct
PairSid string `json:"pair_sid,omitempty"` // sessão autorizada a receber o QR
```

**(b)** Atribuição no construtor de `principal`:

```go
// cmd/server/authz.go, no literal &principal{...}
pairSID:    c.PairSid,
```

**(c)** Coerência escopo↔campo em `validate`, no mesmo lugar onde `vis` já é validado
(`token.go:235-238`): `pair_sid` só faz sentido em `scopeStream`. Presente em `admin` ou `call` é
erro de token.

### A correção que vem junto, e por quê

Acrescentar o campo faz o token **passar**. Não faz `pair_sid` **valer**.

Hoje o QR é publicado para todos os assinantes da organização:

```go
// cmd/server/broker.go:182-187
// emitSessionQR entrega o QR de pareamento. É o emissor mais sensível do broker:
// o QR não é dado, é credencial — quem o escaneia vincula um aparelho ao número.
func (b *Broker) emitSessionQR(orgID, sessionID, qr string) {
	b.publish(orgID, map[string]any{"type": "session-qr", "sessionId": sessionID, "qr": qr})
}
```

O CRM restringe quem **pede** `pair: true` a quem tem `voip.session.manage`
(`torquecalls-signal/index.ts:136-141`). A VPS não usa a claim para restringir a **entrega**. Ou
seja: qualquer operador da organização com um token de stream comum recebe a credencial de
pareamento. O comentário acima descreve uma proteção que só existe do lado do CRM.

**Correção:** `subscriber` ganha o campo `pairSID`, `subscribe` passa a recebê-lo do `principal`, e
`emitSessionQR` entrega apenas a assinantes cujo `pairSID` bate com a sessão do evento.

Isto fecha na VPS a mesma classe de furo que a S5 fechou, e é o mesmo arquivo.

## 1.2 `cid` — nenhuma ligação pode ser autorizada

### O defeito

O CRM assina `cid = voip_calls.id`, que é `uuid` (`_shared/voip/internal/sign.ts:174-184`;
`cid: callId` vindo de `fn_voip_call_reserve`). Formato: 36 caracteres com hífen.

A VPS exige outro formato:

```go
// cmd/server/callrouting.go:12
const callIDLen = 32

// cmd/server/callrouting.go:23-34
func validCallID(id string) bool {
	if len(id) != callIDLen { return false }
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c < '0' || c > '9') && (c < 'A' || c > 'F') { return false }
	}
	return true
}
```

Aplicado no token:

```go
// cmd/server/token.go:242
if !validCallID(c.Cid) {
	return fmt.Errorf("%w: cid fora do formato", errTokenClaims)
}
```

Um uuid nunca passa. **Todo token de escopo `call` é recusado antes de tocar handler nenhum.**

### O quarto corte, que o mesmo defeito esconde

```go
// cmd/server/authz.go:175-182
func callIDFor(p *principal, w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if p.callID == "" || id != p.callID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such call"})
		return "", false
	}
	return id, true
}
```

`p.callID` é o `cid` da claim (= `voip_calls.id`). Mas o CRM manda o **id de rede** no path:

- `torquecalls-signal/index.ts:232` — `/calls/${tcCallId}/accept`
- `torquecalls-signal/index.ts:280-281` — `DELETE /calls/${tc_call_id}` e `/reject`
- `src/modules/communication/lib/torquecallsApi.ts:269` — `/calls/${tcCallId}/webrtc`

São strings diferentes por construção → **404 em atender, desligar, recusar e alimentar mídia.**

### A correção: o CRM cunha o id, a VPS adota

**Lado CRM.** `fn_voip_call_reserve` passa a gerar `tc_call_id` no momento da reserva, no formato
que a VPS aceita:

```sql
upper(replace(gen_random_uuid()::text, '-', ''))
-- 32 caracteres de [0-9A-F], por construção
```

O valor é gravado em `voip_calls.tc_call_id` na própria reserva e devolvido junto com `call_id`.
`signCallToken` passa a mandar **esse** valor como `cid`.

**Lado Go.** `startOutgoing` recebe o id em vez de sorteá-lo:

```go
// cmd/server/session.go:103-111 — antes
func (s *Session) startOutgoing(ctx context.Context, peer types.JID, isVideo bool) (string, error) {
	callID := signaling.GenerateCallID()
	...
}

// depois: o id vem de quem autorizou
func (s *Session) startOutgoing(ctx context.Context, callID string, peer types.JID, isVideo bool) (string, error) {
	...
}
```

Alimentado do `principal` em `cmd/server/httpapi.go:296`.

**Guarda que não pode sumir:** `validCallID` continua sendo aplicado — em `validate` (token) e em
`callIDFromNode` (stanza de entrada). Ele deixa de ser barreira acidental e passa a ser o gate que
sempre quis ser: manter dado remoto num domínio fechado.

### O que se resolve de uma vez

1. Token de chamada passa a ser aceito.
2. `callIDFor` volta a fechar — o `cid` **é** o id de rede, então o vínculo token→chamada que a S5
   construiu passa a valer. Atender, desligar, recusar e webrtc param de dar 404.
3. `tc_call_id` existe **antes** de a VPS responder. Nenhum evento do S11 pode chegar antes de a
   linha existir, e a `UNIQUE (tc_session_id, tc_call_id)` vira chave de idempotência utilizável —
   hoje não é, porque `tc_call_id` é nulo e o btree trata NULLs como distintos.
4. O comentário da migration passa a ser verdade. Ele já promete isto:

   > `20270730000000_torquecalls_voip_foundation.sql:145-146` — "no outbound nós geramos; no
   > inbound o call-id vem do stanza do peer remoto"

   O código nunca cumpriu: a VPS gerava nos dois casos.

**Chamada de entrada não muda.** O id continua vindo do stanza do peer remoto, validado por
`callIDFromNode`. A assimetria de proveniência que a migration documenta continua valendo.

### A alternativa rejeitada

A VPS gerar e ecoar o `cid` num campo novo do evento. Rejeitada porque não conserta o `callIDFor`
(o path continuaria trazendo um id e a claim outro), exigindo conserto próprio, e porque enfraquece
exatamente a amarração token→chamada que a S5 construiu.

**Só reconsiderar se a fase 2 mostrar que o whatsmeow recusa um call-id que não foi ele quem
sorteou.** É uma das coisas que a fase 2 mede.

## 1.3 `OrgID` — os avisos de chamada vão para o lixo

### O defeito

```go
// cmd/server/session.go:80-89, dentro de cm.OnStateChange
existing, _ := s.mgr.broker.getCall(s.id, c.CallID)
rec := CallRecord{
	SessionID: s.id, CallID: c.CallID, Direction: dir, Peer: c.PeerJid,
	StartedAt: time.Now().UnixMilli(), Status: mapStatus(c.StateData.State),
}
if existing != nil {
	rec.Owner = existing.Owner
	rec.StartedAt = existing.StartedAt
}
s.mgr.broker.upsertCall(rec)
```

Sem `OrgID`. E o broker descarta evento sem organização, corretamente:

```go
// cmd/server/broker.go:116-122
func (b *Broker) publish(orgID string, ev any) {
	if orgID == "" {
		slog.Error("evento sem organizacao descartado", "evento", fmt.Sprintf("%T", ev))
		return
	}
	...
```

Três consequências, em ordem de gravidade:

1. **`upsertCall` grava o registro envenenado no mapa** (`broker.go:192`). O `endCall` seguinte lê
   `orgID := c.OrgID` (`broker.go:265`) = `""` e **também** é descartado. Perde-se o `ended`.
2. Em chamada **de saída**, `cm.OnIncoming` nunca roda — e ele é o único lugar que preenche `OrgID`
   (`session.go:64-69`). Nenhum evento sai. Nem `ringing`, nem `connected`, nem `ended`.
3. Em chamada de entrada, só o primeiro evento escapa.

### A correção

```go
// cmd/server/session.go, no literal de rec
OrgID: s.orgID,
```

E, por robustez, `upsertCall` preserva `OrgID` do registro existente quando o novo vier vazio — a
mesma disciplina que já aplica a `Owner` e `StartedAt`.

### As duas ausências que a correção expõe

**O teste era verde medindo a própria ficção.** `cmd/server/broker_test.go` não tem uma única
asserção sobre `OrgID` neste caminho. A correção nasce com o teste que a deixaria vermelha:
originar uma chamada de saída, disparar `OnStateChange`, e assertar que um assinante da
organização recebeu `call-status` — e que um assinante de **outra** organização não recebeu.

**Faltam transições de saída.** `handleEvent` (`cmd/server/session.go:150-178`) trata `Connected`,
`LoggedOut` e os eventos de chamada. Não trata `*events.Disconnected`, `*events.ConnectFailure`
nem `*events.StreamReplaced`. Sem evento de saída, `open` no CRM é uma afirmação que apodrece em
silêncio — e isso é pré-requisito do S11, não enfeite dele.

Correção: cada um desses passa a chamar `setAuth(AuthSnapshot{State: "connecting", Paired: false})`.

**Janela de mentira no re-pareamento.** `SessionManager.Pair` (`sessionmanager.go:213-228`) chama
`replaceClient` com um device novo e vazio, mas não chama `setAuth` — ao contrário do `Logout`
logo acima, que chama (`sessionmanager.go:208`). Entre o `replaceClient` e a chegada do primeiro
QR, `info()` ainda reporta `Paired: true` do snapshot anterior. Janela curta, mas real, e é
exatamente durante ela que o webhook do S11 poderia espelhar a mentira.

Correção: `setAuth(AuthSnapshot{State: "qr", Paired: false})` logo após `replaceClient`, espelhando
o que o `Logout` já faz.

**Carimbo de tempo no `auth-state`.** `emitAuthState` (`broker.go:161-166`) não carrega instante;
`emitIncoming` já carrega. Acrescentar `at: time.Now().UnixMilli()` — o S11 precisa dele para
recusar entrega fora de ordem.

---

# FASE 2 — O portão

Não é cerimônia. São quatro afirmações que hoje ninguém consegue fazer, e que passam a ser
**medidas**:

1. Um número real fica pareado, e `voip_sessions` ganha linha com `jid` preenchido.
2. Uma ligação sai daqui e toca no aparelho de destino.
3. O áudio funciona nos dois sentidos.
4. **Os avisos `ringing`, `connected` e `ended` saem do broker** — verificados no stream SSE, antes
   de existir webhook nenhum.

A quarta é a que autoriza a fase 3. As três primeiras já foram vistas uma vez no spike de julho; a
quarta nunca.

## Pré-requisitos que não são código

**Redeploy do frontend no EasyPanel.** Pendente desde o merge do PR #1317. O merge publica a
imagem; o redeploy é manual e deliberado. Sem ele a tela de pareamento não existe para o CTO.

**Imagem nova da VPS, com as correções da fase 1.** E um risco a registrar: **a imagem em produção
não é reproduzível a partir do repositório.** Não há Dockerfile no repo Go; o release publica só
binários; a imagem foi montada à mão por cima de uma base herdada do espelho AGPL. Ninguém sabe
qual é o `WORKDIR` dela — e é nele que o SQLite aterrissa, porque o caminho do `-db` é relativo
(`cmd/server/main.go:21`).

**Um slot de aparelho livre no número.** O WhatsApp permite 4 vinculados; o Uazapi ocupa um.

## Medição obrigatória da persistência

A fase 3 grava uma chave privada ao lado do banco. Antes disso, na VPS:

```bash
cat /opt/torquecalls/docker-compose.yml
docker inspect -f '{{json .Mounts}}' torquecalls
```

Se **nenhum mount cobrir o caminho do `-db`**, a decisão de chave está morta: a chave desaparece no
próximo `up -d`, que é operação rotineira (houve dois recreates em 2026-07-30). Nesse caso, a fase 3
troca para caminho absoluto dentro de um mount explícito de `/opt/torquecalls`, movendo banco e
chave juntos na mesma janela.

**Não deduzir persistência de "o produto funciona".** A evidência que circulava — "sobreviveu a 4
restarts" — é do binário do **espelho AstraCalls**, que persistia em Postgres. O produto MIT de hoje
persiste em SQLite. Duas trocas: de store e de binário. `restart` preserva a camada gravável;
`up -d` com imagem nova destrói.

## Uma armadilha do schema que aparece aqui

`voip_sessions.jid` é `UNIQUE` **global, sem `organization_id`**. Um número de WhatsApp só pode
estar pareado em **uma** organização em toda a plataforma. Duas orgs tentando parear o mesmo número:
a segunda toma erro de chave única. Aparece primeiro em teste interno, com o número do CTO.
Provavelmente não intencional. **Vira issue; não muda nesta fatia.**

---

# FASE 3 — O S11

## 3.1 O envelope

Segundo par Ed25519, sentido oposto ao de hoje. A VPS assina; o CRM verifica.

### Nascimento e guarda da chave

Na primeira subida sem chave, o processo Go gera o par, grava a privada com permissão `0600` ao
lado do banco, e registra **apenas a pública** no log. O operador copia a pública para os segredos
do Supabase como `TORQUECALLS_WEBHOOK_PUBKEY` (formato `kid:base64url`, mesmo do sentido atual).

A privada nunca aparece em terminal, em `.env` ou em histórico de shell. Rotação: apagar o arquivo,
reiniciar, copiar a nova pública.

**Recuperação de "a chave sumiu":** é passo humano, e o sintoma é o pior possível — o CRM passa a
recusar todo webhook, e o pareamento fica preso sem diagnóstico. Por isso a recusa é barulhenta
(§3.7) e o log de boot diz explicitamente que gerou chave nova.

### O que é assinado

Assinatura no header `Authorization: Bearer <JWS>`, sobre os **bytes crus do corpo** —
`await req.arrayBuffer()` / `req.text()`, **nunca** `req.json()` reserializado: ordem de chave e
espaço em branco mudam e quebram a verificação. O corpo é consumível uma vez só; confirmar que
`withErrorBoundary` não o leia antes.

| Claim | Para quê |
|---|---|
| `bh` | SHA-256 do corpo, em base64url. Sem ele o token é replayável em cima de outro payload |
| `jti` | uso único — o anti-replay do §3.4 |
| `iat`, `exp` | janela curta: `exp = iat + 300s` |
| `aud`, `env`, `kid` | mesma disciplina do sentido atual: token de dev não escreve em prod |
| `sid` | sessão. É por ela que o CRM deriva a organização |
| `org` | **não autoriza nada.** Serve só para comparar (§3.3) |
| `epoch`, `seq` | ordem (abaixo) |

### Por que `epoch` e não só `seq`

O contador nasce do zero a cada boot da VPS — `jtiCache` é em memória (`cmd/server/jticache.go:14-20`
declara isso por escrito) e o broker não numera nada. Só com `seq`, o primeiro reinício faria o CRM
recusar tudo para sempre como "evento velho": um kill-switch acidental.

**`epoch` é global do processo; `seq` é por sessão.** O `epoch` fica no SQLite e incrementa uma vez
por boot; o `seq` de cada sessão recomeça em 1 depois do reinício, e o `epoch` maior é o que faz o
CRM aceitar mesmo assim.

O CRM aceita se `epoch > last_epoch` **ou** (`epoch = last_epoch` **e** `seq > last_seq`).

**`exp` de 300s é maior que a janela usual de entrega e menor que o horizonte de retry
(§3.2).** Consequência deliberada: um evento que ficou preso no outbox por mais de 5 minutos é
**reassinado** na hora da reentrega, com `jti` novo e o mesmo `(epoch, seq)`. A ordem é garantida
pelo par `(epoch, seq)`, não pela validade da assinatura — misturar os dois papéis obrigaria a
esticar o `exp` até o horizonte de retry, e um token de 30 minutos é um token roubável por 30
minutos.

### Gate da chave pública: auto-teste, não blocklist

Validar por tamanho não basta. Existem chaves Ed25519 de ordem pequena que fazem a verificação
aceitar qualquer assinatura — fail-open medido, incluindo as codificações canônicas de `00*32` e
`01 00*31`.

Em vez de blocklist: **auto-teste no boot da função.** Ao carregar cada `kid`, verificar um par de
fixtures — assinatura boa tem que dar `true`, assinatura ruim tem que dar `false`. Falhou qualquer
uma, a função **recusa servir**. Um mecanismo pega quatro problemas: chave neutra, trocada,
truncada, e runtime sem Ed25519.

O gate roda **por `kid`, individualmente**, na carga. Um `kid` podre não pode ser mascarado por um
`kid` bom.

Importar com `importKey("raw", pubBytes, { name: "Ed25519" }, false, ["verify"])`. A receita
provada está em `_shared/voip/internal/sign.test.ts:61-77`.

### Gate de entrega, inegociável

**Uma execução real do caminho Ed25519 no runtime hospedado, antes de ligar.** Ele nunca rodou lá —
nem assinando (`runtime_logs where module='voip'` = 0 linhas, com as duas funções ACTIVE). A prova
que existe hoje é de Deno local, e prod é mais antigo: build reportado
`supabase-edge-runtime-1.69.4 (compatible with Deno v2.1.4)` contra 2.7.7 local, região `sa-east-1`.
O pin da CLI **não** é a versão de prod.

## 3.2 O outbox, na VPS

Tabela nova no SQLite que já existe (`cmd/server/sessionstore.go:34` cria `sessions`; a nova segue
o mesmo padrão de migração idempotente).

O evento é gravado **antes** de qualquer tentativa de rede. Um worker; entrega **em ordem por
sessão**, single-flight.

**Por que ordem importa:** `open` seguido de `logged_out` entregues fora de ordem deixa o CRM
afirmando que o número está ativo depois de ele ter sido desconectado. Retry com backoff pode
reordenar se a entrega for paralela.

**O custo aceito:** fila de cabeça bloqueada — um evento envenenado trava a sessão dele. É o preço
certo para uma máquina de estados. O dead-letter desentope, com log alto.

**Números travados, e eles andam juntos:**

| Constante | Valor | Amarração |
|---|---|---|
| Backoff | exponencial, 1s → 60s | — |
| Horizonte de retry | **30 minutos** | Depois disso, dead-letter |
| `expires_at` do anti-replay | **60 minutos** | Tem que ser ≥ horizonte + skew de relógio (§3.4) |
| `exp` do JWS | 300s | Menor que o horizonte, de propósito — o evento é reassinado na reentrega |

Trocar o horizonte de retry sem trocar o `expires_at` abre buraco de replay. **Os dois vivem no
mesmo passo do plano.**

Escopo real do trabalho, para ninguém subdimensionar: **o lado Go não tem nada disto hoje.**
`git grep -E 'ed25519.Sign|ed25519.GenerateKey' origin/main -- '*.go'` fora de `_test.go`: zero.
Nenhum `http.Post` / `http.NewRequest` de saída. Nenhum arquivo com "webhook" no nome. Assinador,
guarda de chave, cliente HTTP e fila de retry são 100% greenfield.

## 3.3 O webhook, no CRM

`supabase/functions/torquecalls-webhook/index.ts`, com `verify_jwt = false` em `config.toml`
(mesmo tratamento de `torquecalls-control` e `torquecalls-signal`).

**Sem CORS e sem `OPTIONS`.** Quem chama é a VPS, não um navegador. Isto contraria o "padrão
obrigatório" do `CLAUDE.md` da raiz — e é o mesmo desvio que o `whatsapp-webhook`, a função de
webhook mais crítica do produto, já faz. **A exceção vai para a doc nesta fatia**, senão o próximo
agente "conserta" e reabre a superfície.

### Ordem das barreiras, e ela é deliberada

1. **Limite de rajada em memória, por isolate.**
2. **Teto de tamanho do corpo.**
3. **Assinatura — antes de qualquer consulta ao banco.** Ed25519 é barato; consultar o Postgres com
   payload não autenticado é o que transforma o endpoint em amplificador de carga.
4. **Só então** derivar a organização.

O limitador persistente do projeto **falha aberto** em erro de banco
(`_shared/auth.ts:246-249` e `263-266` devolvem `allowed: true`). Numa rota pública sem JWT isso
significa que uma indisponibilidade do Postgres remove o teto por inteiro. Por isso ele não é a
primeira barreira nem a única.

### A organização sai da linha, nunca do corpo

`voip_sessions.tc_session_id` é `UNIQUE` e `organization_id` é `NOT NULL`. A org vem de lá.

A claim `org` do envelope **não autoriza** — serve só para comparar. Divergiu: **403 + registro de
tentativa cross-tenant**, não um 200 silencioso.

É o ADR-0024 §3: sem isso, o Ed25519 protegeria a cunhagem e deixaria a escrita cross-org aberta.

### Códigos de resposta, e por que não "200 sempre"

O `whatsapp-webhook` devolve 200 em quase todo erro porque o Uazapi faz retry agressivo e perder
mensagem é caro. **A VPS é nossa** — a política de retry é escolha nossa, não imposição de terceiro.
Copiar "200 sempre" aqui esconderia bug em vez de proteger.

| Situação | Resposta | Por quê |
|---|---|---|
| Assinatura inválida / expirada / `bh` divergente | `401` | A VPS é nossa e precisa do sinal |
| `jti` repetido (replay) | `200` | Já foi processado. O remetente deve parar de retentar |
| `seq`/`epoch` velho | `200` | Idem — chegou fora de ordem e já foi superado |
| Sessão desconhecida no CRM | `202` | Pode aparecer por adoção. Retry limitado, não infinito |
| Sessão `quarantined` ou `closed` | `202` | Inerte por decisão do plano de controle |
| Divergência de organização | `403` | Evidência, não ruído |
| Transição recusada | `409` | O evento é válido; o estado é que não permite |
| Erro interno | `500` | A VPS **deve** retentar |

## 3.4 A máquina de estados, e onde ela mora

Numa RPC `SECURITY DEFINER`, `service_role` apenas — **não em TypeScript**.

Numa transação: reivindica o `jti`, barra `seq`/`epoch` velho, aplica a transição, escreve no
ledger. A transição é a única coisa aqui que não pode ficar frouxa, e assim ela vira invariante de
armazenamento em vez de sequência de `UPDATE`s. De brinde, a reconciliação (§3.6) reusa a mesma
lógica em vez de duplicá-la.

**Sem `GRANT` para `authenticated`.** A RLS das três tabelas voip é SELECT-only; toda escrita já
depende de `service_role` ou de DEFINER. Um `GRANT` a mais aqui abriria escrita cross-tenant por
parâmetro.

### Anti-replay

Tabela nova. **Nome do campo importa:** `voip_calls.token_jti` já existe e é o `jti` do sentido
CRM→VPS. Chamar o novo de `jti` solto transforma o próximo incidente em caça ao fantasma. Usar
`event_jti` e `voip_webhook_events`.

```sql
CREATE TABLE IF NOT EXISTS public.voip_webhook_events (
  event_jti       uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tc_session_id   text NOT NULL,
  tc_call_id      text,
  seq_epoch       bigint NOT NULL,
  seq             bigint NOT NULL,
  signed_at       timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT voip_webhook_events_seq_pos CHECK (seq > 0 AND seq_epoch > 0)
);
```

RLS ligada, **só policy de SELECT** (org scope + master shadow), espelhando `voip_calls` e
`voip_sessions`. E `REVOKE` de `PUBLIC` **e** de `anon` separadamente: o `pg_default_acl` do schema
`public` concede `anon` em toda tabela nova, e revogar de `PUBLIC` não alcança grant direto — lição
já escrita em `20270728000002_revoke_anon_meta_conversations.sql`.

Marca d'água por sessão, na tabela que já é o mapa autoritativo:

```sql
ALTER TABLE public.voip_sessions ADD COLUMN IF NOT EXISTS last_seq_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.voip_sessions ADD COLUMN IF NOT EXISTS last_seq       bigint NOT NULL DEFAULT 0;
```

A reserva anti-replay é o `INSERT` que decide:

```sql
INSERT INTO public.voip_webhook_events
  (event_jti, organization_id, tc_session_id, tc_call_id,
   seq_epoch, seq, signed_at, expires_at)
VALUES
  (p_event_jti, v_org_id, p_tc_session_id, p_tc_call_id,
   p_epoch, p_seq, to_timestamp(p_iat), now() + interval '60 minutes')
ON CONFLICT (event_jti) DO NOTHING
RETURNING event_jti INTO v_claimed;

IF v_claimed IS NULL THEN
  RETURN jsonb_build_object('ok', true, 'code', 'replay');  -- 200, sem efeito
END IF;
```

`v_org_id` vem do `SELECT` em `voip_sessions` feito antes — **nunca** de parâmetro. A reserva é a
primeira escrita da transação: se a transição seguinte falhar, o `ROLLBACK` devolve o `jti` e a
reentrega funciona.

Limpeza por `pg_cron`, no padrão idempotente do projeto (`unschedule` antes de `schedule`, para
sobreviver a `db reset`).

**`expires_at = now() + 60 minutos`**, contra horizonte de retry de 30 minutos (§3.2) e skew de
relógio tolerado de 120 segundos. A janela tem que ser ≥ horizonte + skew: se o outbox retentar por
30 minutos e a janela for de 10, abre buraco de replay. Os dois números são travados juntos, no
mesmo passo do plano, nunca em fatias separadas.

A limpeza remove o que já venceu há mais de 1 minuto, a cada 5 minutos.

### Tabela de transição de sessão

A VPS emite **três** estados de auth: `qr`, `open`, `logged_out`. Não quatro — `connecting` não
chega hoje, e `quarantined` não é emitível.

| Estado no CRM | chega `qr` | chega `open` | chega `logged_out` |
|---|---|---|---|
| `pending` | → `pairing` | → **`open`** | → `closed` |
| `pairing` | → `pairing` (idempotente) | → **`open`** | → `closed` |
| `open` | **recusa** ¹ | no-op ³ | → `closed` |
| `closed` | → `pairing` | **recusa** ² | no-op |
| `quarantined` | recusa e alarma | recusa e alarma | recusa e alarma |

¹ **`open` + `qr` recusado.** O re-pareamento legítimo já passa pelo CRM, que escreve `pairing`
antes de chamar a VPS (`torquecalls-control/index.ts:533`). QR chegando numa sessão `open` sem o
CRM ter iniciado é replay velho ou sequestro do número.
*Risco conhecido e aceito:* `POST /api/sessions/{sid}/pair` é alcançável direto na VPS com token
admin. Quem repartear por fora deixa o CRM travado em `open`, e o reserve autorizaria chamada num
número sem device. Mitigação: aceitar `open → pairing` **dentro de 5 minutos** após um
`pairSession` originado aqui, medidos pelo `updated_at` que a linha 533 já grava. Cinco minutos
cobrem folgadamente o tempo entre o clique e o primeiro QR; fora da janela, recusa e alarme.

² **`closed` + `open` recusado.** `closed` é o único status que **não** ocupa vaga no teto
(`torquecalls-control/index.ts:234`). Promover direto da VPS re-consome vaga em silêncio e passa por
fora do gate comercial **e** do teto — a mesma classe de furo que já vazou uma vez pela rota de
adoção (`index.ts:477-483`).

³ **`open` + `open` é no-op, não escrita.** `events.Connected` re-dispara a cada reconexão do
whatsmeow; escrever sempre polui `updated_at` e destrói qualquer heurística de frescor.
*(Que o `Connected` re-dispara é hipótese de desenho — não foi possível ler o fonte do whatsmeow
nesta máquina. O no-op custa zero se a hipótese for falsa.)*

**`pending` promove.** O handoff diz que a sessão nasce `pairing`; ela nasce `pending`
(`torquecalls-control/index.ts:393`), e sessão adotada faz upsert em `pending` (`index.ts:538-545`)
e fica lá para sempre. Promover só a partir de `pairing` produziria um bug novo indistinguível do
bug de hoje.

**A fonte do estado é o `AuthSnapshot` do evento, nunca `info()`.** `info()` calcula
`Paired: a.Paired || jid != ""` (`session.go:233`) — duas noções de "pareado" que podem divergir no
restore e no re-pareamento. Espelhar `session-list` herdaria a divergência e promoveria para `open`
uma sessão sem device.

### `quarantined` precisa de decisão

Hoje **nada** alcança esse status. Ou o fluxo de adoção passa a escrevê-lo, ou ele sai do CHECK.
Status que ninguém alcança é mentira no schema.

**Decisão para o plano:** manter no CHECK e passar a escrevê-lo quando a reconciliação (§3.6)
encontrar sessão na VPS sem linha correspondente aqui. Isso dá ao status um produtor real e torna a
rota de adoção do S12 alcançável a partir da tela, em vez de decorativa.

## 3.5 O ledger de chamada

Mesmo problema de tradução, eixo diferente. `CallStatus` da VPS
(`broker.go:14-19`: `starting|ringing|connected|ended`) contra o CHECK de `voip_calls`
(`authorized|ringing|connected|ended|expired`):

| VPS emite | CRM aceita? | Tradução |
|---|---|---|
| `starting` | não existe | → `ringing` |
| `ringing` | sim | direto |
| `connected` | sim | direto |
| `ended` | sim | direto |
| motivo terminal (`rejected`, `no_answer`, `busy`, …) | não existe | → `ended` + motivo em `end_reason` |
| — | `authorized`, `expired` | só o CRM origina |

Sem essa tradução o `UPDATE` viola `voip_calls_status_check` e o webhook devolve 500.

### Campos que o evento precisa ganhar no lado Go

- **`direction`** — `call-status` e `call-ended` não carregam. O `INSERT` de chamada de entrada
  precisa (coluna `NOT NULL` com CHECK).
- **`peer` em dígitos, não JID.** Hoje vai `peer.String()` (`httpapi.go:302`) e `c.PeerJid`
  (`session.go:65,82`), ex.: `5511...@s.whatsapp.net`. `voip_calls.peer_phone` tem
  `CHECK (peer_phone ~ '^[0-9]{8,15}$')` — o INSERT quebra. **O Go normaliza**, não o webhook:
  normalizar aqui carregaria o problema conhecido do 9º dígito para dentro do CRM.
- **`at`** no `auth-state` (§1.3).
- **`org` NÃO entra no payload.** Confiança invertida quer dizer que a VPS assina o evento, não que
  ela decide o tenant.

**Nunca casar evento com linha por `peer`.** O JID do WhatsApp perde o 9º dígito do celular
brasileiro — é a falha silenciosa já registrada nesta integração. A chave é
`(tc_session_id, tc_call_id)`, sempre.

### Dois caminhos, um handler

- **Saída:** a linha já existe (criada na reserva, com `tc_call_id` preenchido pela §1.2). `UPDATE`
  casando `(tc_session_id, tc_call_id)`.
- **Entrada:** não existe `voip_calls.id` antes do evento — o call-id vem do stanza do peer remoto.
  O webhook é quem **cria** a linha.

Um `upsert` com `ON CONFLICT (tc_session_id, tc_call_id)` atende os dois. **Depende da §1.2**: sem
`tc_call_id` preenchido no outbound, a UNIQUE não deduplica nada (NULLs são distintos no btree).

### Rede de segurança 1 — a corrida com o ceifador

O cron `voip-reap-authorized` roda a cada minuto e expira reservas `authorized` com mais de 12
segundos. **Janela real de morte: 12 a 72 segundos.** Um `ringing` que chegue depois encontra a
linha já `expired`.

Com o outbox entregando na hora isso é raro. Raro não é nunca.

**Regra:** evento de vida (`ringing`/`connected`) **ressuscita** linha `expired`, desde que aquele
operador não tenha outra ligação viva. A ressurreição é **registrada**, porque ela significa que a
entrega está lenta. Se houver outra ligação viva do mesmo operador, recusa e alarma — ressuscitar
ali violaria o índice único.

### Rede de segurança 2 — a ligação que nunca recebe "desligou"

```sql
-- 20270730000000_torquecalls_voip_foundation.sql
CREATE UNIQUE INDEX idx_voip_calls_one_live_per_operator
  ON public.voip_calls (operator_user_id)
  WHERE operator_user_id IS NOT NULL
    AND status IN ('authorized','ringing','connected');
```

Uma linha presa em `connected` **tranca aquele vendedor para sempre** — nenhuma ligação nova dele
passa. O ceifador atual só toca em `authorized`.

**Varredor novo:** status `ringing` ou `connected` sem atualização há mais de **60 minutos** →
`ended` com `end_reason = 'no_terminal_event'`, para o caso ficar distinguível de um desligamento
normal na auditoria.

Os 60 minutos são constante documentada dentro da função, na mesma disciplina dos outros tetos do
`fn_voip_call_reserve` — não vira knob sem decisão do CTO. O número é folgado de propósito: ele
existe para destravar operador, não para encerrar ligação viva. Uma ligação B2B de mais de uma hora
é implausível; se aparecer, o log da varredura é que vai contar.

### Um efeito colateral a registrar

`voip_calls.tc_session_id` referencia `voip_sessions(tc_session_id)` **ON DELETE CASCADE**. Logo
`deleteSession` (`torquecalls-control/index.ts:528`) apaga a sessão e leva junto **todo o histórico
de chamadas** dela. Perda de trilha de auditoria. **Vira issue; não muda nesta fatia.**

## 3.6 A reconciliação

Cron no CRM, comparando `voip_sessions` com o que a VPS reporta.

**Um token de plano de controle por organização, não um de alcance global.** A VPS já filtra no lado
dela quando o token traz uma org (`httpapi.go:146-151` compara `info.OrgID == p.orgID`). Com alcance
global ela devolveria as sessões de **todos** os tenants para dentro da edge function, e a correção
de tenancy passaria a depender de um laço de TypeScript.

O próprio CRM já escreveu essa objeção e recusou a rota:

> `torquecalls-control/index.ts:300-304` — "A lista vem do CRM, não da VPS. `GET /api/sessions` da
> VPS devolve as sessões de TODAS as organizações — pedir a ela e filtrar depois seria confiar no
> filtro do lado errado da fronteira."

O S11 não reintroduz o que a S6 conscientemente rejeitou. Custo: uma chamada por organização **que
tenha sessão** — hoje, zero.

**Sem mudança no Go.** O ramo `all` fica sem caller, como está hoje.

### O que a reconciliação vai medir e que não é anomalia

No boot, `SessionManager.Restore` **apaga** linhas com `jid` vazio, `jid` não-parseável ou device
ausente (`sessionmanager.go:114-129`, três `m.store.delete`). Uma sessão criada e nunca pareada
existe em memória, aparece na lista, e some do banco no próximo restart — **sem evento nenhum**.

"Sumiu da VPS" é estado esperado pós-restart, não anomalia. A reconciliação trata como
`quarantined`/`closed` conforme §3.4, não como incidente.

### O que continua impossível sem mexer no Go

Descobrir sessão **órfã** (a que existe na VPS sem organização). Nem o ramo `all` nem o `mine` a
enxergam, porque ambos leem a vista do processo, não o store. **Fora de escopo desta fatia.**

## 3.7 A recusa barulhenta

Toda recusa — assinatura inválida, replay, sessão desconhecida, divergência de organização,
transição negada — vira linha em `runtime_logs` com `module: 'voip'` (o módulo já existe no enum,
`_shared/logger.ts:189`) e ação própria por motivo. Isso funciona hoje.

### O alerta no WhatsApp está morto, e o desenho tem que dizer isso

É o mesmo caminho da **issue #1320**: `SUPPORT_UAZAPI_TOKEN` inválido em produção desde
2026-07-13. Duas consequências vinculantes:

**1. Não copiar o `support-notify-staff`.** `support-notify-staff/index.ts:113` é o **único** `fetch`
direto a `/send/text` fora de `_shared/uazapi-client.ts` em todo o repositório. Todo o resto passa
pelo client e herda disjuntor, classificação de erro e telemetria de hash de token. Esse envio não
tem nenhuma das três — e é exatamente ele que falhou calado por 17 dias, com 26 erros registrados
para ninguém. **O alerta do S11 passa pelo client compartilhado.**

**2. A janela de dedup é própria, dentro da função.** `reserveSendOrSkip`
(`_shared/send-dedup.ts:198`) devolve `{duplicate:false}` quando falta `orgId` ou `phone` — para um
alerta interno ela passaria batido em **100%** dos casos, parecendo protegida sem estar. Um loop de
retry com assinatura inválida viraria uma mensagem por evento, sem teto.

Janela: **no máximo 1 alerta por hora por sessão**, por motivo.

**3. Até o token ser rotacionado, o alerta registra e não envia** — e isso fica escrito no log, com
ação própria, para ninguém concluir depois que estava silencioso por acidente.

---

# Testes

A regra desta fatia, herdada da lição que mais rendeu na sessão anterior:

> **Toda asserção de fronteira nasce com uma planta que a deixa vermelha. Teste que nunca foi visto
> vermelho não prova nada.**

Três defeitos da sessão passada estavam escondidos atrás de teste verde que media a própria ficção:
um dublê com formato que o cliente real nunca produz, uma promise que nunca resolve, uma asserção
sobre tabela vazia.

| Alvo | O teste | Como se prova que ele funciona |
|---|---|---|
| `pair_sid` na struct | token com `pair_sid` é aceito; sem o campo na struct, recusado | rodar contra a struct **antes** da correção — tem que falhar |
| Entrega do QR | assinante com `pairSID` correspondente recebe; assinante da mesma org sem `pairSID` **não** recebe | remover o filtro e ver o segundo assinante receber |
| `cid` | token com uuid é recusado; token com 32-hex é aceito | asserção nos dois sentidos |
| `callIDFor` | path `== cid` passa; path `!= cid` dá 404 | idem |
| `OrgID` no `call-status` | assinante da org recebe `ringing`, `connected` e `ended` de chamada **de saída**; assinante de outra org não recebe nenhum | reverter a linha e ver os três sumirem |
| Verificação Ed25519 | assinatura boa passa; corpo alterado falha; `jti` repetido é recusado; `seq` velho é recusado | cada um isolado |
| Auto-teste da chave | chave de ordem pequena faz a função **recusar servir** | fixture com `00*32` |
| Transições | cada célula da tabela §3.4, incluindo as duas recusas | matriz completa, não caminho feliz |
| Ordem | `logged_out` seguido de `open` fora de ordem **não** promove | dois eventos com `seq` invertido |
| Ressurreição | `expired` + `connected` ressuscita; com outra ligação viva do mesmo operador, recusa | dois casos |
| Varredor | linha `connected` velha vira `ended`; linha nova não | dois casos |

### Armadilhas de execução de teste neste repositório

- **Nunca `git stash`.** Os stashes são compartilhados entre worktrees e há WIP de outras branches
  empilhado.
- **`npm run test:unit -- <arquivo>` não filtra** — o script tem caminhos fixos e roda a suíte
  inteira, onde ~158 testes falham por motivo alheio. Usar `npx vitest run <caminho>`.
- **`supabase test db` roda a suíte inteira**, com 17 arquivos herdados vermelhos. Rodar o arquivo
  específico com `psql -f`.
- **pgTAP 1.3.3:** em `throws_ok(text,integer,text,text)` o terceiro parâmetro é `errmsg`, comparado
  literalmente contra `SQLERRM`. Passar `NULL` ali e a descrição no quarto.
- **Verificar se o teste novo está no `supabase/tests/run.sh`.** `voip_gate_test.sql` existia e
  nunca tinha rodado por não estar lá.

---

# Migrations

Prefixo livre a partir de `20270730000006` (o `...0005` já é `voice_calls_feature_flag`). Rollback
pareado em `supabase/migrations/rollback/` com nome idêntico, como a migration de fundação tem.

| Arquivo | Conteúdo |
|---|---|
| `20270730000006_voip_call_id_provenance.sql` | `fn_voip_call_reserve` gera e grava `tc_call_id` no formato 32-hex |
| `20270730000007_voip_webhook_replay_guard.sql` | `voip_webhook_events` + `last_seq_epoch`/`last_seq` em `voip_sessions` + cron de limpeza |
| `20270730000008_voip_apply_vps_event.sql` | a RPC da §3.4 |
| `20270730000009_voip_sweep_stuck_calls.sql` | o varredor da §3.5 |

**Antes de aplicar:** `--dry-run` e conferir o ledger. O ledger de prod não tem nenhuma `version`
2027 (0 de 40 linhas) enquanto o schema voip está aplicado sob `2026073x` — são 44 arquivos contra
40 linhas, e um `db push` de checkout limpo tentaria re-rodar 17 migrations. **Nunca push cego.**

---

# Riscos, e o que fazemos com cada um

| Risco | Tratamento |
|---|---|
| O whatsmeow recusar call-id que não foi ele quem sorteou | **A fase 2 mede.** Se recusar, cai para a alternativa da §1.2 e o `callIDFor` ganha conserto próprio |
| Volume da VPS não persistir | **A fase 2 mede**, antes de a chave ser gravada. Plano B: caminho absoluto num mount explícito |
| Ed25519 não funcionar no runtime hospedado | Smoke de uma linha em dev, antes de escrever o resto do S11 |
| Chave perdida em recreate | Recusa barulhenta + log de boot explícito ao gerar chave nova |
| Perda do outbox (disco novo) | A reconciliação da §3.6 é a rede |
| Alerta WhatsApp morto | Registrado como #1320; o alerta nasce funcionando no dia da rotação |
| `db push` cego reaplicar migration | `--dry-run` obrigatório, worktree limpo |

---

# Fora de escopo, deliberadamente

- **S13 completo** — o outbox entra na fase 3; tela de dead-letter fica para depois.
- **#1319** — as quatro promessas da spec de pareamento (renovação do token de stream, adoção de
  sessão órfã, reconexão do SSE, saída do QR vencido).
- **#18 e #19** no repo Go — UI standalone e código de limite de aparelhos.
- **Descoberta de sessão órfã** na reconciliação (§3.6).

# Issues a abrir junto

1. `voip_sessions.jid` é `UNIQUE` global, sem organização — um número só pareia em um tenant na
   plataforma inteira.
2. `deleteSession` apaga o histórico de chamadas por CASCADE.
3. `torquecalls-signal` emite token de stream para sessão em qualquer status —
   `ownedSession` (`index.ts:97-105`) seleciona `status` e nunca o confere, enquanto todos os outros
   gates do sistema exigem `open`.
4. `useVoipSession.ts:30-35` usa `.eq("status","open").limit(1).maybeSingle()` **sem `.order()`** —
   com duas sessões `open` na org, o botão de ligar se prende a um número arbitrário que pode mudar
   entre renders.
5. O CI fixa `deno-version: v2.x` (flutuante, sempre à frente do runtime hospedado) —
   `.github/workflows/test.yml:35,168`. Pode ficar verde em API que prod não tem.
6. O `CLAUDE.md` da raiz afirma que CORS + `OPTIONS` é padrão obrigatório de edge function; a regra
   real é "funções chamadas pelo navegador". Enquanto não distinguir, todo agente novo vai copiar
   CORS onde não cabe ou "consertar" o `whatsapp-webhook`.
