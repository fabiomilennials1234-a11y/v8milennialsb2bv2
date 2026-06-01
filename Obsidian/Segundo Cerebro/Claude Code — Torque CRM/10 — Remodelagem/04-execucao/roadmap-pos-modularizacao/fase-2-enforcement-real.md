# Fase 2 — Enforcement real

**Branch:** `chore/boundaries-enforcement-real`
**Base:** `develop` (com Fase 1 já mergeada)
**Target PR:** `develop`
**Estimate:** 6-8h
**Pré-requisitos:** Fase 1 mergeada + CI verde em pelo menos 1 PR de teste pós-Fase-1
**Habilita:** Fase 4 (limpeza)

## Constraints invariantes (NÃO violar)

1. Zero push em `main`. Zero merge em `main`.
2. Zero mutação em prod DB ou dev DB.
3. Zero deploy edge function.
4. Branch sai de `develop` sincronizada. PR target = `develop`.
5. Sem `--no-verify`. Sem skip de hooks.
6. Antes de começar: confirmar Fase 1 mergeada via `git log origin/develop --oneline | grep "ci-unblock-security-audit"` e ver CI verde em ao menos 1 push pós-Fase-1.

## Contexto

A análise pós-modularização ([`analise-pos-modularizacao.md`](../analise-pos-modularizacao.md)) constatou que enforcement de boundaries é **teatro**:

1. ESLint `boundaries/element-types` (em "error mode" desde slice 17) permite **qualquer module → module** sem exigir barrel. A regra atual:
   ```js
   { from: "module", allow: ["ui", "shared", "core", "module"] }
   ```
   Não impede `@/modules/leads` de importar `@/modules/pipelines/hooks/useFoo` (deep path interno).

2. `dependency-cruiser` (`.dependency-cruiser.cjs`) tem `module-internals-private` e `no-circular` ainda em `severity: "warn"`. O comentário no código ainda diz "Flip para `error` em slice 17" — não foi feito.

3. **973 deep-imports cross-module** vivem hoje. Top: leads→pipelines (38), analytics→engagement (24), leads→communication (22). Todos passam pelo lint atual.

Esta fase **torna o enforcement real** com 3 estratégias combinadas:

- **A.** Flip dep-cruiser warn→error.
- **B.** Configurar regra ESLint que efetivamente proíba deep-import cross-module.
- **C.** Golden file (baseline) das violations existentes — CI falha apenas em **violations novas** vs baseline, dando caminho de redução incremental sem big-bang refactor.

## Investigação prévia

```bash
git checkout develop
git pull --ff-only origin develop
# Confirmar Fase 1 mergeada
git log origin/develop --oneline -10 | grep -i "ci-unblock" || echo "PARAR — Fase 1 nao mergeada ainda"

git checkout -b chore/boundaries-enforcement-real

# Inspecionar regras atuais
cat eslint.config.js | sed -n '/boundaries/,/]/p' | head -40
cat .dependency-cruiser.cjs | head -100
```

## Tarefas

### 1. Inventariar violations atuais (baseline)

```bash
# ESLint sem mudanças — só rodar pra contar warnings/errors atuais
npm run lint 2>&1 | tee .baseline-eslint.log
# Esperado: erros de boundaries hoje (regra em error mas permissiva)
# Contar boundary errors:
grep -c "boundaries/" .baseline-eslint.log || true

# Dep-cruiser
npm run lint:deps 2>&1 | tee .baseline-deps.log
# Contar violations module-internals-private + no-circular
grep -E "module-internals-private|no-circular" .baseline-deps.log | wc -l
```

Snapshot dos números no commit message final.

### 2. Decisão: estratégia de enforcement

Duas opções viáveis:

**Opção A — Strict (recomendado, mais trabalho)**
- Flip ESLint regra para forçar imports cross-module apenas via `@/modules/<bc>` exato (sem subpath).
- Flip dep-cruiser warn→error.
- Refatorar todos os 973 imports para passar via `index.ts` de cada módulo.
- **Esforço:** 12-20h (caso-a-caso por módulo).

