# Spec — Checkout, assinatura e cobrança do Torque

**Fonte canônica: o Epic SCRUM-39 no Jira.** Este arquivo é o espelho versionado dele.
Escrito em 2026-08-26. Toda medição citada foi feita contra produção (`jsjsmuncfkbsbzqzqhfq`) nesta data.
PRD original: GitHub #1393 · Mapa: #1376.

Escrito para alguém que nunca mexeu em billing conseguir abrir o código e saber onde está.

---

## 1. Em uma frase

O Torque vende por duas portas — o cliente compra sozinho no site, ou o vendedor manda um link com um pacote negociado — e as duas terminam no mesmo trilho: cobra, recebe, provisiona, libera.

## 2. Cinco palavras para aprender antes de abrir o código

**PACOTE** — o que está sendo comprado: plano + features + limites + assentos + ciclo + meio de pagamento + preço. Pode ter sido montado pelo vendedor ou escolhido pelo próprio cliente. Nos dois casos vira a mesma linha em `payment_links`.

**CONTRATAÇÃO** — a linha em `payment_links`. É o pacote gravado. Toda compra do Torque passa por uma. NÃO usar "Pedido" nem "Cotação": no `CONTEXT.md` essas palavras já descrevem o domínio oposto — dinheiro que o cliente final deve à Organização.

**COBRANÇA** — a dívida criada no Asaas quando o cliente escolhe COMO pagar. Uma Contratação pode gerar duas cobranças (uma Pix, uma cartão), nunca duas do mesmo método.

**SNAPSHOT** — cópia congelada do pacote gravada em `org_subscriptions` no instante do pagamento. É o contrato. Se o catálogo mudar amanhã, o cliente continua com o que comprou. É daqui que sai o grandfathering, de graça.

**PROVISIONAMENTO** — transformar "pagou" em "tem acesso": criar organização, criar admin, gravar plano e validade, ligar o snapshot.

---

## 3. As duas portas

```
   PORTA 1 — SELF-SERVE                 PORTA 2 — LINK DO VENDEDOR
   (foco atual)                         (construído, falta ligar)

   cliente escolhe no site              Master monta o pacote
   cadastra                             gera link com token
   paga                                 manda pro cliente
        │                                    │
        └────────► CONTRATAÇÃO ◄─────────────┘
                        │
                        ▼
                 cobra no Asaas
                        ▼
                 cliente paga
                        ▼
                 webhook → fila → worker
                        ▼
                 organização + snapshot + acesso
```

**As duas portas se alimentam.** Os planos caros não são vendidos no automático: o botão deles agenda uma demo, e depois da demo o vendedor usa a Porta 2 para fechar. O self-serve vende embaixo; o link fecha em cima.

---

## 4. Decisões travadas (2026-08-26)

Cada uma tem um número para que as tasks possam citá-la.

| # | Decisão |
|---|---|
| **D1** | Duas portas, ambas de primeira classe. Foco imediato: self-serve. |
| **D2** | **Entrada é pagamento na porta. Sem trial.** Trial vira fatia depois, quando a cobrança estiver provada rodando. Motivo: existem 9 orgs em trial hoje que nunca expiram e nunca cobram — o relógio que um trial exige já foi tentado e não existe. |
| **D3** | **Self-serve vende 1 plano básico.** `torque-v8` e `torque-2.0` trocam "Assinar" por "Falar com vendas" → agendar demo. |
| **D4** | **O plano básico ainda NÃO existe.** Nome, preço e escopo são decisão comercial pendente (ver P1). O `torque-1.0` está descartado: tem `max_whatsapp_instances: 0` e `max_copilot_agents: 0` — o cliente pagaria R$594 e não teria o produto. |
| **D5** | **Ciclos e desconto, para TODOS os planos:** mensal = cartão, assinatura recorrente, sem desconto · semestral = Pix à vista **−15%** ou cartão até 12x preço cheio · anual = Pix à vista **−20%** ou cartão até 12x preço cheio. Pix não existe no mensal. |
| **D6** | **Parcelado é preço cheio, sem desconto**, e recebemos parcelado (sem antecipação). Até 12x em qualquer ciclo, **inclusive semestral** — decisão tomada com a consequência na mesa (num semestral parcelado em 12x, o cliente termina de pagar 6 meses depois do serviço acabar, e a renovação chega enquanto ele ainda paga a anterior). |
| **D7** | **Fluxo self-serve:** cadastra → checkout/paywall → paga → organização nasce → entra. **A organização só nasce com pagamento confirmado.** |
| **D8** | *(REVISTO POR G9 — leia G9 antes de implementar.)* **Conta sem pagar vive no paywall** e cai nele em todo login. Nunca vira organização: não consome instância de WhatsApp, não gera custo, não polui a base. É assim que os 19 usuários órfãos medidos hoje deixam de existir. |
| **D9** | **Arquitetura: um componente de checkout, dois invólucros.** Uma tela com os nove estados, montada no invólucro público (resolve por token) e no autenticado (resolve por sessão). |
| **D10** | **Gateway: Asaas.** Medido contra Stripe e a diferença não é de gosto — ver seção 8. |
| **D11** | **Cartão salvo sempre, em qualquer ciclo.** Quem paga no cartão gera o token de graça na primeira cobrança. Quem paga no Pix cadastra um cartão na área de billing, tokenizado **sem cobrar**. |
| **D12** | **Addons com 1 clique** usando o cartão salvo: assento a mais, número de WhatsApp adicional, créditos de IA, integração. Escrevem em `org_quotas.purchased_addons`. |
| **D13** | *(custo medido em G4: ~85 policies.)* **Régua de cobrança falha:** dia 0 avisa · dias 1 a 6 retenta 1x/dia **e na hora em que o cartão for atualizado** · dia 7 **trava a ESCRITA** até o pagamento ser aceito de fato. Travar escrita, nunca o login. |
| **D14** | **Renovação do Pix:** avisa antes de vencer e oferece renovar com 1 clique no cartão salvo. **Nunca cobrar sozinho no cartão de quem escolheu Pix** — é o caminho mais curto para contestação. |
| **D15** | **Avisos em dois canais: dentro do sistema + WhatsApp**, por número oficial nosso (dedicado, em fase posterior). Template categoria `utility`, custo medido R$0,0350/mensagem no Brasil. O telefone já é coletado no `/signup` hoje. |
| **D16** | **Demo: Cal.com embutido** na própria página. O webhook de agendamento do Cal.com aponta para o `lead-webhook`, que já roda em produção — cada demo marcada vira lead na org da Milennials. |
| **D17** | **Preço na landing:** `torque-v8` vira **"sob consulta"** (é onde a venda é negociada de verdade — 121 ajustes de feature em 9 orgs). `torque-2.0` mantém o preço visível, porque é mecânico: R$697 × assentos. |

### Decisões herdadas que continuam valendo

Modelo comercial híbrido (catálogo é ponto de partida, o vendido vira snapshot) · Um link só, com alvo (org nova OU troca de snapshot de org existente) · Snapshot é a camada BASE da resolução · Master vende, admin da org consulta · Backfill das orgs existentes com reconciliação; o dinheiro migra na renovação natural · Nota fiscal fora de escopo (o checkout coleta razão social, CNPJ e e-mail fiscal).

**#1382** — status é DERIVADO, sem coluna. `billing_override` morre e vira dois conceitos: cortesia permanente e isenção temporária com motivo, autor e validade.
**#1380** — snapshot exaustivo e append-only; `organization_features` vira só concessão temporária com `expires_at`.
**#1381** — preço em cascata multiplicativa, override com motivo obrigatório, RPC `service_role`-only.
**#1383** — só o hash do token é guardado; uma cobrança por (Contratação, método), reaproveitada; geração é autoridade de Master; a página mostra o pacote, não o cadastro.
**#1379** — write-block é o único desenho que cobra sem destruir a operação do cliente.

---

## 5. A jornada do cliente (Porta 1)

