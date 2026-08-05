# TorqueCalls — Fase 1: consertar o contrato, e o portão de prova

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> caixa (`- [ ]`) para acompanhamento.

**Goal:** Destravar o pareamento por QR e a chamada de voz do TorqueCalls, consertando três
defeitos no contrato CRM↔VPS, e provar ao vivo que os eventos de chamada saem do broker.

**Architecture:** Duas frentes em repositórios distintos. No Go (VPS): a claim `pair_sid` passa a
existir e a restringir a entrega do QR; o id de rede da chamada passa a vir do CRM em vez de ser
sorteado; os eventos de chamada param de ser descartados por falta de organização. No CRM: a reserva
de chamada passa a cunhar o id de rede no formato que a VPS aceita, e o assinador passa a usá-lo
como `cid`. Fecha com um portão manual de prova em produção.

**Tech Stack:** Go 1.26.4 (whatsmeow, pion) · Deno / TypeScript (Supabase Edge Functions) ·
PostgreSQL 15 com pgTAP · Vitest

**Spec:** `docs/superpowers/specs/2026-07-30-torquecalls-contrato-e-s11-design.md`

## Global Constraints

- **Repo Go:** `/Users/gabrielaureliogipp/Dev/tc-s5`, branch nova `fix/torquecalls-contrato`
  tirada de `origin/main` (`86c9502`). **Go 1.26.4** é exigido pelo `go.mod`.
- **Repo CRM:** worktree `/Users/gabrielaureliogipp/Dev/wt-torquecalls-s11`, branch
  `feat/torquecalls-contrato-e-s11` (já criada de `origin/main` = `c3598cb3`).
- **Nunca `git stash` no repo do CRM.** Os stashes são compartilhados entre worktrees e há WIP de
  outras branches empilhado. Um `pop` acidental suja arquivos de outra feature.
- **Os testes de `supabase/functions/` são de DENO, não de vitest.** `npx vitest run` sobre eles
  não roda nada: o `include` do `vitest.config.ts` é só `src/**` e `tests/**`, e argumento
  posicional do vitest **filtra** o include, não o expande. O comando certo é:

  ```bash
  cd supabase/functions && deno test --allow-env --allow-net --allow-read --no-check <caminho>
  ```

  Rodar `npx vitest` nesses arquivos devolve "No test files found, exiting with code 1" — um
  vermelho que não mediu nada, exatamente o padrão que este plano existe para evitar.
- **`npm run test:unit -- <arquivo>` NÃO filtra** — o script tem caminhos fixos e roda a suíte
  inteira, onde ~158 testes falham por motivo alheio. Para `src/**` e `tests/**`, usar
  `npx vitest run <caminho>`.
- **`supabase test db` roda a suíte inteira**, com 17 arquivos herdados vermelhos. Rodar o arquivo
  específico com `psql -f`.
- **`organization_features.is_enabled` é coluna gerada** — escrever nela dá erro. Escrever em
  `enabled`.
- **Nenhuma escrita em produção** em nenhuma tarefa deste plano, exceto no portão (Tarefa 8), e lá
  só com autorização explícita do CTO no momento.
- **Prefixo de migration livre a partir de `20270730000006`.** Rollback pareado em
  `supabase/migrations/rollback/` com nome idêntico.
- Mensagens de commit em português, no formato Conventional Commits, e **sem** rodapé de
  co-autoria nas tarefas (o rodapé entra só no commit final de cada frente, se o CTO pedir PR).

---

## Estrutura de arquivos

### Frente Go — `/Users/gabrielaureliogipp/Dev/tc-s5`

| Arquivo | Responsabilidade | Tarefas |
|---|---|---|
| `cmd/server/token.go` | Struct `claims` e validação de coerência escopo↔campo | 1 |
| `cmd/server/authz.go` | Tradução de `claims` para `principal` | 1 |
| `cmd/server/broker.go` | Assinantes, entrega de evento, registro de chamadas | 2, 4, 5 |
| `cmd/server/httpapi.go` | Rotas e handlers; ponto de entrada do SSE e da chamada | 2, 3 |
| `cmd/server/session.go` | Ciclo de vida da sessão e fiação dos eventos de chamada | 3, 4, 5 |
| `cmd/server/sessionmanager.go` | Criação, restauração e re-pareamento de sessão | 5 |
| `cmd/server/token_test.go` | Testes do verificador | 1 |
| `cmd/server/broker_test.go` | Testes de entrega e de registro | 2, 4 |
| `cmd/server/authz_test.go` | Matriz rota × credencial | 3 |

### Frente CRM — `/Users/gabrielaureliogipp/Dev/wt-torquecalls-s11`

| Arquivo | Responsabilidade | Tarefas |
|---|---|---|
| `supabase/migrations/20270730000006_voip_call_id_provenance.sql` | `fn_voip_call_reserve` cunha `tc_call_id` | 6 |
| `supabase/migrations/rollback/20270730000006_voip_call_id_provenance.sql` | Rollback pareado | 6 |
| `supabase/tests/voip_call_id_provenance_test.sql` | pgTAP da proveniência | 6 |
| `supabase/tests/run.sh` | Registro do teste novo | 6 |
| `supabase/functions/_shared/voip/call-plane.ts` | Assina `cid` a partir do `tc_call_id` | 7 |
| `supabase/functions/_shared/voip/call-plane.test.ts` | Testes do choke | 7 |
| `supabase/functions/torquecalls-signal/index.ts` | Consome o `tc_call_id` já cunhado | 7 |

---

## Tarefa 0: Ambiente e linha de base verde

Nenhuma ferramenta desta tarefa está disponível na máquina hoje. **Medido em 2026-07-30:** `go` não
está no PATH, o daemon do Docker está morto, e o Postgres local não responde na 54322. O handoff
anterior afirmava que o banco local estava de pé — está desatualizado.

Sem linha de base verde, "meu teste falha" é ambíguo: pode ser o teste novo ou a suíte já quebrada.

**Files:**
- Nenhum arquivo alterado.

**Interfaces:**
- Consumes: nada.
- Produces: toolchain funcional e a contagem exata de testes que passam em `origin/main` nos dois
  repositórios. As tarefas seguintes comparam contra essa contagem.

- [ ] **Passo 1: Instalar o Go 1.26.4**

```bash
brew install go
go version   # tem que reportar go1.26.x ou superior
```

Se o `brew` entregar versão menor que 1.26.4, baixar de `https://go.dev/dl/` e instalar o pacote
`darwin-arm64`. O `go.mod` declara `go 1.26.4`; versão menor recusa a compilar.

- [ ] **Passo 2: Subir o Docker**

```bash
open -a Docker
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker info --format '{{.ServerVersion}}'   # tem que imprimir uma versão, não erro de socket
```

O symlink de `/usr/local/bin/docker` aponta para um volume desmontado nesta máquina; o binário real
está em `/Applications/Docker.app/Contents/Resources/bin/docker`. Adicionar ao PATH da sessão.

- [ ] **Passo 3: Criar a branch do Go e medir a linha de base**

```bash
cd /Users/gabrielaureliogipp/Dev/tc-s5
git fetch origin
git checkout -b fix/torquecalls-contrato origin/main
go build ./...
go test ./cmd/server/... 2>&1 | tail -20
```

Anotar: build passa? Quantos testes passam e quantos falham? **Se algum teste já falha em
`origin/main`, registrar o nome dele agora** — é ruído conhecido, e nenhuma tarefa deste plano tem
obrigação de consertá-lo.

- [ ] **Passo 4: Subir o Supabase local e medir a linha de base do banco**

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
supabase start
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -c "select count(*) from public.voip_sessions;"
```

Esperado: `0`. Se o `supabase start` falhar, resolver antes de seguir — as Tarefas 6 e 7 dependem
dele.

- [ ] **Passo 5: Instalar as dependências do CRM**

O worktree é novo e **não tem `node_modules`**. Sem isso, `npx vitest` nem carrega o config.

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
npm ci
```

- [ ] **Passo 6: Medir a linha de base dos testes de edge function**

