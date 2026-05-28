# Fase 1 — Destravar CI

**Branch:** `chore/ci-unblock-security-audit`
**Base:** `develop`
**Target PR:** `develop`
**Estimate:** 1h
**Pré-requisitos:** nenhum
**Habilita:** Fase 2 (sem CI rodando, enforcement não é verificável)

## Constraints invariantes (NÃO violar)

1. Zero push em `main`. Zero merge em `main`.
2. Zero mutação em prod DB (`jsjsmuncfkbsbzqzqhfq`) ou dev DB (`bcfadphgsibjzivtbjvc`).
3. Zero deploy edge function.
4. Branch sai de `develop` sincronizada. PR target = `develop`.
5. Sem `--no-verify`, sem skip de hooks.
6. Antes de começar: `git checkout develop && git pull --ff-only origin develop`. Confirme `git status --short` limpo (exceto `Obsidian/.../feature-overview.md` untracked do CTO que NÃO deve ser commitada).

## Contexto

CI workflow `Tests` (`.github/workflows/test.yml`) tem `Security audit` (`npm audit`) como segundo step. Esse step falha por 8 vulns conhecidas (esbuild, tmp, uuid, ws, exceljs, storybook, vite). Como resultado, todos os outros steps/jobs (`npm run lint`, `Lint dependency graph (cycles + module boundaries)`, `Build (prod)`, Unit Tests, E2E Tests, Edge Function Tests, Integration Tests, Workflow System Tests) ficam **skipped** em todo push.

A modularização (slices 0-19) inteira mergeou sem CI validar. Slice 17 (ESLint boundaries flip warn→error) também nunca rodou de verdade.

Esta fase destrava o pipeline tornando `Security audit` informativo (não-bloqueante), e roda `npm audit fix` para reduzir o ruído sem mudanças breaking. Itens breaking (vite 6→8, exceljs 3.4) **NÃO** entram nesta fase — ficam pra projeto separado.

## Investigação prévia (antes de mudar nada)

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b chore/ci-unblock-security-audit

# Inspecionar o workflow
cat .github/workflows/test.yml | head -50
# Confirmar nome exato do step "Security audit"
grep -n "Security audit\|npm audit" .github/workflows/test.yml
```

## Tarefas

### 1. Tornar `Security audit` não-bloqueante

Editar `.github/workflows/test.yml`. Localizar o step `Security audit` e adicionar `continue-on-error: true`:

```yaml
      - name: Security audit
        run: npm audit --audit-level=high --omit=dev
        continue-on-error: true  # ← adicionar esta linha
```

Justificativa do `--audit-level=high --omit=dev` (se ainda não estiver assim): foca só em alta severidade e ignora deps de dev. Reduz ruído sem perder sinal real. Se o comando atual for diferente, manter a string original e só adicionar `continue-on-error`.

### 2. Rodar `npm audit fix` (não-breaking)

```bash
npm audit fix 2>&1 | tee audit-fix.log
# Verificar que NENHUM major version foi mudado
grep -E "BREAKING|will install" audit-fix.log || true
```

Se o `audit-fix.log` mostrar **breaking changes propostas** ou **major version bumps**, **NÃO aplicar** — reverter e documentar como out-of-scope:

```bash
git checkout -- package.json package-lock.json
```

Se tudo for non-breaking, manter `package.json` + `package-lock.json` modificados.

Não commit do `audit-fix.log` — deletar antes de stage:

```bash
rm audit-fix.log
```

### 3. Validar localmente que CI vai rodar

Sem `npm ci` instalado nesta máquina, validação completa fica para o CI. Mas a sintaxe do YAML pode ser checada:

```bash
# Se yamllint disponível
yamllint .github/workflows/test.yml 2>/dev/null || echo "yamllint não instalado — skip"

# Confirmar que o YAML é parseável
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/test.yml','utf-8'))" 2>&1 || echo "js-yaml não disponível — skip"
```

### 4. Commit + push + PR

```bash
git status --short
# Esperado:
#   M .github/workflows/test.yml
#   M package.json           (se audit fix aplicou)
#   M package-lock.json      (se audit fix aplicou)
# CONFIRMAR que NÃO inclui "Obsidian/Segundo Cerebro/feature-overview.md"
git status --short | grep -i "feature-overview" && echo "PARAR — vault scratch não pode entrar"

git add .github/workflows/test.yml package.json package-lock.json
# Se package*.json não foi modificado, adicionar só o workflow:
# git add .github/workflows/test.yml

git commit -m "chore(ci): unblock pipeline — security audit non-blocking + npm audit fix

CI workflow Tests falha em Security audit step desde antes da modularizacao
(8 vulns deps pre-existentes: esbuild, tmp, uuid, ws, exceljs, storybook,
vite). Consequencia: lint, dep-cruiser, build, todos os 6 jobs de tests
ficam skipped em todo push para main/develop. Slices 0-19 mergearam sem
validacao real.

Esta mudanca:
- Marca Security audit como continue-on-error: true (informativo, nao
  bloqueante) — gates de qualidade voltam a rodar.
- Aplica npm audit fix nao-breaking onde possivel.

Itens breaking (vite 6->8, exceljs 3.4, uuid v11) ficam para projeto
separado — exigem coordenacao de regressao.

Ver: Obsidian/.../analise-pos-modularizacao.md (PR #517) — achado #1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin chore/ci-unblock-security-audit

gh pr create --base develop --head chore/ci-unblock-security-audit \
  --title "chore(ci): unblock pipeline — security audit non-blocking + npm audit fix" \
  --body "<colar resumo da commit message>"
```

### 5. Aguardar CI rodar no push (após merge)

Após merge da PR em develop, `test.yml` dispara em push. **Confirmar via `gh run list --workflow=test.yml --limit 3`** que:

- Step `Security audit` agora reporta "success" ou "warning" (não falha o job).
- Step `npm run lint` **executa** (deixou de ser skipped).
- Step `Lint dependency graph (cycles + module boundaries)` **executa**.
- Step `Build (prod)` **executa**.
- Jobs Unit Tests, E2E Tests, etc — **executam**.

Se algum desses ainda aparecer como skipped após o merge desta fase, **PARAR** e investigar — o problema é outro dependency conditional que não está visível no workflow.

## Critério de aceite

- [ ] `Security audit` step tem `continue-on-error: true` em `test.yml`.
- [ ] `npm audit fix` aplicado se non-breaking, ou explicitamente revertido + documentado.
- [ ] PR aberto contra `develop`.
- [ ] Após merge em develop, run de CI mostra todos os steps subsequentes a `Security audit` **executando** (success ou failure, mas não skipped).

## Riscos + mitigação

- **`npm audit fix` quebra alguma transitive em runtime.** Mitigação: rodar `npm run build` + `npm run test:unit` localmente antes do commit se `node_modules` instalado.
- **`continue-on-error: true` esconde vulns reais novas.** Mitigação: aceita-se — `Security audit` continua reportando como warning (visível no log). Endereçar em projeto separado pós-modularização.
- **Vault scratch `feature-overview.md` commitado por engano.** Mitigação: `git status` antes de cada `git add` — não usar `git add -A`.

## Out of scope

- Bump de vite 6→8, exceljs 3→4, uuid v11 — projeto separado.
- Substituir storybook pre-9 por versão moderna — projeto separado.
- Mover `Security audit` pra workflow dedicado weekly — pode ser feito depois.

## Próximo passo após esta fase

Atacar **Fase 2 — Enforcement real** ou **Fase 3 — Event-bus dev** em paralelo (independentes entre si).