```
  1. LANDING       básico → [Assinar]      v8 e 2.0 → [Falar com vendas]
                        │                            │
                        │                            └─► Cal.com embutido
                        ▼                                → lead no Torque
  2. CADASTRO      nome, e-mail, senha, telefone, CPF/CNPJ
                   cria a conta. Ainda NÃO existe organização.
                        ▼
  3. CHECKOUT      mostra o pacote e o preço, pergunta o ciclo:
                     ○ Mensal      R$ X/mês
                     ○ Semestral   R$ Y   (−15% no Pix)
                     ○ Anual       R$ Z   (−20% no Pix)
                   e o meio de pagamento:
                     mensal    → cartão (vira assinatura recorrente)
                     sem/anual → Pix à vista COM desconto
                                 ou cartão em até 12x, preço cheio
                        ▼
  4. PAGA          Pix    → QR code na nossa tela
                   Cartão → sai pro Asaas e volta
                        ▼
  5. A TELA ESPERA pergunta sozinha se caiu (3s por 2min, depois 10s)
                        ▼
  6. ORGANIZAÇÃO   nasce AQUI, com o pagamento confirmado
                        ▼
  7. ENTRA         cai no produto, com o plano já valendo
```

### Os desvios — é onde o desenho mora

| Situação | O que acontece |
|---|---|
| Fechou a aba no meio do Pix | Nada se perde. Faz login e cai no mesmo checkout, com a **mesma** cobrança. Não gera Pix novo. |
| Não pagou e sumiu | A Contratação fica aberta e ele cai nela no próximo login. Nunca vira organização — não consome instância, não gera custo. Isso é **primeira compra, não bloqueio**: quem nunca teve organização não está inadimplente (G9). |
| Pix venceu | A tela diz que venceu e oferece gerar outro. É desfecho, não erro — tem que estar bonita nesse estado. |
| Cartão recusado | Volta ao checkout com a mensagem do banco. Pode tentar outro cartão ou trocar pro Pix. |
| Recarregou / clicou duas vezes | Não cobra de novo. Uma cobrança por (Contratação, método), reaproveitada. |
| Já tem conta | O cadastro **não** diz "e-mail já existe" — isso entrega quem é cliente nosso. Manda fazer login, e o login leva pro checkout se não pagou. |

---

## 6. Arquitetura

**A Contratação é sempre uma linha em `payment_links`, inclusive no self-serve.** A diferença entre as portas é só **como essa linha é lida**.

```
  PORTA PÚBLICA (Master)              PORTA AUTENTICADA (self-serve)
  ──────────────────────              ──────────────────────────────
  autoriza por TOKEN                  autoriza por SESSÃO
  token_hash = sha256(t)              created_by = auth.uid()
  AND origin = 'master'               AND origin = 'self_serve'
                                      AND paid_at IS NULL
           │                                    │
           └────────────► link_id ◄─────────────┘
                            │
                            ▼
              billing-create-charge  (um só, daqui pra baixo)
              ensureCustomer → createCharge → payment_link_charges
                            │
                            ▼
              asaas-webhook → fila → worker → snapshot → acesso
```

### A invariante que fecha o risco do modo duplo

**Um token NUNCA resolve linha de self-serve. Uma sessão NUNCA resolve linha de Master.** Dois resolvedores, cada um cego para o território do outro, um só rabo compartilhado. Sem essa regra, o modo duplo vira furo: alguém paga ou lê a Contratação de outra pessoa.

### O que muda no schema

- `payment_links.origin` — `'master' | 'self_serve'`, `NOT NULL DEFAULT 'master'`
- índice parcial em `created_by WHERE origin='self_serve' AND paid_at IS NULL` — é a busca de "o checkout aberto deste cliente", que roda em todo login de conta não paga

`token_hash` continua `NOT NULL`: a linha de self-serve também ganha um token, que **nunca é devolvido a ninguém**. Mantém a tabela com uma forma só.

### O que NÃO muda

`billing_quote_price` (exceto o que a seção 7 lista), `asaas-webhook`, `billing-provision-worker`, `org_subscriptions`, `org_quotas`. O self-serve entra num trilho que já existe.

---

## 7. Motor de preço — o que muda

O cálculo é uma função de banco e é a única que pode calcular preço. **O navegador nunca calcula.** Cascata atual:

```
   preço do plano + assentos extras
        ↓ desconto do ciclo
        ↓ cupom
        ↓ desconto manual do vendedor
   = valor a cobrar
```

Três mudanças que D5 e D6 exigem:

**1. O desconto passa a depender do meio de pagamento, não só do ciclo.**

```
                    PIX À VISTA        CARTÃO (até 12x)
   ─────────────────────────────────────────────────────
   Mensal           não existe         preço cheio, recorrente
   Semestral        −15%               preço cheio
   Anual            −20%               preço cheio
```

Hoje o desconto está preso ao ciclo e sairia para o cartão também. Sem esse ajuste, entrega-se desconto de Pix para quem pagou no cartão — e o desconto existe justamente porque o Pix custa R$1,99 fixo e o cartão custa 2,99%.

**2. O motor não sabe o que é parcelamento.** Entra como parte da proposta, com a regra: só no cartão, só em semestral ou anual, no máximo 12x, sempre preço cheio.

**3. Os percentuais sobem para todos os planos.** Hoje todos estão em 10% semestral / 15% anual. Passam para **15% / 20%** (D5). Efeito medido: `torque-v8` anual no Pix sai de R$20.369,40 para R$19.171,20 — **R$1.198,20 a mais de desconto por venda**.

A recusa de combinações inválidas (Pix no mensal, ciclo inválido, método inválido) já existe e fica.

---

## 8. Por que Asaas e não Stripe

Medido contra a documentação oficial dos dois em 2026-08-26.

```
                      ASAAS                 STRIPE BR
  ────────────────────────────────────────────────────────────────
  Pix              R$ 1,99 FIXO          1,19% do valor (só por convite)
  Cartão           2,99% + R$ 0,49       3,99% + R$ 0,39
  Assinatura       incluso                + 0,70% do volume
  Parcelamento     até 21x                NÃO EXISTE NO BRASIL
```

**O fato que decide:** a documentação de parcelamento do Stripe cobre Mastercard Installments, México e Japão. **O Brasil não aparece.** O Stripe não parcela cartão brasileiro, e D6 depende de parcelar.

Somado: o Pix do Stripe é "apenas para convidados" para empresa sediada no Brasil, e numa venda anual de `torque-v8` no Pix a taxa seria R$228,14 contra R$1,99 do Asaas — **114x mais cara**, exatamente no meio de pagamento que o desconto de D5 empurra o cliente a usar.

**O que se perde:** Stripe Billing e Customer Portal entregariam prontos a proração, a área de billing e o dunning. É trabalho real que estaríamos comprando. Não compensa a ~R$36k/ano de taxa a mais, sem parcelamento e dependendo de convite para o Pix.

**A decisão é barata de reverter.** `_shared/payments/port.ts` foi escrito para isso: *"Adicionar um segundo gateway significa escrever outra implementação desta interface — não tocar num único chamador."*

---

## 9. Cartão salvo e addons

O `creditCardToken` **volta na resposta da primeira cobrança aprovada** — não é passo extra. Literal da doc do Asaas: *"Nas próximas cobranças do mesmo cliente, envie o token no lugar dos objetos `creditCard` e `creditCardHolderInfo`."* E: *"O token pertence ao cliente para o qual foi criado e não pode ser utilizado em cobranças de outro cliente."*

Ou seja: **assinatura mensal e compra com 1 clique são a mesma peça.**

```
   PAGOU NO CARTÃO                    PAGOU NO PIX
   token vem de graça                 não tem cartão
        │                             área de billing: cadastra
        │                             → tokeniza SEM cobrar
        └──────► token salvo ◄────────┘
                     │
                     ▼
           addons com 1 clique
           · assento a mais    · número de WhatsApp
           · créditos de IA    · integração
```

**O encanamento já existe:** `org_quotas.purchased_addons` é exatamente onde o assento comprado cai, e o preço do assento extra já está no catálogo (R$120 no `torque-v8`, R$297 no `torque-1.0`, R$697 no `torque-2.0`). Não é feature nova — é ligar três coisas que já existem.

### Duas restrições que o desenho respeita