São testes de **Deno**, não de vitest (ver Global Constraints). O `deno` já está nesta máquina
(`/opt/homebrew/bin/deno`, 2.7.7).

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11/supabase/functions
deno test --allow-env --allow-net --allow-read --no-check _shared/voip/ 2>&1 | tail -10
```

Esperado, medido em 2026-07-30: **27 passed / 0 failed**, sendo 12 em `call-plane.test.ts`. Se a
contagem divergir, anotar antes de seguir — a Tarefa 7 compara contra ela.

- [ ] **Passo 7: Registrar a linha de base**

Escrever as contagens num comentário do PR ou numa nota de sessão. Não commitar arquivo novo.

---

## Tarefa 1: `pair_sid` passa a existir na credencial

O CRM assina a claim; o Go recusa claim desconhecida; o pareamento inteiro toma 401 mudo.

**Files:**
- Modify: `cmd/server/token.go` (struct `claims`, ~linha 49-71; função `validate`, ~linha 249-252)
- Modify: `cmd/server/authz.go` (literal `&principal{...}`, ~linha 81-90)
- Test: `cmd/server/token_test.go`

**Interfaces:**
- Consumes: nada.
- Produces: `claims.PairSid string` e `principal.pairSID string` preenchido. A Tarefa 2 lê
  `p.pairSID`.

- [ ] **Passo 1: Escrever o helper de assinatura crua e os dois testes que falham**

O helper existente (`f.sign`) serializa a struct `claims`. Com ele é **impossível** escrever um
teste que falhe hoje, porque o campo não existe na struct e simplesmente não seria emitido. O teste
precisa montar o payload como mapa.

Acrescentar ao fim de `cmd/server/token_test.go`:

```go
// signRaw monta o JWS a partir de um mapa, não da struct claims.
//
// Existe porque testar "claim que a struct não conhece" é impossível pela
// struct: o campo ausente simplesmente não é serializado, e o teste passaria
// sem exercitar nada. Com o mapa, o corpo assinado tem o campo de verdade e o
// DisallowUnknownFields do verificador é de fato exercitado.
func (f *tokenFixture) signRaw(t *testing.T, hdr jwsHeader, payload map[string]any) string {
	t.Helper()
	hb, _ := json.Marshal(hdr)
	cb, _ := json.Marshal(payload)
	h := base64.RawURLEncoding.EncodeToString(hb)
	p := base64.RawURLEncoding.EncodeToString(cb)
	sig := ed25519.Sign(f.priv, []byte(h+"."+p))
	return h + "." + p + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func (f *tokenFixture) rawStream(jti string) map[string]any {
	return map[string]any{
		"iss": testIss, "aud": testAud, "env": testEnv,
		"iat": f.now.Add(-5 * time.Second).Unix(),
		"exp": f.now.Add(60 * time.Second).Unix(),
		"jti": jti, "sc": scopeStream, "org": "org-1",
		"act": []string{"events.read"},
	}
}

// O token de pareamento é o que o CRM assina hoje em torquecalls-signal quando
// body.pair === true. Antes desta fatia ele tomava 401 como token malformado, e
// o QR nunca chegava ao navegador.
func TestVerify_StreamComPairSid(t *testing.T) {
	f := newFixture(t)
	payload := f.rawStream("pair-1")
	payload["pair_sid"] = "sess-42"

	c, err := f.v.verify(f.signRaw(t, hdrOK(), payload), scopeStream, "events.read")
	if err != nil {
		t.Fatalf("token de pareamento recusado: %v", err)
	}
	if c.PairSid != "sess-42" {
		t.Fatalf("PairSid = %q, esperado %q", c.PairSid, "sess-42")
	}
}

// pair_sid é do plano de stream. Em admin ou call ele não tem o que autorizar,
// e aceitar sem conferir seria a mesma frouxidão que o `all` já tem barrada.
func TestVerify_PairSidForaDeStreamRecusado(t *testing.T) {
	f := newFixture(t)
	payload := map[string]any{
		"iss": testIss, "aud": testAud, "env": testEnv,
		"iat": f.now.Add(-5 * time.Second).Unix(),
		"exp": f.now.Add(60 * time.Second).Unix(),
		"jti": "pair-2", "sc": scopeAdmin, "org": "org-1",
		"act": []string{"session.list"}, "pair_sid": "sess-42",
	}

	// errors.Is, não `err == nil`. Sem distinguir o erro, este teste fica VERDE
	// em cima de errTokenMalformed — a recusa acidental por claim desconhecida —
	// e pararia de medir a coerência escopo↔campo que ele existe para medir.
	// Todos os outros testes negativos deste arquivo usam errors.Is.
	if _, err := f.v.verify(f.signRaw(t, hdrOK(), payload), scopeAdmin, "session.list"); !errors.Is(err, errTokenClaims) {
		t.Fatalf("erro = %v; queria errTokenClaims", err)
	}
}
```

`errors` já está nos imports de `cmd/server/token_test.go`.

- [ ] **Passo 2: Rodar e confirmar que os dois falham**

```bash
cd /Users/gabrielaureliogipp/Dev/tc-s5
go test ./cmd/server/ -run 'TestVerify_(StreamComPairSid|PairSidForaDeStreamRecusado)' -v
```

Esperado: **falha de compilação nos dois** — `c.PairSid` não existe na struct, e falha de
compilação num `_test.go` derruba o pacote inteiro. Isso ainda não prova nada sobre o defeito de
produção; ele só fica observável depois do Passo 3.

Rodar de novo **depois do Passo 3 e antes do Passo 4**:

- `TestVerify_StreamComPairSid` **passa** — é aqui que o `DisallowUnknownFields` deixa de recusar, e
  é este o defeito de produção reproduzido e consertado.
- `TestVerify_PairSidForaDeStreamRecusado` fica **VERMELHO**, porque a claim passa a ser aceita em
  escopo admin. O Passo 4 é o que o torna verde.

Essa ordem importa: sem ela, o segundo teste ficaria verde desde o começo pelo motivo errado.

- [ ] **Passo 3: Acrescentar o campo à struct**

Em `cmd/server/token.go`, na struct `claims`, logo depois de `Vis`:

```go
	Vis  string `json:"vis,omitempty"` // "org" | "own"
	// PairSid é a sessão autorizada a receber o QR de pareamento. Só existe no
	// plano de stream: o QR é credencial, não dado, e quem o lê vincula um
	// aparelho ao número da organização.
	PairSid string `json:"pair_sid,omitempty"`
```

- [ ] **Passo 4: Acrescentar a coerência escopo↔campo**

Em `cmd/server/token.go`, na função `validate`, logo depois do bloco do `all`:

```go
	// all só faz sentido no plano de controle.
	if c.All && c.Sc != scopeAdmin {
		return fmt.Errorf("%w: all fora do escopo admin", errTokenClaims)
	}
	// pair_sid só faz sentido no plano de stream, pela mesma razão.
	if c.PairSid != "" && c.Sc != scopeStream {
		return fmt.Errorf("%w: pair_sid fora do escopo stream", errTokenClaims)
	}
	return nil
```

- [ ] **Passo 5: Preencher o `principal`**

Em `cmd/server/authz.go`, no literal `&principal{...}`:

```go
		p := &principal{
			orgID:      c.Org,
			all:        c.All,
			sessionID:  c.Sid,
			callID:     c.Cid,
			operatorID: c.Sub,
			peer:       c.Peer,
			vis:        c.Vis,
			pairSID:    c.PairSid,
			acts:       c.Act,
		}
```

- [ ] **Passo 6: Rodar e confirmar que os dois passam**

```bash
go test ./cmd/server/ -run 'TestVerify_' -v
```

Esperado: PASS em todos, incluindo os que já existiam.

- [ ] **Passo 7: Rodar a suíte inteira e comparar com a linha de base**

```bash
go test ./cmd/server/... 2>&1 | tail -20
```

Esperado: mesma contagem da Tarefa 0, mais os dois novos.

- [ ] **Passo 8: Commit**

```bash
git add cmd/server/token.go cmd/server/authz.go cmd/server/token_test.go
git commit -m "fix(auth): reconhecer pair_sid na credencial de stream

O CRM assina a claim pair_sid quando o modal de pareamento pede o token
(torquecalls-signal, body.pair === true). A struct claims não tinha o campo e
o decoder recusa claim desconhecida por decisão explícita (DisallowUnknownFields).

Resultado em produção: todo token de stream de pareamento era recusado como
malformado, o SSE nunca abria e o QR nunca chegava. O 401 é mudo de propósito,
então o sintoma chegava ao operador como falha de conexão.

O campo principal.pairSID já estava declarado e nunca era atribuído.

pair_sid ganha a mesma coerência escopo-campo que o all já tinha: fora de
stream, é erro."
```

---

## Tarefa 2: o QR passa a ser entregue só a quem pediu pareamento

A Tarefa 1 fez o token **passar**. Não fez `pair_sid` **valer**: o QR continua indo para todos os
assinantes da organização, e ele é credencial.

**Files:**
- Modify: `cmd/server/broker.go` (`subscriber`, ~50-56; `subscribe`, ~91-97; `emitAuthState`,
  ~161-166; `emitSessionQR`, ~182-187; `serveSSE`, ~319-375)
- Modify: `cmd/server/httpapi.go` (`handleEvents`, ~126-135)
- Test: `cmd/server/broker_test.go`

**O segundo vazamento, que quase passou.** Restringir `emitSessionQR` **não fecha o buraco**: o QR
sai por outro emissor. `session.go:202` faz `s.setAuth(AuthSnapshot{State: "qr", QR: evt.Code})` — a
linha imediatamente anterior ao `emitSessionQR` — e `setAuth` chama `emitAuthState`, que publica
`"qr": a.QR` (`broker.go:164`) via `publish`, filtrado **só por organização**. O cliente do repo Go
prova que o consumo é real: `client/src/stores/sessions.ts:49` lê `ev.qr` dentro do ramo
`auth-state`.

Sem tratar os dois, a tarefa entrega três testes verdes certificando uma restrição que o fio não
tem.

**Interfaces:**
- Consumes: `principal.pairSID` da Tarefa 1.
- Produces: `Broker.subscribe(clientID, orgID, pairSID string) *subscriber` e
  `Broker.serveSSE(w, r, clientID, orgID, pairSID string)` — assinaturas com **três** strings.
  Nenhuma tarefa posterior deste plano as consome.

- [ ] **Passo 1: Escrever o teste que falha**

Acrescentar a `cmd/server/broker_test.go`:

```go
// O QR é credencial: quem o escaneia vincula um aparelho ao número da
// organização. Entregá-lo a todo assinante da org significa que qualquer
// operador com um stream aberto pode parear o WhatsApp do cliente.
//
// O CRM já restringe quem PEDE pair: true a quem tem voip.session.manage. Este
// teste cobre o outro lado: a VPS restringindo a ENTREGA.
func TestEmitSessionQR_SoParaQuemPediuPareamento(t *testing.T) {
	b := NewBroker()

	querPar := b.subscribe("op-A", "org-1", "sess-1")
	naoQuer := b.subscribe("op-B", "org-1", "")
	outraSessao := b.subscribe("op-C", "org-1", "sess-2")
	defer b.unsubscribe(querPar)
	defer b.unsubscribe(naoQuer)
	defer b.unsubscribe(outraSessao)

	b.emitSessionQR("org-1", "sess-1", "2@abc...")

	if len(querPar.ch) != 1 {
		t.Fatalf("quem pediu pareamento de sess-1 devia receber 1 evento, recebeu %d", len(querPar.ch))
	}
	if len(naoQuer.ch) != 0 {
		t.Fatalf("assinante comum da org NÃO devia receber o QR, recebeu %d", len(naoQuer.ch))
	}
	if len(outraSessao.ch) != 0 {
		t.Fatalf("quem pareia outra sessão NÃO devia receber, recebeu %d", len(outraSessao.ch))
	}
}

// Regressão da fronteira que já existia: o filtro novo não pode ser a única
// barreira, e o filtro de organização continua valendo para todo o resto.
func TestEmitSessionQR_NaoAtravessaOrganizacao(t *testing.T) {
	b := NewBroker()

	mesmaOrg := b.subscribe("op-A", "org-1", "sess-1")
	outraOrg := b.subscribe("op-D", "org-2", "sess-1")
	defer b.unsubscribe(mesmaOrg)
	defer b.unsubscribe(outraOrg)

	b.emitSessionQR("org-1", "sess-1", "2@abc...")

	if len(mesmaOrg.ch) != 1 {
		t.Fatalf("assinante da org dona devia receber, recebeu %d", len(mesmaOrg.ch))
	}
	if len(outraOrg.ch) != 0 {
		t.Fatalf("assinante de outra org NÃO devia receber, recebeu %d", len(outraOrg.ch))
	}
}

// O filtro do QR não pode vazar para os outros emissores: quem pediu
// pareamento continua sendo um assinante normal para todo o resto.
func TestPublish_PairSidNaoFiltraOutrosEventos(t *testing.T) {
	b := NewBroker()

	querPar := b.subscribe("op-A", "org-1", "sess-1")
	naoQuer := b.subscribe("op-B", "org-1", "")
	defer b.unsubscribe(querPar)
	defer b.unsubscribe(naoQuer)

	b.emitAuthState("org-1", "sess-1", AuthSnapshot{State: "open", Paired: true})

	if len(querPar.ch) != 1 || len(naoQuer.ch) != 1 {
		t.Fatalf("auth-state vai para os dois; recebeu %d e %d", len(querPar.ch), len(naoQuer.ch))
	}
}

// O segundo vazamento: o QR também viajava dentro do auth-state, que vai para
// TODA a organização. Restringir só o emitSessionQR fecharia uma porta e
// deixaria a outra aberta.
func TestEmitAuthState_NaoCarregaOQR(t *testing.T) {
	b := NewBroker()
	naoQuer := b.subscribe("op-B", "org-1", "")
	defer b.unsubscribe(naoQuer)

	b.emitAuthState("org-1", "sess-1", AuthSnapshot{State: "qr", QR: "2@credencial..."})

	var ev map[string]any
	if err := json.Unmarshal(<-naoQuer.ch, &ev); err != nil {
		t.Fatalf("evento não é json: %v", err)
	}
	if _, tem := ev["qr"]; tem {
		t.Fatalf("auth-state não pode carregar o QR: %#v", ev)
	}
}
```

`cmd/server/broker_test.go` hoje tem `import "testing"` numa linha só. Vai virar bloco, com
`encoding/json`.

- [ ] **Passo 2: Rodar e confirmar que falham**

```bash
go test ./cmd/server/ -run 'TestEmitSessionQR|TestPublish_PairSid' -v
```

Esperado: **falha de compilação** — `subscribe` aceita dois argumentos, não três. Erro de compilação
é falha válida aqui: ele prova que a assinatura ainda não existe.

- [ ] **Passo 3: Acrescentar o campo ao assinante**

Em `cmd/server/broker.go`:

```go
type subscriber struct {
	clientID string
	// orgID é a fronteira de entrega. Um assinante só recebe evento da própria
	// organização — sem isso, todo navegador conectado via o tráfego de todos.
	orgID string
	// pairSID é a fronteira do QR, que é mais estreita que a da organização: o
	// QR não é dado, é credencial. Vazio significa "não pediu pareamento", e
	// nesse caso o assinante nunca recebe QR nenhum.
	pairSID string
	ch      chan []byte
}

func (b *Broker) subscribe(clientID, orgID, pairSID string) *subscriber {
	s := &subscriber{clientID: clientID, orgID: orgID, pairSID: pairSID, ch: make(chan []byte, 32)}
	b.mu.Lock()
	b.subs[s] = struct{}{}
	b.mu.Unlock()
	return s
}
```

- [ ] **Passo 4: Restringir a entrega do QR**

Substituir `emitSessionQR` em `cmd/server/broker.go`:

```go
// emitSessionQR entrega o QR de pareamento. É o emissor mais sensível do broker:
// o QR não é dado, é credencial — quem o escaneia vincula um aparelho ao número.
//
// Não usa publish: a fronteira aqui é mais estreita que a da organização. Só
// recebe quem apresentou uma credencial de stream com pair_sid igual a esta
// sessão, o que o CRM só assina para quem tem voip.session.manage.
func (b *Broker) emitSessionQR(orgID, sessionID, qr string) {
	if orgID == "" || sessionID == "" {
		slog.Error("qr sem organizacao ou sessao descartado", "sessao", sessionID)
		return
	}
	data, err := json.Marshal(map[string]any{
		"type": "session-qr", "sessionId": sessionID, "qr": qr,
	})
	if err != nil {
		return
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for s := range b.subs {
		if s.orgID != orgID || s.pairSID != sessionID {
			continue
		}
		select {
		case s.ch <- data:
		default:
		}
	}
}
```

- [ ] **Passo 4b: Tirar o QR do `auth-state`**

Em `cmd/server/broker.go`, `emitAuthState` deixa de publicar o campo:

```go
func (b *Broker) emitAuthState(orgID, sessionID string, a AuthSnapshot) {
	b.publish(orgID, map[string]any{
		"type": "auth-state", "sessionId": sessionID,
		"paired": a.Paired, "state": a.State,
		// O QR NÃO trafega aqui. publish filtra só por organização, então este
		// campo entregava a credencial de pareamento a todo assinante da org —
		// pela porta de trás do emitSessionQR, que é o emissor com a fronteira
		// estreita. O QR sai por um caminho só.
	})
}
```

Seguro do lado do CRM: o front lê QR apenas do evento `session-qr`
(`useVoicePairing.ts:73`) e usa `auth-state` só para `paired === true` (`:78`).

- [ ] **Passo 5: Passar o `pairSID` pelo SSE**

Em `cmd/server/broker.go`, na assinatura de `serveSSE` e na chamada a `subscribe`:

```go
func (b *Broker) serveSSE(w http.ResponseWriter, r *http.Request, clientID, orgID, pairSID string) {
```

```go
	sub := b.subscribe(clientID, orgID, pairSID)
	defer b.unsubscribe(sub)
```

Em `cmd/server/httpapi.go`, em `handleEvents`:

```go
	s.broker.serveSSE(w, r, p.clientKey(), p.orgID, p.pairSID)
```

- [ ] **Passo 6: Rodar e confirmar que passam**

```bash
go test ./cmd/server/ -run 'TestEmitSessionQR|TestPublish_PairSid' -v
go build ./...
```

Esperado: PASS nos três, build limpo.

- [ ] **Passo 7: Provar que o teste pega o defeito**

Reverter temporariamente o filtro — trocar a condição do Passo 4 por
`if s.orgID != orgID { continue }` — e rodar de novo:

```bash
go test ./cmd/server/ -run TestEmitSessionQR_SoParaQuemPediuPareamento -v
```

Esperado: **FALHA**. Restaurar o filtro. Um teste que nunca foi visto vermelho não prova nada.

- [ ] **Passo 8: Suíte inteira e commit**

```bash
go test ./cmd/server/... 2>&1 | tail -20
git add cmd/server/broker.go cmd/server/httpapi.go cmd/server/broker_test.go
git commit -m "fix(broker): entregar o QR só a quem pediu pareamento

O QR é credencial, não dado: quem o escaneia vincula um aparelho ao número da
organização. emitSessionQR publicava para TODOS os assinantes da org, então
qualquer operador com um stream aberto podia parear o WhatsApp do cliente.

O CRM já restringia quem PEDE pair: true a quem tem voip.session.manage. Faltava
a VPS restringir a ENTREGA — a claim pair_sid chegava e ninguém a usava.

O filtro é mais estreito que o de organização e por isso não passa por publish.
Os demais emissores continuam com a fronteira da organização."
```

---

## Tarefa 3: o id de rede da chamada passa a vir do CRM

O CRM assina `cid = voip_calls.id` (uuid, 36 caracteres). `validCallID` exige 32 de `[0-9A-F]`.
Nenhum token de chamada passa. E o mesmo desencontro faz `callIDFor` dar 404 em atender, desligar,
recusar e webrtc.

**Files:**
- Modify: `cmd/server/session.go` (`startOutgoing`, ~103-111)
- Modify: `cmd/server/httpapi.go` (`doStartCall`, ~296)
- Test: `cmd/server/authz_test.go`

**Interfaces:**
- Consumes: `principal.callID` (já existe, vem de `claims.Cid`).
- Produces: `Session.startOutgoing(ctx context.Context, callID string, peer types.JID, isVideo bool) (string, error)`.
  A Tarefa 7 do lado CRM garante que `callID` chega no formato certo.

- [ ] **Passo 1: Escrever o teste que falha**

Acrescentar a `cmd/server/authz_test.go`:

```go
// O cid da credencial e o id do path têm que ser a mesma string, senão
// callIDFor recusa. Antes desta fatia eles eram diferentes por construção — o
// CRM assinava voip_calls.id (uuid) e mandava o id de rede no path — e todo
// accept, end, reject e webrtc dava 404 "no such call".
func TestValidCallID_FormatoDoCRM(t *testing.T) {
	// O que o CRM passa a cunhar: uuid sem hífen, em maiúsculas. 32 chars.
	bom := "AA8D770BEC6B458D83BE94953EF8896E"
	if !validCallID(bom) {
		t.Fatalf("id cunhado pelo CRM recusado: %q", bom)
	}

	// O que o CRM assinava antes: uuid cru. Tem que continuar recusado — a
	// validação não pode ser afrouxada para "consertar" o desencontro.
	ruim := "aa8d770b-ec6b-458d-83be-94953ef8896e"
	if validCallID(ruim) {
		t.Fatalf("uuid com hífen deveria ser recusado: %q", ruim)
	}

	// Minúsculas continuam recusadas: o domínio fechado é o que mantém o dado
	// remoto do stanza sob controle.
	if validCallID("aa8d770bec6b458d83be94953ef8896e") {
		t.Fatal("hex minúsculo deveria ser recusado")
	}
}

// Guarda de CORPO, não de assinatura.
//
// A assinatura não muda se alguém regenerar o id DENTRO da função — e uma
// implementação que aceite o parâmetro e o descarte compilaria, passaria em
// qualquer teste de assinatura, e manteria exatamente o defeito de produção: o
// cid da claim voltaria a ser diferente do id de rede, e accept/end/reject/
// webrtc voltariam a dar 404 por callIDFor.
//
// createCall fixa wa.NewSocket(s.client) e StartCall exige socket vivo, então
// não há costura para dublê. A guarda de fonte é o caminho barato que fica
// vermelho pelo motivo certo.
func TestStartOutgoing_NaoGeraIdProprio(t *testing.T) {
	src, err := os.ReadFile("session.go")
	if err != nil {
		t.Fatal(err)
	}
	i := bytes.Index(src, []byte("func (s *Session) startOutgoing("))
	if i < 0 {
		t.Fatal("startOutgoing não encontrada")
	}
	j := bytes.Index(src[i:], []byte("\nfunc "))
	corpo := src[i:][:j]
	if bytes.Contains(corpo, []byte("GenerateCallID")) {
		t.Fatal("startOutgoing voltou a sortear o id; o cid da claim deixa de ser o id de rede")
	}
}
```

Acrescentar `"bytes"` e `"os"` aos imports de `cmd/server/authz_test.go` — conferir quais já estão
lá antes de duplicar.

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
go test ./cmd/server/ -run 'TestValidCallID_FormatoDoCRM|TestStartOutgoing_NaoGeraIdProprio' -v
```

Esperado: `TestValidCallID_FormatoDoCRM` **passa** (a validação já é assim — ele documenta o
contrato) e `TestStartOutgoing_NaoGeraIdProprio` **FALHA**, porque o corpo atual chama
`signaling.GenerateCallID()` na primeira linha.

- [ ] **Passo 3: `startOutgoing` passa a receber o id**

Em `cmd/server/session.go`:

```go
// startOutgoing adota o call-id que o CRM autorizou, em vez de sortear o seu.
//
// O cid da credencial é o mesmo id que vai para o path de accept, end, reject e
// webrtc, e callIDFor compara os dois. Gerar aqui produzia duas strings
// diferentes por construção: a credencial autorizava uma chamada e o path
// falava de outra, e as quatro rotas davam 404.
//
// O formato continua garantido: validCallID roda sobre o cid na verificação do
// token, então um id fora do domínio fechado não chega até aqui.
func (s *Session) startOutgoing(ctx context.Context, callID string, peer types.JID, isVideo bool) (string, error) {
	cm := s.createCall(callID)
	if err := cm.StartCall(ctx, callID, peer, isVideo); err != nil {
		s.removeCall(callID)
		return "", err
	}
	return callID, nil
}
```

Se `signaling` deixar de ser usado no arquivo, remover o import — `go build` acusa.

- [ ] **Passo 4: Alimentar o id no handler**

Em `cmd/server/httpapi.go`, em `doStartCall`:

```go
	callID, err := sess.startOutgoing(r.Context(), p.callID, peer, false)
```

- [ ] **Passo 5: Rodar e confirmar**

```bash
go test ./cmd/server/ -run 'TestValidCallID_FormatoDoCRM|TestStartOutgoing_NaoGeraIdProprio' -v
go build ./...
```

Esperado: PASS nos dois, build limpo.

- [ ] **Passo 5b: Provar que a guarda pega o defeito**

Reinserir `callID = signaling.GenerateCallID()` como primeira linha do corpo de `startOutgoing`,
rodar, ver **VERMELHO**, e restaurar. Sem isso a guarda é só um teste que nunca foi visto falhar.

- [ ] **Passo 6: Suíte inteira e commit**

```bash
go test ./cmd/server/... 2>&1 | tail -20
git add cmd/server/session.go cmd/server/httpapi.go cmd/server/authz_test.go
git commit -m "fix(call): adotar o call-id que o CRM autorizou

O CRM assinava cid = voip_calls.id, um uuid de 36 caracteres. validCallID exige
32 de [0-9A-F]. Nenhum token de escopo call passava — toda ligação era recusada
antes de tocar handler nenhum.

O mesmo desencontro quebrava callIDFor: o CRM manda o id de REDE no path de
accept, end, reject e webrtc, enquanto a claim trazia o uuid. Strings diferentes
por construção, 404 nas quatro rotas.

startOutgoing passa a adotar o id da credencial. O cid vira o id de rede, e o
vínculo token-chamada que a S5 construiu passa a valer.

validCallID continua aplicado, e continua recusando uuid e hex minúsculo: ele
deixa de ser barreira acidental e vira o gate que sempre quis ser."
```

---

## Tarefa 4: os eventos de chamada param de ser descartados

`OnStateChange` monta o `CallRecord` sem organização; o broker descarta evento sem organização; e o
registro envenenado ainda contamina o `endCall` seguinte.

**Files:**
- Modify: `cmd/server/session.go` (`wireCall`, ~80-89)
- Modify: `cmd/server/broker.go` (`upsertCall`, ~189-199)
- Test: `cmd/server/broker_test.go`

**Interfaces:**
- Consumes: `Broker.subscribe(clientID, orgID, pairSID string)` da Tarefa 2 — os testes desta tarefa
  chamam `subscribe` com **três** argumentos. Executar esta tarefa antes da 2 quebra a compilação
  do teste.
- Produces: garantia de que `CallRecord.OrgID` está preenchido em todo evento emitido. A fase 3
  (S11) pendura o outbox nestes mesmos emissores.

- [ ] **Passo 1: Escrever os testes que falham**

Acrescentar a `cmd/server/broker_test.go`:

```go
// Em chamada de SAÍDA, OnIncoming nunca roda — e ele era o único lugar que
// preenchia OrgID. Sem organização, publish descarta, e o operador nunca vê a
// própria ligação mudar de estado.
func TestUpsertCall_SemOrgNaoEntregaEEnvenenaOMapa(t *testing.T) {
	b := NewBroker()
	sub := b.subscribe("op-A", "org-1", "")
	defer b.unsubscribe(sub)

	// Primeiro evento, com organização: é o que o handler de start emite.
	b.upsertCall(CallRecord{
		OrgID: "org-1", SessionID: "s1", CallID: "C1", Owner: ownerPtr("op-A"),
		Direction: "outbound", Peer: "5511999999999", Status: StatusRinging,
	})
	recebeu(t, sub, "call-status") // drena

	// Segundo evento, como OnStateChange o monta: SEM organização.
	b.upsertCall(CallRecord{
		SessionID: "s1", CallID: "C1", Direction: "outbound",
		Peer: "5511999999999", Status: StatusConnected,
	})
	if !recebeu(t, sub, "call-status") {
		t.Fatal("mudança de estado não foi entregue: evento sem organização é descartado")
	}

	// E o agravante: o registro guardado no mapa não pode ter perdido a
	// organização, senão o endCall seguinte também é descartado.
	b.endCall("s1", "C1", "normal")
	if !recebeu(t, sub, "call-ended") {
		t.Fatal("call-ended não foi entregue: o mapa foi envenenado com organização vazia")
	}
}

// recebeu consome o canal e diz se algum evento tem o "type" pedido.
//
// CONTAR eventos não serve, e é uma armadilha real: upsertCall chama
// publishCallList ANTES do publish do call-status, e endCall chama DEPOIS do
// call-ended. Essa lista é publicada para a organização do ASSINANTE, não do
// registro — então ela chega mesmo quando o call-status é descartado por falta
// de organização. Uma asserção por len() fica VERDE com o defeito presente.
func recebeu(t *testing.T, s *subscriber, tipo string) bool {
	t.Helper()
	for len(s.ch) > 0 {
		var ev map[string]any
		if err := json.Unmarshal(<-s.ch, &ev); err != nil {
			t.Fatalf("evento não é json: %v", err)
		}
		if ev["type"] == tipo {
			return true
		}
	}
	return false
}
```

O `import "testing"` de `cmd/server/broker_test.go` já terá virado bloco com `encoding/json` na
Tarefa 2. Se as tarefas forem executadas fora de ordem, fazer aqui.

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
go test ./cmd/server/ -run TestUpsertCall_SemOrg -v
```

Esperado: **FALHA** na primeira asserção — "mudança de estado não foi entregue".

- [ ] **Passo 3: Preservar a organização no `upsertCall`**

Em `cmd/server/broker.go`:

```go
// upsertCall guarda o registro e emite call-status.
//
// A organização é preservada do registro anterior quando o novo vier sem ela.
// Sem isto, um emissor que esqueça de preencher OrgID não só perde o próprio
// evento — ele envenena o mapa, e o endCall seguinte, que lê a organização de
// lá, também é descartado. Um esquecimento apagava dois eventos.
func (b *Broker) upsertCall(r CallRecord) {
	b.mu.Lock()
	if prev, ok := b.calls[callKey{r.SessionID, r.CallID}]; ok {
		if r.OrgID == "" {
			r.OrgID = prev.OrgID
		}
	}
	cp := r
	b.calls[callKey{r.SessionID, r.CallID}] = &cp
	b.mu.Unlock()
	b.publishCallList()
	b.publish(r.OrgID, map[string]any{
		"type": "call-status", "sessionId": r.SessionID, "id": r.CallID, "owner": r.Owner,
		"status": r.Status, "peer": r.Peer, "startedAt": r.StartedAt,
	})
}
```

- [ ] **Passo 4: Preencher a organização na origem**

Em `cmd/server/session.go`, em `cm.OnStateChange`:

```go
		existing, _ := s.mgr.broker.getCall(s.id, c.CallID)
		rec := CallRecord{
			OrgID: s.orgID, SessionID: s.id, CallID: c.CallID, Direction: dir, Peer: c.PeerJid,
			StartedAt: time.Now().UnixMilli(), Status: mapStatus(c.StateData.State),
		}
		if existing != nil {
			rec.Owner = existing.Owner
			rec.StartedAt = existing.StartedAt
		}
		s.mgr.broker.upsertCall(rec)
```

As duas correções são deliberadamente redundantes: a da origem é a certa, a do `upsertCall` é a
rede para o próximo emissor que esquecer.

- [ ] **Passo 5: Rodar e confirmar**

```bash
go test ./cmd/server/ -run TestUpsertCall_SemOrg -v
go build ./...
```

Esperado: PASS.

- [ ] **Passo 6: Provar que o teste pega o defeito**

Reverter só a preservação no `upsertCall` (deixar a correção da origem) e rodar de novo. Esperado:
**FALHA** — o teste emite um registro sem organização de propósito. Restaurar.

- [ ] **Passo 7: Suíte inteira e commit**

```bash
go test ./cmd/server/... 2>&1 | tail -20
git add cmd/server/session.go cmd/server/broker.go cmd/server/broker_test.go
git commit -m "fix(broker): não descartar os eventos de chamada por falta de organização

OnStateChange montava o CallRecord sem OrgID. publish descarta evento sem
organização — corretamente, porque evento sem destinatário vazaria. Resultado:
em chamada de saída, onde OnIncoming nunca roda, NENHUM evento saía.

Agravante: o registro sem organização era gravado no mapa, e o endCall seguinte
lia a organização de lá. Um esquecimento apagava dois eventos.

Duas correções, deliberadamente redundantes: OrgID na origem, e preservação do
valor anterior no upsertCall como rede para o próximo emissor que esquecer.

broker_test.go não tinha uma única asserção de OrgID neste caminho — o teste era
verde medindo a própria ficção."
```

---

## Tarefa 5: a sessão passa a ter saída, e o `auth-state` a ter carimbo

Sem evento de saída, `open` no CRM é uma afirmação que apodrece em silêncio. E o S11 precisa de um
instante no `auth-state` para recusar entrega fora de ordem.

**Files:**
- Modify: `cmd/server/session.go` (`handleEvent`, ~150-178)
- Modify: `cmd/server/sessionmanager.go` (`Pair`, ~213-228)
- Modify: `cmd/server/broker.go` (`emitAuthState`, ~161-166)
- Test: `cmd/server/broker_test.go`

**Interfaces:**
- Consumes: `Broker.subscribe(clientID, orgID, pairSID string)` da Tarefa 2, pelo mesmo motivo da
  Tarefa 4. E o `emitAuthState` **já sem** o campo `qr`, da Tarefa 2, Passo 4b.
- Produces: evento `auth-state` com o campo `at` (epoch em milissegundos). A fase 3 o consome.

- [ ] **Passo 1: Escrever o teste que falha**

Acrescentar a `cmd/server/broker_test.go`:

```go
// O auth-state precisa de instante próprio: sem ele o CRM não tem como recusar
// uma entrega fora de ordem. emitIncoming já carrega o seu; este não carregava.
func TestEmitAuthState_CarregaInstante(t *testing.T) {
	b := NewBroker()
	sub := b.subscribe("op-A", "org-1", "")
	defer b.unsubscribe(sub)

	b.emitAuthState("org-1", "sess-1", AuthSnapshot{State: "open", Paired: true})

	if len(sub.ch) != 1 {
		t.Fatalf("esperado 1 evento, recebeu %d", len(sub.ch))
	}
	var ev map[string]any
	if err := json.Unmarshal(<-sub.ch, &ev); err != nil {
		t.Fatalf("evento não é json: %v", err)
	}
	at, ok := ev["at"].(float64)
	if !ok || at <= 0 {
		t.Fatalf("auth-state sem campo at utilizável: %#v", ev["at"])
	}
}
```

Acrescentar `"encoding/json"` aos imports de `cmd/server/broker_test.go`.

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
go test ./cmd/server/ -run TestEmitAuthState_CarregaInstante -v
```

Esperado: **FALHA** — "auth-state sem campo at utilizável".

- [ ] **Passo 3: Carimbar o `auth-state`**

Em `cmd/server/broker.go`:

```go
func (b *Broker) emitAuthState(orgID, sessionID string, a AuthSnapshot) {
	b.publish(orgID, map[string]any{
		"type": "auth-state", "sessionId": sessionID,
		"paired": a.Paired, "state": a.State,
		// Instante próprio, como emitIncoming já tem. É o que permite a quem
		// consome recusar uma entrega fora de ordem em vez de sobrescrever um
		// estado mais novo com um mais velho.
		"at": time.Now().UnixMilli(),
	})
}
```

**Sem `"qr": a.QR`** — ele saiu na Tarefa 2, Passo 4b. Se esta tarefa for executada antes da 2, não
reintroduzir o campo aqui.

`time` já está importado em `cmd/server/broker.go`.

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
go test ./cmd/server/ -run TestEmitAuthState_CarregaInstante -v
```

Esperado: PASS.

- [ ] **Passo 5: Tratar os eventos de saída**

Em `cmd/server/session.go`, dentro do `switch` de `handleEvent`, depois do caso `*events.LoggedOut`:

```go
	case *events.LoggedOut:
		s.setAuth(AuthSnapshot{State: "logged_out", Paired: false})
	// Sem evento de saída, "open" é uma afirmação que apodrece em silêncio: o
	// CRM continuaria autorizando chamada para um número desconectado, e o
	// sintoma apareceria só na ligação que não completa.
	case *events.Disconnected:
		s.setAuth(AuthSnapshot{State: "connecting", Paired: false})
	case *events.ConnectFailure:
		s.setAuth(AuthSnapshot{State: "connecting", Paired: false})
	case *events.StreamReplaced:
		s.setAuth(AuthSnapshot{State: "connecting", Paired: false})
```

Conferir que os três tipos existem no pacote `events` do whatsmeow da versão fixada:

```bash
go build ./...
```

Se algum não existir nesta versão, remover só esse caso e **registrar no PR qual foi** — não
inventar substituto.

- [ ] **Passo 6: Fechar a janela de mentira do re-pareamento**

Em `cmd/server/sessionmanager.go`, na função `Pair`, logo depois do `replaceClient`:

```go
	s.replaceClient(whatsmeow.NewClient(m.container.NewDevice(), m.waLogger))
	// Espelha o que Logout já faz. Entre o replaceClient e a chegada do primeiro
	// QR, o snapshot anterior ainda dizia "pareado" — e é justamente nessa
	// janela que quem consome o estado espelharia a mentira.
	s.setAuth(AuthSnapshot{State: "qr", Paired: false})
	if err := s.startPairing(m.appCtx); err != nil {
		return fmt.Errorf("start pairing: %w", err)
	}
```

- [ ] **Passo 7: Build, suíte inteira e commit**

```bash
go build ./...
go test ./cmd/server/... 2>&1 | tail -20
git add cmd/server/session.go cmd/server/sessionmanager.go cmd/server/broker.go cmd/server/broker_test.go
git commit -m "fix(session): dar saída à sessão e instante ao auth-state

handleEvent tratava Connected e LoggedOut, mas não Disconnected, ConnectFailure
nem StreamReplaced. Sem evento de saída, 'open' é uma afirmação que apodrece em
silêncio: o CRM segue autorizando chamada para número desconectado.

Pair() chamava replaceClient com device novo e vazio sem chamar setAuth, ao
contrário do Logout logo acima. Entre o replaceClient e o primeiro QR, o snapshot
anterior ainda dizia 'pareado'.

auth-state ganha o campo at, como emitIncoming já tinha. É o que permite recusar
entrega fora de ordem em vez de sobrescrever estado novo com estado velho."
```

---

## Tarefa 6: a reserva de chamada passa a cunhar o id de rede

**Files:**
- Create: `supabase/migrations/20270730000006_voip_call_id_provenance.sql`
- Create: `supabase/migrations/rollback/20270730000006_voip_call_id_provenance.sql`
- Create: `supabase/tests/voip_call_id_provenance_test.sql`
- Modify: `supabase/tests/run.sh`

**Interfaces:**
- Consumes: `fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid)` existente.
- Produces: o retorno da RPC ganha a chave **`tc_call_id`** (text, 32 chars de `[0-9A-F]`), ao lado
  de `call_id` (uuid) e `token_jti` (uuid). A Tarefa 7 a consome.

- [ ] **Passo 1: Escrever o teste pgTAP que falha**

Criar `supabase/tests/voip_call_id_provenance_test.sql`:

```sql
BEGIN;
-- Obrigatório. pgTAP não é criado por migration nenhuma nem pelo config.toml, e
-- como toda suíte roda dentro de BEGIN/ROLLBACK ele nunca fica instalado entre
-- arquivos. Sem esta linha, `SELECT plan(...)` estoura com "function plan(integer)
-- does not exist". Os 31 arquivos de suíte deste diretório têm a linha.
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(4);

-- A RPC responde com código em vez de estourar quando a sessão não existe.
SELECT ok(
  (SELECT public.fn_voip_call_reserve(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,
     'sess-inexistente', '5511999999999',
     NULL, 'outbound', NULL, NULL
   )) ? 'code',
  'chamada com sessão inexistente devolve code, não estoura'
);

-- A coluna existe e continua nullable (chamada de entrada nasce sem ela até o S11).
SELECT col_is_null('public', 'voip_calls', 'tc_call_id', 'tc_call_id continua nullable');

-- O GRANT não pode ter sido perdido na recriação da função.
SELECT ok(
  has_function_privilege('service_role',
    'public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid)', 'EXECUTE'),
  'service_role mantém EXECUTE depois do CREATE OR REPLACE'
);

-- ANTI-REGRESSÃO. Esta migration recria a função inteira, e a versão vigente é a
-- de 20270730000003 ("sem teto de volume"), não a da fundação. Copiar da fundação
-- reimporia em silêncio os tetos que o CTO removeu em 2026-07-30 — e nenhuma
-- outra asserção deste arquivo pegaria isso, porque a semente faz UMA chamada e
-- não encosta em limiar nenhum.
SELECT matches(
  pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure),
  'c_max_org_live\s+constant integer\s+:= 100',
  'os disjuntores da decisão sem-teto sobrevivem à recriação'
);

SELECT * FROM finish();
ROLLBACK;
```

Saiu daqui a asserção que media
`matches(upper(replace(gen_random_uuid()::text,'-','')), '^[0-9A-F]{32}$')`. Ela era tautológica:
media uma expressão escrita dentro do próprio teste, ficava verde antes e depois da migration, e
continuaria verde se a cunhagem passasse a produzir outro formato. O formato real é medido no
Passo 5, contra o retorno da função.

- [ ] **Passo 2: Rodar e confirmar o estado atual**

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -f supabase/tests/voip_call_id_provenance_test.sql
```

Esperado: os quatro passam, **porque nenhum ainda testa o comportamento novo** — eles travam o
contorno (a RPC responde, a coluna e o grant existem, e os disjuntores da decisão de hoje estão
em pé). O teste do comportamento novo é o Passo 5, e ele exige dado semeado.

Se o quarto falhar **agora**, a função viva em produção não é a de `20270730000003` — parar e
investigar antes de escrever migration nenhuma.

- [ ] **Passo 3: Escrever a migration**

Criar `supabase/migrations/20270730000006_voip_call_id_provenance.sql`.

> **DE ONDE COPIAR — leia antes de qualquer coisa.**
> Copiar o corpo de **`20270730000003_voip_sem_teto_de_volume.sql:55-293`**, que é a definição
> **vigente em produção**. **NÃO** copiar de `20270730000000_torquecalls_voip_foundation.sql`:
> aquela é a versão anterior à decisão "sem teto de volume", e copiá-la reverteria em silêncio,
> em produção, o que o CTO decidiu em 2026-07-30 —
> `c_max_org_live` 100→2, `c_max_per_minute` 600→6, `c_max_per_peer_day` 1000→3,
> `c_peer_backoff` 0s→15 min, a normalização `\D`→`[^0-9]`, e some a guarda `v_cap IS NOT NULL`
> que faz `daily_call_cap = NULL` significar "sem teto".
> O pgTAP desta tarefa ficaria **verde** por cima da regressão, porque a semente faz uma chamada só
> e não encosta em limiar nenhum. A quarta asserção do Passo 1 existe justamente para pegar isso.

Aplicar **quatro** mudanças. `CREATE OR REPLACE`, nunca `DROP` + `CREATE`: dropar reseta os grants
para `PUBLIC` e `anon`.

Cabeçalho do arquivo:

```sql
-- Proveniência do id de rede da chamada (Fase 1 do contrato TorqueCalls).
-- ROLLBACK pareado: rollback/20270730000006_voip_call_id_provenance.sql
--
-- O CRM assinava cid = voip_calls.id, um uuid de 36 caracteres. A VPS exige 32
-- de [0-9A-F] (validCallID). Nenhum token de chamada passava.
--
-- A reserva passa a cunhar o id de rede no formato que a VPS aceita e a
-- devolvê-lo. Com isso tc_call_id existe ANTES de a VPS responder, e a UNIQUE
-- (tc_session_id, tc_call_id) vira chave de idempotência utilizável — hoje não
-- é, porque a coluna nasce nula e o btree trata NULLs como distintos.
--
-- CREATE OR REPLACE preserva o ACL. DROP + CREATE devolveria EXECUTE a PUBLIC.
```

**Mudança 1** — declarar a variável, junto de `v_call_id uuid;`:

```sql
  v_tc_call_id text;
```

**Mudança 2** — no ramo de chamada de entrada (`p_existing_call_id IS NOT NULL`), devolver o id que
já existe. Trocar o `RETURNING`:

```sql
      RETURNING id, tc_call_id INTO v_call_id, v_tc_call_id;
```

**Mudança 3** — no ramo de chamada de saída, cunhar e gravar:

```sql
    ELSE
      -- Cunhado aqui, no formato que a VPS aceita: uuid sem hífen, maiúsculo.
      -- 32 caracteres de [0-9A-F], por construção.
      v_tc_call_id := upper(replace(gen_random_uuid()::text, '-', ''));

      INSERT INTO public.voip_calls (
        organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
        peer_phone, direction, status, token_jti, consent_record_id
      ) VALUES (
        p_organization_id, p_tc_session_id, v_tc_call_id, p_lead_id, p_operator_user_id,
        v_peer, p_direction, 'authorized', v_jti, p_consent_record_id
      )
      RETURNING id INTO v_call_id;
    END IF;
```

**Mudança 4** — devolver a chave nova:

```sql
  RETURN jsonb_build_object(
    'ok', true,
    'call_id', v_call_id,
    'tc_call_id', v_tc_call_id,
    'token_jti', v_jti,
    'expires_in_ms', 12000
  );
```

Fechar o arquivo reafirmando os grants (não muda nada se o `REPLACE` os preservou, e conserta se
alguém trocar por `DROP` no futuro):

```sql
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) TO service_role;
```

- [ ] **Passo 4: Escrever o rollback pareado**

Criar `supabase/migrations/rollback/20270730000006_voip_call_id_provenance.sql` com o
`CREATE OR REPLACE` da versão **anterior** da função — cópia literal do corpo de
**`20270730000003_voip_sem_teto_de_volume.sql:55-293`**, com os mesmos `REVOKE`/`GRANT` no fim.

Mesma armadilha do Passo 3, invertida: um rollback copiado da fundação não desfaz esta migration —
ele reverte a decisão de hoje. Note que `20270730000003`, `...0004` e `...0005` **não têm** arquivo
de rollback no diretório, então não há âncora pronta para copiar; a fonte é o corpo da própria
`0003`.

- [ ] **Passo 5: Escrever o teste do comportamento novo**

Acrescentar a `supabase/tests/voip_call_id_provenance_test.sql`, **antes** do `finish()`, e subir o
`plan` de 4 para 7:

A reserva é semeada pelo caminho de **entrada**, não de saída. Chamada de saída exige, além de tudo,
um `lead_id` da organização **e** um `consent_records` de tipo `voice_call_whatsapp` com
`source IN ('form','api','webhook')` (`20270730000000:551-563`). Chamada de entrada pula os dois
— "quem ligou foi o outro lado" — e cai exatamente no mesmo ramo `ELSE` do `INSERT`, que é o que
esta migration muda. Menos semente, mesma cobertura.

```sql
-- OBRIGATÓRIO antes da semente. whatsapp_instances tem
-- trg_enforce_whatsapp_instance_limit BEFORE INSERT, que chama org_resolve_quota,
-- que começa com PERFORM public.assert_org_access(p_org_id). Rodando como
-- postgres via psql (auth.role() e auth.uid() nulos, org sem membro), isso levanta
-- P0001 access_denied — e com ON_ERROR_STOP=1, que o run.sh usa, o arquivo inteiro
-- aborta antes de qualquer asserção. Mesmo passando o gate, a org semeada não tem
-- plano nem org_quotas, então o limite resolveria 0 e o trigger recusaria.
-- É o mesmo tratamento que voip_foundation_test.sql:167 já usa.
SET LOCAL session_replication_role = replica;

-- Semente mínima. organizations exige name E slug (os dois NOT NULL sem default).
INSERT INTO public.organizations (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Org de teste', 'org-de-teste')
ON CONFLICT (id) DO NOTHING;

-- voice_calls_enabled tem default false: sem true explícito a reserva devolve
-- voice_calls_disabled. daily_call_cap é nullable e sem default; explícito para
-- o teste não depender de comparação com NULL.
INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, voice_calls_enabled, daily_call_cap)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'inst-teste', true, 100)
ON CONFLICT (id) DO NOTHING;

-- status='open' é exigido pela reserva (20270730000000:519).
INSERT INTO public.voip_sessions (organization_id, whatsapp_instance_id, tc_session_id, name, status)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'sess-teste', 'TorqueCalls', 'open')
ON CONFLICT (tc_session_id) DO NOTHING;

-- De volta ao runtime real ANTES das asserções: o que se mede tem que ser o
-- comportamento com triggers ligados.
SET LOCAL session_replication_role = origin;

-- Assinatura, na ordem exata de 20270730000000:454-462:
--   p_organization_id, p_operator_user_id, p_tc_session_id, p_peer_phone,
--   p_lead_id, p_direction, p_consent_record_id, p_existing_call_id
CREATE TEMP TABLE reserva AS
SELECT public.fn_voip_call_reserve(
  '11111111-1111-1111-1111-111111111111'::uuid,  -- org
  NULL,                                          -- operador (inbound nasce sem)
  'sess-teste',                                  -- sessão
  '5511999999999',                               -- peer
  NULL,                                          -- lead: inbound não exige
  'inbound',                                     -- direção
  NULL,                                          -- consentimento: inbound não exige
  NULL                                           -- sem linha prévia: cai no INSERT
) AS r;

SELECT is((SELECT (r->>'ok')::boolean FROM reserva), true,
  'reserva de entrada é autorizada');

SELECT matches(
  (SELECT r->>'tc_call_id' FROM reserva),
  '^[0-9A-F]{32}$',
  'a RPC devolve tc_call_id no formato que a VPS aceita'
);

-- `ok(... IS NOT NULL AND ...)`, não `is(a, b)`. O `is()` do pgTAP usa
-- `NOT $1 IS DISTINCT FROM $2`, então NULL = NULL PASSA — e antes da migration os
-- dois lados são NULL. A asserção seria vacuamente verdadeira exatamente no
-- estado que ela existe para reprovar.
SELECT ok(
  (SELECT c.tc_call_id IS NOT NULL
      AND c.tc_call_id = (SELECT r->>'tc_call_id' FROM reserva)
     FROM public.voip_calls c
    WHERE c.id = (SELECT (r->>'call_id')::uuid FROM reserva)),
  'o tc_call_id devolvido foi gravado na linha, e não é nulo'
);
```

Subir o `plan(4)` do topo do arquivo para `plan(7)`.

Se a reserva devolver `ok: false`, **ler o `code`** antes de mexer na migration — ele diz qual gate
recusou, e todos eles são de semente, não do que esta tarefa muda.

- [ ] **Passo 6: Rodar e confirmar que os três novos falham**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -f supabase/tests/voip_call_id_provenance_test.sql
```

Esperado: **apenas um dos três falha** — o `matches(... r->>'tc_call_id' ...)`, porque
`NULL ~ regex` devolve NULL e o pgTAP conta como falha.

Os outros dois passam contra a função atual, e isso é esperado:
- a reserva de entrada **já é autorizada** hoje;
- a comparação linha-contra-retorno só é load-bearing por causa do `IS NOT NULL` acrescentado no
  Passo 5 — sem ele, `is(NULL, NULL)` passaria.

Se você ver dois verdes inesperados aqui, **não vá depurar a semente**: é o comportamento correto
descrito acima.

- [ ] **Passo 7: Aplicar a migration localmente e rodar de novo**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/migrations/20270730000006_voip_call_id_provenance.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/tests/voip_call_id_provenance_test.sql
```

Esperado: os sete passam.

- [ ] **Passo 8: Registrar o teste no runner**

`supabase/tests/voip_gate_test.sql` existia e **nunca tinha rodado** por não estar no runner.

**A lista de suítes aparece em DOIS lugares no `run.sh`, e os dois precisam da entrada.** Acrescentar
só num deles faz o teste rodar em uma máquina e não na outra — o `pg_prove` é usado quando está
instalado, e o `psql` é o caminho de fallback, que é o que roda nesta máquina.

1. Na lista do `run_with_pg_prove`, depois de `"$SCRIPT_DIR/voip_gate_test.sql"` — repare que essa é
   hoje a **última** linha e não tem a barra invertida de continuação. Acrescentar a barra nela e a
   linha nova depois:

```bash
    "$SCRIPT_DIR/voip_gate_test.sql" \
    "$SCRIPT_DIR/voip_call_id_provenance_test.sql"
}
```

2. Na lista embutida do `for f in ...` de `run_with_psql`, ao fim, depois de `voip_gate_test.sql`:

```bash
... send_dedup_log_test.sql voip_foundation_test.sql voip_gate_test.sql voip_call_id_provenance_test.sql; do
```

Conferir que o arquivo novo aparece na saída dos dois caminhos:

```bash
bash supabase/tests/run.sh 2>&1 | grep voip_call_id_provenance
```

Esperado: pelo menos uma linha `----- running voip_call_id_provenance_test.sql via psql -----`.

- [ ] **Passo 9: Provar o rollback**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/migrations/rollback/20270730000006_voip_call_id_provenance.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/tests/voip_call_id_provenance_test.sql
```

Esperado: os três testes novos **voltam a falhar**. Reaplicar a migration do Passo 7.

- [ ] **Passo 10: Commit**

```bash
git add supabase/migrations/20270730000006_voip_call_id_provenance.sql \
        supabase/migrations/rollback/20270730000006_voip_call_id_provenance.sql \
        supabase/tests/voip_call_id_provenance_test.sql \
        supabase/tests/run.sh
git commit -m "feat(voip): a reserva passa a cunhar o id de rede da chamada

O CRM assinava cid = voip_calls.id (uuid, 36 chars) e a VPS exige 32 de
[0-9A-F]. Nenhum token de chamada passava.

fn_voip_call_reserve passa a cunhar tc_call_id no formato aceito e a devolvê-lo.
Chamada de entrada devolve o id que já existe na linha.

Efeito colateral que importa: tc_call_id passa a existir ANTES de a VPS
responder, e a UNIQUE (tc_session_id, tc_call_id) vira chave de idempotência
utilizável — antes a coluna nascia nula e o btree trata NULLs como distintos.

CREATE OR REPLACE de propósito: DROP + CREATE devolveria EXECUTE a PUBLIC e anon."
```

---

## Tarefa 7: o assinador passa a usar o id de rede como `cid`

**Files:**
- Modify: `supabase/functions/_shared/voip/call-plane.ts` — **dois** pontos:
  `renewCallControlToken` (~113-145) e `authorizeCallAndMint` (~295-334)
- Modify: `supabase/functions/torquecalls-signal/index.ts` (~179-200)
- Test: `supabase/functions/_shared/voip/call-plane.test.ts`

**`call-plane.ts` tem DOIS chamadores de `signCallToken`, não um.** Consertar só o de
`authorizeCallAndMint` deixa `renewCallControlToken` (linha 139) assinando `cid: call.id` — o uuid.
Consequência: **desligar e recusar continuam tomando 401 `cid fora do formato`** depois do plano
inteiro. E isso derruba o próprio portão, porque a Medição 4 espera ver `call-ended` no stream, e o
caminho de desligar da UI passa exatamente por aqui:
`useVoiceCall.ts:198,213` → `torquecallsApi.endCall()` → `torquecalls-signal:83-84 terminate()` →
`:283-287 renewCallControlToken` → `:290 callVps` no path com `tc_call_id`.

**Interfaces:**
- Consumes: `tc_call_id` no retorno de `fn_voip_call_reserve` (Tarefa 6).
- Produces: o retorno de `authorizeCallAndMint` ganha o campo **`tcCallId: string`**, ao lado de
  `callId`, `peer`, `leadId`, `tokens` e `expiresAt`.

- [ ] **Passo 1: Escrever o teste que falha**

O arquivo **já tem** os dublês e os helpers. Usar os que existem — inventar novos é como se produz
um dublê com formato que a RPC real nunca devolve:

- `stubClient({ tables, rpc })` — cliente de mentira (linha 63)
- `decodeClaims(token)` — devolve as claims do JWS (linha 44)
- `memberCaller()`, `openSession()`, `ownedLead()`, `grantedConsent`, `permissiveEngine`
- `okReserve()` (linha 145) — **o dublê da RPC, usado por 8 testes**
- Constantes `ORG`, `USER`, `LEAD`, `CALL`

Assinatura real: `authorizeCallAndMint(caller, { supabaseAdmin, tcSessionId, direction, leadId })`.

**Primeiro, atualizar o dublê da RPC** para o formato que ela passa a devolver (linha 145):

```ts
// O id de rede que a reserva passa a cunhar. 32 chars de [0-9A-F] — o formato
// exato que validCallID aceita do outro lado.
const TC_CALL = "D1111111111111111111111111111111";

const okReserve = () => ({ ok: true, call_id: CALL, tc_call_id: TC_CALL, token_jti: "jti-1" });
```

Isso mantém os 8 testes existentes verdes — nenhum deles assere o conjunto de chaves do retorno da
RPC — e alimenta os novos.

Depois, acrescentar ao fim do arquivo:

```ts
// O arquivo inteiro não tinha UMA asserção sobre o cid — por isso a suíte ficou
// verde enquanto, em produção, todo token de chamada era recusado por formato.
Deno.test("o cid assinado é o id de rede, não o uuid da linha", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(res.ok, `esperava autorização, veio ${JSON.stringify(res)}`);

  // O uuid continua identificando a linha do ledger.
  assertEquals(res.callId, CALL);
  // E o id de rede é o que vai para a VPS.
  assertEquals(res.tcCallId, TC_CALL);

  // A asserção que importa: callIDFor compara o cid da claim com o id do path,
  // e o path é montado a partir do tc_call_id.
  for (const tok of [res.tokens.start, res.tokens.media, res.tokens.ctl]) {
    const c = decodeClaims(tok);
    assertEquals(c.cid, TC_CALL, "o cid tem que ser o id de rede");
    assertMatch(c.cid as string, /^[0-9A-F]{32}$/, "o cid tem que passar no validCallID da VPS");
  }
});

