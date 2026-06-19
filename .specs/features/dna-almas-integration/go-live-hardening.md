# DNA de Almas — Go-live hardening (findings do completeness critic)

**Created:** 2026-06-19
**Contexto:** Onda 1/2/3 aplicadas em prod (placement). Funil roteia evento→tag→stage→drip.
Revisão adversarial do funil completo (21 workflows) achou gaps de **semântica de mensagem** e
**cobertura** que NÃO bloqueiam o estado atual (instância=0, nada envia) mas DEVEM ser resolvidos
antes do go-live (conectar `whatsapp_instance`). Raiz comum de vários: **stages reusados por
múltiplos eventos** + move-pro-mesmo-stage = no-op de gatilho.

Decisões com 🧑 = voz de produto (CTO decide copy/UX). 🔧 = mecânica (engenharia).

## 🔴 Bloqueantes de go-live (resolver ANTES de conectar instância)

### H1 — F (onboarding de mapa) dispara pra `checkout.upgrade` 🧑🔧
`checkout.upgrade` → tag `checkout_upgrade` → move `pago` → cascateia **F**. F2/F4 dizem "seu mapa
foi liberado / começa pelo Caminho de Vida" + oferta de Planilha vitalícia. Quem fez **upgrade de
plano** não comprou mapa avulso → mensagem factualmente errada.
**Fix:** (a) `checkout.upgrade` → stage próprio `upgrade` com drip próprio (ou no-op); OU
(b) F ganha nó condition no início checando `{{custom.plan_name}}`/tipo de compra (avulso vs plano).

### H2 — `downgrade` e `subscription.canceled` colidem em `cancelado` → winback errado pro downgrade 🧑🔧
`plan.downgrade_free` (usuário continua, só virou free) → tag `downgrade` → `cancelado` → **winback**
("seu acesso foi encerrado"). Falso — não foi encerrado.
**Fix:** `downgrade` → stage próprio `plano_free` (sem winback de "encerrado"), ou drip distinto.
Hoje `DNA · Downgrade (tag→stage)` aponta pra `cancelado` — mudar targetStage.

### H3 — `invoice.paid` no-op deixa inadimplente preso recebendo cobrança 🔧
Cliente `inadimplente` → paga (`invoice.paid`) → hoje SEM workflow → continua em `inadimplente` →
drip cobrança segue (o guard `in_stage:inadimplente` NÃO encerra porque o lead ainda está lá).
**Fix:** criar `DNA · Renovação (tag→stage)`: tag `renovacao` → move `pago` (ou stage `ativo`).
Tira o lead de `inadimplente` → guard da cobrança encerra. ⚠️ interage com H1 (mover pra `pago`
re-dispara F) → resolver junto: mover pra um stage `ativo`/`pago` SEM drip de onboarding, ou
F guardado por tipo de compra.

### H4 — guard "pago-mata-recuperação" ausente em E/B/C/D 🔧
Recovery drips (E cartão, B/C/D recuperação) sem nó condition. Lead que converte no meio do drip
continua recebendo "seu PIX expirou" depois do onboarding. Pattern do guard já provado nos drips
novos (Inadimplente/Cancelado). **NÃO ativar Onda 3 (B/C/D) sem o guard.**
**Fix:** inserir condition `in_stage:<stage_recuperação>` → `source-false`→`end` antes do 1º send
de E, B, C, D (mesmo shape do `apply_14`).

## 🟠 Cobertura fantasma (parece pronto, entrega zero)

### H5 — `frio`/G = código morto 🔧
Drip G (reativação frio) ativo, mas NENHUM caminho move lead pra `frio` (G1/G2 do PDF eram cron 15d,
nunca montado). **Fix:** montar gatilho de inatividade (cron/no-response → move frio) OU aceitar G
dormante e marcar como não-coberto (não mascarar).

### H6 — E (cartão recusado) inentregável sem phone 🧑
`checkout.error` só traz email; E é WhatsApp. Net-new sem lead.created prévio (com phone) → E não
entrega. = **DEP-3** (Zuvic mandar phone nos checkout.* OU garantir lead.created com phone antes).
Até lá, E só funciona pra quem já é lead com telefone.

## 🟡 Hardening

### H7 — tags de sistema sem prefixo → colisão com tag humana 🔧🧑
`cancelado`/`downgrade`/`inadimplente`/`renovacao` são palavras genéricas; match é case-insensitive.
Tag humana/import com mesmo nome dispara o move. **Fix:** prefixar tags de sistema (`sys:cancelado`
etc.) — exige coordenar com a Zuvic (eles mandam a tag) + atualizar trigger_config dos workflows.

### H8 — stages terminais sem re-entrada (ordem-dependência) 🔧
`pago`/`cancelado`/`inadimplente` reusados: 2º evento pro mesmo stage = no-op (não re-dispara nem
loga). Edge cases de jornada (pago→cancelou→reativou). **Fix:** stages-por-evento onde a jornada
diverge, ou re-entrada forçada. Relacionado a H1/H2.

## Já resolvido / não-issue (registro)
- ❌ **Re-tag re-move** (over-stated): `lead_tags ON CONFLICT DO NOTHING` → re-add de tag existente
  não re-dispara `trg_workflow_tag_added`. Mitigado por design.
- ❌ **Preço 99,97 em B/C**: já corrigido em prod pra 98,00 (scan zero residual 2026-06-19). O critic
  leu o artefato-fonte stale, não o estado de prod.
- ✅ Genéricos (Disparo Automático + 3 Nutrição/Pré-Qualificado) todos is_active=false.

## Sequência sugerida de go-live
1. CTO conecta `whatsapp_instance` (DEP-1).
2. Resolver H1/H2/H3/H8 (stages-por-evento ou guards de tipo) — decisão de produto + mecânica.
3. Montar guard H4 em E (e B/C/D antes de ativar Onda 3).
4. Resolver H5 (gatilho frio) ou marcar G dormante.
5. Zuvic: phone (H6/DEP-3) + tags (DEP-2) + prefixo sys: (H7) + 3 eventos novos (DEP-4 → Onda 3).
6. Smoke real por cenário (1 lead descartável cada, com instância).