1. **Toda cobrança com token exige `remoteIp` — o IP do aparelho do pagador, não do servidor.** Na prática, a compra com 1 clique tem que partir do navegador dele. Cobrança automática sem ninguém na tela (ex.: estouro de consumo) não passa por esse caminho; teria que ser pela assinatura.
2. **Cartão vencido é buraco não coberto pela doc.** Existe endpoint para trocar o cartão de uma *assinatura*; para o token avulso a doc é silenciosa. Entra em P5.

---

## 10. Régua de cobrança falha e renovação

```
   DIA 0      cartão recusado
              → avisa DENTRO do sistema + WhatsApp
              → acesso normal

   DIA 1 a 6  retenta 1x por dia
              → e retenta NA HORA se o cartão for atualizado
              → avisa a cada falha, nos dois canais

   DIA 7      TRAVA A ESCRITA até o pagamento ser aceito de fato
              → ele entra, lê tudo, exporta tudo, não cria nem edita
              → tela de pagamento por cima
```

**Por que travar escrita e não login:** tirar o acesso de um CRM tira do cliente o histórico da operação dele. Quem não consegue nem exportar os próprios leads não vira devedor — vira contestação de cartão, e contestação em volume faz o gateway olhar para a conta com má vontade.

**Nota de calibragem, registrada:** 7 dias é mais curto que todos os concorrentes medidos (RD, Kommo e Pipedrive trabalham com 30 dias de carência). Falha involuntária de cartão de PJ — limite, vencimento, troca de banco — costuma levar mais que 7 dias para ser resolvida. Decisão do CTO, registrada como está.

**Renovação do Pix:** quem pagou 12 meses no Pix não tem cartão para cobrar. Sem aviso, perde acesso no dia seguinte ao vencimento sem nunca ter sido avisado — e é a maior parte da receita, porque o desconto de 20% empurra todo mundo para o anual. O aviso vai nos dois canais e oferece **renovar com 1 clique no cartão salvo** (D11), nunca cobrança automática.

---

## 11. Como o produto descobre o que a org pode fazer

Conferido lendo o `prosrc` em produção, não a documentação. **Feature é sobrescrita. Cota é soma.**

```
  FEATURES — org_get_features_and_limits()   [o de baixo sobrescreve o de cima]
    0. master? → tudo true, sai
    1. BASE ──┬─ tem snapshot?  → org_subscriptions.features   ← o que foi VENDIDO
              └─ não tem?       → subscription_plans.features  ← o catálogo
    2. organization_features  (expires_at futuro ou nulo)      ← concessão temporária
    3. feature_catalog.default_enabled                          ← só preenche buraco

  LIMITES — mesma função                     [o de baixo sobrescreve o de cima]
    1. BASE: snapshot.limits, senão plano.limits
    2. organizations.limit_overrides
    3. org_quotas.effective_limit  ← SÓ para max_users,
                                     max_whatsapp_instances, max_copilot_agents

  E effective_limit é COLUNA GERADA — não dá para escrever nela:
       plan_base  +  purchased_addons  +  admin_adjustment
       ─────────     ────────────────     ────────────────
       vem do        o que o cliente      remendo do master
       plano         COMPROU a mais       (7 orgs vivem disso hoje)
                            ↑
                     0 EM TODAS AS LINHAS ← bug SCRUM-447, bloqueia D12
```

`org_resolve_quota`: `org_quotas` manda quando a linha existe. Quando não existe, cai numa cadeia (org_subscriptions→plano, organizations.subscription_plan→plano, limit_overrides, 0) e nesse caminho addons e adjustment valem ZERO.

**Mina conhecida:** `_resolve_plan_base_for_resource` já prioriza `org_subscriptions`. Inserir a PRIMEIRA linha nessa tabela vira a resolução de quota de ~90 organizações sozinho, sem nenhuma mudança de código.

---

## 12. As regras que não se dobram

```
  Preço é calculado no servidor, sempre.
    → senão o cliente edita o JSON e compra por R$1.

  O front pede CAMPO, nunca objeto.
    → devolver o objeto inteiro vaza org_id, link_id e o quote cru
      numa página pública.

  O token da Contratação é credencial: nunca em log, erro ou telemetria.
    → o rastro é o link_id, ou 8 hex do sha256 quando não resolve.

  Cada chave abre só a porta dela.
    → token não abre self-serve; sessão não abre Contratação de Master.

  HTTP 200 em todos os desfechos da página pública.
    → link vencido é desfecho, não incidente.

  O webhook responde 200 SEMPRE.
    → a fila do Asaas trava com 15 falhas seguidas, e um evento envenenado
      bloqueia todos os seguintes. Devolver 500 derruba a receita inteira.

  PAGO = CONFIRMED ou RECEIVED, o que chegar primeiro.
    → no cartão o RECEIVED vem 32 DIAS depois; no Pix o CONFIRMED é PULADO.

  O estado nunca REBAIXA.
    → em entrega NON_SEQUENTIALLY o CONFIRMED pode chegar depois do RECEIVED.

  Idempotência é LIVRO, não coluna de estado.
    → UNIQUE(provider_payment_id).

  Provisionar fora do webhook.
    → provisionar dentro deixa a org paga e inacessível em silêncio.

  NUNCA escrever org_quotas direto.
    → grava-se o NOME do plano e o gatilho sincroniza. effective_limit é GERADA.

  Renovação SOMA ao vencimento vigente, não substitui.
    → substituir queima os dias que o cliente já pagou.

  Uma cobrança por (Contratação, método), reaproveitada.
    → sem isso, recarregar a página cobra o cliente duas vezes.

  Nunca cobrar no cartão de quem escolheu Pix sem ele pedir.
    → o cartão salvo serve para ele clicar, não para decidirmos por ele.

  billing_resolve_charge_buyer ramifica por `code`, nunca por `ok`.
    → buyer_missing volta com ok = true. E buyer_missing + new_org é INCIDENTE.
```

---

## 13. O que pode dar errado, e como se prova que não deu

| Risco | Como se prova |
|---|---|
| Chave abrindo a porta errada | teste que tenta cada cruzamento e **exige recusa** |
| Navegador mandando o preço | teste que manda valor diferente e exige que seja ignorado |
| Cobrar duas vezes | pedir a mesma cobrança 2x devolve a **mesma**; webhook duplicado não provisiona de novo |
| PII em log | medir os GUCs em produção, não supor (ver P6) |
| Cobrar errado | SCRUM-446 e SCRUM-447 precisam cair antes (ver B1, B2) |

**Restrição de ambiente:** Docker e Supabase local estão banidos neste projeto. Todo teste que precisa de banco — que aqui é a maior parte, porque o dinheiro mora em função de banco — exige uma **branch do Supabase**, que é projeto separado e cobra por hora. As fatias precisam ser agrupadas para usar a branch em blocos, não uma por tarefa.

**O único teste que prova tudo é um pagamento real em sandbox.** Todo o resto é a máquina sem carga.

---

## 14. Estado medido em 2026-08-26

**O apply acabou.** Todas as migrations de billing estão no ledger de produção. Existem em prod: as 9 tabelas, as RPCs, o cron do provision worker (a cada 2 minutos, ativo), os 5 segredos com prefixo `ASAAS_`, e 3 edge functions (`asaas-webhook`, `billing-payment-link`, `billing-provision-worker`).

**E nada nunca rodou.** Zero linhas em `payment_links`, `payment_link_charges`, `payment_webhook_events`, `payment_history` e `org_subscriptions`. `billing_override` ligado em **90 de 107** organizações.

**A causa:** nenhuma edge function chama o gateway. A camada `_shared/payments/` está escrita, testada, e tem **zero consumidores**. Não é falta de tráfego — não existe caminho do pedido até o Asaas. O próprio `billing-payment-link` documenta no cabeçalho: *"Não confundir com os endpoints que ainda não existem: status do pagamento, dados fiscais e a criação da cobrança."*

**A porta 1 já existe pela metade e vaza:** a landing vende três planos com botão de assinar, o `/signup?plan=` lê o plano e **joga fora**, e o usuário cai no `/dashboard` sem organização. Medido: **19 usuários sem organização nenhuma**, 9 deles nos últimos 90 dias.

