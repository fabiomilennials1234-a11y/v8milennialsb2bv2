# S11 — webhook da VPS para o CRM

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Goal:** A sessão de voz passa a ficar `open` sozinha, e o ledger de chamadas passa a registrar
quando a pessoa atendeu e por que a ligação terminou — hoje as duas coisas dependem de escrita
manual no banco.

**Architecture:** Confiança invertida. A VPS ganha um par Ed25519 próprio (a privada nasce no
processo e nunca é lida por humano), assina cada evento sobre os bytes crus do corpo, e faz POST
numa edge function nova. O CRM verifica assinatura antes de tocar o banco, deriva a organização da
linha de `voip_sessions` — nunca do corpo — e aplica a transição dentro de uma RPC `SECURITY
DEFINER`, onde o anti-replay e a máquina de estados são a mesma transação.

**Tech Stack:** Go 1.26 (`crypto/ed25519`, `net/http`, SQLite via `modernc.org/sqlite`) · Deno /
TypeScript (Supabase Edge Functions, `crypto.subtle`) · PostgreSQL 15 com pgTAP

**Spec:** `.specs/torquecalls/S11-ESCOPO-REVISADO.md`

## Global Constraints

- **Repo Go:** `/Users/gabrielaureliogipp/Dev/tc-s5`. Branch nova `feat/s11-webhook` a partir de
  `origin/fix/torquecalls-contrato` — **não** de `origin/main`, que ainda não tem os 8 commits do
  contrato (PR #20 aberto). Confirme com `git log --oneline -1` antes de começar.
- **Repo CRM:** `/Users/gabrielaureliogipp/Dev/wt-voip-callstate`, branch
  `feat/torquecalls-s11-webhook` (já criada de `origin/main`).
- **Nunca `git stash` no repo do CRM.** Os stashes são compartilhados entre worktrees e há WIP de
  outras branches empilhado.
- **Testes de `supabase/functions/` são de Deno, não de vitest:**
  `cd supabase/functions && deno test --allow-env --allow-net --allow-read --no-check <caminho>`.
  `npx vitest` sobre eles não roda nada e sai com código 1.
- **pgTAP:** rodar o arquivo específico com `psql -f`; `supabase test db` roda a suíte inteira, onde
  17 arquivos herdados estão vermelhos. Todo arquivo novo entra em `supabase/tests/run.sh` **nos
  dois lugares** (a lista do `pg_prove` e o `for f in ...` do `psql`).
- **Migration nova:** prefixo livre a partir de `20270730000010`. Rollback pareado em
  `supabase/migrations/rollback/` com nome idêntico. `CREATE OR REPLACE`, nunca `DROP` + `CREATE` —
  dropar devolve `EXECUTE` a `PUBLIC` e `anon`.
- **`db push` não funciona neste projeto** (ledger com 40 linhas para 44+ arquivos). Aplicar por
  `psql -f` ou pelo MCP, e inserir a linha no ledger à mão.
- **Nada em produção** sem autorização explícita do CTO no momento.
- Mensagens de commit em português, Conventional Commits.

---

## Estrutura de arquivos

### Frente Go — `/Users/gabrielaureliogipp/Dev/tc-s5`

| Arquivo | Responsabilidade | Tarefas |
|---|---|---|
| `cmd/server/webhookkey.go` | **novo** — nascimento, guarda e carga do par Ed25519 | 1 |
| `cmd/server/webhooksign.go` | **novo** — monta e assina o envelope JWS | 2 |
| `cmd/server/webhookseq.go` | **novo** — `epoch` no SQLite, `seq` por sessão | 3 |
| `cmd/server/webhook.go` | **novo** — cliente HTTP: monta, assina, envia | 4 |
| `cmd/server/broker.go` | pendura o emissor nos três eventos | 5 |
| `cmd/server/main.go` · `server.go` | fiação: carrega a chave, injeta o emissor | 1, 4 |

### Frente CRM — `/Users/gabrielaureliogipp/Dev/wt-voip-callstate`

| Arquivo | Responsabilidade | Tarefas |
|---|---|---|
| `supabase/migrations/20270730000011_voip_webhook_ingest.sql` | tabela de anti-replay, colunas de marca d'água, RPC de aplicação | 6 |
| `supabase/migrations/rollback/20270730000010_...sql` | rollback pareado | 6 |
| `supabase/tests/voip_webhook_ingest_test.sql` | pgTAP da RPC e das transições | 6 |
| `supabase/functions/_shared/voip/webhook-verify.ts` | **novo** — verificação Ed25519 + auto-teste de chave | 7 |
| `supabase/functions/torquecalls-webhook/index.ts` | **novo** — o endpoint | 8 |
| `supabase/config.toml` | `verify_jwt = false` para a função nova | 8 |

---

## Tarefa 1: a chave nasce no processo e vive no volume

**Files:**
- Create: `cmd/server/webhookkey.go`
- Modify: `cmd/server/main.go` (junto de `buildVerifier`, ~linha 110)
- Test: `cmd/server/webhookkey_test.go`

**Interfaces:**
- Consumes: nada.
- Produces: `loadOrCreateWebhookKey(dir string, log *slog.Logger) (ed25519.PrivateKey, string, error)`
  — devolve a privada, o `kid`, e erro. O `kid` é derivado dos 8 primeiros caracteres do SHA-256 da
  pública, em hexadecimal minúsculo.

**Contexto:** o volume da VPS **persiste** — provado por recreate real em 2026-07-31: o
`torquecalls.db` sobreviveu a `up -d` com imagem nova, mesmo timestamp. O `-db` é caminho absoluto
em `/data`, que é o volume nomeado `torquecalls_sqlite`. Por isso a chave pode morar ao lado do
banco, sem plano B.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `cmd/server/webhookkey_test.go`:

```go
package main

import (
	"crypto/ed25519"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// A chave nasce na primeira subida e é REUSADA na segunda. Sem isto, cada
// restart geraria par novo e o CRM passaria a recusar todo webhook — com o
// sintoma pior possível: pareamento que nunca completa, sem erro nenhum.
func TestLoadOrCreateWebhookKey_PersisteEntreChamadas(t *testing.T) {
	dir := t.TempDir()

	priv1, kid1, err := loadOrCreateWebhookKey(dir, silentLogger())
	if err != nil {
		t.Fatalf("primeira carga: %v", err)
	}
	if len(priv1) != ed25519.PrivateKeySize {
		t.Fatalf("chave com %d bytes, esperado %d", len(priv1), ed25519.PrivateKeySize)
	}

	priv2, kid2, err := loadOrCreateWebhookKey(dir, silentLogger())
	if err != nil {
		t.Fatalf("segunda carga: %v", err)
	}
	if !priv1.Equal(priv2) {
		t.Fatal("a segunda carga gerou chave nova; tinha que reusar a do disco")
	}
	if kid1 != kid2 {
		t.Fatalf("kid mudou entre cargas: %q -> %q", kid1, kid2)
	}
}

// A privada é segredo. Arquivo legível por outro usuário do host é o mesmo que
// não ter chave — qualquer processo na caixa assina eventos em nome da VPS.
func TestLoadOrCreateWebhookKey_ArquivoNaoEhLegivelPorOutros(t *testing.T) {
	dir := t.TempDir()
	if _, _, err := loadOrCreateWebhookKey(dir, silentLogger()); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(dir, webhookKeyFile))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != fs.FileMode(0o600) {
		t.Fatalf("permissão %04o; esperado 0600", perm)
	}
}

// Chave corrompida NÃO pode virar chave nova em silêncio: isso trocaria um erro
// visível por um serviço que sobe e é recusado pelo CRM para sempre.
func TestLoadOrCreateWebhookKey_ArquivoCorrompidoFalha(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, webhookKeyFile), []byte("nao é chave"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, _, err := loadOrCreateWebhookKey(dir, silentLogger()); err == nil {
		t.Fatal("arquivo corrompido deveria falhar, não gerar chave nova")
	}
}
```

Acrescente `"io"` aos imports.

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/gabrielaureliogipp/Dev/tc-s5
go test ./cmd/server/ -run TestLoadOrCreateWebhookKey -v
```

Esperado: **falha de compilação** — `loadOrCreateWebhookKey` e `webhookKeyFile` não existem.

- [ ] **Passo 3: Implementar**

Criar `cmd/server/webhookkey.go`:

```go
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

// webhookKeyFile mora AO LADO do torquecalls.db, no mesmo volume — que é
// persistente (provado por recreate em 2026-07-31: o banco sobreviveu a `up -d`
// com imagem nova). Se este arquivo sumir, a VPS gera par novo e o CRM passa a
// recusar todo webhook; por isso a perda é barulhenta no log, e o runbook manda
// copiar a pública nova para os segredos do Supabase.
const webhookKeyFile = "webhook_ed25519.key"

// loadOrCreateWebhookKey devolve a privada de assinatura de webhook e o kid.
//
// A privada NASCE NO PROCESSO e nunca passa por terminal, .env ou histórico de
// shell — decisão do CTO em 2026-07-30. Só a pública é registrada, e é ela que
// vai para os segredos do Supabase.
func loadOrCreateWebhookKey(dir string, log *slog.Logger) (ed25519.PrivateKey, string, error) {
	path := filepath.Join(dir, webhookKeyFile)

	raw, err := os.ReadFile(path)
	switch {
	case err == nil:
		if len(raw) != ed25519.PrivateKeySize {
			// Falha ALTA em vez de gerar chave nova. Gerar aqui trocaria um erro
			// visível no boot por um serviço que sobe e é recusado pelo CRM
			// indefinidamente — e o sintoma seria "o pareamento não completa",
			// que não aponta para cá.
			return nil, "", fmt.Errorf(
				"%s tem %d bytes; esperado %d. Chave corrompida — mova o arquivo e reinicie para gerar outra, "+
					"e lembre de atualizar TORQUECALLS_WEBHOOK_PUBKEY no Supabase",
				path, len(raw), ed25519.PrivateKeySize)
		}
		priv := ed25519.PrivateKey(raw)
		return priv, webhookKID(priv), nil

	case errors.Is(err, os.ErrNotExist):
		pub, priv, genErr := ed25519.GenerateKey(rand.Reader)
		if genErr != nil {
			return nil, "", genErr
		}
		// 0600 antes de escrever: WriteFile respeita o modo só na CRIAÇÃO, e um
		// arquivo legível por outro usuário do host é o mesmo que não ter chave.
		if wErr := os.WriteFile(path, priv, 0o600); wErr != nil {
			return nil, "", wErr
		}
		kid := webhookKID(priv)
		// A PÚBLICA no log, nunca a privada. É por aqui que o operador a copia
		// para TORQUECALLS_WEBHOOK_PUBKEY nos segredos do Supabase.
		log.Warn("par de webhook gerado — copie a publica para o Supabase",
			"kid", kid,
			"TORQUECALLS_WEBHOOK_PUBKEY", kid+":"+base64.RawURLEncoding.EncodeToString(pub))
		return priv, kid, nil

	default:
		return nil, "", err
	}
}

// webhookKID identifica a chave sem revelá-la: 8 primeiros caracteres do
// SHA-256 da pública. Serve para o CRM saber qual chave verificar quando houver
// duas vivas durante uma rotação.
func webhookKID(priv ed25519.PrivateKey) string {
	sum := sha256.Sum256(priv.Public().(ed25519.PublicKey))
	return hex.EncodeToString(sum[:4])
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
go test ./cmd/server/ -run TestLoadOrCreateWebhookKey -v
go build ./...
```

Esperado: PASS nos três, build limpo.

- [ ] **Passo 5: Fiar no `main.go`**

Em `cmd/server/main.go`, depois de `buildVerifier` e **antes** de `newServer`, carregue a chave a
partir do diretório do banco:

```go
	// A chave do webhook vive ao lado do banco, no mesmo volume persistente.
	webhookPriv, webhookKid, err := loadOrCreateWebhookKey(filepath.Dir(*dbPath), log)
	if err != nil {
		log.Error("chave de webhook indisponivel", "err", err)
		os.Exit(1)
	}
```

Acrescente `"path/filepath"` aos imports. **O processo não sobe sem a chave** — mesma disciplina do
verificador: um serviço que sobe sem poder assinar produziria eventos que o CRM recusa, e o sintoma
apareceria como pareamento que não completa.

- [ ] **Passo 6: Build e commit**

```bash
go build ./... && go test ./cmd/server/...
git add cmd/server/webhookkey.go cmd/server/webhookkey_test.go cmd/server/main.go
git commit -m "feat(webhook): par Ed25519 que nasce no processo e vive no volume

A privada nunca passa por terminal, .env ou histórico de shell — decisão do CTO
em 2026-07-30. Só a pública vai para o log, e é dela que sai o
TORQUECALLS_WEBHOOK_PUBKEY do Supabase.

Mora ao lado do torquecalls.db, no mesmo volume — persistência provada por
recreate real: o banco sobreviveu a up -d com imagem nova, mesmo timestamp.

Arquivo corrompido FALHA em vez de gerar chave nova: gerar trocaria um erro
visível no boot por um serviço que sobe e é recusado pelo CRM para sempre, com
o sintoma aparecendo como 'o pareamento não completa'."
```

---

## Tarefa 2: o envelope assinado

**Files:**
- Create: `cmd/server/webhooksign.go`
- Test: `cmd/server/webhooksign_test.go`

**Interfaces:**
- Consumes: a privada e o `kid` da Tarefa 1.
- Produces:
  `signWebhook(priv ed25519.PrivateKey, kid, audience, env, sid string, epoch, seq int64, body []byte, now time.Time) (string, error)`
  — devolve o JWS compacto que vai no header `Authorization: Bearer`.

**O contrato do envelope.** Espelha `_shared/voip/internal/sign.ts` do CRM, no sentido inverso.
Header `{alg:"EdDSA", typ:"JWT", kid}`. Claims:

| Claim | Valor |
|---|---|
| `iss` | `"torquecalls-vps"` |
| `aud` | o host do CRM (`TORQUECALLS_WEBHOOK_AUDIENCE`) |
| `env` | `TORQUECALLS_ENV` — token de dev não escreve em prod |
| `iat` / `exp` | `exp = iat + 300` |
| `jti` | uuid v4, uso único |
| `sid` | a sessão — é por ela que o CRM deriva a organização |
| `bh` | SHA-256 do corpo, base64url sem padding |
| `epoch` / `seq` | ordem |

**`bh` é o que impede o token de ser reusado com outro corpo.** Sem ele, quem interceptasse um
envelope válido poderia trocar o payload inteiro.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `cmd/server/webhooksign_test.go`:

```go
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func decodeClaims(t *testing.T, jws string) map[string]any {
	t.Helper()
	parts := strings.Split(jws, ".")
	if len(parts) != 3 {
		t.Fatalf("jws com %d partes, esperado 3", len(parts))
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("payload não é base64url: %v", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatalf("payload não é json: %v", err)
	}
	return claims
}

func TestSignWebhook_AssinaturaVerificaComAPublica(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	body := []byte(`{"type":"auth-state","paired":true}`)

	jws, err := signWebhook(priv, "abc12345", "crm.exemplo", "test", "sess-1", 7, 42, body, time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}

	parts := strings.Split(jws, ".")
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(pub, []byte(parts[0]+"."+parts[1]), sig) {
		t.Fatal("a assinatura não verifica com a pública correspondente")
	}
}

// bh é o que amarra o token AO CORPO. Sem ele, um envelope válido interceptado
// autorizaria qualquer payload.
func TestSignWebhook_BhEhOHashDoCorpo(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	body := []byte(`{"type":"call-status","status":"connected"}`)

	jws, err := signWebhook(priv, "abc12345", "crm.exemplo", "test", "sess-1", 1, 1, body, time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}

	sum := sha256.Sum256(body)
	esperado := base64.RawURLEncoding.EncodeToString(sum[:])
	if got := decodeClaims(t, jws)["bh"]; got != esperado {
		t.Fatalf("bh = %v; esperado %v", got, esperado)
	}
}

// Corpo diferente TEM que produzir bh diferente — senão o campo é decorativo.
func TestSignWebhook_CorpoDiferenteMudaOBh(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Unix(1_700_000_000, 0)

	a := decodeClaims(t, mustSign(t, priv, []byte(`{"a":1}`), now))["bh"]
	b := decodeClaims(t, mustSign(t, priv, []byte(`{"a":2}`), now))["bh"]
	if a == b {
		t.Fatal("corpos diferentes produziram o mesmo bh")
	}
}

func mustSign(t *testing.T, priv ed25519.PrivateKey, body []byte, now time.Time) string {
	t.Helper()
	jws, err := signWebhook(priv, "abc12345", "crm.exemplo", "test", "sess-1", 1, 1, body, now)
	if err != nil {
		t.Fatal(err)
	}
	return jws
}

func TestSignWebhook_ClaimsObrigatorias(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Unix(1_700_000_000, 0)

	c := decodeClaims(t, mustSign(t, priv, []byte(`{}`), now))

	for _, k := range []string{"iss", "aud", "env", "iat", "exp", "jti", "sid", "bh", "epoch", "seq"} {
		if _, ok := c[k]; !ok {
			t.Errorf("claim %q ausente", k)
		}
	}
	if c["exp"].(float64)-c["iat"].(float64) != 300 {
		t.Errorf("exp - iat = %v; esperado 300", c["exp"].(float64)-c["iat"].(float64))
	}
	if c["env"] != "test" {
		t.Errorf("env = %v; token de dev não pode escrever em prod", c["env"])
	}
}

// jti de uso único: dois envelopes do mesmo corpo têm que ter jti diferente,
// senão o anti-replay do CRM recusaria o segundo evento legítimo.
func TestSignWebhook_JtiEhUnicoPorEnvelope(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Unix(1_700_000_000, 0)
	body := []byte(`{"x":1}`)

	a := decodeClaims(t, mustSign(t, priv, body, now))["jti"]
	b := decodeClaims(t, mustSign(t, priv, body, now))["jti"]
	if a == b {
		t.Fatalf("jti repetido entre envelopes: %v", a)
	}
}
```

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
go test ./cmd/server/ -run TestSignWebhook -v
```

Esperado: falha de compilação — `signWebhook` não existe.

- [ ] **Passo 3: Implementar**

Criar `cmd/server/webhooksign.go`:

```go
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// webhookTTL é curto de propósito: o envelope autoriza UMA entrega, e o que
// garante ordem é o par (epoch, seq), não a validade da assinatura. Um token
// longo seria um token roubável por muito tempo, sem ganho nenhum.
const webhookTTL = 300 * time.Second

type webhookHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
	Kid string `json:"kid"`
}

type webhookClaims struct {
	Iss   string `json:"iss"`
	Aud   string `json:"aud"`
	Env   string `json:"env"`
	Iat   int64  `json:"iat"`
	Exp   int64  `json:"exp"`
	Jti   string `json:"jti"`
	Sid   string `json:"sid"`
	Bh    string `json:"bh"`
	Epoch int64  `json:"epoch"`
	Seq   int64  `json:"seq"`
}

// signWebhook monta o JWS compacto que vai no Authorization do webhook.
//
// ASSIMETRIA INVERTIDA: aqui a VPS ASSINA e o CRM verifica — o oposto do token
// de chamada, onde o CRM assina e a VPS verifica. As duas direções existem ao
// mesmo tempo, com pares DIFERENTES, e confundi-las é o erro que mata a
// propriedade: se a VPS pudesse assinar com a chave do CRM, uma VPS
// comprometida cunharia autoridade para qualquer organização.
//
// `bh` amarra o token AO CORPO. Sem ele, um envelope válido interceptado
// autorizaria qualquer payload.
func signWebhook(
	priv ed25519.PrivateKey,
	kid, audience, env, sid string,
	epoch, seq int64,
	body []byte,
	now time.Time,
) (string, error) {
	sum := sha256.Sum256(body)

	hdr, err := json.Marshal(webhookHeader{Alg: "EdDSA", Typ: "JWT", Kid: kid})
	if err != nil {
		return "", err
	}
	iat := now.Unix()
	cl, err := json.Marshal(webhookClaims{
		Iss:   "torquecalls-vps",
		Aud:   audience,
		Env:   env,
		Iat:   iat,
		Exp:   iat + int64(webhookTTL.Seconds()),
		Jti:   uuid.NewString(),
		Sid:   sid,
		Bh:    base64.RawURLEncoding.EncodeToString(sum[:]),
		Epoch: epoch,
		Seq:   seq,
	})
	if err != nil {
		return "", err
	}

	signing := base64.RawURLEncoding.EncodeToString(hdr) + "." + base64.RawURLEncoding.EncodeToString(cl)
	sig := ed25519.Sign(priv, []byte(signing))
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}
```

Se `github.com/google/uuid` não estiver no `go.mod`, rode `go get github.com/google/uuid` — ou, se
preferir não acrescentar dependência, gere o `jti` com `crypto/rand` (16 bytes em hexadecimal
serve; o CRM só precisa que seja único, não que seja uuid). **Decida e justifique no relatório.**

- [ ] **Passo 4: Rodar, build e commit**

```bash
go test ./cmd/server/ -run TestSignWebhook -v && go build ./...
git add cmd/server/webhooksign.go cmd/server/webhooksign_test.go go.mod go.sum
git commit -m "feat(webhook): envelope JWS assinado pela VPS

Confiança invertida: aqui a VPS assina e o CRM verifica — o oposto do token de
chamada. As duas direções coexistem com pares DIFERENTES; confundi-las mataria a
propriedade que o ADR-0024 §3 construiu.

bh (SHA-256 do corpo) amarra o token ao payload: sem ele, um envelope válido
interceptado autorizaria qualquer corpo.

TTL de 300s porque a ordem é garantida pelo par (epoch, seq), não pela validade
da assinatura. Token longo seria roubável por mais tempo, sem ganho."
```

---

## Tarefa 3: ordem que sobrevive ao restart

**Files:**
- Create: `cmd/server/webhookseq.go`
- Modify: `cmd/server/sessionstore.go` (a migração idempotente, ~linha 33-50)
- Test: `cmd/server/webhookseq_test.go`

**Interfaces:**
- Consumes: o `*sql.DB` já aberto por `openDB`.
- Produces: `newSeqKeeper(ctx context.Context, db *sql.DB) (*seqKeeper, error)` e
  `(*seqKeeper).next(sessionID string) (epoch, seq int64)`.

**Por que `epoch`.** O `seq` é um contador em memória e recomeça do zero a cada boot. Só com `seq`,
o primeiro reinício faria o CRM recusar todo evento para sempre como "velho" — um kill-switch
acidental. O `epoch` fica no SQLite e incrementa **uma vez por boot**; o CRM aceita se
`epoch > last_epoch` **ou** (`epoch = last_epoch` **e** `seq > last_seq`).

- [ ] **Passo 1: Escrever o teste que falha**

Criar `cmd/server/webhookseq_test.go`:

```go
package main

import (
	"context"
	"testing"
)

// O seq é por sessão: duas sessões não podem compartilhar contador, senão o
// CRM veria a segunda sempre "atrás" e descartaria eventos legítimos.
func TestSeqKeeper_SeqEhPorSessao(t *testing.T) {
	db := openTestDB(t)
	k, err := newSeqKeeper(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}

	_, a1 := k.next("sess-A")
	_, a2 := k.next("sess-A")
	_, b1 := k.next("sess-B")

	if a1 != 1 || a2 != 2 {
		t.Fatalf("sess-A: %d, %d; esperado 1, 2", a1, a2)
	}
	if b1 != 1 {
		t.Fatalf("sess-B começou em %d; esperado 1 — o contador não é compartilhado", b1)
	}
}

// O epoch SOBE a cada boot. Sem isto, o seq voltando a 1 depois de um restart
// faria o CRM recusar todo evento para sempre.
func TestSeqKeeper_EpochSobeACadaBoot(t *testing.T) {
	db := openTestDB(t)

	k1, err := newSeqKeeper(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	e1, _ := k1.next("sess-A")

	// Segundo keeper sobre o MESMO banco = segundo boot.
	k2, err := newSeqKeeper(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	e2, seq := k2.next("sess-A")

	if e2 <= e1 {
		t.Fatalf("epoch não subiu: %d -> %d", e1, e2)
	}
	if seq != 1 {
		t.Fatalf("seq depois do restart = %d; esperado 1 (é o epoch que resolve, não o seq)", seq)
	}
}
```

Você vai precisar de um helper `openTestDB(t)` que devolva um `*sql.DB` em memória ou em
`t.TempDir()`. Veja como `cmd/server/db_test.go` já faz isso e **reuse**, não duplique.

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
go test ./cmd/server/ -run TestSeqKeeper -v
```

Esperado: falha de compilação.

- [ ] **Passo 3: Implementar**

Criar `cmd/server/webhookseq.go`:

```go
package main

import (
	"context"
	"database/sql"
	"sync"
)

// seqKeeper numera os eventos de webhook para que o CRM possa recusar entrega
// fora de ordem.
//
// O PAR (epoch, seq) EXISTE POR UM MOTIVO ESPECÍFICO. O seq é memória e
// recomeça do zero a cada boot. Com ele sozinho, o primeiro restart faria o CRM
// ver "1" depois de já ter aceitado "500" e descartar tudo dali em diante —
// para sempre, sem erro nenhum. O epoch é persistido e sobe uma vez por boot,
// então "epoch maior" ganha de "seq menor".
type seqKeeper struct {
	epoch int64

	mu  sync.Mutex
	seq map[string]int64
}

func newSeqKeeper(ctx context.Context, db *sql.DB) (*seqKeeper, error) {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS webhook_epoch (
		id    INTEGER PRIMARY KEY CHECK (id = 1),
		epoch INTEGER NOT NULL
	)`); err != nil {
		return nil, err
	}

	// Incrementa e lê numa instrução só: dois processos subindo juntos não
	// podem receber o mesmo epoch.
	var epoch int64
	if err := db.QueryRowContext(ctx, `
		INSERT INTO webhook_epoch (id, epoch) VALUES (1, 1)
		ON CONFLICT (id) DO UPDATE SET epoch = webhook_epoch.epoch + 1
		RETURNING epoch
	`).Scan(&epoch); err != nil {
		return nil, err
	}

	return &seqKeeper{epoch: epoch, seq: map[string]int64{}}, nil
}

// next devolve o par para o próximo evento daquela sessão.
func (k *seqKeeper) next(sessionID string) (int64, int64) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.seq[sessionID]++
	return k.epoch, k.seq[sessionID]
}
```

- [ ] **Passo 4: Rodar, build e commit**

```bash
go test ./cmd/server/ -run TestSeqKeeper -v && go build ./...
git add cmd/server/webhookseq.go cmd/server/webhookseq_test.go
git commit -m "feat(webhook): ordem por (epoch, seq) que sobrevive ao restart

O seq é memória e recomeça a cada boot. Com ele sozinho, o primeiro restart
faria o CRM ver '1' depois de ter aceitado '500' e descartar tudo dali em
diante — para sempre, sem erro nenhum.

O epoch é persistido no SQLite e sobe uma vez por boot, num INSERT ... ON
CONFLICT DO UPDATE RETURNING para que dois processos subindo juntos não recebam
o mesmo valor."
```

---

## Tarefa 4: o emissor

**Files:**
- Create: `cmd/server/webhook.go`
- Modify: `cmd/server/server.go` (struct `server`, ~linha 15-27; `newServer`, ~linha 41)
- Modify: `cmd/server/main.go` (fiação)
- Test: `cmd/server/webhook_test.go`

**Interfaces:**
- Consumes: `signWebhook` (T2), `seqKeeper` (T3), a chave (T1).
- Produces: `type webhookSender struct{...}` com
  `send(sessionID string, payload any)` — **não bloqueante**, dispara numa goroutine.

**A restrição que manda no desenho:** este emissor é chamado de dentro do broker, que é chamado de
dentro do laço de eventos do whatsmeow. **Bloquear aqui trava a chamada de voz.** O envio é
assíncrono e best-effort — sem fila durável, por decisão do CTO. Timeout curto, uma tentativa.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `cmd/server/webhook_test.go`:

```go
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestWebhookSender_EnviaAssinadoComOCorpoIntacto(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)

	var mu sync.Mutex
	var gotAuth string
	var gotBody []byte
	done := make(chan struct{})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotAuth = r.Header.Get("Authorization")
		gotBody, _ = io.ReadAll(r.Body)
		mu.Unlock()
		close(done)
	}))
	defer srv.Close()

	s := newWebhookSender(srv.URL, priv, "kid123", "crm.exemplo", "test", newTestSeqKeeper(t), silentLogger())
	s.send("sess-1", map[string]any{"type": "auth-state", "paired": true})

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("o webhook não chegou em 3s")
	}

	mu.Lock()
	defer mu.Unlock()

	if len(gotAuth) < 8 || gotAuth[:7] != "Bearer " {
		t.Fatalf("Authorization = %q; esperado Bearer <jws>", gotAuth)
	}
	var body map[string]any
	if err := json.Unmarshal(gotBody, &body); err != nil {
		t.Fatalf("corpo não é json: %v", err)
	}
	if body["type"] != "auth-state" || body["paired"] != true {
		t.Fatalf("corpo chegou alterado: %v", body)
	}
}

// O envio NÃO pode bloquear: ele nasce dentro do laço de eventos do whatsmeow,
// e travar aqui trava a chamada de voz.
func TestWebhookSender_NaoBloqueia(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)

	// Servidor que nunca responde.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(30 * time.Second)
	}))
	defer srv.Close()

	s := newWebhookSender(srv.URL, priv, "kid123", "crm.exemplo", "test", newTestSeqKeeper(t), silentLogger())

	inicio := time.Now()
	s.send("sess-1", map[string]any{"type": "auth-state"})
	if d := time.Since(inicio); d > 100*time.Millisecond {
		t.Fatalf("send bloqueou por %v; tem que retornar na hora", d)
	}
}

// URL vazia = webhook desligado. O serviço tem que seguir funcionando sem ele,
// senão uma configuração faltando derruba a chamada de voz inteira.
func TestWebhookSender_SemURLNaoQuebra(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	s := newWebhookSender("", priv, "kid123", "crm.exemplo", "test", newTestSeqKeeper(t), silentLogger())
	s.send("sess-1", map[string]any{"type": "auth-state"}) // não pode entrar em pânico
}
```

Escreva o helper `newTestSeqKeeper(t)` reusando o `openTestDB` da Tarefa 3.

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
go test ./cmd/server/ -run TestWebhookSender -v
```

- [ ] **Passo 3: Implementar**

Criar `cmd/server/webhook.go`:

```go
package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// webhookTimeout é curto: o CRM só precisa aceitar e enfileirar. Timeout longo
// aqui só serviria para segurar goroutine quando o CRM estivesse ruim.
const webhookTimeout = 5 * time.Second

// webhookSender entrega evento assinado ao CRM.
//
// BEST-EFFORT, E ISSO É DECISÃO, NÃO DESCUIDO. Não há fila durável (decisão do
// CTO em 2026-07-31): evento perdido é coberto por duas redes que já existem —
// o varredor `voip-sweep-stuck-calls` fecha a linha de chamada, e a
// reconciliação corrige o estado da sessão. Construir outbox, retry e
// dead-letter no Go, onde tudo é greenfield, não se paga nesta fatia.
//
// NÃO BLOQUEIA. Este emissor é chamado de dentro do broker, que roda no laço de
// eventos do whatsmeow: bloquear aqui trava a chamada de voz.
type webhookSender struct {
	url      string
	priv     ed25519.PrivateKey
	kid      string
	audience string
	env      string
	seq      *seqKeeper
	client   *http.Client
	log      *slog.Logger
}

func newWebhookSender(url string, priv ed25519.PrivateKey, kid, audience, env string, seq *seqKeeper, log *slog.Logger) *webhookSender {
	return &webhookSender{
		url:      url,
		priv:     priv,
		kid:      kid,
		audience: audience,
		env:      env,
		seq:      seq,
		client:   &http.Client{Timeout: webhookTimeout},
		log:      log,
	}
}

func (s *webhookSender) send(sessionID string, payload any) {
	// URL vazia desliga o webhook sem derrubar nada. Vale para o spike local e
	// para o intervalo entre subir o binário novo e configurar o segredo.
	if s == nil || s.url == "" || sessionID == "" {
		return
	}

	body, err := json.Marshal(payload)
	if err != nil {
		s.log.Error("webhook: payload não serializa", "err", err)
		return
	}

	epoch, seq := s.seq.next(sessionID)
	token, err := signWebhook(s.priv, s.kid, s.audience, s.env, sessionID, epoch, seq, body, time.Now())
	if err != nil {
		s.log.Error("webhook: falha ao assinar", "err", err)
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), webhookTimeout)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
		if err != nil {
			s.log.Error("webhook: request inválida", "err", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := s.client.Do(req)
		if err != nil {
			s.log.Warn("webhook: entrega falhou", "err", err, "sessao", sessionID)
			return
		}
		defer resp.Body.Close()

		// 4xx é defeito de contrato e não melhora sozinho — merece nível alto.
		// 5xx é o CRM passando mal; some quando ele voltar.
		if resp.StatusCode >= 500 {
			s.log.Warn("webhook: CRM devolveu erro", "status", resp.StatusCode, "sessao", sessionID)
		} else if resp.StatusCode >= 400 {
			s.log.Error("webhook: CRM RECUSOU", "status", resp.StatusCode, "sessao", sessionID)
		}
	}()
}
```

- [ ] **Passo 4: Fiar no servidor**

Em `cmd/server/server.go`, acrescente à struct `server`:

```go
	// webhook entrega eventos ao CRM. Pode ser nil em teste; `send` trata.
	webhook *webhookSender
```

Acrescente o parâmetro a `newServer` e passe adiante. Em `main.go`, monte o `seqKeeper` e o
`webhookSender` a partir de `TORQUECALLS_WEBHOOK_URL`, `TORQUECALLS_WEBHOOK_AUDIENCE` e
`TORQUECALLS_ENV`, e injete.

**O `seqKeeper` precisa do `*sql.DB`**, que hoje é aberto dentro de `newServer` por `openDB`. Ou
você o cria lá dentro, ou expõe o banco. Escolha o caminho que mexer menos, e justifique.

- [ ] **Passo 5: Rodar, build e commit**

```bash
go test ./cmd/server/... && go build ./... && go vet ./...
git add cmd/server/webhook.go cmd/server/webhook_test.go cmd/server/server.go cmd/server/main.go
git commit -m "feat(webhook): emissor assíncrono que não trava a chamada

Chamado de dentro do broker, que roda no laço de eventos do whatsmeow —
bloquear aqui travaria a chamada de voz. Dispara em goroutine, timeout de 5s,
uma tentativa.

Best-effort por decisão do CTO: sem fila durável. Evento perdido é coberto pelo
varredor (fecha a linha) e pela reconciliação (corrige a sessão).

URL vazia desliga o webhook sem derrubar nada — vale para o spike local e para
o intervalo entre subir o binário e configurar o segredo."
```

---

## Tarefa 5: pendurar o emissor nos eventos

**Files:**
- Modify: `cmd/server/broker.go` (`emitAuthState` ~165, `upsertCall` ~231, `endCall` ~297)
- Test: `cmd/server/broker_test.go`

**Interfaces:**
- Consumes: `webhookSender.send` (T4).
- Produces: os três eventos saindo também por webhook, além do SSE.

**O que vai em cada payload.** O CRM precisa casar o evento com a linha do ledger por
`(tc_session_id, tc_call_id)` — **nunca por telefone**, porque o JID do WhatsApp perde o 9º dígito
do celular brasileiro.

| Evento | Campos |
|---|---|
| `auth-state` | `type`, `sessionId`, `paired`, `state`, `at` |
| `call-status` | `type`, `sessionId`, `id`, `status`, `direction`, `peer`, `startedAt` |
| `call-ended` | `type`, `sessionId`, `id`, `reason`, `endedAt` |

**`peer` tem que ir em dígitos, não como JID.** `voip_calls.peer_phone` tem
`CHECK (peer_phone ~ '^[0-9]{8,15}$')` — mandar `5548...@s.whatsapp.net` faria o INSERT de chamada
de entrada quebrar. Normalize no Go, onde o JID é conhecido.

**NÃO mande a organização no payload.** O CRM a deriva de `voip_sessions.tc_session_id`. Confiança
invertida quer dizer que a VPS assina o evento, não que ela decide o tenant.

- [ ] **Passo 1: Escrever o teste que falha**

Acrescentar a `cmd/server/broker_test.go`:

```go
// O webhook tem que sair JUNTO com o SSE, não no lugar dele: o SSE alimenta a
// tela aberta, o webhook alimenta o ledger e sobrevive ao navegador fechado.
func TestBroker_EmiteWebhookAlemDoSSE(t *testing.T) {
	b := NewBroker()
	var enviados []map[string]any
	var mu sync.Mutex
	b.OnWebhook = func(sessionID string, payload any) {
		mu.Lock()
		defer mu.Unlock()
		m, _ := payload.(map[string]any)
		enviados = append(enviados, m)
	}

	sub := b.subscribe("op-A", "org-1", "")
	defer b.unsubscribe(sub)

	b.emitAuthState("org-1", "s1", AuthSnapshot{State: "open", Paired: true})
	b.upsertCall(CallRecord{
		OrgID: "org-1", SessionID: "s1", CallID: "C1",
		Direction: "outbound", Peer: "5548991005289", Status: StatusRinging,
	})
	b.endCall("s1", "C1", "user_ended")

	mu.Lock()
	defer mu.Unlock()

	tipos := map[string]bool{}
	for _, e := range enviados {
		tipos[e["type"].(string)] = true
	}
	for _, esperado := range []string{"auth-state", "call-status", "call-ended"} {
		if !tipos[esperado] {
			t.Errorf("webhook de %q não foi emitido; saíram: %v", esperado, tipos)
		}
	}
}

// A organização NÃO vai no payload: o CRM a deriva da linha de voip_sessions.
// Mandá-la aqui convidaria alguém a confiar no corpo para decidir tenant.
func TestBroker_WebhookNaoCarregaOrganizacao(t *testing.T) {
	b := NewBroker()
	var payloads []map[string]any
	var mu sync.Mutex
	b.OnWebhook = func(_ string, p any) {
		mu.Lock()
		defer mu.Unlock()
		m, _ := p.(map[string]any)
		payloads = append(payloads, m)
	}

	b.emitAuthState("org-1", "s1", AuthSnapshot{State: "open", Paired: true})

	mu.Lock()
	defer mu.Unlock()
	for _, p := range payloads {
		for _, proibido := range []string{"org", "orgId", "organization_id"} {
			if _, tem := p[proibido]; tem {
				t.Errorf("payload carrega %q: %v", proibido, p)
			}
		}
	}
}
```

Acrescente `"sync"` aos imports de `broker_test.go` se faltar.

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
go test ./cmd/server/ -run TestBroker_.*Webhook -v
```

Esperado: falha de compilação — `OnWebhook` não existe no `Broker`.

- [ ] **Passo 3: Implementar**

Em `cmd/server/broker.go`, acrescente à struct `Broker`:

```go
	// OnWebhook entrega o evento ao CRM, além do SSE. Nil em teste e quando o
	// webhook está desligado.
	//
	// O SSE alimenta a TELA ABERTA; o webhook alimenta o LEDGER e sobrevive ao
	// navegador fechado. Um não substitui o outro.
	OnWebhook func(sessionID string, payload any)
```

E um auxiliar, para não repetir a checagem de nil:

```go
func (b *Broker) toCRM(sessionID string, payload map[string]any) {
	if b.OnWebhook == nil || sessionID == "" {
		return
	}
	b.OnWebhook(sessionID, payload)
}
```

Chame-o nos três emissores, com os campos da tabela acima. Em `upsertCall` e `endCall`, o `peer`
tem que ir **em dígitos** — se `CallRecord.Peer` guarda o JID, extraia a parte antes do `@` e
remova o que não for dígito.

- [ ] **Passo 4: Fiar no `newServer`**

Onde o `Broker` é construído, ligue `broker.OnWebhook = sender.send` quando houver emissor.

- [ ] **Passo 5: Rodar, build e commit**

```bash
go test ./cmd/server/... && go build ./... && go vet ./...
git add cmd/server/broker.go cmd/server/broker_test.go cmd/server/server.go
git commit -m "feat(webhook): os três eventos saem também para o CRM

O SSE alimenta a tela aberta; o webhook alimenta o ledger e sobrevive ao
navegador fechado. Um não substitui o outro.

peer vai em DÍGITOS, não como JID: voip_calls.peer_phone tem CHECK de 8 a 15
dígitos, e o INSERT de chamada de entrada quebraria com 5548...@s.whatsapp.net.

A organização NÃO vai no payload — o CRM a deriva de voip_sessions. Confiança
invertida quer dizer que a VPS assina o evento, não que ela decide o tenant."
```

---

## Tarefa 6: a RPC que aplica o evento

**Files:**
- Create: `supabase/migrations/20270730000011_voip_webhook_ingest.sql`
- Create: `supabase/migrations/rollback/20270730000011_voip_webhook_ingest.sql`
- Create: `supabase/tests/voip_webhook_ingest_test.sql`
- Modify: `supabase/tests/run.sh`

**Interfaces:**
- Consumes: `voip_sessions`, `voip_calls` existentes.
- Produces: `fn_voip_apply_vps_event(p_event_jti uuid, p_sid text, p_epoch bigint, p_seq bigint, p_signed_at timestamptz, p_payload jsonb) RETURNS jsonb`
  — devolve `{ok, code}`. Códigos: `applied`, `replay`, `out_of_order`, `session_not_found`,
  `session_inert`, `transition_refused`.

**Trabalha no repositório do CRM**, `/Users/gabrielaureliogipp/Dev/wt-voip-callstate`.

- [ ] **Passo 1: Escrever a migration**

Três partes.

**(a) Tabela de anti-replay.** Nome do campo importa: `voip_calls.token_jti` já existe e é o `jti`
do sentido CRM→VPS. Chamar o novo de `jti` solto transforma o próximo incidente em caça ao
fantasma.

```sql
CREATE TABLE IF NOT EXISTS public.voip_webhook_events (
  event_jti       uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tc_session_id   text NOT NULL,
  seq_epoch       bigint NOT NULL,
  seq             bigint NOT NULL,
  signed_at       timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT voip_webhook_events_seq_pos CHECK (seq > 0 AND seq_epoch > 0)
);

CREATE INDEX IF NOT EXISTS idx_voip_webhook_events_expires_at
  ON public.voip_webhook_events(expires_at);

ALTER TABLE public.voip_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY voip_webhook_events_select_org ON public.voip_webhook_events
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));
CREATE POLICY master_select_all_voip_webhook_events ON public.voip_webhook_events
  FOR SELECT USING ((SELECT is_master_user()));

-- REVOKE de PUBLIC **e** de anon, separadamente: o pg_default_acl do schema
-- public concede anon em toda tabela nova, e revogar de PUBLIC não alcança
-- grant direto. Lição de 20270728000002_revoke_anon_meta_conversations.sql.
REVOKE ALL ON public.voip_webhook_events FROM PUBLIC;
REVOKE ALL ON public.voip_webhook_events FROM anon;
GRANT SELECT ON public.voip_webhook_events TO authenticated;
GRANT ALL    ON public.voip_webhook_events TO service_role;
```

**(b) Marca d'água por sessão:**

```sql
ALTER TABLE public.voip_sessions ADD COLUMN IF NOT EXISTS last_seq_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.voip_sessions ADD COLUMN IF NOT EXISTS last_seq       bigint NOT NULL DEFAULT 0;
```

**(c) A RPC.** `SECURITY DEFINER`, `search_path = public`, e ao fim:

```sql
REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) TO service_role;
```

O corpo, na ordem:

1. `SELECT ... INTO` a sessão por `tc_session_id`. Não achou → `{ok:true, code:'session_not_found'}`
   (a VPS não deve retentar por sessão que sumiu daqui).
2. Sessão `quarantined` → `{ok:true, code:'session_inert'}`.
3. **Reserva do jti** — a primeira escrita da transação:
   ```sql
   INSERT INTO public.voip_webhook_events (...)
   VALUES (p_event_jti, v_org, p_sid, p_epoch, p_seq, p_signed_at, now() + interval '60 minutes')
   ON CONFLICT (event_jti) DO NOTHING
   RETURNING event_jti INTO v_claimed;
   IF v_claimed IS NULL THEN RETURN jsonb_build_object('ok', true, 'code', 'replay'); END IF;
   ```
4. **Ordem:** aceita se `p_epoch > last_seq_epoch` OU (`p_epoch = last_seq_epoch` E
   `p_seq > last_seq`). Senão → `out_of_order`. Aceitando, atualiza as duas colunas.
5. **Despacho por `p_payload->>'type'`:**
   - `auth-state`: aplica a tabela de transição abaixo
   - `call-status`: casa por `(tc_session_id, tc_call_id)`; `connected` grava `connected_at = now()`
     e `status='connected'`; `ringing` grava `ringing_at` se nulo
   - `call-ended`: grava `status='ended'`, `ended_at`, `end_reason` do payload

**Tabela de transição de sessão** (a VPS emite `qr`, `open`, `logged_out`):

| Atual | `qr` | `open` | `logged_out` |
|---|---|---|---|
| `pending` | → `pairing` | → `open` | → `closed` |
| `pairing` | → `pairing` | → `open` | → `closed` |
| `open` | recusa | no-op | → `closed` |
| `closed` | → `pairing` | recusa | no-op |
| `quarantined` | recusa | recusa | recusa |

**A corrida com o varredor.** Ele fecha `ringing` com mais de 2 minutos, com
`end_reason='no_terminal_event'`. Um `connected` que chegue depois encontra a linha já `ended`.
Regra: evento de vida **ressuscita** linha fechada **somente** por `no_terminal_event`, e apenas se
o operador não tiver outra viva (`idx_voip_calls_one_live_per_operator`). A ressurreição escreve
`end_reason = NULL` e registra em `runtime_logs` — ela significa que a entrega está lenta.

**Limpeza por `pg_cron`**, no padrão idempotente do projeto (`unschedule` antes de `schedule`):

```sql
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voip-webhook-events-cleanup') THEN
    PERFORM cron.unschedule('voip-webhook-events-cleanup');
  END IF;
  PERFORM cron.schedule('voip-webhook-events-cleanup', '*/5 * * * *',
    $clean$DELETE FROM public.voip_webhook_events WHERE expires_at < now() - interval '1 minute'$clean$);
END
$cron$;
```

**A janela de 60 min** tem que ser ≥ TTL do envelope (300 s) + skew tolerado. Está folgada de
propósito; não a encurte sem olhar o TTL junto.

- [ ] **Passo 2: Escrever o rollback pareado**

`DROP FUNCTION`, `DROP TABLE`, `cron.unschedule`, e `ALTER TABLE ... DROP COLUMN` das duas colunas.
Cabeçalho declarando `-- ROLLBACK pareado: ...`, como as outras migrations voip.

- [ ] **Passo 3: Escrever o pgTAP**

Criar `supabase/tests/voip_webhook_ingest_test.sql`. Começa com
`CREATE EXTENSION IF NOT EXISTS pgtap;` — sem isso o `plan()` estoura.

Para semear, `whatsapp_instances` tem trigger `BEFORE INSERT` que chama `assert_org_access` e falha
para `postgres` sem JWT. **Siga o padrão de `supabase/tests/voip_call_id_provenance_test.sql`**
(`SET LOCAL session_replication_role = replica;` antes da semente, `origin` antes das asserções).

Cobrir, no mínimo:

- o mesmo `event_jti` duas vezes → segunda devolve `replay` e **não** altera nada
- `seq` menor com mesmo `epoch` → `out_of_order`
- `epoch` maior com `seq` menor → **aceita** (é o caso do restart, e é o ponto inteiro do `epoch`)
- `auth-state` `paired` numa sessão `pending` → vira `open`
- `auth-state` `qr` numa sessão `open` → **recusa**
- `call-status` `connected` → grava `connected_at` (**o que hoje é sempre nulo**)
- `call-ended` → grava `ended_at` e o `end_reason` do payload
- `connected` numa linha fechada por `no_terminal_event` → **ressuscita**
- `connected` numa linha fechada por `user_ended` → **não** ressuscita
- `anon` **não** tem EXECUTE na RPC

Registrar no `run.sh` **nos dois lugares**.

- [ ] **Passo 4: Aplicar no banco local e rodar**

```bash
cd /Users/gabrielaureliogipp/Dev/wt-voip-callstate
supabase db reset   # o `start` reusa volume e NÃO aplica migration nova
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -f supabase/tests/voip_webhook_ingest_test.sql
```

Rode **antes** de aplicar a migration e confirme que as asserções de comportamento falham. Depois
aplique e confirme que passam.

- [ ] **Passo 5: Provar o rollback**

Aplique o rollback, confirme que os testes voltam a falhar, reaplique a migration.

- [ ] **Passo 6: Commit**

```bash
git add supabase/migrations/20270730000011_voip_webhook_ingest.sql \
        supabase/migrations/rollback/20270730000011_voip_webhook_ingest.sql \
        supabase/tests/voip_webhook_ingest_test.sql supabase/tests/run.sh
git commit -m "feat(voip): RPC que aplica o evento da VPS, com anti-replay e ordem

Anti-replay, ordem por (epoch, seq), transição de sessão e escrita no ledger na
MESMA transação — a transição é a única coisa aqui que não pode ficar frouxa, e
assim ela vira invariante de armazenamento em vez de sequência de UPDATEs.

event_jti, não jti: voip_calls.token_jti já é o jti do sentido CRM->VPS, e
repetir o nome transformaria o próximo incidente em caça ao fantasma.

epoch maior com seq menor É ACEITO — é o caso do restart da VPS, e é o ponto
inteiro de existir epoch.

connected ressuscita linha fechada por no_terminal_event (o varredor), nunca por
user_ended: o operador que desligou decidiu, o varredor só chutou."
```

---

## Tarefa 7: verificação Ed25519 no CRM

**Files:**
- Create: `supabase/functions/_shared/voip/webhook-verify.ts`
- Test: `supabase/functions/_shared/voip/webhook-verify.test.ts`

**Interfaces:**
- Consumes: `TORQUECALLS_WEBHOOK_PUBKEY` (formato `kid:base64url`, uma ou duas separadas por
  vírgula, como o `TORQUECALLS_TOKEN_PUBKEY` da VPS já faz).
- Produces: `verifyWebhook(token: string, rawBody: string): Promise<VpsClaims | null>`.

**NÃO ponha em `internal/`.** O `scripts/test-voip-choke.sh` barra import de `internal/sign.ts` de
fora de `_shared/voip/`, e misturar verificador com assinador dentro de `internal/` convida alguém a
reusar a chave errada. Este arquivo lê **só** a pública do webhook, nunca `TORQUECALLS_SIGNING_SK`.

**O gate da chave é auto-teste, não blocklist.** Validar por tamanho não basta: existem chaves
Ed25519 de ordem pequena que fazem a verificação aceitar qualquer assinatura. Ao carregar cada
`kid`, verifique um par de fixtures — assinatura boa tem que dar `true`, ruim tem que dar `false`.
Falhou qualquer uma, a função **recusa servir**. Um mecanismo pega quatro problemas: chave neutra,
trocada, truncada e runtime sem Ed25519.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `supabase/functions/_shared/voip/webhook-verify.test.ts`. Cobrir:

- assinatura válida com corpo íntegro → devolve as claims
- **corpo alterado** → `null` (é o `bh` fazendo efeito)
- assinatura de outra chave → `null`
- `exp` no passado → `null`
- `aud` ou `env` diferentes → `null`
- chave de ordem pequena (`00` × 32) → a carga **recusa servir**

Gere as chaves no próprio teste com `crypto.subtle.generateKey({name:"Ed25519"}, true, ["sign","verify"])`
e assine com `crypto.subtle.sign`. A receita de importação está em
`_shared/voip/internal/sign.test.ts:61-77`.

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
cd /Users/gabrielaureliogipp/Dev/wt-voip-callstate/supabase/functions
deno test --allow-env --allow-net --allow-read --no-check _shared/voip/webhook-verify.test.ts
```

- [ ] **Passo 3: Implementar**

Importe a pública com `crypto.subtle.importKey("raw", pubBytes, { name: "Ed25519" }, false, ["verify"])`.

A verificação, em ordem: separar as três partes → decodificar o header e achar o `kid` →
verificar a assinatura sobre `header.payload` → conferir `aud`, `env`, `exp`, `iat` → **conferir o
`bh` contra o SHA-256 do corpo cru**.

**O corpo tem que ser o cru** (`await req.text()`), nunca `req.json()` reserializado: ordem de chave
e espaço mudam e quebram a verificação.

- [ ] **Passo 4: Rodar, choke e commit**

```bash
deno test --allow-env --allow-net --allow-read --no-check _shared/voip/
cd /Users/gabrielaureliogipp/Dev/wt-voip-callstate && bash scripts/test-voip-choke.sh
git add supabase/functions/_shared/voip/webhook-verify.ts supabase/functions/_shared/voip/webhook-verify.test.ts
git commit -m "feat(voip): verificação Ed25519 do webhook da VPS

Fica FORA de internal/: o choke barra import de internal/sign.ts de fora de
_shared/voip/, e misturar verificador com assinador ali convida a reusar a chave
errada. Este arquivo lê só a pública do webhook.

O gate da chave é AUTO-TESTE, não blocklist: existem chaves Ed25519 de ordem
pequena que fazem a verificação aceitar qualquer assinatura. Um fixture bom que
tem que passar e um ruim que tem que falhar pegam chave neutra, trocada,
truncada e runtime sem Ed25519 — quatro problemas, um mecanismo.

bh conferido contra o SHA-256 do corpo CRU. Reserializar o json quebraria a
verificação por ordem de chave."
```

---

## Tarefa 8: o endpoint

**Files:**
- Create: `supabase/functions/torquecalls-webhook/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `verifyWebhook` (T7), `fn_voip_apply_vps_event` (T6).
- Produces: o endpoint que a VPS chama.

**Sem CORS e sem OPTIONS** — quem chama é a VPS, não um navegador. Isto contraria o "padrão
obrigatório" do `CLAUDE.md` da raiz, e é o mesmo desvio que o `whatsapp-webhook` já faz. **Registre
a exceção no comentário do arquivo**, senão o próximo agente "conserta".

**Ordem das barreiras, deliberada:**

1. Limite de rajada em memória, por isolate
2. Teto de tamanho do corpo
3. **Assinatura, antes de qualquer consulta ao banco** — Ed25519 é barato; consultar o Postgres com
   payload não autenticado é o que vira amplificação. O `checkRateLimitPersistent` do projeto falha
   **aberto** em erro de banco (`_shared/auth.ts:246-249`), então ele não pode ser a única barreira
4. Só então chamar a RPC

**Códigos de resposta.** A VPS é nossa; a política de retry é escolha nossa, não imposição de
terceiro. Não copie o "200 sempre" do `whatsapp-webhook`, que existe porque o Uazapi faz retry
agressivo.

| Situação | Resposta |
|---|---|
| Assinatura inválida, expirada, `bh` divergente | `401` |
| `replay` ou `out_of_order` | `200` — já processado ou superado |
| `session_not_found` ou `session_inert` | `202` |
| `transition_refused` | `409` |
| Erro interno | `500` |

**Toda recusa vira `runtime_logs`** com `module: 'voip'` e ação própria por motivo. O alerta no
WhatsApp **não** funciona hoje (issue #1320) — não construa em cima dele.

- [ ] **Passo 1: Declarar no `config.toml`**

```toml
[functions.torquecalls-webhook]
verify_jwt = false
```

Copie o formato exato das entradas de `torquecalls-control` e `torquecalls-signal`.

- [ ] **Passo 2: Implementar**

Esqueleto, com os imports reais deste repositório:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { verifyWebhook } from "../_shared/voip/webhook-verify.ts";
```

**Confirme que `withErrorBoundary` não consome o corpo antes de você** — ele é lido uma vez só, e o
`bh` depende dos bytes crus.

- [ ] **Passo 3: Testar a rejeição sem deploy**

Rode a função localmente (`supabase functions serve torquecalls-webhook --env-file ...`) e prove:

- sem `Authorization` → 401
- com assinatura de outra chave → 401
- com corpo alterado depois de assinado → 401

- [ ] **Passo 4: Commit**

```bash
git add supabase/functions/torquecalls-webhook/index.ts supabase/config.toml
git commit -m "feat(voip): endpoint de ingestão do webhook da VPS

Sem CORS e sem OPTIONS de propósito: quem chama é a VPS, não um navegador —
mesmo desvio que o whatsapp-webhook já faz, registrado no comentário para o
próximo agente não 'consertar'.

Assinatura ANTES de qualquer consulta ao banco: Ed25519 é barato, e consultar o
Postgres com payload não autenticado é o que vira amplificação. O limitador
persistente do projeto falha ABERTO em erro de banco, então não pode ser a
única barreira.

A organização sai de voip_sessions, nunca do corpo."
```

---

## Tarefa 9: a prova ao vivo

**Nada aqui é automatizável.** Exige a VPS, o CRM e um telefone.

**Files:** nenhum de código. Produz o registro das medições.

- [ ] **Passo 1: Gerar a chave e capturar a pública**

Suba o binário novo na VPS **sem** `TORQUECALLS_WEBHOOK_URL` configurada. No boot, o log traz:

```
par de webhook gerado — copie a publica para o Supabase kid=... TORQUECALLS_WEBHOOK_PUBKEY=...
```

- [ ] **Passo 2: Configurar os dois lados**

No Supabase: `TORQUECALLS_WEBHOOK_PUBKEY` com o valor do log.
Na VPS: `TORQUECALLS_WEBHOOK_URL` apontando para a função, e `TORQUECALLS_WEBHOOK_AUDIENCE`.

- [ ] **Passo 3: MEDIÇÃO — a sessão promove sozinha**

Delete a sessão atual, pareie de novo, e **não escreva no banco**.

```sql
select tc_session_id, status, last_seq_epoch, last_seq from public.voip_sessions;
```

Esperado: `status = 'open'` **sem intervenção**. É o que hoje só existe por escrita manual.

- [ ] **Passo 4: MEDIÇÃO — o ledger registra a chamada**

Faça uma ligação e atenda.

```sql
select tc_call_id, status, connected_at, ended_at, end_reason
  from public.voip_calls order by created_at desc limit 3;
```

Esperado: **`connected_at` preenchido** — hoje é nulo em 100% das linhas — e `end_reason` com o
motivo real da VPS, não `no_terminal_event`.

- [ ] **Passo 5: MEDIÇÃO — o anti-replay funciona**

```sql
select event_jti, tc_session_id, seq_epoch, seq from public.voip_webhook_events
 order by received_at desc limit 10;
```

Esperado: `seq` crescente por sessão, sem buraco.

- [ ] **Passo 6: MEDIÇÃO — restart não trava a ingestão**

Reinicie o container e faça outra ligação. O `epoch` sobe, o `seq` volta a 1, e os eventos
**continuam sendo aceitos**. É o cenário que o `epoch` existe para cobrir.

- [ ] **Passo 7: Registrar**

Escreva em `.specs/torquecalls/MEDICOES-S11.md` e commite.

---

## Self-review

**Cobertura do spec revisado:**

| Requisito | Tarefa |
|---|---|
| Chave nasce no processo, vive no volume, só a pública no log | 1 |
| Envelope com `bh`, `jti`, `exp` 300s, `aud`, `env`, `kid` | 2 |
| `epoch` persistido + `seq` por sessão | 3 |
| Emissor não bloqueante, best-effort, sem fila | 4 |
| Três eventos pendurados; `peer` em dígitos; sem org no payload | 5 |
| Anti-replay `event_jti`; ordem; transições; ledger; ressurreição | 6 |
| Verificação Ed25519 com auto-teste de chave | 7 |
| Endpoint sem CORS; assinatura antes do banco; org da linha | 8 |
| Promoção automática e `connected_at` provados ao vivo | 9 |
| Reconciliação por cron | **não coberto** — ver abaixo |

**Lacuna assumida:** a reconciliação periódica ficou de fora. Com o webhook entregando e as duas
redes existentes (varredor + o próprio pareamento), ela deixa de ser caminho crítico. Vira issue.

**Consistência de nomes entre tarefas:**
- `loadOrCreateWebhookKey` → T1, usada em T1 (main) e T4
- `signWebhook` → T2, usada em T4
- `newSeqKeeper` / `next` → T3, usada em T4
- `webhookSender.send` → T4, ligada em T5 como `Broker.OnWebhook`
- `fn_voip_apply_vps_event` → T6, chamada em T8
- `verifyWebhook` → T7, chamada em T8
- `event_jti` (nunca `jti` solto) → T6, T8
