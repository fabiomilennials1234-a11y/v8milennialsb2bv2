# vault-only — backup espelho do vault Obsidian

Branch automática mantida pelo workflow `.github/workflows/vault-backup.yml`.

A cada push em `main` que toca em `Obsidian/`, o conteúdo é espelhado aqui.

**Não desenvolver nesta branch.** É read-only. Para restaurar arquivos:

```bash
git fetch origin vault-only
git checkout origin/vault-only -- Obsidian/
git commit -m "fix(vault): restore from backup branch"
```

Histórico: 1 commit por mirror, com hash do commit em main que disparou.