Deno.test("recusa sem assinar quando a reserva não devolve tc_call_id", async () => {
  await setupSigningKey();

  // Fail-closed. Assinar sem id de rede produz token que a VPS recusa por
  // formato, e o sintoma chega como "a chamada não completa" em vez de erro de
  // contrato.
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: () => ({ ok: true, call_id: CALL, token_jti: "jti-1" }),
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assertEquals(res.ok, false);
  assertEquals((res as { code?: string }).code, "reserve_failed");
});
```

E o teste do **segundo** assinador, que é o que faltava:

```ts
// renewCallControlToken é o outro chamador de signCallToken. Sem este teste, o
// caminho de desligar continuaria com o uuid no cid e tomando 401 — e o defeito
// só apareceria ao vivo, no portão.
Deno.test("renewCallControlToken também assina o cid com o id de rede", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        tc_session_id: "tc-sess",
        tc_call_id: TC_CALL,
        peer_phone: "5548991005289",
        lead_id: LEAD,
        operator_user_id: USER,
        status: "connected",
      }),
      ...permissiveEngine,
    },
  });

  const res = await renewCallControlToken(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    callId: CALL,
  });

  assert(res.ok, `esperava renovação, veio ${JSON.stringify(res)}`);
  assertMatch(decodeClaims(res.ctl).cid as string, /^[0-9A-F]{32}$/);
  assertEquals(decodeClaims(res.ctl).cid, TC_CALL);
});
```

Conferir que `assertMatch` está entre os imports do topo do arquivo e que `renewCallControlToken`
está no import de `call-plane.ts`; se não estiverem, acrescentar.

- [ ] **Passo 2: Rodar e confirmar que falham**

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11/supabase/functions
deno test --allow-env --allow-net --allow-read --no-check _shared/voip/call-plane.test.ts
```

