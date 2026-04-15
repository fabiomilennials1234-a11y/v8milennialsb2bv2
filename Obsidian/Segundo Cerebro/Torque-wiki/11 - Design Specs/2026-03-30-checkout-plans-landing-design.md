---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/specs/2026-03-30-checkout-plans-landing-design.md
---

# Torque - Planos, Checkout Self-Service e Landing Page

**Data:** 2026-03-30
**Status:** Aprovado
**Escopo:** Definição de planos, landing page pública, fluxo de signup/checkout, integração Asaas, provisioning de organizaçoes

---

## 1. Estrutura de Planos e Pricing

### 1.1 Planos

| | **Torque 1.0** | **Torque 2.0 (Remap)** | **Torque V8 (Remap + Turbo)** |
|---|---|---|---|
| Slug | `torque-1.0` | `torque-2.0` | `torque-v8` |
| Modelo | Por usuário | Por usuário | Pacote fixo |
| Preço/mês | R$ 297/usuário | R$ 697/usuário | R$ 1.997 fixo |
| Mín. usuários | 2 | 3 | 3 (inclusos) |
| Usuários inclusos | 0 (paga por cada) | 0 (paga por cada) | 3 |
| Copilots inclusos | 0 | 0 | 1 |
| Usuário extra | R$ 297 | R$ 697 | R$ 120 |
| Custo mínimo/mês | R$ 594 | R$ 2.091 | R$ 1.997 |

### 1.2 Ciclos de cobrança

| Ciclo | Desconto | Exemplo (V8 base) |
|---|---|---|
| Mensal | - | R$ 1.997/mês |
| Semestral | 10% | R$ 1.797,30/mês (R$ 10.783,80 total) |
| Anual | 15% | R$ 1.697,45/mês (R$ 20.369,40 total) |

Descontos de ciclo aplicam-se ao valor total (plano + extras + add-ons).

### 1.3 Add-on Turbo

- **Preço:** R$ 1.427/mês por copiloto
- **Disponível para:** planos 1.0 e 2.0
- **Desbloqueia:** Copilot (agentes IA) + Oráculo Comercial
- Descontos de ciclo aplicam ao add-on

### 1.4 Descontos

- **Cupom "Cliente Milennials":** 35% sobre o valor do plano. Código aplicado manualmente pelo vendedor.
- **Volume 10+ usuários:** 35% automático no preço por usuário. Para planos 1.0 e 2.0 (todos per-user), aplica sobre o preço unitário. Para V8, aplica sobre o `extra_user_price` dos usuários além dos 3 inclusos. Calculado pelo sistema quando `user_count >= 10`.

### 1.5 Feature map por plano

| Feature | 1.0 | 2.0 | V8 |
|---|---|---|---|
| Métricas/Dashboard | ok | ok | ok |
| Funis (exceto Carteira) | ok | ok | ok |
| Pódio/Ranking/Performance | ok | ok | ok |
| Metas | ok | ok | ok |
| Leads | ok | ok | ok |
| Produtos | ok | ok | ok |
| **Chat WhatsApp** | - | ok | ok |
| **Gestão de Carteira** | - | ok | ok |
| **Mensagens Agendadas** | - | ok | ok |
| **Automaçoes de fluxo** | - | ok | ok |
| **Disparo em massa** | - | ok | ok |
| **Copilot (agentes IA)** | - | - | ok |
| **Oráculo Comercial** | - | - | ok |

> Add-on Turbo desbloqueia apenas Copilot + Oráculo para planos 1.0 e 2.0.

---

## 2. Rotas e Fluxo de Navegação

### 2.1 Estrutura de rotas

```
/                 → Landing page (convertida do mockup)
/pricing          → Âncora #pricing na landing (scroll automático)
/login            → Login existente
/signup           → Cadastro rápido (cria user pending_payment, sem org)
/checkout         → Wizard de contratação (3 steps, requer auth)
/checkout/success → Confirmação pós-pagamento
/dashboard        → App privado (como hoje)
```

