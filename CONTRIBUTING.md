# CONTRIBUTING — Torque CRM

Padrões de contribuição do Torque CRM. Documento curto e operacional.
Detalhe técnico vive em [`CLAUDE.md`](./CLAUDE.md).

---

## Branch model

```
main          ← produção. Push proibido direto. PR + review obrigatórios.
develop       ← integração contínua (quando usada).
<tipo>/<slug> ← branches de trabalho. Sempre nova por fix/feature.
```

### Naming de branch

```
feat/<slug>        nova funcionalidade
fix/<slug>         bug fix
refactor/<slug>    refactor sem mudança de comportamento
docs/<slug>        documentação (inclui vault Obsidian)
chore/<slug>       infra, build, config
security/<slug>    fix de segurança
perf/<slug>        otimização
test/<slug>        testes
```

**Regra dura**: nunca pushar direto em `main` ou `develop`. Toda mudança vai em branch nova.

---

## Conventional Commits

Commits seguem [Conventional Commits](https://www.conventionalcommits.org/).

```
<tipo>(<escopo>): <descrição curta no imperativo, minúsculo>

[corpo opcional explicando o "porquê"]

[footers: refs, breaking changes, co-authored-by, flags]
```

### Tipos aceitos

- `feat` — funcionalidade nova
- `fix` — bug fix
- `refactor` — refactor sem mudar comportamento
- `docs` — documentação (inclui vault)
- `chore` — infra, build, deps
- `security` — fix de segurança
- `perf` — performance
- `test` — testes
- `style` — formatação/lint sem lógica

### Escopos comuns

`auth`, `vault`, `chat`, `whatsapp`, `copilot`, `pipe`, `permissions`, `workflows`,
`campaigns`, `dashboard`, `master`, `webhooks`, `cron`, `migrations`, `deps`, `ci`.

### Exemplos

```
feat(copilot): add reasoning audit page for master admin
fix(whatsapp-webhook): tolerate Uazapi V2 payload schema variations
docs(vault): register whatsapp stability state for handoff
refactor(carteira): complete Wave 2 — migrate page, preview, remove old hook
chore(vault): cleanup notas obsoletas [vault-delete-ok]
security(rls): tighten products policy to organization scope
```

---

## Vault Obsidian — proteção contra perda

O vault em `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/` é parte do
projeto e versionado neste repo. Concentra ADRs, features, changelog, decisões.
Perda silenciosa é catastrófica — single source of truth para fluxos críticos.

### Camadas de proteção ativas

1. **`.gitattributes`** — `merge=union` em `Obsidian/**/*.md`. Em conflito,
   ambos os lados são concatenados (duplicação visível em vez de overwrite
   silencioso).

2. **`.gitignore`** — exclui sujeira local do Obsidian (`workspace.json`,
   `graph.json`, `.trash/`), mantém config compartilhada de plugins.

3. **CODEOWNERS** — qualquer mudança em `Obsidian/` exige aprovação do CTO.

4. **`vault-sentinel.yml`** — GitHub Action que bloqueia PR se o número
   de arquivos `.md` em `Obsidian/` diminuiu, a menos que algum commit
   message do PR contenha `[vault-delete-ok]`.

5. **`scripts/git-hooks/pre-commit`** — hook local que pede confirmação
   antes de aceitar commit que delete/renomeie arquivos do vault.

6. **PR template** — força declaração explícita do impacto no vault.

7. **Convention `docs(vault):`** — commits que tocam só vault usam scope
   dedicado, mantém diff de PR de código limpo.

8. **`vault-backup.yml`** — Action que espelha `Obsidian/` para branch
   `vault-only` em todo push em `main` (recovery point).

### Setup local — instalar pre-commit hook

```bash
git config core.hooksPath scripts/git-hooks
chmod +x scripts/git-hooks/pre-commit
```

Verifica:

```bash
git config core.hooksPath
# deve imprimir: scripts/git-hooks
```

Desinstalar (não recomendado):

```bash
git config --unset core.hooksPath
```

### Como deletar arquivo do vault legitimamente

```bash
# 1. Commit normal com a deleção
git rm "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/<caminho>"
git commit -m "chore(vault): remove nota obsoleta sobre <X>"

# 2. Commit vazio com flag autorizando (pode estar em qualquer commit do PR)
git commit --allow-empty -m "chore(vault): autoriza remoção [vault-delete-ok]

Razão: <X foi superada pela ADR-YYYY-MM-DD-Z, conteúdo migrou para [[Y]]>."

# 3. Push da branch
git push origin <branch>
```

### Como recuperar arquivo deletado por engano

```bash
# Listar commits que tocaram no arquivo
git log --all --diff-filter=D --name-only -- "<caminho>" | head

# Restaurar do último commit antes da deleção
git checkout <hash>^ -- "<caminho>"
git commit -m "fix(vault): restaura <arquivo> deletado por engano"
git push
```

### Mover/renomear preferível a deletar+criar

Obsidian atualiza wikilinks automaticamente em rename. Sempre que possível:

```bash
git mv "Obsidian/.../old-name.md" "Obsidian/.../new-name.md"
git commit -m "docs(vault): renomeia <X> para <Y>"
```

---

## Pull Requests

### Antes de abrir PR

- [ ] Branch nomeada conforme convenção acima
- [ ] Commits passam no pre-commit hook
- [ ] Testes relevantes rodando localmente
- [ ] Build não quebra (`npm run build`)
- [ ] Lint limpo (`npm run lint`)
- [ ] Wikilinks do vault íntegros (se tocou em vault)
- [ ] CLAUDE.md atualizado (se mudou padrão estrutural ou área frágil)

### No PR

- [ ] Template preenchido (seção do vault obrigatória mesmo que vazia)
- [ ] Reviewer designado (CODEOWNERS adiciona automaticamente)
- [ ] CI verde antes de pedir merge

### Merge

- [ ] **Squash & merge** é o default (histórico de `main` limpo)
- [ ] Merge commit só em casos especiais (release branches, large features)
- [ ] Após merge, deletar branch remota

---

## Segurança — gates obrigatórios

PRs que tocam em qualquer destes paths exigem review explícito de segurança:

- `src/lib/permissions.ts`
- `supabase/functions/_shared/permission_engine.ts`
- `supabase/functions/_shared/whatsapp-client.ts`
- `supabase/functions/_shared/whatsapp-providers/`
- `supabase/migrations/` (qualquer migration com `RLS`, `POLICY`, `GRANT`, `ROLE`)
- `src/contexts/AuthContext*.tsx`
- `src/integrations/supabase/client.ts`

Marcar checkbox de segurança no template e descrever em uma linha:
**o que mudou + como foi validado**.

---

## Deploy — autorização explícita

Default = **dev**. Deploy em produção exige **pedido explícito do CTO na sessão**.

- Edge functions PROD: **NÃO sem autorização**.
- Migrations PROD: **NÃO sem autorização**.

⚠️ O projeto dev foi **aposentado** em 2026-07-22 (estava 404 migrations atrás).
O alvo de validação passou a ser **branch efêmera do Supabase a partir de prod** —
descartável, sempre encerrada após o teste. Ver `CLAUDE.md` § Ambientes.

**Bloqueio ativo:** a branch replaya as migrations do repo do zero e o repo não
replaya (840 migrations, morre em jan/2026). Enquanto o baseline não for feito,
**não existe ambiente de validação** e mudança de risco vai pra prod com rollback
engatilhado e validação imediata.

---

## Setup inicial — checklist de novo dev

```bash
# 1. Clone
git clone https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2.git
cd v8milennialsb2bv2

# 2. Install
npm install

# 3. Hooks
git config core.hooksPath scripts/git-hooks
chmod +x scripts/git-hooks/*

# 4. Env
cp .env.example .env.local
# preencher credenciais

# 5. Verify
npm run dev
npm run test:unit
```

---

## Referências

- [`CLAUDE.md`](./CLAUDE.md) — instruções para agente Claude Code
- [`Obsidian/Segundo Cerebro/Claude Code — Torque CRM/00 — INDEX.md`](./Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/00%20—%20INDEX.md) — índice do vault
- [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/)
