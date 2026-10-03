# Interface nova ou clássica, por organização

Decisão do CTO (03/10): um switch em **Configurações › Geral** escolhe a interface da organização inteira.
**Ligado = V5. Desligado = clássica.** Começam ligadas só **Milennials** (`6030520a-2ca7-477d-be89-55758e2cd808`) e
**TorqueCRM** (`b2ad1ffb-e136-4356-846b-9f210f902573`). As outras ~28 seguem na clássica.

## Desenho

**Duas builds no mesmo deploy, mesma origem.** Manter as duas interfaces no mesmo código exigiria cada tela
duas vezes (o V5 mexeu em ~700 arquivos de `src/`). Em vez disso:

```
src/       → interface V5 (a de sempre do repo)        → dist/
classic/   → cópia congelada do front da main (pré-V5)  → dist-classic/ → mesclada em dist/
```

- **`classic/`** é gerada por `scripts/ui-classic/snapshot.mjs --ref <ref>`: extrai `src/` (sem testes),
  `index.html` e `tailwind.config.ts` do ref e aplica `scripts/ui-classic/classic.patch` (o switch, a guarda e o
  hook — o mínimo para a clássica saber trocar). **Não é editada à mão**: conserto na clássica = editar, regenerar o
  patch, rodar o script. Fora de tsc, ESLint e Vitest — é código que já passou nesses gates na `main`.
- **Build**: `npm run build` (V5) + `npm run build:classic` + `node scripts/ui-classic/merge-dist.mjs`, que copia os
  assets da clássica para `dist/assets/` (nomes com hash, não colidem), o `index.html` dela como
  `index.classic.html` e o `sw.js` como `sw.classic.js`.
- **nginx** escolhe pelo cookie `torque_ui`: `v5` → `index.html`/`sw.js`; qualquer outra coisa (inclusive sem
  cookie) → `index.classic.html`/`sw.classic.js`. Assets são a união das duas, então uma aba velha que pede chunk
  depois da troca não toma 404.
- **Mesma origem** → mesma sessão do Supabase (localStorage): trocar de interface não pede login.

## Fluxo

1. A guarda (`UiVersionGuard`, nas duas árvores, dentro do layout autenticado) lê `organizations.ui_v5_enabled` da
   org atual.
2. Se a interface pedida não é a que está rodando: desregistra o service worker, apaga os caches, grava o cookie e
   recarrega. Proteção contra laço: no máximo uma tentativa por destino a cada 30 s por aba.
3. Só age com `VITE_UI_SWITCH=true` (ligado no Dockerfile). Dev, harness de prints e E2E servem uma build só — a
   guarda ali recarregaria à toa.
4. Coluna ausente (migration ainda não aplicada) → **clássica**. Deploy do front antes da migration é seguro:
   todo mundo fica na clássica. Erro passageiro de leitura → a guarda **não faz nada** (fica na build que o cookie
   escolheu) — um timeout não pode jogar a org inteira na outra interface.

## Banco

`20271104120000_org_interface_nova.sql`: coluna `organizations.ui_v5_enabled boolean not null default false` e a
chave `ui_v5_enabled` na allowlist de `set_org_settings` (admin da org ou master; auditado em
`permission_audit_log`). **Sem DML**: Milennials e TorqueCRM são ligadas pelo próprio switch depois do apply.

## Ordem de entrada em produção

1. **Antes do merge**: trazer a `main` para esta branch e regenerar a clássica dela —
   `npm run ui-classic:snapshot -- --ref origin/main`. Hoje a pasta vem da base comum (`1b3524727`), porque a
   `main` já usa dependências que a branch ainda não tem (`@sentry/react`); o patch aplica limpo nos dois refs.
2. **Merge** → EasyPanel builda a imagem com as duas interfaces. Sem cookie, todo mundo recebe a clássica —
   o mesmo que já usa hoje.
3. **Apply da migration** (botão do humano). Conferir depois:
   `has_function_privilege('anon'|'authenticated', 'public.set_org_settings(uuid,jsonb)', 'EXECUTE')` =
   `false`/`true`.
4. **Ligar Milennials e TorqueCRM**: o próprio switch, como admin/master, em cada uma.

Prova local de ponta a ponta (build dual contra o Supabase mockado, servida com as regras do nginx):
`node scripts/ui-classic/e2e-troca.mjs`.

## Custo enquanto a clássica existir

- A clássica é **congelada**: funcionalidade nova entra só na V5; na clássica, só conserto crítico (via patch).
- O banco precisa continuar servindo a clássica: nada de remover coluna/view que ela lê.
- Desligar a clássica = apagar `classic/`, `scripts/ui-classic/`, o mapa do nginx e a guarda.
