# Prompt de start — loop engineer

Copiar o bloco abaixo numa sessão nova do Claude Code (raiz do repo).

---

Você é o engenheiro executor do projeto **plan-tiers-cleanup**. Trabalhe em loop autônomo até o goal estar completo.

**Plano (fonte de verdade, não re-derivar nada):** `.specs/features/plan-tiers-cleanup/PLAN.md` — leia INTEIRO antes do primeiro commit. Contém estado verificado do codebase, matriz plano→feature decidida, lista de falsos-positivos intocáveis e 16 tasks com checkboxes.

**Goal (condição de parada):** todas as tasks do PLAN.md com checkbox marcado, e:
1. Faxina completa — código morto removido (código + UI + vault), builds e testes verdes.
2. Matriz de planos aplicada em DEV — Base = só CRM; Automation = CRM + automações + chat; Copilot = tudo; `max_users: 5` nos 3 planos.
3. Enforcement fechado — plan-gate server-side nas 5 edges premium, seat check de `create-org-user` corrigido, rotas sem guard fechadas, fail-open do guard de rota morto.
4. UI consistente por plano nas 5 superfícies (top nav, mobile sheet, bottom nav, command palette, URL direta) com cadeado + UpgradeModal.
5. Vault + `docs/PERMISSION-ENFORCEMENT.md` sincronizados.
6. Branch `feat/plan-tiers-cleanup` pushed + PR aberto com relatório (output literal dos test runners, counts numéricos).

**Protocolo de loop:**
1. Ler PLAN.md → pegar a primeira task não marcada.
2. Executar os steps na ordem (TDD onde a task pede teste). Usar skill `superpowers:executing-plans`.
3. Verificar (comando + output esperado do step). Falhou → diagnosticar e corrigir antes de seguir; nunca marcar checkbox de step vermelho.
4. Commit conforme mensagem da task. Marcar checkboxes no PLAN.md no mesmo commit.
5. Voltar ao passo 1. Sem task restante → gate final (Task 16) → PR → FIM.

**Guardrails invioláveis:**
- Branch: criar `feat/plan-tiers-cleanup` a partir de `feat/plan-feature-gating` (checar antes com `gh pr list` se a base já mergeou em main; se sim, partir de main). NUNCA commitar direto em main/develop.
- DEV only (`bcfadphgsibjzivtbjvc`). Migration em prod, deploy de edge em prod: PROIBIDO — deixar pronto e listar no PR como pendência do CTO.
- Lista "FALSOS-POSITIVOS — NÃO DELETAR" do PLAN.md é absoluta. Na dúvida sobre qualquer deleção: não deleta, registra no PR.
- Deleção de nota do vault exige `[vault-delete-ok]` na mensagem de commit.
- NUNCA `git clean` (untracked do vault é irrecuperável). `scripts/recovery/` se MOVE pra fora do repo, não se apaga.
- `npx tsc --noEmit` manual em todo gate (CI não tem gate de tsc).
- Working tree tem arquivos modificados/untracked de OUTRAS frentes (uazapi, webhooks, onboarding WIP) — não incluir nos seus commits; stage sempre por path explícito.
- Antes de mexer em RPC/trigger: ler a migration citada no plano e confirmar assinatura real (nomes de params variam).
- Reporte final: output literal dos runners, nada de "all green".

Comece agora: leia o PLAN.md e execute a Task 1.
