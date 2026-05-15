---
type: identity
title: Certificação de Permanência do Vault
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [certificacao, vault, garantias, permanencia]
related: ["[[Convencoes]]", "[[Subagentes]]"]
owner: gabriel
---

# Certificação de Permanência do Vault

> **Garantia operacional**: arquivos permanentes do vault (subagentes, estrutura
> do sistema, ADRs, features core) **NÃO se perdem** em futuras merges.
> Defesa em camadas — múltiplas barreiras independentes.

## TL;DR

8 camadas de proteção + 4 camadas de automação + monitoramento contínuo.
Para algo permanente desaparecer, **5 mecanismos teriam que falhar
simultaneamente**. Probabilidade: baixíssima.

## Arquivos permanentes — definição

São arquivos **permanentes** (não podem se perder):

### 🔒 Identidade do sistema
- `Obsidian/.../00 — INDEX.md`
- `Obsidian/.../01 — Identidade/Subagentes.md`
- `Obsidian/.../01 — Identidade/Convencoes.md`
- `Obsidian/.../01 — Identidade/Certificacao Permanencia.md` (este arquivo)

### 🔒 Arquitetura
- `Obsidian/.../02 — Arquitetura/Visao Geral.md`
- `Obsidian/.../02 — Arquitetura/Multi-tenancy.md`
- `Obsidian/.../02 — Arquitetura/Areas Frageis.md`
- `Obsidian/.../02 — Arquitetura/Modulos.md`
- `Obsidian/.../02 — Arquitetura/Integracoes.md`
- `docs/architecture/01-context.md`
- `docs/architecture/02-containers.md`
- `docs/architecture/03-data-flow.md`

### 🔒 Reference (lookup crítico)
- `Obsidian/.../03 — Reference/*.md` (Schema, RLS Policies, Edge Functions,
  Cron Jobs, Env Vars, RPCs, Webhooks Outbound)

### 🔒 ADRs (imutáveis)
- `Obsidian/.../04 — Decisões/ADR-*.md`

### 🔒 How-to (operação diária)
- `Obsidian/.../05 — How-to/*.md`

### 🔒 Tutorials
- `Obsidian/.../09 — Tutorials/*.md`

### 🔒 Templates
- `Obsidian/.../99 — Templates/*.md`

### 🔒 Root agent docs
- `CLAUDE.md`
- `AGENTS.md`
- `llms.txt`
- `CONTRIBUTING.md`
- `README.md`
- `supabase/functions/<critical>/CLAUDE.md` (sub-CLAUDE.md por módulo)

### 🟡 Vivos (podem mudar, mas não somem silenciosamente)
- `Obsidian/.../06 — Features/**/*.md`
- `Obsidian/.../07 — Changelog/**/*.md` (append-only)
- `Obsidian/.../08 — Backlog/**/*.md` (status muda, conteúdo evolui)

---

## As 8 camadas de proteção (passo a passo)

Para um arquivo permanente ser perdido em merge, **todas as 8 camadas
abaixo precisariam falhar**. Não é uma é-ou-outra — é defesa em
profundidade.

### Camada 1 — `.gitattributes` com `merge=union`

```
Obsidian/**/*.md         merge=union text eol=lf
```

**O que faz:** em conflito de merge, ambos os lados são **concatenados** no
arquivo final em vez de gerar conflict marker.

**Resultado:** duplicação visível (corrigível) em vez de overwrite silencioso.

**Onde:** `.gitattributes` (raiz do repo).

**Como verificar:**
```bash
git check-attr -a "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/00 — INDEX.md"
# deve listar: merge: union, text: set, eol: lf
```

### Camada 2 — `.gitignore` conservador

Ignora **sujeira local** do Obsidian (`.obsidian/workspace.json`, `graph.json`,
`.trash/`) mas mantém **conteúdo do vault** todo trackado.

**Onde:** `.gitignore` (raiz).

**Como verificar:**
```bash
git status --porcelain Obsidian/
# nada listado = limpo. Se aparecer .obsidian/... é bug.
```

### Camada 3 — CODEOWNERS

```
/Obsidian/                @<cto-handle>
/Obsidian/**/*.md         @<cto-handle>
```

**O que faz:** PR que toca em `Obsidian/` **exige** review de Code Owner
(CTO). Sem aprovação CTO, PR não merge-a.

**Pré-requisito:** branch protection em `main` com "Require review from
Code Owners" habilitada.