### 2.2 Fluxos de entrada

| Origem | Fluxo |
|---|---|
| Visitante clica "Começar agora" na landing | `/signup` → `/checkout` |
| Visitante clica "Criar conta" na navbar | `/signup` → `/checkout` |
| Visitante clica "Contratar" num card de pricing | `/signup?plan=torque-v8` → `/checkout` (plano pré-selecionado) |
| Usuário `pending_payment` faz login | Redirect automático pro `/checkout` |
| Usuário ativo faz login | Dashboard normal |

### 2.3 Página `/signup`

Formulário simples:
- Nome completo, email, telefone, CPF/CNPJ, senha
- Cria usuário no Supabase Auth com metadata `{ subscription_status: 'pending_payment' }`
- **Não cria org, não cria team_member**
- Após cadastro → redirect pro `/checkout`
- Contas `pending_payment` ficam indefinidamente (sem cron de limpeza)

### 2.4 Wizard `/checkout` (3 steps)

Usuário já autenticado.

**Step 1 - Plano + configuração**
- Cards dos 3 planos com toggle mensal/semestral/anual
- Seletor de quantidade de usuários (respeitando mínimos por plano)
- Toggle Turbo add-on com seletor de quantidade de copilots (planos 1.0 e 2.0)
- Campo de cupom de desconto
- Desconto volume 10+ calculado automaticamente
- Resumo do valor atualizado em tempo real

**Step 2 - Organização + equipe**
- Nome da empresa
- Nomes/emails dos usuários adicionais (quantidade selecionada no step 1)

**Step 3 - Pagamento**
- Duas opçoes: Cartão de crédito ou PIX
- **Cartão:** formulário tokenizado via Asaas.js (dados nunca tocam nosso servidor)
- **PIX:** QR code + código copia-e-cola gerado via API Asaas, com polling de status
- Ao confirmar pagamento:
  1. Edge function cria org, vincula plano, cria team_members
  2. Envia emails de boas-vindas com links de ativação para usuários adicionais
  3. Redirect → `/checkout/success` → auto-login → dashboard

---

## 3. Landing Page

### 3.1 Conversão do mockup

O HTML estático em `/Volumes/Untitled/torque-landing-mockup/index.html` será convertido para componentes React.

### 3.2 Componentes

- `src/pages/Landing.tsx` - página principal pública
- `src/components/landing/LandingNavbar.tsx` - navbar com Login, Criar conta, Demonstração
- `src/components/landing/HeroSection.tsx` - hero com badge, headline, CTAs
- `src/components/landing/LogosMarquee.tsx` - social proof carousel
- `src/components/landing/FeatureShowcase.tsx` - seçoes de features
- `src/components/landing/SegmentsGrid.tsx` - segmentos atendidos
- `src/components/landing/TestimonialsGrid.tsx` - depoimentos
- `src/components/landing/PricingSection.tsx` - cards de planos + tabela comparativa + add-ons
- `src/components/landing/FAQAccordion.tsx` - perguntas frequentes
- `src/components/landing/CTAFinal.tsx` - CTA de fechamento
- `src/components/landing/LandingFooter.tsx` - footer

### 3.3 Design system

- Mantém a palette do mockup (`--orange: #E8922A`, `--grad`, `--brown: #3D2B2B`) via CSS variables
- Usa `framer-motion` (já no projeto) para animaçoes reveal
- Responsivo (preserva breakpoints do mockup)

### 3.4 Pricing section

Substituir os planos placeholder do mockup pelos planos reais (1.0, 2.0, V8):
- Toggle mensal/semestral/anual (3 opçoes)
- Cards com calculadora de usuários inline
- Tabela comparativa com feature map correto
- Add-on Turbo separado
- CTA "Contratar" → `/signup?plan=<slug>`

### 3.5 Navbar