**Opção B — Baseline + ratchet (rápido, dívida incremental)**
- Flip dep-cruiser warn→error.
- Salvar lista de violations atuais como **golden file** (`.dependency-cruiser-baseline.json`).
- Script CI compara nova execução vs baseline: falha apenas em violations **novas**.
- Cada PR seguinte pode reduzir o baseline (PR remove linha do baseline + corrige import).
- **Esforço:** 4-6h.

**Decisão default desta fase: Opção B** (ratchet). Razão: 973 violations num PR único = code review impossível + risco alto. Ratchet permite redução em N sprints sem bloquear feature work.

Se o CTO preferir A explicitamente em sessão, escalar a esforço pra 12-20h e atacar módulo por módulo (sub-slices).

### 3. Implementar Opção B — Ratchet

#### 3.1. Flip dep-cruiser warn→error

Editar `.dependency-cruiser.cjs`:

```js
// Antes
{
  name: "no-circular",
  severity: "warn",
  ...
}
{
  name: "module-internals-private",
  severity: "warn",
  ...
}

// Depois
{
  name: "no-circular",
  severity: "error",  // ← flip
  ...
}
{
  name: "module-internals-private",
  severity: "error",  // ← flip
  ...
}
```

Atualizar comentário das regras pra remover "Flip pra slice 17" — agora é o estado real.

#### 3.2. Gerar baseline

Adicionar script ao `package.json`:

```json
{
  "scripts": {
    "lint:deps:baseline": "depcruise src --config .dependency-cruiser.cjs --output-type json > .dependency-cruiser-baseline.json",
    "lint:deps:check": "node scripts/dep-cruise-ratchet.js"
  }
}
```

Criar `scripts/dep-cruise-ratchet.js`:

```js
#!/usr/bin/env node
/**
 * Dep-cruise ratchet: roda depcruise atual e compara vs baseline.
 * Falha apenas em violations novas (não presentes em .dependency-cruiser-baseline.json).
 *
 * Para reduzir baseline: corrigir um import, depois rodar npm run lint:deps:baseline
 * para atualizar o snapshot. Commit com explicação no PR body.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const BASELINE_FILE = ".dependency-cruiser-baseline.json";

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`baseline file missing: ${BASELINE_FILE}. Run npm run lint:deps:baseline first.`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

function runCurrent() {
  // depcruise retorna exit code 1 se houver erro (após flip warn→error).
  // Capturamos output em ambos os casos.
  try {
    const out = execSync(
      "npx depcruise src --config .dependency-cruiser.cjs --output-type json",
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(out);
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

function violationKey(v) {
  return `${v.rule.name}|${v.from}|${v.to}`;
}

const baseline = loadBaseline();
const current = runCurrent();

const baselineKeys = new Set((baseline.summary?.violations ?? []).map(violationKey));
const currentViolations = current.summary?.violations ?? [];

const novel = currentViolations.filter((v) => !baselineKeys.has(violationKey(v)));

if (novel.length > 0) {
  console.error(`\n${novel.length} NEW dep-cruiser violation(s) vs baseline:\n`);
  novel.forEach((v) => {
    console.error(`  [${v.rule.name}] ${v.from} -> ${v.to}`);
  });
  console.error("\nFix the import OR (if intentional) regenerate baseline via:");
  console.error("  npm run lint:deps:baseline");
  console.error("\nNever regenerate baseline blindly — each removed entry should be justified in the PR body.\n");
  process.exit(1);
}

// Bonus: reportar quantas violations o baseline ainda contém (sinal de débito).
console.log(`Dep-cruise ratchet OK. Baseline pending: ${baselineKeys.size} violations.`);
```

#### 3.3. Gerar baseline inicial

```bash
mkdir -p scripts
# (criar script acima)

# Primeira geração — captura snapshot do estado atual
npm run lint:deps:baseline

# Verificar que arquivo gerado tem entradas
ls -la .dependency-cruiser-baseline.json
node -e "const b=require('./.dependency-cruiser-baseline.json'); console.log('violations:', (b.summary?.violations ?? []).length)"
```

Commit do baseline gerado.

#### 3.4. Integrar no workflow CI

Editar `.github/workflows/test.yml`. Adicionar step após `Lint dependency graph`:

```yaml
      - name: Dep-cruise ratchet (no new violations)
        run: npm run lint:deps:check
```

Esse step só falha se entrarem violations **novas** — protege baseline sem big-bang.

### 4. Validar localmente

