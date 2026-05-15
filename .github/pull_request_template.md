<!--
PR Template — Torque CRM
Preencher seções aplicáveis. Apagar o que não usar. Manter a seção "Vault Obsidian"
mesmo em PRs sem mudança no vault (marcar primeiro checkbox).
-->

## O que muda

<!-- Resumo em 1-3 frases do que este PR faz e por quê. -->

## Tipo

- [ ] feat — nova funcionalidade
- [ ] fix — bug fix
- [ ] refactor — refactor sem mudança de comportamento
- [ ] docs — documentação (inclui vault Obsidian)
- [ ] chore — infra/build/config
- [ ] security — fix de segurança
- [ ] perf — otimização de performance
- [ ] test — adição/refactor de testes

## Vault Obsidian (obrigatório marcar uma opção)

- [ ] Não tocou em `Obsidian/`
- [ ] Adicionou notas — listar abaixo
- [ ] Editou notas — listar abaixo
- [ ] **Deletou notas** — listar abaixo + justificar + incluir `[vault-delete-ok]` em algum commit message

<details>
<summary>Arquivos do vault tocados (se aplicável)</summary>

```
Obsidian/...
```

Justificativa para deleção (se aplicável):
<!-- ... -->

</details>

## Multi-tenancy / segurança

- [ ] PR não toca em paths sensíveis (auth, RLS, multi-tenant, permissions)
- [ ] PR toca em paths sensíveis — review de Security obrigatório

Se tocou em paths sensíveis, descrever em uma linha o que mudou e como foi validado:

<!-- ... -->

## Banco de dados

- [ ] Sem mudanças de schema
- [ ] Migration nova — nome do arquivo: `supabase/migrations/...`
- [ ] Aplicada em DEV (`bcfadphgsibjzivtbjvc`): sim / não
- [ ] Aplicada em PROD (`jsjsmuncfkbsbzqzqhfq`): **NÃO sem autorização explícita do CTO**

## Edge functions

- [ ] Sem mudanças em `supabase/functions/`
- [ ] Função tocada — nome: `<função>`
- [ ] Deploy em DEV feito: sim / não
- [ ] Deploy em PROD: **NÃO sem autorização explícita do CTO**

## Testes

- [ ] Unit (`npm run test:unit`)
- [ ] Integration (`npm run test:integration`)
- [ ] E2E (`npm run test:e2e`)
- [ ] Manual / smoke
- [ ] Não aplica (justificar)

Comando que rodou + resultado:

```
$ npm run test:unit
...
```

## Como testar localmente

<!-- Passos para o reviewer reproduzir. -->

1. `git checkout <branch>`
2. `npm install`
3. `npm run dev`
4. ...

## Checklist final

- [ ] Branch nomeada com `tipo/slug-descritivo`
- [ ] Commits seguem Conventional Commits (`feat:`, `fix:`, `docs(vault):`, etc.)
- [ ] Sem segredos commitados (`.env`, credentials, service_role)
- [ ] CHANGELOG do vault atualizado (se mudança relevante)
- [ ] CLAUDE.md atualizado (se mudou padrão ou área frágil)
- [ ] Wikilinks do vault não ficaram órfãos