**Legado vivo e não revisado:** `checkout-provision-org` (v55) e `checkout-create-payment` (v54), ACTIVE em produção desde 15/05/2026, fora do desenho novo inteiro.

**MRR ≈ R$213k/mês** de 89 organizações que o sistema não registra.

**Catálogo em prod, conferido:**

```
  PLANO        PREÇO      WHATSAPP   COPILOT   LEADS    FEATURES   ORGS
  ─────────────────────────────────────────────────────────────────────
  torque-1.0   R$   594        0         0       ∞         12        5   ativo
  torque-v8    R$ 1.997        ∞         ∞       ∞         19       61   ativo
  torque-2.0   R$ 3.485        ∞         0       ∞         17       34   ativo
  free         R$     0        1         0      100         7        5   inativo
  starter      R$    97        1         2    1.000        13        0   inativo
  pro          R$   197        3        10    5.000        19        0   inativo
  enterprise   R$   497        ∞         ∞       ∞         20        0   inativo
```

`torque-v8`: R$1.997 base, 3 inclusos, extra R$120. `torque-2.0`: R$697 por assento, mínimo 5 (o base é 0 de propósito: 697×5 = 3.485). `torque-1.0`: R$297 por assento, mínimo 2.

---

## 15. Benchmark de mercado

Dossiê completo com fonte primária: `.specs/pesquisa/precos-mercado-e-custo-insumo.md`.

**O corte do self-serve não é um preço, é o formato do plano.** Quem vende por assento corta cedo; quem vende por conta não corta.

```
  DataCrazy    NÃO CORTA — os 4 tiers, até R$ 2.997/mês, vão pro /register
  Pipedrive    NÃO CORTA — os 4 planos, até US$ 89/licença, são autocompra
  HubSpot      corta em US$ 150/assento — Enterprise só "Falar com Vendas"
  Kommo        corta acima do Pro (R$ 232/user) — Empresarial "Sob medida"
  RD Station   corta acima do Pro (R$ 131/user) — Advanced "sob consulta"
  Agendor      corta em R$ 156/user com mínimo 10 users (~R$ 1.560/mês)
  Ploomes      INVERSO — publica só o Básico; os 8 módulos são "sob consulta"
```

**Entrada praticada no Brasil:** R$59–85 por assento, ou **R$297/mês flat** (DataCrazy Starter — 4 membros, 3 conexões, 5 mil leads). O Torque vende flat, então o número de referência é o R$297.

**Trial:** Kommo 14d, Pipedrive 14d, Agendor 7d, Ploomes 14d — **nenhum pede cartão**. Plano gratuito permanente em 3 dos 7.

**Escada de ciclo:** DataCrazy −17% semestral / −28% anual · Kommo −10/−16/−25% (6/9/12/24 meses) · RD −10% anual · Pipedrive "até 26%".

**Custo de insumo é irrisório perto do ticket:** WhatsApp utility no Brasil **R$0,0350/mensagem**, marketing R$0,3217, service grátis (rate card oficial da Meta, vigente 01/07/2026); instância Uazapi de R$0,65 a R$19,00/mês; gpt-4.1-mini US$0,40 / US$1,60 por 1M tokens. **Custo não é restrição de preço aqui.**

**Nota honesta:** os dois concorrentes mais próximos do Torque — DataCrazy (mesmo ICP de WhatsApp) e Pipedrive — não cortam o self-serve em lugar nenhum. D3 corta mais cedo que o mercado. É decisão deliberada, para alimentar o time comercial em vez de competir com ele.

---

## 16. Pendências

| # | O que | Quem destrava |
|---|---|---|
| **P1** | **Plano básico: nome, preço e escopo.** Sem isso o self-serve não tem o que vender. Dossiê de mercado já entregue. | CTO |
| **P2** | Quantos dias antes avisar a renovação do Pix anual (sugerido 30 / 15 / 3 — contrato anual de PJ passa por aprovação interna) | CTO |
| **P3** | **Habilitar tokenização em produção no Asaas.** Sujeita a análise e **pode ser negada**. Sem ela não há assinatura recorrente **nem** addon com 1 clique. Prazo de terceiro — abrir já. | gerente de contas Asaas |
| **P4** | Taxa real do parcelado. O blog do Asaas fala em 1,99% adicional; a página de preços não confirma. Numa venda anual de R$23.964 são R$477. | gerente de contas Asaas |
| **P5** | Uma parcela individual pode falhar depois da primeira? Como se atualiza um cartão vencido no token avulso? | gerente de contas Asaas |
| **P6** | #1560 — PII em texto claro no log do Postgres. `log_min_error_statement = error` é default e grava a instrução inteira quando ela falha; o checkout recebe nome, CPF e e-mail. Medir os GUCs, a retenção e se há drain em produção. | engenharia |

P3, P4 e P5 vão no **mesmo e-mail** ao gerente de contas e não dependem de mais nenhuma decisão.

---

## 17. Bloqueios técnicos

| # | O que | Task |
|---|---|---|
| **B1** | Desconto manual anual cobra **12x** a mais, sem erro. Mesma função que o self-serve vai usar. | SCRUM-446 |
| **B2** | `purchased_addons` zerado em todas as linhas. **Bloqueia D12 diretamente** — o cliente compraria um assento, seria cobrado, e não receberia. | SCRUM-447 |
| **B3** | A criação de cobrança no gateway não existe. É o que mantém tudo inerte. | SCRUM-444 |
| **B4** | `billing-quote` e `billing-payment-status` não estão deployadas. A tela do Master está quebrada em produção hoje. | SCRUM-445 |
| **B5** | Perna do cartão: A1 (redirect para `invoiceUrl`, PCI fora) vs A2 (formulário próprio, PCI dentro). **Ficou mais crítico com D11**: sob A1 não está confirmado que o `creditCardToken` chega até nós — se não chegar, não há cartão salvo nem addon com 1 clique. Medir com um pagamento de cartão em sandbox e `GET /payments/{id}`. | SCRUM-452 |

**Premissa de #1394 que caiu na medição:** não existe "componente hospedado do Asaas" embutível. Para cartão a doc lista três caminhos e nenhum é iframe ou SDK — redirecionar para a `invoiceUrl`, mandar o PAN pela API do nosso servidor, ou reusar `creditCardToken`.

---

## 18. Fora de escopo

Emissão de NFS-e · trial (volta como fatia depois que a cobrança estiver provada) · cobrança do cliente final da org (Carteira / TinyERP / Omie — domínio diferente) · proração de upgrade e downgrade no meio do ciclo (SCRUM-450, fatia própria) · backfill do snapshot nas orgs existentes (fatia própria) · desarme dos 90 `billing_override` (fatia própria).
# ATUALIZAÇÃO — 2026-08-26 · grilling e decisões G1–G11

> Tudo acima é de 04/08 e **fica**. Esta seção estende o PRD. **Onde houver conflito, esta seção vence** — e os pontos em que ela contradiz o texto de cima estão nomeados explicitamente em "O que esta atualização revoga".
>
> Espelhos: Epic Jira **SCRUM-39** · `.specs/checkout/spec-checkout-e-billing.md` · dossiê de mercado em `.specs/pesquisa/precos-mercado-e-custo-insumo.md`.
> Toda medição citada foi feita contra produção (`jsjsmuncfkbsbzqzqhfq`) em 2026-08-26.

## Problem Statement — o que mudou desde 04/08

**O gargalo mudou duas vezes.** Não é mais "código na branch sem apply": **o apply acabou**. Todas as migrations de billing estão no ledger de produção. Existem lá as 9 tabelas, as RPCs, o cron do provision worker (a cada 2 minutos, ativo), os 5 segredos com prefixo `ASAAS_`, e 3 edge functions (`asaas-webhook`, `billing-payment-link`, `billing-provision-worker`).

**E nada nunca rodou.** Zero linhas em `payment_links`, `payment_link_charges`, `payment_webhook_events`, `payment_history` e `org_subscriptions`. `billing_override` ligado em **90 de 107** organizações — era 86 de 97.