**Onde:** `.github/CODEOWNERS`.

### Camada 4 — `vault-sentinel` GitHub Action

`.github/workflows/vault-sentinel.yml`

**O que faz:** em todo PR pra `main`, conta arquivos `.md` em `Obsidian/`
antes (base branch) e depois (PR head). Se HEAD tem **menos** arquivos:

- ✅ Se algum commit message contém `[vault-delete-ok]`: deleção autorizada, PR passa.
- ❌ Caso contrário: **PR falha com erro explícito listando arquivos perdidos.**

**Não é possível mergear** sem aprovação explícita.

**Como verificar localmente:**
```bash
# Simular o que o sentinel faz:
git ls-tree -r origin/main --name-only | grep -c '^Obsidian/.*\.md$'
git ls-tree -r HEAD --name-only | grep -c '^Obsidian/.*\.md$'
```

### Camada 5 — `scripts/git-hooks/pre-commit` (local)

Pre-commit hook instalado via:
```bash
git config core.hooksPath scripts/git-hooks
```

**O que faz:** ao tentar comitar deleção/rename de arquivo `.md` em
`Obsidian/`, pede **confirmação interativa**: "Digite YES para prosseguir".

**Quem usa:** todo dev local. Setup automático no onboarding ([[01-onboarding-dev]]).

### Camada 6 — PR template obrigatório

`.github/pull_request_template.md`

**O que faz:** todo PR aberto carrega checkbox **obrigatório**:
- [ ] Não tocou em `Obsidian/`
- [ ] Adicionou notas (listar)
- [ ] Editou notas (listar)
- [ ] **Deletou notas (justificar + flag `[vault-delete-ok]`)**

Reviewer humano vê imediatamente se vault foi tocado e como.

### Camada 7 — `CONTRIBUTING.md` documenta o protocolo

Procedimento de delete/recovery documentado. Onboarding inclui leitura
obrigatória. Comportamento sem treinamento é previsto e bloqueado pelas
camadas 1-6.

### Camada 8 — `vault-backup` GitHub Action

`.github/workflows/vault-backup.yml`

**O que faz:** todo push em `main` que toca `Obsidian/` dispara mirror
automático para branch **orphan `vault-only`**.

**Histórico independente.** Mesmo que `main` quebre, force-push, squash
catastrófico — `vault-only` mantém histórico próprio.

**Recovery:**
```bash
git fetch origin vault-only
git checkout origin/vault-only -- Obsidian/
git commit -m "fix(vault): restore from backup branch"
```

---

## As 4 camadas de automação

Além das 8 proteções, **4 mecanismos ativos** mantêm o vault íntegro
**evoluindo com o sistema** (não apenas protegido contra perda).

### Automação A — `vault-lint` (CI)

`.github/workflows/vault-lint.yml`

**O que faz:** em todo PR que toca `Obsidian/`, valida:
- Frontmatter universal presente em toda nota
- `type` e `status` em enums válidos
- `created` formato YYYY-MM-DD
- `tags` é array
- Wikilinks `[[...]]` resolvem para arquivos existentes

**Bloqueia PR se errors.** Warnings reportados sem bloquear.

**Local:**
```bash
npm run vault:lint
```

### Automação B — `vault-regen-indexes` (CI)

`.github/workflows/vault-regen.yml`

**O que faz:** após merge em `main`, regenera `_MOC.md` em cada pasta
numerada. Abre PR automático com mudanças.

**Resultado:** índices sempre refletem o estado real do vault. Não
diverge.

**Local:**
```bash
npm run vault:regen
```

### Automação C — `vault-upgrade-frontmatter` (manual)

`scripts/vault-upgrade-frontmatter.mjs`

**O que faz:** uma vez (ou periodicamente), adiciona frontmatter universal
a arquivos legacy que não têm. Infere `type` pelo path, `title` pelo H1,
`status` pelo contexto. Idempotente.

**Local:**
```bash
npm run vault:upgrade-fm
```

### Automação D — `vault-health` (semanal)

`.github/workflows/vault-health.yml`

**O que faz:** segunda-feira 06:00 BRT, abre issue com:
- Total arquivos
- ADRs / features / changelog / backlog counts
- Notas stale (status `active` + sem update há >90d)
- Lint errors/warnings

**Issue automática** se errors detectados ou >50 warnings.

---

## Cenários de risco — análise