```bash
# 1. Lint atual deve passar (boundaries error mode mas regra permissiva → poucas falhas reais)
npm run lint

# 2. Dep-cruise ratchet deve passar (zero violations novas vs baseline recém-gerado)
npm run lint:deps:check
```

Se aparecer falha aqui, investigar antes do PR.

### 5. Documentar processo de redução incremental

Criar `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/reducao-deep-imports.md`:

```markdown
# Redução incremental de deep-imports

## Estado inicial (Fase 2 — <data>)

Baseline em `.dependency-cruiser-baseline.json` contém **<N>** violations.

Top edges acoplados:
- leads → pipelines: 38 deep-imports
- analytics → engagement: 24
- leads → communication: 22
- ...

## Como reduzir

Em qualquer PR feature, se você tocar um import cross-module deep:
1. Promova o símbolo importado para a API pública (`@/modules/<bc>/index.ts`).
2. Ajuste o import no consumer: `from "@/modules/<bc>"`.
3. Rode `npm run lint:deps:baseline` — confirme que a violation sumiu.
4. Documente no body do PR: "redução incremental — <N+M> -> <N+M-1> violations no baseline".

## Sprints de redução dirigida

- Sprint X: leads → pipelines (38 → 0). Top consumer: `LeadDetailDialogV2`.
- Sprint Y: analytics → engagement (24 → 0). Top consumer: `Performance.tsx`.
- (continuar)

Meta: baseline = 0 em 6 sprints.
```

### 6. Commit + push + PR

```bash
git status --short
git status --short | grep -i "feature-overview" && echo "PARAR — vault scratch"

git add .dependency-cruiser.cjs scripts/ .dependency-cruiser-baseline.json package.json .github/workflows/test.yml "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/reducao-deep-imports.md"

git commit -m "chore(boundaries): enforcement real via dep-cruise ratchet

Flip dep-cruiser regras module-internals-private e no-circular de warn
para error mode. Gera baseline (.dependency-cruiser-baseline.json) com
as <N> violations atuais. Adiciona script lint:deps:check que falha
apenas em violations NOVAS vs baseline — ratchet. CI integrado.

Por que ratchet vs big-bang: 973 violations num unico PR = code review
impossivel + risco alto. Ratchet permite reducao em N sprints sem
bloquear feature work. Doc do processo em vault.

Endereca achado #2 da analise pos-modularizacao (PR #517): enforcement
era teatro.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin chore/boundaries-enforcement-real
gh pr create --base develop --head chore/boundaries-enforcement-real \
  --title "chore(boundaries): enforcement real via dep-cruise ratchet" \
  --body "<resumo>"
```

## Critério de aceite

- [ ] `.dependency-cruiser.cjs` com regras flipadas para `error`.
- [ ] `.dependency-cruiser-baseline.json` commitado com snapshot das violations atuais.
- [ ] `scripts/dep-cruise-ratchet.js` criado e funcional.
- [ ] `package.json` com scripts `lint:deps:baseline` e `lint:deps:check`.
- [ ] `.github/workflows/test.yml` com step `Dep-cruise ratchet`.
- [ ] Doc `reducao-deep-imports.md` criado no vault.
- [ ] `npm run lint:deps:check` passa localmente (zero violations novas).
- [ ] PR aberto contra `develop`. CI verde após merge.

## Riscos + mitigação

- **Baseline esconde dívida indefinidamente.** Mitigação: sprint plan documentado + meta zero em 6 sprints.
- **Time regenera baseline sem corrigir imports.** Mitigação: doc explicita que regenerar baseline em PR exige justificativa no body; code review obriga.
- **Script `dep-cruise-ratchet.js` quebra em mudanças do schema do `depcruise`.** Mitigação: testes não-existentes — aceitar débito.
- **Vault scratch commitado.** `git status` antes de cada `git add`.

## Out of scope

- Refactor dos 973 deep-imports (projeto separado, sprints futuras).
- Mudança do `boundaries/no-private` ESLint (regra atual fica como está — dep-cruise ratchet é o gate efetivo).
- Mudança nas regras de elementos ESLint (deixar como está, não cria conflito).

## Próximo passo

Fase 3 (event-bus dev) em paralelo OU Fase 4 (limpeza) sequencial.