**A causa, medida:** nenhuma edge function chama o gateway. `git grep "createCharge\|createSubscription\|ensureCustomer" -- supabase/functions` fora de `_shared/payments/` devolve **vazio**. A camada de pagamento está escrita, testada, e tem **zero consumidores**. Não é falta de tráfego — não existe caminho da Contratação até o Asaas. O próprio `billing-payment-link` documenta no cabeçalho: *"Não confundir com os endpoints que ainda não existem: status do pagamento, dados fiscais e a criação da cobrança."*

**Uma quinta dor, que o PRD de 04/08 não tinha:** existe uma **segunda porta, já construída pela metade, e ela vaza gente hoje**. A landing vende três planos com botão de assinar, o `/signup?plan=` lê o plano e **joga fora**, e o usuário cai no `/dashboard` sem organização nenhuma. Medido: **38 usuários sem organização ativa** — 19 nunca tiveram vínculo (vieram desse funil) e 19 tiveram vínculo desativado (ex-funcionários de clientes).

**Legado vivo e não revisado:** `checkout-provision-org` (v55) e `checkout-create-payment` (v54) estão **ACTIVE em produção desde 15/05/2026**, fora do desenho novo inteiro. O PRD de 04/08 chamava a primeira de "referência fantasma"; em produção ela existe e responde.

## Solution — duas portas, um trilho

O Torque vende por **duas portas**, e as duas terminam no mesmo trilho: cobra, recebe, provisiona, libera.

```
   PORTA 1 — SELF-SERVE                 PORTA 2 — LINK DO VENDEDOR
   (foco atual)                         (construído, falta ligar)

   cliente escolhe no site              Master monta o pacote
   cadastra                             gera link com token
   paga                                 manda pro cliente
        │                                    │
        └──────────► CONTRATAÇÃO ◄───────────┘
                        │
                        ▼
                 cobra no Asaas
                        ▼
                 cliente paga
                        ▼
                 webhook → fila → worker
                        ▼
                 organização + snapshot + acesso
```

**As duas portas se alimentam, não competem.** Os planos caros não são vendidos no automático: o botão deles agenda uma demo, e depois da demo o vendedor usa a Porta 2 pra fechar. O self-serve vende embaixo; o link fecha em cima.

## Vocabulário — termo novo, e por quê

**Contratação** entra no glossário do projeto (`CONTEXT.md`, seção Billing): *um pacote de venda do Torque congelado e precificado, esperando pagamento.* Nasce das duas origens e as duas viram a mesma linha em `payment_links`.

**Não usar "Pedido" nem "Cotação" neste domínio.** As duas já estão ocupadas no `CONTEXT.md` e descrevem o domínio **oposto** — dinheiro que o cliente final deve à Organização, não dinheiro que a Organização deve ao Torque. Um leitor novo vendo "pedido" vai abrir `orders` da Carteira. Também entraram no glossário: **Comprador**, **Snapshot da Assinatura**, **Provisionamento** e **Cota**.

## User Stories — a porta self-serve

**Cliente novo comprando sozinho**

51. Como visitante do site, quero ver o preço do plano básico e assinar sem falar com ninguém, para começar a usar hoje.
52. Como visitante interessado num plano caro, quero agendar uma demonstração escolhendo o horário na hora, para não depender de troca de e-mail.
53. Como cliente novo, quero me cadastrar e cair direto na tela de pagamento, para não ficar perdido num produto vazio que ainda não contratei.
54. Como cliente novo, quero escolher entre mensal, semestral e anual vendo o desconto de cada um, para decidir com o número na frente.
55. Como cliente novo, quero pagar no Pix com desconto ou parcelar no cartão, para escolher o que cabe no meu caixa.
56. Como cliente novo, quero ver a data da próxima cobrança **antes** de confirmar, para não ser surpreendido depois.
57. Como cliente novo, quero informar razão social, CNPJ e e-mail fiscal no checkout, para a cobrança sair no nome certo da empresa.
58. Como cliente novo, quero dar um nome à minha empresa dentro do Torque, já sugerido a partir da razão social, para não trabalhar num workspace chamado "LTDA ME".
59. Como cliente novo pagando no Pix, quero que a tela me avise sozinha quando o pagamento cair, para não ficar recarregando a página.
60. Como cliente novo, quero fechar a aba no meio do pagamento e voltar depois no mesmo lugar, para não recomeçar do zero.
61. Como cliente novo, quero que o preço que vi na terça continue valendo no sábado, para não tomar susto ao voltar.
62. Como cliente que se cadastrou e não pagou, quero cair na tela de pagamento a cada login, para saber exatamente o que falta.
63. Como cliente que pagou, quero receber o acesso e entrar com o plano já valendo, sem esperar ninguém liberar nada.

**Cliente já pagante — expansão e autonomia**

64. Como admin da organização, quero comprar um usuário a mais com um clique, usando o cartão que já cadastrei, para não abrir chamado por causa disso.
65. Como admin, quero comprar número de WhatsApp adicional, integração ou créditos de IA da mesma forma.
66. Como admin que pagou no Pix, quero cadastrar um cartão sem ser cobrado por isso, para poder usar compras rápidas depois.
67. Como admin, quero ver a bandeira e os últimos quatro dígitos do cartão salvo, e trocá-lo quando ele vencer.
68. Como admin, quero cancelar a assinatura sozinho, sem precisar pedir para ninguém.
69. Como admin que cancelou, quero continuar usando até o fim do período que já paguei.
70. Como admin, quero ser avisado 30, 15 e 3 dias antes do vencimento anual, no sistema e no WhatsApp, para conseguir aprovar a renovação internamente a tempo.
71. Como admin, quero renovar com um clique no cartão salvo, sem gerar Pix novo.
72. Como admin que pagou no Pix, **não** quero ser cobrado automaticamente no cartão — o cartão salvo serve para eu clicar, não para o sistema decidir por mim.

**Cobrança falhando**

73. Como admin com cartão recusado, quero ser avisado no sistema e no WhatsApp no mesmo dia, para resolver antes de perder acesso.
74. Como admin, quero que o sistema tente de novo assim que eu atualizar o cartão, sem esperar o dia seguinte.
75. Como admin, quero ter uma semana para resolver antes de qualquer trava.

**Casos que não podem dar errado**

76. Como ex-funcionário de um cliente, quero ver "você não tem acesso a nenhuma organização", e **nunca** uma tela de venda do Torque.
77. Como usuário de duas organizações, quero que uma bloqueada não afete a outra, e conseguir alternar entre elas.
78. Como admin de uma organização bloqueada, quero continuar vendo a organização na lista para conseguir pagar — bloqueado e sem porta de saída é pior que bloqueado.
79. Como pessoa que já tem conta, quero que o cadastro me mande fazer login em vez de dizer que o e-mail já existe — dizer isso entrega quem é cliente do Torque para quem estiver testando.

## Implementation Decisions — as 17 do desenho

Cada decisão tem número para que as fatias possam citá-la sem repetir a regra (e sem divergir dela depois).

