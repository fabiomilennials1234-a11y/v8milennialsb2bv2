---
type: tutorial
title: Onboarding Dev — Setup + Tour
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [tutorial, onboarding, setup]
related: ["[[02-primeiro-PR]]", "[[03-tour-vault]]", "[[04-trabalhando-com-claude]]"]
owner: gabriel
audience: dev-novo
estimated_time_min: 90
---

# Onboarding Dev — Setup + Tour

> [!info] Audiência
> Dev novo no Torque CRM. Assume: conhecimento básico de React, TypeScript,
> Git. Não assume: Supabase, Edge Functions, multi-tenant.

## O que você vai aprender

Ao final, você consegue:
- Rodar o app local
- Rodar testes
- Navegar pelo vault e código
- Saber quando pedir ajuda (e pra quem)

## Antes de começar

- [ ] Acesso ao repo: `https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2`
- [ ] Node 20+
- [ ] npm
- [ ] Git
- [ ] Editor (VS Code ou Cursor recomendado)
- [ ] Conta Supabase (dev project: `bcfadphgsibjzivtbjvc`)
- [ ] Claude Code CLI (se vai usar agente)

## 1. Clone + install

```bash
git clone https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2.git
cd v8milennialsb2bv2
npm install
```

## 2. Setup git hooks (proteção vault)

```bash
git config core.hooksPath scripts/git-hooks
```

Verifica:
```bash
git config core.hooksPath
# scripts/git-hooks
```

Esse hook protege o vault Obsidian contra deleção acidental. Detalhe em
[[Subagentes]] + [[CONTRIBUTING|CONTRIBUTING.md]].

## 3. Env vars

```bash
cp .env.example .env.local
```

Preencher (pedir credenciais dev pro CTO):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- (outras conforme `.env.example`)

## 4. Rodar app

```bash
npm run dev
```

Abre em http://localhost:8080. Login com conta dev (pedir pro CTO).

## 5. Rodar testes

```bash
npm run test:unit             # rápido, no setup
npm run lint                  # ESLint
npm run build                 # build prod local (sanity check)
```

## 6. Tour do código

```
src/
├── components/    componentes UI (46 categorias)
│   └── ui/        shadcn primitives (não editar)
├── hooks/         122+ hooks (queries + lógica)
├── pages/         46 páginas
├── contexts/      auth + theme + feature flags
├── lib/           helpers (permissions, supabase client, etc.)
└── integrations/  types.ts auto-gerado (NUNCA editar manualmente)

supabase/
├── functions/     94 edge functions (Deno)
│   └── _shared/   módulos compartilhados (35)
└── migrations/    322+ migrations SQL

tests/             unit + integration + e2e
docs/              C4 + runbooks
Obsidian/          vault (segundo cerebro do projeto)
```

## 7. Tour do vault

Abra `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/` em Obsidian
(ou só leia os `.md`).

Comece por:
1. [[00 — INDEX]] — mapa geral
2. [[Visao Geral]] — arquitetura do sistema
3. [[Areas Frageis]] — onde tomar cuidado
4. [[Subagentes]] — como o time Claude Code funciona

Detalhe da estrutura em [[03-tour-vault]].

## 8. Principais áreas pra entender

- **Multi-tenancy**: [[Multi-tenancy]]
- **RLS**: [[RLS Policies]]
- **Copilot (IA)**: [[Copilot]]
- **WhatsApp**: [[whatsapp-stability-plan]]
- **Permissões**: [[Permissoes Sistema]]

## 9. Primeiros 2 dias

Sugestão de tasks de aquecimento:
1. Ler `00 — INDEX.md` inteiro
2. Ler `CLAUDE.md` raiz do projeto
3. Ler `CONTRIBUTING.md`
4. Rodar `npm run test:unit` — entender o que falha (se algo falhar)
5. Pegar 1 backlog item LOW e tentar resolver

## 10. Quem pergunto sobre o quê

- **CTO (Gabriel)**: decisões arquiteturais, prod deploys, escolhas que afetam ICP
- **Outro dev**: setup, git, código mundo dia-a-dia
- **Claude Code subagentes**: implementação técnica, debugging, refactors
- **Vault**: consultar antes de perguntar — geralmente já tem resposta

## Próximos passos

- [[02-primeiro-PR]] — abrir seu primeiro PR
- [[03-tour-vault]] — entender a estrutura do vault em profundidade
- [[04-trabalhando-com-claude]] — usar subagentes pra acelerar trabalho

## Se der erro durante setup

1. Verificar versões: Node 20+, npm atualizado
2. Reinstalar: `rm -rf node_modules package-lock.json && npm install`
3. Limpar cache Vite: `npm run dev -- --force`
4. Perguntar no #dev-help com erro completo + sistema + Node version