Esperado: **os três falham** — `res.tcCallId` é `undefined`, e o `cid` das claims é o uuid nos dois
assinadores.

- [ ] **Passo 3: Consumir o `tc_call_id` — nos DOIS assinadores**

**(a) `renewCallControlToken`.** Acrescentar `tc_call_id` ao `.select(...)` da linha 119, assinar
com ele, e falhar fechado sem ele:

```ts
  const { data: call } = await args.supabaseAdmin
    .from("voip_calls")
    .select("id, organization_id, tc_session_id, tc_call_id, peer_phone, lead_id, operator_user_id, status")
    .eq("id", args.callId)
    .maybeSingle();
```

```ts
  // Sem id de rede não há o que assinar: o cid tem que ser a mesma string que
  // vai no path, senão callIDFor recusa com 404 e o operador não consegue
  // desligar a própria ligação.
  if (!call.tc_call_id) {
    return { ok: false, code: "no_tc_call_id" };
  }

  const t = await signCallToken({
    act: ["call.end"],
    ttlSeconds: TTL_CTL_SECONDS,
    org: caller.orgId,
    sub: caller.userId,
    sid: args.tcSessionId,
    cid: call.tc_call_id,
    peer: call.peer_phone,
    lead: call.lead_id,
  });
```

Acrescentar `"no_tc_call_id"` à união de códigos de `RenewCtlResult`, e tratá-lo em
`torquecalls-signal` como **409** — a chamada existe, mas não é encerrável por esse caminho.