| # | Decisão |
|---|---|
| **D1** | Duas portas, ambas de primeira classe. Foco imediato: self-serve. |
| **D2** | **Entrada é pagamento na porta. Sem trial.** Trial volta como fatia depois que a cobrança estiver provada. Motivo medido: existem 9 organizações em trial hoje que nunca expiram nem cobram — o relógio que um trial exige já foi tentado e não existe. |
| **D3** | **Self-serve vende 1 plano básico.** `torque-v8` e `torque-2.0` trocam "Assinar" por "Falar com vendas" → agendar demo. |
| **D4** | **O plano básico ainda NÃO existe.** Nome, preço e escopo são decisão comercial pendente (P1). O `torque-1.0` está descartado como candidato: tem `max_whatsapp_instances: 0` e `max_copilot_agents: 0` — o cliente pagaria R$594 e não teria o produto. |
| **D5** | **Ciclos e desconto, para TODOS os planos:** mensal = cartão, assinatura recorrente, sem desconto · semestral = Pix à vista **−15%** ou cartão até 12x preço cheio · anual = Pix à vista **−20%** ou cartão até 12x preço cheio. Pix não existe no mensal. Hoje o catálogo está em 10%/15% e o desconto está preso ao ciclo, não ao meio de pagamento. |
| **D6** | **Parcelado é preço cheio, sem desconto**, e recebemos parcelado, sem antecipação. Até 12x em qualquer ciclo, **inclusive semestral** — decidido com a consequência na mesa: num semestral em 12x o cliente termina de pagar 6 meses depois do serviço acabar. |
| **D7** | **Fluxo self-serve:** cadastra → checkout/paywall → paga → organização nasce → entra. **A organização só nasce com pagamento confirmado.** |
| **D8** | *(revisto no grill — ver G9)* Conta que se cadastrou e não pagou não vira organização: não consome instância de WhatsApp, não gera custo, não polui a base. |
| **D9** | **Um componente de checkout, dois invólucros.** Uma tela com os nove estados, montada no invólucro público (resolve por token) e no autenticado (resolve por sessão). |
| **D10** | **Gateway: Asaas.** Medido contra Stripe — ver abaixo. |
| **D11** | **Cartão salvo sempre, em qualquer ciclo.** Quem paga no cartão gera o token de graça na primeira cobrança. Quem paga no Pix cadastra um cartão na área de billing, tokenizado **sem cobrar**. |
| **D12** | **Addons com 1 clique** com o cartão salvo: assento, número de WhatsApp, créditos de IA, integração. Escrevem em `org_quotas.purchased_addons`. |
| **D13** | *(custo medido em G4: ~85 policies.)* **Régua de cobrança falha:** dia 0 avisa · dias 1 a 6 retenta 1x/dia **e na hora em que o cartão for atualizado** · dia 7 **trava a ESCRITA** até o pagamento ser aceito. Travar escrita, nunca o login. |
| **D14** | **Renovação do Pix:** avisa antes de vencer e oferece renovar com 1 clique no cartão salvo. **Nunca cobrar sozinho no cartão de quem escolheu Pix.** |
| **D15** | **Avisos em dois canais: dentro do sistema + WhatsApp**, por número oficial nosso (dedicado, em fase posterior). Template `utility`, custo medido R$0,0350/mensagem no Brasil. O telefone já é coletado no `/signup`. |
| **D16** | **Demo: Cal.com embutido** na própria página. O webhook de agendamento aponta para o `lead-webhook`, que já roda em produção — cada demo marcada vira lead na org da Milennials. |
| **D17** | **Preço na landing:** `torque-v8` vira **"sob consulta"** — é onde a venda é negociada de verdade (121 ajustes de feature em 9 organizações). `torque-2.0` mantém o preço visível, porque é mecânico: R$697 × assentos. |

## Implementation Decisions — as 11 do grilling

| # | Decisão |
|---|---|
| **G1** | **Vocabulário:** "Contratação", não "Pedido". Glossário atualizado em `CONTEXT.md`. |
| **G2** | **Cartão salvo mora em tabela dedicada** — `organization_id` + provider + `provider_customer_id` + token + bandeira + últimos 4 + padrão + quem cadastrou. **RLS deny-all**, no molde de `whatsapp_instance_secrets`. O navegador **nunca** vê o token, só bandeira e últimos 4. N cartões modelados, 1 padrão em uso, só admin mexe. Guardar token não é guardar cartão: o número nunca encosta no banco, então o armazenamento fica fora do escopo PCI. |
| **G3** | **Duas coletas com propósitos diferentes:** o cadastro coleta o documento da **pessoa** (identificação); o checkout coleta o **Comprador** (razão social, CNPJ, e-mail fiscal), que é o que vai ao gateway. **Trocar o documento fiscal invalida o cartão salvo** — documento novo é cliente novo no Asaas e o token não atravessa. A tela avisa na hora da troca. |
| **G4** | **A trava de escrita exige separar o choke em dois.** Hoje `get_my_organization_ids()` exclui a organização bloqueada e **235 policies** o consultam — 150 SELECT, 23 INSERT, 21 UPDATE, 18 DELETE e **23 `ALL`**. Bloquear só escrita significa um helper de leitura sem bloqueio e um de escrita com bloqueio, repontar ~85 policies e quebrar as 23 `ALL` em pares. Ordem importa: **repontar as escritas primeiro**, relaxar a leitura depois — inverter abre uma janela em que organização bloqueada escreve. |
| **G5** | **A automação PARA INTEIRA durante o bloqueio.** Nenhum workflow, campanha ou copilot roda. Aceito: lacuna no funil quando voltar, e silêncio para o cliente final. Hoje só o caminho de **envio** checa bloqueio (`send-governor/gate.ts`, `whatsapp-api-proxy`, `agent-message`); cada dispatcher de cron precisa passar a pular organização bloqueada. |
| **G6** | **O nome da organização é coletado no checkout**, pré-preenchido a partir da razão social e editável. Razão social é péssimo nome de exibição; campo vazio é pior. |
| **G7** | **Cancelamento é autosserviço.** Para de renovar, o acesso continua até o fim do período pago, o cartão salvo é removido, a organização é preservada. Tela de retenção fica para quando pausa e downgrade existirem — oferecer o que não existe é pior que não oferecer. |
| **G8** | **Sem devolução, por enquanto.** Decisão provisória. A exposição a contestação de cartão é risco aceito e está registrada como tal, não esquecida. |
| **G9** | **O bloqueio é da ORGANIZAÇÃO, não do usuário.** Uma pessoa pode ter uma organização ativa e outra bloqueada ao mesmo tempo, e alterna entre elas. **Revisa o D8:** "sem organização" e "organização bloqueada" são estados **diferentes** — o primeiro é primeira compra, o segundo é cobrança. Botão de "criar outra organização" fica para quando houver demanda (hoje: 1 usuário em 232 tem mais de uma, e é conta de operação). |
| **G10** | **A Contratação congela o preço por 7 dias**, e nasce quando o cliente **confirma ciclo e meio de pagamento** — não quando abre a tela. Vencer a proposta **não** mata a cobrança já emitida: são dois relógios, e a dívida tem prazo próprio no gateway. Renovar a oferta é um clique, não um recomeço. |
| **G11** | **Renovação do Pix avisa 30, 15 e 3 dias antes.** Trinta porque contrato anual de fábrica ou distribuidora passa por compras, financeiro e às vezes diretoria — sete dias não dá tempo de aprovar nada, e você perde cliente por processo, não por decisão. |

## Implementation Decisions — arquitetura

**A Contratação é sempre uma linha em `payment_links`, inclusive no self-serve.** A diferença entre as portas é só **como essa linha é lida**:

```
  PORTA PÚBLICA (Master)              PORTA AUTENTICADA (self-serve)
  autoriza por TOKEN                  autoriza por SESSÃO
  token_hash = sha256(t)              created_by = auth.uid()
  AND origin = 'master'               AND origin = 'self_serve'
                                      AND paid_at IS NULL
           │                                    │
           └────────────► link_id ◄─────────────┘
                            │
                            ▼
              a função que cria a cobrança (um só caminho daqui pra baixo)
              ensureCustomer → createCharge → payment_link_charges
                            │
                            ▼
              asaas-webhook → fila → worker → snapshot → acesso
```

**A invariante que fecha o risco do modo duplo de autorização:** um token **nunca** resolve linha de self-serve, e uma sessão **nunca** resolve linha de Master. Dois resolvedores cegos um para o território do outro, um só caminho compartilhado depois. Sem essa regra, alguém paga ou lê a Contratação de outra pessoa.

**Schema — o que muda:** `payment_links` ganha `origin` (`'master' | 'self_serve'`, `NOT NULL DEFAULT 'master'`) e um índice parcial em `created_by WHERE origin='self_serve' AND paid_at IS NULL`, que é a busca de "o checkout aberto deste cliente" e roda em todo login de conta não paga. `token_hash` continua `NOT NULL` — a linha de self-serve também ganha um token, que **nunca é devolvido a ninguém**. Mais a tabela nova de meios de pagamento (G2).

**O que NÃO muda:** `asaas-webhook`, `billing-provision-worker`, `org_subscriptions`, `org_quotas`. O self-serve entra num trilho que já existe.