```
[Logo Torque]   Recursos ▾   Planos e Preços   Sobre nós     [Login]  [Criar conta]  [Demonstração →]
```

---

## 4. Integração Asaas

### 4.1 Edge functions

| Function | Responsabilidade |
|---|---|
| `checkout-create-payment` | Recebe configuração de plano. Valida pricing no backend. Cria customer + cobrança no Asaas. Retorna QR code PIX ou status de cartão. |
| `checkout-provision-org` | Chamada internamente após pagamento confirmado. Cria org, team_members, vincula plano, atualiza status → active. Transacional. |
| `asaas-webhook` | Recebe webhooks do Asaas. Valida autenticidade. Gerencia ciclo de vida da subscription. |

### 4.2 Segurança do pricing

```
1. Frontend envia: { plan_slug, billing_cycle, user_count, turbo_count, coupon_code }
2. Backend busca preços reais da tabela subscription_plans
3. Backend calcula: base + extras + add-ons - descontos
4. Backend valida: mínimo de usuários, cupom válido, desconto volume
5. Backend cria cobrança no Asaas com o valor calculado
6. Frontend NUNCA envia valor - só a configuração
```

### 4.3 Fluxo PIX

```
Frontend → checkout-create-payment → Asaas API (cria cobrança PIX)
                                   ← { qr_code, qr_code_url, payment_id }
Frontend renderiza QR code + copia-e-cola
Frontend faz polling no status a cada 5s
Asaas confirma → asaas-webhook → checkout-provision-org
Frontend detecta confirmação → redirect /checkout/success
```

### 4.4 Fluxo Cartão

```
Frontend → tokeniza cartão via Asaas.js (dados nunca no nosso server)
Frontend → checkout-create-payment { ..., card_token }
Backend → Asaas API (cria assinatura recorrente com token)
         ← { subscription_id, status }
Se ACTIVE → checkout-provision-org imediato
Frontend → redirect /checkout/success
```

### 4.5 Ciclo de vida da subscription

| Evento Asaas | Ação no Torque |
|---|---|
| `PAYMENT_CONFIRMED` | Se primeiro: provisiona org. Se recorrência: mantém ativo. |
| `PAYMENT_OVERDUE` | `subscription_status → overdue`. Notifica admin da org. |
| `PAYMENT_DELETED` / `PAYMENT_REFUNDED` | `subscription_status → suspended`. Bloqueia acesso após grace period de 3 dias. |
| `SUBSCRIPTION_DELETED` | `subscription_status → cancelled`. |

---

## 5. Banco de Dados

### 5.1 Tabela `subscription_plans` - novas colunas

```sql
price_per_user_monthly  NUMERIC     -- preço por usuário (1.0 e 2.0)
base_price_monthly      NUMERIC     -- preço fixo do pacote (V8)
min_users               INTEGER     -- mínimo de usuários exigidos
included_users          INTEGER     -- usuários inclusos no base (V8 = 3)
included_copilots       INTEGER     -- copilots inclusos (V8 = 1)
extra_user_price        NUMERIC     -- preço por usuário extra (V8 = 120)
discount_semester_pct   NUMERIC     -- 10
discount_annual_pct     NUMERIC     -- 15
discount_volume_pct     NUMERIC     -- 35 (10+ users)
discount_volume_min     INTEGER     -- 10 (threshold)
```

Colunas `price_monthly` e `price_yearly` existentes ficam deprecated.

Planos antigos (free/starter/pro/enterprise) são desativados (`is_active = false`).

### 5.2 Nova tabela `plan_addons`

```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
slug                TEXT UNIQUE       -- 'turbo'
display_name        TEXT              -- 'Turbo (Copilot IA)'
price_monthly       NUMERIC           -- 1427
unit_label          TEXT              -- 'por copiloto'
applicable_plans    TEXT[]            -- {'torque-1.0', 'torque-2.0'}
features_unlocked   TEXT[]            -- {'copilot', 'oraculo'}
is_active           BOOLEAN DEFAULT true
created_at          TIMESTAMPTZ DEFAULT now()
```