**(b) `authorizeCallAndMint`.**

Em `supabase/functions/_shared/voip/call-plane.ts`, substituir o bloco a partir de
`const result = reserved as ...`:

```ts
  const result = reserved as {
    ok: boolean;
    code?: string;
    call_id?: string;
    tc_call_id?: string;
    retry_after_ms?: number;
  };
  if (!result.ok) {
    return deny((result.code ?? "reserve_failed") as DenyCode, result.retry_after_ms);
  }

  const callId = result.call_id!;
  const tcCallId = result.tc_call_id;

  // Fail-closed. Assinar sem id de rede produz um token que a VPS recusa por
  // formato, e o sintoma chega como "a chamada não completa" em vez de como
  // erro de contrato. A reserva já foi feita, então o log tem que registrar
  // para a linha órfã ser explicável depois.
  if (!tcCallId) {
    await logRuntime({
      organizationId: caller.orgId,
      module: "voip",
      action: "reserve_sem_tc_call_id",
      status: "error",
      entityType: "voip_call",
      entityId: callId,
    });
    return deny("reserve_failed");
  }

  // 6. SÓ ENTÃO assina. Nada acima pode ser pulado para chegar aqui.
  //
  // O cid é o id de REDE, não o uuid da linha. São coisas diferentes: o uuid
  // identifica o registro no ledger; o cid é o que a VPS conhece, o que
  // validCallID valida, e o que vai no path das rotas de accept, end, reject e
  // webrtc — onde callIDFor compara os dois.
  const startAct = direction === "outbound" ? "call.start" : "call.accept";
  const common = {
    sc: "call" as const,
    org: caller.orgId,
    sub: caller.userId,
    sid: tcSessionId,
    cid: tcCallId,
    peer,
    lead: leadId,
  };
```

