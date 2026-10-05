# Interface clássica (congelada)

Cópia do front da `main` de antes do V5, servida às organizações com **Configurações › Geral › Nova interface**
desligada. Desenho completo: [`docs/ui-v5/interface-por-organizacao.md`](../docs/ui-v5/interface-por-organizacao.md).

**Não edite à mão.** `src/`, `index.html` e `tailwind.config.ts` saem de um ref do git
(`SNAPSHOT.json`) mais `scripts/ui-classic/classic.patch`:

```bash
npm run ui-classic:snapshot -- --ref origin/main      # regenera a pasta a partir da main
node scripts/ui-classic/snapshot.mjs --gerar-patch    # depois de editar classic/, salva o patch
```

- `vite.config.ts` (mantido à mão) herda o da raiz; `src/assets` é o da V5 (alias `@/assets`).
- Fora de tsc e ESLint — é código que já passou nesses gates na `main`.
- Conserto portado da V5 leva teste em `tests/classic/` (cópia do teste da V5, `@` → `classic/src`):
  `npm run test:classic` (config `vitest.classic.config.ts`, roda no CI).
- Prova ponta a ponta da troca: `node scripts/ui-classic/e2e-troca.mjs`.