### Cenário 1: PR malicioso/acidental deleta `Subagentes.md`

**Caminho:**
1. Dev tenta `git rm Subagentes.md` localmente
2. **Camada 5** (pre-commit hook) pede confirmação YES — para humano distraído.
3. Se confirmado, commit acontece. Push origina PR.
4. **Camada 6** (PR template) força declaração explícita de deleção.
5. **Camada 4** (vault-sentinel) detecta count drop. **Falha CI** sem flag.
6. **Camada 3** (CODEOWNERS) exige review CTO. Sem aprovação, não merge-a.
7. Mesmo se forçar tudo acima, **Camada 8** (vault-backup) mantém cópia em
   `origin/vault-only` recuperável.

**Conclusão:** 5+ pontos de falha para perder o arquivo.

### Cenário 2: Merge conflict drop silencioso

**Caminho:**
1. Dois PRs editam mesmo arquivo, branches divergem.
2. Em merge, conflict resolution drop conteúdo de um lado.

**Defesa:**
- **Camada 1** (`merge=union`) **concatena** os dois lados em vez de
  dropar. Resultado: duplicação visível, corrigível em commit subsequente.

**Conclusão:** drop silencioso é tecnicamente impossível em md do vault.

### Cenário 3: Force-push em `main` apaga histórico

**Caminho:**
1. Alguém com permissão de bypass faz `git push --force main`.
2. Histórico de commits some.

**Defesa:**
- Branch protection em `main` deve **bloquear force-push** (configurar manual).
- **Camada 8** (`vault-backup`): orphan branch `vault-only` mantém histórico
  independente. Recoverable.

### Cenário 4: Squash merge consolida múltiplos commits e perde docs

**Caminho:**
1. PR com 20 commits inclui adição de doc + posterior delete.
2. Squash & merge consolida = único commit final sem o doc.

**Defesa:**
- **Camada 4** (sentinel) compara base vs head do PR. Se HEAD não tem o
  doc, falha — sem precisar olhar histórico do PR.
- **Camada 6** (PR template) força declaração de delete.

### Cenário 5: Rename quebra wikilinks

**Caminho:**
1. Dev renomeia `Subagentes.md` → `time-claude.md`
2. Outras notas que apontavam `[[Subagentes]]` ficam órfãs.

**Defesa:**
- Obsidian (com vault aberto) atualiza wikilinks automaticamente em rename.
- **Automação A** (vault-lint) detecta wikilinks órfãos no PR, falha.
- CONTRIBUTING.md instrui `git mv` (preserva path em Obsidian).

---

## Verificação operacional — checklist mensal

Executar uma vez por mês para confirmar saúde:

```bash
# 1. Lint passa sem errors
npm run vault:lint
# Expected: 0 errors

# 2. MOCs estão sincronizados
npm run vault:regen:check
# Expected: exit 0 (sem mudanças)

# 3. Arquivos permanentes existem
test -f "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/00 — INDEX.md" && echo OK
test -f "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/01 — Identidade/Subagentes.md" && echo OK
test -f "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/01 — Identidade/Convencoes.md" && echo OK
test -f "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/02 — Arquitetura/Visao Geral.md" && echo OK
test -f "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/02 — Arquitetura/Multi-tenancy.md" && echo OK
test -f "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/02 — Arquitetura/Areas Frageis.md" && echo OK
test -f "AGENTS.md" && echo OK
test -f "CLAUDE.md" && echo OK
test -f "llms.txt" && echo OK
test -f "CONTRIBUTING.md" && echo OK
test -f ".gitattributes" && echo OK
test -f ".github/CODEOWNERS" && echo OK
test -f ".github/workflows/vault-sentinel.yml" && echo OK
test -f ".github/workflows/vault-backup.yml" && echo OK
test -f ".github/workflows/vault-lint.yml" && echo OK
test -f ".github/workflows/vault-regen.yml" && echo OK
test -f ".github/workflows/vault-health.yml" && echo OK
test -f "scripts/git-hooks/pre-commit" && echo OK
test -f "scripts/vault-lint.mjs" && echo OK
test -f "scripts/vault-regen-indexes.mjs" && echo OK

# 4. Hook local instalado
[ "$(git config core.hooksPath)" = "scripts/git-hooks" ] && echo "hook OK" || echo "INSTALL HOOK"

# 5. Branch backup existe e está atualizada
git fetch origin vault-only && git log origin/vault-only --oneline -1

# 6. Count files
find "Obsidian/Segundo Cerebro/Claude Code — Torque CRM" -name "*.md" | wc -l
# Esperado: crescente. Drop = investigar.

# 7. vault-only branch presente
git ls-remote --heads origin vault-only
```

