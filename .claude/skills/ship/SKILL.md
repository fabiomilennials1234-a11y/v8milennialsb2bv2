---
name: ship
description: Fecha o trabalho — branch nova, commit Conventional, push, PR. Use quando o trabalho está pronto pra versionar ou o CTO pede "commita", "sobe", "abre PR".
---

# Ship — Branch, Commit, PR

Fecha o ciclo. **Prod é botão do humano** — aqui só prepara o PR.

## Pré-checks

- [ ] `git status` + `git diff` revistos — sem `console.log`, sem secrets, sem código morto
- [ ] `npm run lint:ratchet` + `npm run typecheck:ratchet` + `npm run test:unit` + `npm run build` — **delta verde** (a branch não introduziu falha; o repo tem 805 erros de tipo e 29.142 warnings herdados)
- [ ] **Nunca use `npm run lint` cru como sinal** — sai 0 mas imprime `✖ 29142 problems`
- [ ] Diff tocou área frágil? Rodou `/security-rubric`?
- [ ] Docs (Obsidian / `.specs/`) atualizadas se a mudança altera comportamento documentado

## Branch

| Tipo | Prefixo |
|---|---|
| Feature | `feat/` |
| Bug fix | `fix/` |
| Refactor | `refactor/` |
| Doc-only | `docs/` |
| Chore (build, deps, ci) | `chore/` |
| Testes | `test/` |
| Perf | `perf/` |

```bash
git checkout -b <prefix>/<descricao-curta>
git add <path1> <path2>     # stage seletivo — NUNCA git add -A
git commit -m "$(cat <<'EOF'
<type>(<scope>): <descrição imperativa curta>

<corpo — só se o "porquê" não for óbvio>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push -u origin <prefix>/<descricao-curta>
```

Subject ≤ 72 chars, imperativo, minúsculas, sem ponto final.

## Inegociáveis

- NUNCA `git add -A` / `git add .`
- NUNCA `--no-verify` / `--no-gpg-sign` — hooks são fonte de verdade
- NUNCA `--force` / `--force-with-lease` sem pedido explícito
- NUNCA push em `main` / `develop`
- NUNCA amend de commit já pushado
- NUNCA misturar mudanças não-relacionadas num commit — divida
- SEMPRE `Co-Authored-By` com o modelo da sessão atual
- SEMPRE relate a URL do remote/branch depois do push

## Deploy (contexto — não faça sozinho)

- Frontend: merge em main **constrói a imagem, não deploya**. Prod exige **Redeploy manual no EasyPanel**. Desacoplamento intencional — não "conserte".
- Edge functions + migrations: manuais.
- Default: dev. Prod só com pedido explícito do CTO.