**Motor de preço — três mudanças que D5 e D6 exigem:** o desconto passa a depender do **meio de pagamento**, não só do ciclo (hoje o cartão levaria o desconto do Pix, e o desconto existe justamente porque o Pix custa R$1,99 fixo contra 2,99% do cartão); o motor ganha a noção de **parcelamento** (só cartão, só semestral ou anual, no máximo 12x, sempre preço cheio); e os percentuais sobem de 10/15 para **15/20 em todos os planos** — efeito medido: `torque-v8` anual no Pix sai de R$20.369,40 para R$19.171,20, R$1.198,20 a mais de desconto por venda.

## Implementation Decisions — por que Asaas e não Stripe

Medido contra a documentação oficial dos dois em 2026-08-26.

```
                      ASAAS                 STRIPE BR
  Pix              R$ 1,99 FIXO          1,19% do valor (só por convite)
  Cartão           2,99% + R$ 0,49       3,99% + R$ 0,39
  Assinatura       incluso                + 0,70% do volume
  Parcelamento     até 21x                NÃO EXISTE NO BRASIL
```

**O fato que decide:** a documentação de parcelamento do Stripe cobre Mastercard Installments, México e Japão. **O Brasil não aparece.** O Stripe não parcela cartão brasileiro, e D6 depende de parcelar. Somado: o Pix do Stripe é *"apenas para convidados"* para empresa sediada no Brasil, e numa venda anual de `torque-v8` no Pix a taxa seria R$228,14 contra R$1,99 — **114x mais cara**, exatamente no meio de pagamento que D5 empurra o cliente a usar. No cartão, ~R$36 mil por ano a mais em 89 organizações.

**O que se perde:** Stripe Billing e Customer Portal entregariam prontos a proração, a área de billing e o dunning. É trabalho real que estaríamos comprando — e ainda assim não compensa.

**A decisão é barata de reverter:** `_shared/payments/port.ts` foi escrito para isso — *"adicionar um segundo gateway significa escrever outra implementação desta interface, não tocar num único chamador"*.

## Implementation Decisions — cartão salvo e addons

O `creditCardToken` **volta na resposta da primeira cobrança aprovada** — não é passo extra. Literal da doc: *"Nas próximas cobranças do mesmo cliente, envie o token no lugar dos objetos `creditCard` e `creditCardHolderInfo`"* e *"o token pertence ao cliente para o qual foi criado e não pode ser utilizado em cobranças de outro cliente"*.

**Assinatura mensal e compra com 1 clique são a mesma peça, não duas.** E o encanamento do addon já existe: `org_quotas.purchased_addons` é onde o assento comprado cai, e o preço do assento extra já está no catálogo (R$120 no `torque-v8`, R$297 no `torque-1.0`, R$697 no `torque-2.0`).

**Duas restrições que o desenho respeita:** toda cobrança com token exige `remoteIp` — *"o IP do dispositivo do pagador, não o IP do servidor"* — logo a compra de 1 clique tem que partir do navegador do cliente; cobrança automática sem ninguém na tela não passa por esse caminho. E **cartão vencido é buraco não coberto pela documentação**: existe endpoint para trocar o cartão de uma assinatura, mas para o token avulso a doc é silenciosa.

## Testing Decisions — quatro costuras, três já existentes

**1. A função de preço no banco, via pgTAP.** É onde o dinheiro é decidido e já existe com 39+ asserções. Cobre a cascata, o desconto por meio de pagamento, o parcelamento, a recusa de combinação inválida, e o override anual que hoje cobra 12x. *Reuso.*

**2. O `PaymentProvider` como dublê.** Toda função que fala com o gateway recebe o provider por parâmetro; o teste injeta um falso. Cobre: **uma cobrança por (Contratação, método), reaproveitada** — pedir duas vezes devolve a mesma, que é a regra que impede cobrar o cliente por recarregar a página; idempotência do webhook; e o token sendo guardado. *Reuso.*

**3. As policies, exercidas como papel `authenticated`.** Obrigatória por causa de G4: separar leitura de escrita em ~85 policies só se prova rodando como usuário de verdade. Rodar como `postgres` bypassa RLS e produz **verde falso**. O par a provar é ler-sim/escrever-não, em cada tabela tocada.

**4. Um caminho de ponta a ponta, no Playwright.** Landing → cadastro → checkout → pago → dentro do produto, com o Asaas em sandbox. **Um só caminho, o feliz.** Os nove estados da tela ficam nas costuras 1 a 3, que são baratas; e2e é caro e frágil demais para cobrir desvio.

**Nenhuma costura nova no front.** Os nove estados são renderização — quem decide o estado é o servidor.

**Restrição de ambiente que muda o planejamento:** Docker e Supabase local estão banidos neste projeto. As costuras 1 e 3 exigem **branch do Supabase**, que é projeto separado e cobra por hora. As fatias precisam ser agrupadas para usar a branch em blocos, não uma por tarefa.

**O único teste que prova tudo é um pagamento real em sandbox.** Todo o resto é a máquina sem carga.

## O que esta atualização revoga do texto de 04/08

- **"Self-service completo com página pública de preços" sai de Out of Scope.** Vira a Porta 1 e é o foco imediato. Era a exclusão que fazia o PRD descrever metade do produto — e a metade excluída já existe construída pela metade e vazando gente.
- **"Cancelamento" sai de Out of Scope** e entra como G7. **"Reembolso e chargeback" continuam fora**, agora por decisão explícita (G8), não por névoa.
- **"Trial dentro do link" continua fora**, agora por decisão (D2), com o motivo medido.
- **`billing_override` em 86 de 97** passa a ser **90 de 107**.
- **A premissa de escopo PCI de #1394 caiu na medição:** não existe "componente hospedado do Asaas" embutível. A documentação lista três caminhos para cartão e nenhum é iframe ou SDK — redirecionar para a `invoiceUrl`, mandar o PAN pela API do nosso servidor, ou reusar `creditCardToken`. A perna do cartão é **redirect**, não componente.
- **A ordem de ataque sugerida está vencida.** #1386 e #1394 estão resolvidos ou revistos; o caminho crítico agora é outro (ver abaixo).

## Benchmark de mercado — fonte primária, 2026-08-26

Dossiê completo em `.specs/pesquisa/precos-mercado-e-custo-insumo.md`.

**O corte do self-serve não é um preço, é o formato do plano.** Quem vende por assento corta cedo; quem vende por conta não corta.

```
  DataCrazy    NÃO CORTA — os 4 tiers, até R$ 2.997/mês, vão pro /register
  Pipedrive    NÃO CORTA — os 4 planos, até US$ 89/licença, são autocompra
  HubSpot      corta em US$ 150/assento — Enterprise só "Falar com Vendas"
  Kommo        corta acima do Pro (R$ 232/user) — Empresarial "Sob medida"
  RD Station   corta acima do Pro (R$ 131/user) — Advanced "sob consulta"
  Agendor      corta em R$ 156/user com mínimo 10 users (~R$ 1.560/mês)
  Ploomes      INVERSO — publica só o Básico; os 8 módulos são "sob consulta"
```

**Entrada praticada no Brasil:** R$59–85 por assento, ou **R$297/mês flat** (DataCrazy Starter — 4 membros, 3 conexões, 5 mil leads). O Torque vende flat, então a referência é o R$297.

**Trial:** Kommo 14d, Pipedrive 14d, Agendor 7d, Ploomes 14d — **nenhum pede cartão**. Plano gratuito permanente em 3 dos 7.

**Custo de insumo não é restrição de preço:** WhatsApp utility no Brasil **R$0,0350/mensagem** (rate card oficial da Meta, vigente 01/07/2026), instância Uazapi de R$0,65 a R$19,00/mês, gpt-4.1-mini US$0,40 / US$1,60 por 1M tokens.

**Nota honesta:** os dois concorrentes mais próximos do Torque — DataCrazy (mesmo ICP de WhatsApp) e Pipedrive — **não cortam o self-serve em lugar nenhum**. D3 corta mais cedo que o mercado inteiro. É decisão deliberada, para alimentar o time comercial em vez de competir com ele.

## Pendências