### 5.3 Nova tabela `coupons`

```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
code                TEXT UNIQUE       -- 'MILENNIALS35'
discount_pct        NUMERIC           -- 35
applies_to          TEXT[]            -- {'torque-1.0', 'torque-2.0', 'torque-v8'} ou NULL = todos
max_uses            INTEGER           -- NULL = ilimitado
current_uses        INTEGER DEFAULT 0
valid_from          TIMESTAMPTZ DEFAULT now()
valid_until         TIMESTAMPTZ       -- NULL = sem expiração
is_active           BOOLEAN DEFAULT true
created_by          UUID
created_at          TIMESTAMPTZ DEFAULT now()
```

### 5.4 Nova tabela `payment_history`

```sql
id                      UUID PRIMARY KEY DEFAULT gen_random_uuid()
organization_id         UUID REFERENCES organizations(id) ON DELETE CASCADE
asaas_payment_id        TEXT UNIQUE
asaas_subscription_id   TEXT
amount                  NUMERIC
discount_applied        NUMERIC DEFAULT 0
coupon_id               UUID REFERENCES coupons(id)
billing_cycle           TEXT CHECK (billing_cycle IN ('monthly', 'semester', 'annual'))
status                  TEXT CHECK (status IN ('pending', 'confirmed', 'overdue', 'refunded'))
paid_at                 TIMESTAMPTZ
created_at              TIMESTAMPTZ DEFAULT now()
```

### 5.5 Nova tabela `org_subscriptions`

```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
organization_id     UUID REFERENCES organizations(id) ON DELETE CASCADE UNIQUE
plan_id             UUID REFERENCES subscription_plans(id)
billing_cycle       TEXT CHECK (billing_cycle IN ('monthly', 'semester', 'annual'))
user_count          INTEGER
addon_turbo_count   INTEGER DEFAULT 0
coupon_id           UUID REFERENCES coupons(id)
base_amount         NUMERIC           -- valor calculado sem desconto
discount_amount     NUMERIC           -- total de descontos
final_amount        NUMERIC           -- valor cobrado
started_at          TIMESTAMPTZ
renews_at           TIMESTAMPTZ
cancelled_at        TIMESTAMPTZ
created_at          TIMESTAMPTZ DEFAULT now()
updated_at          TIMESTAMPTZ DEFAULT now()
```

### 5.6 Campos existentes em `organizations` (mantidos e usados)

- `subscription_status` - atualizado pelo webhook
- `payment_customer_id` - Asaas customer ID
- `payment_subscription_id` - Asaas subscription ID
- `plan_id` - FK pra `subscription_plans`

---

## 6. Segurança

### 6.1 Princípios

1. **Zero trust no frontend** - toda validação de preço, cupom, limite e provisioning no backend.
2. **Dados de cartão nunca no nosso server** - tokenização direta Asaas.js → Asaas API.
3. **Webhook autenticado** - valida `asaas-access-token` header contra secret nas env vars.

### 6.2 Proteção por camada

| Camada | Proteção |
|---|---|
| Rotas públicas (`/`, `/signup`, `/login`) | Sem auth. Rate limiting IP-based. |
| Rota `/checkout` | Requer autenticação Supabase Auth. Redirect pra `/signup` se não logado. |
| `checkout-create-payment` | Valida JWT. Recalcula pricing no backend. Nunca confia em valor do frontend. |
| `asaas-webhook` | Valida access token. Idempotente (payment_id UNIQUE). Usa `service_role`. |
| `checkout-provision-org` | Só chamada internamente (webhook ou create-payment). Nunca exposta. Transacional. |
| Tabela `coupons` | RLS: master pode CRUD. SELECT público limitado a validação. |
| Tabelas `payment_history`, `org_subscriptions` | RLS: membros da org veem os seus. Escrita só via `service_role`. |