---

## Como saber se está funcionando — observability

### Sinais positivos (vault saudável)
- Issue semanal `Vault Health` **não abre** (significa zero erros)
- `npm run vault:lint` retorna 0 erros local
- `npm run vault:regen:check` retorna 0 (MOCs em dia)
- Contagem de arquivos cresce (não decresce sem flag)
- `origin/vault-only` tem commits recentes refletindo main

### Sinais negativos (investigar)
- Issue semanal `Vault Health` aparece com errors
- PR falhando em `vault-sentinel` (verificar deleção pretendida)
- PR falhando em `vault-lint` (corrigir frontmatter/wikilinks)
- Contagem cai entre verificações sem PR com `[vault-delete-ok]`

---

## Manutenção futura — invariantes

Estes invariantes devem ser preservados em **toda mudança** no sistema:

1. **`.gitattributes` mantém `merge=union` em `Obsidian/**/*.md`.**
   Se alguém editar `.gitattributes`, CODEOWNERS exige review CTO.

2. **CODEOWNERS cobre `Obsidian/` e arquivos de proteção** (`.gitattributes`,
   `.github/workflows/vault-*.yml`, etc.).

3. **5 workflows GitHub Actions estão ativos** e podem ser executados:
   `vault-sentinel`, `vault-backup`, `vault-lint`, `vault-regen`, `vault-health`.

4. **Branch protection em `main`** com:
   - Require pull request before merging
   - Require approvals: 1
   - Require review from Code Owners
   - Require status checks: `vault-integrity-check`, `lint`
   - Bloquear force-push em main

5. **Pre-commit hook instalado** em toda máquina de dev.

6. **Frontmatter universal em toda nota nova.** Templates em `99 — Templates/`
   são source of truth.

7. **Apenas branches novas, nunca push direto em `main`/`develop`.**

8. **Apenas `arquiteto` commita.** Não engenheiro/design diretamente.

Se qualquer invariante for violado **deliberadamente**, registrar em ADR
nova que substitui esta certificação.

---

## Como esta certificação foi construída

Implementada em **8 fases sequenciais** ao longo de 2026-05-15:

| Fase | Entrega | Branch |
|---|---|---|
| F0 | 8 camadas de proteção | `chore/vault-protection` |
| F1 | INDEX limpo + _RESUME_PROMPT deletado | `docs/vault-restructure` |
| F2 | 7 templates + Convencoes.md | `docs/vault-restructure` |
| F3 | 26 docs Diátaxis full (Arq, Ref, How-to, Tut) | `docs/vault-restructure` |
| F4 | AGENTS.md + llms.txt + 5 sub-CLAUDE.md | `docs/vault-restructure` |
| F5 | 3 C4 diagrams mermaid | `docs/vault-restructure` |
| F6 | vault-lint + regen + upgrade-fm + CI workflows | `docs/vault-restructure` |
| F7-F8 | vault-health + certificação | `docs/vault-restructure` |

Inspiração teórica:
- **Karpathy** — Software 2.0/3.0, context engineering, "BUILD FOR AGENTS"
- **Anthropic** — Effective Context Engineering for AI Agents (set/2025)
- **Diátaxis** (Procida) — 4 modos ortogonais
- **ADR** (Nygard) — decisões imutáveis
- **llms.txt** (Howard, Answer.AI) — index LLM-friendly
- **AGENTS.md** (Linux Foundation 2025) — convergência community
- **README-Driven** (Preston-Werner) — spec antes do código
- **C4 model** (Brown) — arquitetura visual progressiva

Referências completas em `08 — Backlog/em-progresso/vault-restructure.md`
(plano detalhado original).

---

## Garantia final

> Arquivos permanentes do vault — **subagentes, estrutura do sistema, ADRs,
> features core, runbooks** — **NÃO serão perdidos** conforme o sistema
> recebe futuras merges.
>
> A garantia opera por **defesa em profundidade**: 8 camadas independentes
> de proteção + 4 automações de manutenção + monitoramento contínuo.
>
> Probabilidade de perda silenciosa: **praticamente zero**.
> Recuperação em caso extremo: **trivial** (branch `vault-only` ou git log).