| # | O que | Quem destrava |
|---|---|---|
| **P1** | **O plano básico: nome, preço e escopo.** Sem isso o self-serve não tem o que vender. É o **único bloqueio de verdade** — todo o resto pode ser planejado e construído sem ele. Dossiê de mercado já entregue. | CTO |
| **P2** | Seletor de assentos no plano básico: assentos fixos ou o cliente escolhe? Depende de P1. | CTO |
| **P3** | **Habilitar tokenização em produção no Asaas.** Sujeita a análise e **pode ser negada**. Sem ela não há assinatura recorrente **nem** addon com 1 clique. Prazo de terceiro. | gerente de contas Asaas |
| **P4** | Taxa real do parcelado. O blog do Asaas fala em 1,99% adicional; a página de preços não confirma. Numa venda anual de R$23.964 são R$477. | gerente de contas Asaas |
| **P5** | Uma parcela pode falhar depois da primeira? Como se atualiza um cartão vencido no token avulso? Como funciona estorno de parcelado? | gerente de contas Asaas |
| **P6** | PII em texto claro no log do Postgres. `log_min_error_statement = error` é default e grava a instrução inteira quando ela falha; o checkout recebe nome, CPF e e-mail. Medir os GUCs, a retenção e se há drain em produção. | engenharia |

**P3, P4 e P5 vão no mesmo e-mail** e não dependem de mais nenhuma decisão.

## Bloqueios técnicos

| # | O que | Espelho no Jira |
|---|---|---|
| **B1** | Desconto manual anual cobra **12x** a mais, sem erro. Mesma função que o self-serve vai usar. | SCRUM-446 |
| **B2** | `purchased_addons` zerado em todas as linhas. **Bloqueia D12 diretamente** — o cliente compraria um assento, seria cobrado, e não receberia. | SCRUM-447 |
| **B3** | A criação de cobrança no gateway não existe. É o que mantém tudo inerte. | SCRUM-444 |
| **B4** | `billing-quote` e `billing-payment-status` não estão deployadas. A tela do Master está quebrada em produção hoje. | SCRUM-445 |
| **B5** | Perna do cartão: redirect para `invoiceUrl` (PCI fora) vs formulário próprio (PCI dentro). **Ficou mais crítico com D11:** sob redirect **não está confirmado que o `creditCardToken` chega até nós** — e sem ele não há cartão salvo nem addon. Medir com um pagamento de cartão em sandbox e `GET /payments/{id}`. | SCRUM-452 |

## Quatro achados que viram trabalho, não decisão

1. **Os 38 usuários sem organização ativa são dois grupos.** 19 nunca tiveram vínculo (funil quebrado) → checkout. 19 tiveram vínculo desativado (ex-funcionário de cliente) → "sem acesso, fale com o administrador". **Nunca tela de venda para o segundo grupo.** O que distingue é simplesmente existir uma linha em `team_members`, ativa ou não.
2. **`billing_provision_new_org` amarra o dono pelo `p_buyer_email`.** O self-serve tem que passar o e-mail do **usuário logado**, não o fiscal — senão o admin da organização vira o financeiro que nunca se cadastrou.
3. **O switcher de organização precisa continuar listando a organização bloqueada.** Se filtrar pelo helper que exclui bloqueadas, a organização some da lista e o cliente fica bloqueado e sem porta para pagar. Vira asserção de teste, não suposição.
4. **Cada dispatcher de cron precisa pular organização bloqueada.** Hoje só o caminho de envio faz isso — `send-governor/gate.ts`, `whatsapp-api-proxy` e `agent-message`. `campaign-rule-dispatch` e `outbound-trigger` não checam.

## Further Notes — 2026-08-26

**O que mudou na leitura do esforço.** Por três semanas a explicação foi "falta o apply". O apply aconteceu e o dinheiro continuou não entrando, porque o buraco era outro e ninguém tinha medido os call sites da camada de pagamento. A lição vale para o resto: medir consumidor, não só existência.

**Caminho crítico:** B5 (perna do cartão) → B3 (criar a cobrança) → Fatia 8 (página pública) → pagamento de teste em sandbox. B1, B2 e B4 andam em paralelo e não dependem de nada.

**Legado a aposentar:** `checkout-provision-org` e `checkout-create-payment`, ativas em produção desde 15/05/2026 e fora do desenho novo. Medir se são chamadas antes de remover.

**Higiene no espelho do Jira:** SCRUM-279 e SCRUM-281 estão "A fazer" com o trabalho feito e mergeado.

---

## MAPA DAS TAREFAS NO JIRA — 2026-08-26

A quebra virou **5 tarefas** (uma por onda) com **25 subtarefas**, para o quadro da sprint não afogar as outras frentes. Subtarefa não recebe sprint no Jira — herda a da mãe —, então o board conta os pontos só pela tarefa-mãe.

**114 pontos. Marcelo 62 · Lucas 50 · CTO 2.** O corte é por risco: Marcelo pega o que quebra dinheiro ou isolamento; Lucas pega o que tem contorno claro e verificação óbvia.

```
SCRUM-486  Destravar o checkout em produção                          14 pts
           491  deploy de billing-quote e billing-payment-status      1  Lucas
           492  #1559 override anual cobra 12×                        3  Marcelo
           493  #1564 assento comprado vira cota                      5  Marcelo
           494  medir a perna do cartão e decidir A1/A2               2  Lucas
           495  aposentar checkout-provision-org/create-payment       3  Lucas

SCRUM-487  A primeira cobrança chega ao Asaas                        18 pts
           496  motor de preço: desconto por método, parcelado, 15/20 5  Marcelo
           497  criar a cobrança — perna Pix                          8  Marcelo
           498  criar a cobrança — perna cartão                       5  Marcelo

SCRUM-488  O cliente compra sozinho no site                          32 pts
           499  o plano básico existe no catálogo                     2  CTO
           500  landing: 1 comprável, 2 falar-com-vendas              3  Lucas
           501  Cal.com embutido, demo vira lead no Torque            3  Lucas
           502  cadastro carrega o plano e cria a Contratação         3  Lucas
           503  paywall por ORGANIZAÇÃO, três casos                   5  Lucas
           504  página pública de checkout, nove estados              8  Lucas
           505  dados fiscais do Comprador e nome da organização      5  Marcelo
           506  pagamento de teste em sandbox, ponta a ponta          3  Marcelo

SCRUM-489  Cartão salvo                                              26 pts
           507  org_payment_methods com RLS deny-all                  5  Marcelo
           508  addon 1 clique — cobrança e cota (servidor)           2  Marcelo
           509  addon 1 clique — a tela de comprar (front)            3  Lucas
           510  renovação automática, avisos 30/15/3                  8  Marcelo
           511  área de billing — cancelar e trocar cartão (servidor) 3  Marcelo
           512  área de billing — desenho e tela                      5  Lucas

SCRUM-490  Inadimplência passa a ter consequência                    24 pts
           513  EXPAND — helper de escrita ao lado do de leitura      2  Marcelo
           514  MIGRAR — repontar ~85 policies, em lotes              8  Lucas
           515  CONTRACT — relaxar o helper de leitura                3  Marcelo
           516  dispatchers de cron pulam org bloqueada               3  Lucas
           517  régua de 7 dias — estado, retentativa, worker         5  Marcelo
           518  avisos — faixa no app e template de WhatsApp          3  Lucas

CAMINHO CRÍTICO   486 → 487 → 488 → 489 → 490   (ligados por Blocks no Jira)
```

**As chaves antigas foram fechadas** e carregam `[SUBSTITUÍDA POR SCRUM-xxx]` no título, então quem chegar por um link velho encontra o novo. As referências B1–B5 acima citam as chaves antigas de propósito — elas apontam para as novas.

**O que equilibrou a carga foi a 514.** Migrar ~85 policies é o maior bloco mecânico do épico. Dar tudo ao pleno por medo de vazamento seria medo mal colocado: o expand-contract existe justamente para tornar isso seguro — o padrão e o teste saem da 513 (Marcelo), a repetição é a 514 (Lucas) com o helper antigo ainda vivo, e a remoção é a 515 (Marcelo).