### 6.3 Proteção contra fraude

- **Replay prevention:** `asaas_payment_id` UNIQUE em `payment_history`. Webhook idempotente.
- **Privilege escalation:** features vêm do `plan_id` no banco, não do frontend.
- **Cupom abuse:** validado no backend (exists + active + dates + applies_to + max_uses). Incremento atômico de `current_uses`.
- **User count manipulation:** `org_check_limit` compara team_members com `user_count` da subscription.

### 6.4 Rate limiting

- `/signup`: 5 contas por IP por hora
- `checkout-create-payment`: 10 tentativas por usuário por hora
- `asaas-webhook`: sem rate limit (IP allowlist do Asaas)

---

## 7. Arquitetura Geral

```
┌─────────────────────────────────────────────────────────┐
│                    ROTAS PÚBLICAS                         │
│  /  (Landing)  →  /signup  →  /checkout  →  /success     │
└──────────┬──────────┬──────────────┬─────────────────────┘
           │          │              │
           │    Supabase Auth   ┌────┴─────┐
           │    (cria user      │ checkout- │
           │     pending)       │ create-   │──→ Asaas API
           │                    │ payment   │    (customer +
           │                    └────┬──────┘     cobrança)
           │                         │
           │              ┌──────────┴──────────┐
           │              │                     │
           │         PIX (polling)        Cartão (token)
           │              │                     │
           │              ▼                     ▼
           │     ┌─────────────────┐   Pagamento imediato
           │     │  asaas-webhook  │◄── Asaas callback
           │     └────────┬────────┘
           │              │
           │     ┌────────┴────────┐
           │     │ checkout-       │
           │     │ provision-org   │
           │     │                 │
           │     │ • Cria org      │
           │     │ • Vincula plano │
           │     │ • Cria members  │
           │     │ • Status→active │
           │     └────────┬────────┘
           │              │
           ▼              ▼
┌─────────────────────────────────────────────────────────┐
│                     APP PRIVADO                          │
│  /dashboard  - feature flags + limits enforcement        │
│  OrgFeaturesContext → has_feature() / org_check_limit()  │
└─────────────────────────────────────────────────────────┘
```

### 7.1 Arquivos novos

| Categoria | Arquivos |
|---|---|
| **Landing page** | `src/pages/Landing.tsx` + ~10 componentes em `src/components/landing/` |
| **Signup** | `src/pages/Signup.tsx` |
| **Checkout** | `src/pages/Checkout.tsx` + ~5 componentes em `src/components/checkout/` (PlanSelector, OrgSetup, PaymentStep, CheckoutSummary, PixQRCode) |
| **Edge functions** | `supabase/functions/checkout-create-payment/`, `supabase/functions/checkout-provision-org/`, `supabase/functions/asaas-webhook/` |
| **Migrations** | 1 migration: atualiza `subscription_plans`, cria `plan_addons`, `coupons`, `payment_history`, `org_subscriptions` |
| **Hooks** | `src/hooks/useCheckout.ts`, `src/hooks/useAsaasPayment.ts`, `src/hooks/useCouponValidation.ts` |

### 7.2 O que NÃO muda

- `OrgFeaturesContext` - continua funcionando, lê de `plan_id`
- `has_feature()` / `org_check_limit()` RPCs - sem alteração
- `feature-registry.ts` - features existentes mantidas, só atualizar feature map dos novos planos
- Toda a área logada do app - zero impacto
- Master admin - continua podendo override de plano e features


## Links relacionados

- [[MOC - Arquitetura]]

- [[Chat WhatsApp]]

- [[Produtos]]

- [[Checkout e Planos]]

- [[Master Admin]]

- [[Metas]]

- [[Gestao de Time]]

- [[Mensagens Agendadas]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Ranking]]

- [[Oraculo Comercial]]

- [[Asaas Pagamentos]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