E no retorno:

```ts
  return {
    ok: true,
    callId,
    tcCallId,
    peer,
    leadId,
    tokens: { start: start.token, media: media.token, ctl: ctl.token },
    expiresAt: { start: start.expiresAt, media: media.expiresAt, ctl: ctl.expiresAt },
  };
```

Acrescentar `tcCallId: string;` ao tipo de retorno declarado no topo do arquivo.

- [ ] **Passo 4: Rodar e confirmar que passam**

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11/supabase/functions
deno test --allow-env --allow-net --allow-read --no-check _shared/voip/call-plane.test.ts
```

Esperado: PASS nos três novos e nos 12 que já existiam.

- [ ] **Passo 5: A VPS deixa de ser a fonte do id**

Em `supabase/functions/torquecalls-signal/index.ts`, substituir o bloco de linhas ~190-199:

```ts
  // A VPS ecoa o id que autorizamos. Divergência aqui é defeito de contrato, não
  // dado a absorver: escrever o valor dela por cima faria o ledger e a
  // credencial falarem de chamadas diferentes, que é exatamente o desencontro
  // que esta fatia consertou.
  const ecoado = started.data?.call?.callId ?? null;
  if (ecoado && ecoado !== authorized.tcCallId) {
    await logRuntime({
      organizationId: caller.orgId,
      module: "voip",
      action: "vps_call_id_divergente",
      status: "error",
      entityType: "voip_call",
      entityId: authorized.callId,
      payloadSnapshot: { autorizado: authorized.tcCallId, ecoado },
    });
  }

  await db
    .from("voip_calls")
    .update({
      status: "ringing",
      ringing_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", authorized.callId);

  return json(200, {
    call_id: authorized.callId,
    tc_call_id: authorized.tcCallId,
```

O `update` não escreve mais `tc_call_id` — a coluna já foi preenchida na reserva.

Conferir se `caller` e `logRuntime` estão no escopo desta função; se não estiverem, usar os nomes
que o arquivo já usa ali.

- [ ] **Passo 6: Rodar a suíte de voip inteira**

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11/supabase/functions
deno test --allow-env --allow-net --allow-read --no-check _shared/voip/ torquecalls-control/
```

Esperado: 27 da linha de base (Tarefa 0, Passo 6) mais os três novos = **30 passed / 0 failed**.

- [ ] **Passo 7: Conferir o choke**

```bash
bash scripts/test-voip-choke.sh
```

Esperado: passa. Só `call-plane.ts` chama `signCallToken`, e nenhuma função nova lê
`TORQUECALLS_SIGNING_SK`.

- [ ] **Passo 8: Lint e commit**

```bash
npm run lint 2>&1 | tail -5
git add supabase/functions/_shared/voip/call-plane.ts \
        supabase/functions/_shared/voip/call-plane.test.ts \
        supabase/functions/torquecalls-signal/index.ts
git commit -m "fix(voip): assinar o cid com o id de rede, não com o uuid da linha

O cid da credencial é comparado por callIDFor contra o id do path. Assinar o
uuid de voip_calls fazia as duas strings serem diferentes por construção: a VPS
recusava o token por formato, e as rotas de accept, end, reject e webrtc davam
404.

O cid passa a ser o tc_call_id cunhado na reserva. Fail-closed se a RPC não o
devolver: assinar sem ele produz token recusado e o sintoma chega como 'a
chamada não completa' em vez de erro de contrato.

torquecalls-signal deixa de escrever o id ecoado pela VPS e passa a conferi-lo.
Absorver a divergência faria ledger e credencial falarem de chamadas diferentes."
```

---

## Tarefa 8: o portão — provar ao vivo

**Nada nesta tarefa é automatizável, e nada dela deve ser feito sem o CTO presente.** Ela existe
para transformar defeito deduzido em defeito observado, antes de a fase 3 ser desenhada em cima.

**Files:**
- Nenhum arquivo de código. Produz um registro de medição.

**Interfaces:**
- Consumes: as Tarefas 1 a 7, todas mergeadas e implantadas.
- Produces: as quatro medições e as duas respostas que o plano da fase 3 (S11) precisa —
  **o whatsmeow aceita call-id que não foi ele quem sorteou?** e **o volume da VPS sobrevive a
  `up -d`?**

- [ ] **Passo 1: Medir a persistência do volume, ANTES de qualquer deploy**

Na VPS:

```bash
cat /opt/torquecalls/docker-compose.yml
docker inspect -f '{{json .Mounts}}' torquecalls | python3 -m json.tool
docker inspect -f '{{.Config.WorkingDir}}' torquecalls
```

Registrar as três saídas. **Se nenhum mount cobrir o `WorkingDir`** (que é onde o `torquecalls.db`
relativo aterrissa), a decisão de chave da fase 3 está morta e o plano dela muda: caminho absoluto
dentro de um mount explícito, movendo banco e chave na mesma janela.

Não deduzir persistência de "o produto funciona". A evidência que circulava é do binário do espelho
AstraCalls, que persistia em Postgres.

- [ ] **Passo 2: Aplicar a migration em produção**

**`db push` não serve aqui, e não é questão de cautela — ele aborta.** O ledger de produção e o
diretório de migrations divergem nos dois sentidos:

- **40 linhas no ledger para 44 arquivos**;
- **18 arquivos sem linha** (`20260727140000`, `20270203000000`, `20270204000000`, `20270215000000`,
  `20270216000000`, `20270728000000`–`003`, `20270729000000`–`002`, `20270730000000`–`005`);
- **14 linhas sem arquivo** — a renumeração das migrations de 28 a 30 de julho, mais a duplicata
  `20260727150203`.

As 14 linhas órfãs disparam `Remote migration versions not found in local migrations directory.` e o
CLI **para antes de imprimir lista nenhuma**. E `20260727140000` ordena antes da última versão
remota, o que dispara a segunda parede,
`Found local migration files to be inserted before the last migration on remote database`.

Aplicar **uma** migration, direto, com o CTO autorizando no momento:

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
git status --porcelain    # tem que estar vazio
psql "<URL de prod>" -v ON_ERROR_STOP=1 -f supabase/migrations/20270730000006_voip_call_id_provenance.sql
```

E registrar no ledger à mão, senão o próximo `db push` acha que ela falta:

```sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20270730000006', 'voip_call_id_provenance');
```

Conferir depois que a função viva é a nova **e** que os disjuntores continuam de pé:

```sql
select substring(pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure)
                 from 'c_max_org_live[^;]*;') as disjuntor,
       pg_get_functiondef('public.fn_voip_call_reserve(uuid,uuid,text,text,uuid,text,uuid,uuid)'::regprocedure)
         like '%tc_call_id%' as tem_cunhagem;
```

Esperado: `c_max_org_live constant integer := 100;` e `tem_cunhagem = true`.

**Reconciliar o ledger é trabalho separado e não entra nesta fatia.** Vira issue.

- [ ] **Passo 3: Deployar as edge functions do worktree certo**

Deploy empacota o `_shared/` da árvore de trabalho. Deployar de um checkout atrasado **reverte em
produção** o que está na `main` — já aconteceu neste repositório.

```bash
cd /Users/gabrielaureliogipp/Dev/wt-torquecalls-s11
git log --oneline -1    # tem que ser o commit da Tarefa 7
supabase functions deploy torquecalls-signal  --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy torquecalls-control --project-ref jsjsmuncfkbsbzqzqhfq
```

- [ ] **Passo 4: Redeploy do frontend no EasyPanel**

Manual, pela interface. Sem ele a tela de pareamento não existe para o CTO. Confirmar que a imagem
puxada é a `:latest` publicada depois do merge do PR #1317.

- [ ] **Passo 5: Construir e subir a imagem da VPS**

Na VPS, com o binário compilado da branch `fix/torquecalls-contrato`. Seguir o processo que já
existe em `/opt/torquecalls` — **registrar por escrito qual é**, porque não está no repositório e
essa ausência é um risco conhecido.

```bash
docker logs --tail 20 torquecalls   # "HTTP server listening"
```

- [ ] **Passo 6: MEDIÇÃO 1 — o número pareia**

Na tela Integrações → TorqueCalls, clicar em "Ativar voz" num número com slot de aparelho livre.

Esperado: **o QR aparece**. Este é o defeito da Tarefa 1 saindo de produção.

```sql
select tc_session_id, status, jid, updated_at from public.voip_sessions;
```

Esperado: uma linha. `status` fica em `pending` ou `pairing` — **promover para `open` é o S11 e
ainda não existe.** Isso é correto e esperado.

- [ ] **Passo 7: MEDIÇÃO 2 — a ligação sai e toca**

São **duas** escrituras manuais em produção, não uma. As duas com o CTO presente, as duas
registradas no Passo 10.

**(1) O botão de ligar não aparece**, porque `useVoipSession` exige `status = 'open'`:

```sql
update public.voip_sessions
   set status = 'open', updated_at = now()
 where tc_session_id = '<o da medição 1>';
```

**(2) A ligação seria recusada por falta de consentimento, antes de qualquer token ser assinado.**
Chamada de saída exige um `consent_records` de tipo `voice_call_whatsapp`, vivo, com
`source IN ('form','api','webhook')`. Em produção existem **zero** linhas desse tipo, e **não há
caminho de produto para criar uma**: `fn_voip_consent_record` é `service_role`-only e não tem um
único chamador em `src/` nem em `supabase/functions/`; o hook `useConsent` grava `source: 'manual'`,
que o gate exclui de propósito. A recusa acontece em `call-plane.ts:263`, antes da reserva.

```sql
select public.fn_voip_consent_record(
  '<org>'::uuid,
  '<lead_id do número de teste>'::uuid,
  true,
  'api',
  '<telefone do lead>'
);
```

As duas são muletas de teste, não atalhos de produto. A primeira é exatamente a promoção que o S11
vai automatizar com prova criptográfica — e que o CTO já recusou fazer a partir da palavra do
navegador. A segunda expõe uma lacuna real de produto que **vira issue**: o consentimento de voz não
tem porta de entrada nenhuma.

Então ligar para um número de teste pelo chat. Esperado: o telefone de destino toca.

Triagem, em ordem de probabilidade:
- **`consent_missing`** → a escrita (2) não foi feita, ou nasceu com `source` errado. **Não** é
  defeito das Tarefas 3, 6 ou 7.
- **`session_not_open`** → a escrita (1) não foi feita.
- **401 `cid fora do formato`** → a Tarefa 6 ou a 7 não chegou em produção.
- **404 `no such call`** → o `callIDFor` ainda está desencontrado; conferir a Tarefa 3.

- [ ] **Passo 8: MEDIÇÃO 3 — o áudio funciona nos dois sentidos**

Atender e falar. Confirmar áudio de ida e de volta.

**Esta é a medição que responde a pergunta da fase 3:** se a ligação completa, o whatsmeow aceitou
um call-id que não foi ele quem sorteou, e a Opção A do spec está confirmada. **Se falhar
especificamente aqui**, com o token passando e a chamada não estabelecendo, a alternativa do
§1.2 do spec volta à mesa.

- [ ] **Passo 9: MEDIÇÃO 4 — os três eventos saem do broker**

A medição que autoriza a fase 3.

**Não dá para observar isso pelo navegador**, e essa era uma premissa errada deste plano.
`subscribeSessionEvents` tem um único chamador — `useVoicePairing.openStream` — e ele **aborta o
stream** no instante em que chega `auth-state` com `paired: true`, ou seja, exatamente quando a
Medição 1 dá certo. Reabrir pela UI é impossível: o `VoicePairingDialog` só é montado pelo botão
"Ativar voz", que desaparece assim que a instância tem sessão.

Ler o stream **fora do navegador**. Antes de discar, pedir um token de stream — **sem** `pair: true`:

```bash
TOKEN=$(curl -s -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/torquecalls-signal \
  -H "Authorization: Bearer <JWT de um admin da org>" -H "Content-Type: application/json" \
  -d '{"action":"streamToken","tc_session_id":"<o da medição 1>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -N -H "Authorization: Bearer $TOKEN" -H "Accept: text/event-stream" \
  "<vps_url>/api/events" | tee /tmp/sse-portao.txt
```

O token vive 60 s, mas `serveSSE` não revalida nada depois do connect — o stream sobrevive à
chamada inteira.

Com o `curl` rodando, fazer uma ligação inteira e registrar os eventos que chegam em
`/tmp/sse-portao.txt`.

Esperado, em ordem: `ringing` → `connected` → `call-ended`.

**Se `connected` ou `call-ended` não aparecerem, a Tarefa 4 não está em produção** — é exatamente o
defeito do `OrgID` que ela conserta, e o S11 não pode ser construído sobre emissores que não emitem.

Conferir o ledger:

```sql
select id, tc_call_id, status, direction, peer_phone, authorized_at, ringing_at, ended_at
  from public.voip_calls order by created_at desc limit 5;
```

Esperado: `tc_call_id` **preenchido** (Tarefa 6) e no formato de 32 hex maiúsculos. O `status` vai
estar em `ringing` ou `expired` — **promover para `connected`/`ended` é o S11.** O ceifador expira a
linha em 12 a 72 segundos, e isso também é esperado.

- [ ] **Passo 10: Registrar as medições**

Escrever as nove saídas em `.specs/torquecalls/MEDICOES-PORTAO-FASE1.md` e commitar. O plano da
fase 3 é escrito a partir deste arquivo, não de dedução.

Incluir explicitamente:
1. O `WorkingDir` e os `Mounts` do container.
2. Se o áudio funcionou (⇒ a Opção A do `cid` está confirmada).
3. Quais dos três eventos apareceram em `/tmp/sse-portao.txt` — anexar o arquivo.
4. Que a promoção para `open` foi feita à mão, e em qual sessão.
5. Que um `consent_records` de voz foi criado à mão, para qual lead, com qual `source`.
6. Que a migration foi aplicada por `psql` e a linha do ledger inserida à mão.

---

## Self-review

**Cobertura do spec (fase 1 e 2):**

| Requisito do spec | Tarefa |
|---|---|
| §1.1 `pair_sid` na struct + principal + coerência de escopo | 1 |
| §1.1 entrega do QR restrita ao `pairSID` | 2 |
| §1.2 `fn_voip_call_reserve` cunha `tc_call_id` | 6 |
| §1.2 `signCallToken` usa o id de rede | 7 |
| §1.2 `startOutgoing` adota o id | 3 |
| §1.2 `validCallID` continua aplicado | 3 (passo 1) |
| §1.3 `OrgID` no `rec` | 4 |
| §1.3 preservação no `upsertCall` | 4 |
| §1.3 teste de `OrgID` que nasce vermelho | 4 (passo 6) |
| §1.3 transições de saída | 5 |
| §1.3 `Pair` chama `setAuth` | 5 |
| §1.3 `at` no `auth-state` | 5 |
| Fase 2, medições 1 a 4 | 8 |
| Fase 2, medição de persistência do volume | 8 (passo 1) |
| Fase 2, armadilha do `jid` UNIQUE global | fora — vira issue, conforme o spec |

**Consistência de tipos entre tarefas:**
- `subscribe(clientID, orgID, pairSID string)` — definida na 2, usada só na 2.
- `serveSSE(w, r, clientID, orgID, pairSID string)` — definida na 2, chamada na 2.
- `startOutgoing(ctx, callID, peer, isVideo)` — definida na 3, chamada na 3.
- `tc_call_id` (chave do JSON da RPC) — produzida na 6, consumida na 7.
- `tcCallId` (campo do retorno de `authorizeCallAndMint`) — produzido na 7, consumido na 7.
- `claims.PairSid` → `principal.pairSID` — produzido na 1, consumido na 2.

**Fora do escopo deste plano, registrado no spec:** todo o S11 (envelope, outbox, webhook, RPC de
aplicação, reconciliação, alerta), as seis issues da seção final do spec, e a issue #1320.

---

## O que a revisão adversarial do plano mudou

Seis agentes tentaram derrubar as premissas deste plano antes de ele ser executado. Voltaram 22
achados: 9 que fariam uma tarefa não rodar, 7 testes que passariam sem medir o que dizem medir, 6
imprecisões. Todos corrigidos acima. Os que valem memória:

1. **A migration da Tarefa 6 reverteria uma decisão de 2026-07-30.** O corpo vigente de
   `fn_voip_call_reserve` é o de `20270730000003`, não o da fundação. Copiar da fundação reimporia
   `c_max_org_live` 2, `c_max_per_minute` 6 e `c_peer_backoff` 15 min — e o pgTAP ficaria verde,
   porque a semente faz uma chamada só.
2. **A Tarefa 2 fecharia meia porta.** O QR também viaja dentro do `auth-state`, que vai para toda a
   organização. Três testes verdes teriam certificado uma restrição que o fio não tinha.
3. **Os testes de edge function são de Deno.** `npx vitest` sobre eles não roda nada e sai com
   código 1 — um vermelho que não mede.
4. **`call-plane.ts` tem dois assinadores**, não um. Sem o segundo, desligar continuaria em 401
   depois do plano inteiro.
5. **A Tarefa 4 media a coisa errada.** `upsertCall` e `endCall` também publicam `call-list`, que
   chega mesmo quando o `call-status` é descartado — a asserção por `len()` ficava verde com o
   defeito presente.
6. **O portão não rodaria.** `db push` aborta por divergência do ledger; a ligação seria recusada por
   falta de consentimento, que não tem porta de entrada nenhuma no produto; e o stream SSE não é
   observável pelo navegador, porque o hook o aborta quando o pareamento conclui.

## Issues a abrir junto (além das seis do spec)

7. **Consentimento de voz não tem porta de entrada.** `fn_voip_consent_record` é `service_role`-only
   e não tem um único chamador em `src/` nem em `supabase/functions/`. `useConsent` grava
   `source: 'manual'`, que o gate exclui de propósito. Produção tem zero linhas de
   `voice_call_whatsapp`. Sem isso, nenhuma ligação de saída pode ser autorizada por caminho de
   produto — só por escrita manual no banco.
8. **O ledger de migrations diverge nos dois sentidos:** 40 linhas para 44 arquivos, com 18 arquivos
   não aplicados **e** 14 linhas órfãs (renumeração de 28–30 de julho + a duplicata
   `20260727150203`). `db push` aborta. Reconciliar é trabalho próprio.
9. **`useVoicePairing` aborta o stream ao concluir o pareamento** e não há como reabri-lo pela UI —
   o botão "Ativar voz" some quando a instância tem sessão. Qualquer diagnóstico de evento ao vivo
   depende de `curl`.
