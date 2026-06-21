# Meta Dashboard — Passo a Passo (CTO)

Configurar WhatsApp Business Cloud API no app Meta **existente** (Track A — o mesmo que já faz Ads/leadgen).
Labels da UI Meta mudam com frequência — se um nome não bater, procure o intent equivalente.

Pré: estar logado em https://developers.facebook.com com a conta que administra o app Track A,
e ser admin do Meta Business Manager (business.facebook.com) da Torque.

---

## 0. Abrir o app

1. https://developers.facebook.com/apps
2. Selecionar o app Track A (o que tem o `META_APP_ID` atual — o de Ads/leadgen).
3. Confirmar tipo do app = **Business**. Se for outro tipo, Embedded Signup não aparece (raro — Ads já exige Business).

---

## 1. Business Verification (provavelmente já feito)

1. business.facebook.com → Configurações do Negócio (Business Settings) → Centro de Segurança / Security Center.
2. Conferir status **Verificado (Verified)**. Se já roda Ads pago, costuma estar.
3. Se "Não verificado": iniciar verificação (documento da empresa: CNPJ/comprovante). **Leva dias.** É pré-req de Advanced Access.

---

## 2. Adicionar o produto WhatsApp ao app

1. No app (passo 0) → menu esquerdo → **Add Product / Adicionar Produto**.
2. Card **WhatsApp** → **Set up / Configurar**.
3. Vai pedir pra associar o app a um **Meta Business Account** → escolher o Business da Torque.
4. Aparece a seção **WhatsApp** no menu esquerdo, com: Quickstart, API Setup, Configuration.

> Nota: o "número de teste" que a Meta dá no Quickstart é descartável. Em produção os números
> reais entram **por org** via Embedded Signup (passo 3 + fluxo no app Torque). Não precisa conectar
> nenhum número aqui manualmente.

---

## 3. Embedded Signup — criar configuração e pegar o `config_id`

Embedded Signup é o popup que o frontend Torque abre (`FB.login({config_id})`) pro cliente conectar o
WhatsApp dele sozinho. Exige o app com postura de **Tech Provider / Solution Partner**.

1. WhatsApp → **Configuration / Embedded Signup** (em apps mais novos: "Customize your Embedded Signup flow"
   ou aba **Embedded Signup** dentro de Configuration).
2. Se não existir a seção: WhatsApp → **API Setup** → procurar "Embedded Signup" / "Tech Provider". Pode exigir
   marcar o app como Tech Provider primeiro (Business Settings → Accounts → Apps → o app → habilitar funções de
   Tech Provider) — Meta às vezes gateia isso atrás do App Review (passo 4).
3. **Create configuration / Nova configuração**:
   - Nome: `Torque WhatsApp Onboarding` (livre).
   - Permissões/feature: **WhatsApp Business Messaging** + **WhatsApp Business Management**.
   - Tipo de token: deixar o padrão do Embedded Signup (retorna `code` curto → nosso edge troca por token).
4. Salvar → copiar o **Configuration ID** (`config_id`). Guardar — vira `VITE_META_WA_CONFIG_ID`.

---

## 4. App Review — Advanced Access

Sem isso, `whatsapp_business_messaging` só funciona em modo dev (números de teste). Produção = Advanced Access.

1. App → menu esquerdo → **App Review → Permissions and Features**.
2. Localizar **`whatsapp_business_messaging`** → **Request Advanced Access**.
3. Localizar **`business_management`** → se ainda não estiver Advanced (Ads costuma já ter), pedir também.
4. A Meta pede:
   - Descrição do uso: "CRM B2B multi-tenant; clientes conectam o próprio WhatsApp Business via Embedded
     Signup pra enviar/receber mensagens com seus leads dentro do Torque CRM."
   - **Screencast** demonstrando o fluxo Embedded Signup + envio/recebimento. (Pode precisar do app já
     funcional em dev pra gravar — ver "ordem prática" no fim.)
   - Justificativa de cada permissão.
5. Submeter. **Review leva dias a semanas.** É o gargalo externo principal.

---

## 5. Webhook (WhatsApp)

O webhook já existe e está verificado pro leadgen (Track A) — vamos **reusar a mesma URL e verify token**,
só adicionando a inscrição do produto WhatsApp.

1. WhatsApp → **Configuration → Webhook** (ou "Webhooks" no menu, escolhendo o objeto **WhatsApp Business Account**).
2. **Callback URL:**
   ```
   https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/meta-webhook
   ```
3. **Verify token:** o valor atual de `META_WEBHOOK_VERIFY_TOKEN`.
   - Ler em: Supabase Dashboard → projeto prod (`jsjsmuncfkbsbzqzqhfq`) → Project Settings → Edge Functions →
     Secrets → `META_WEBHOOK_VERIFY_TOKEN` (revelar valor). **Não inventar outro** — tem que bater com o secret.
4. Clicar **Verify and Save**. A Meta faz GET na URL; nossa fn responde o `hub.challenge` se o token bater → fica **Verified**.
   - ⚠️ Só funciona se a edge fn `meta-webhook` **atualizada estiver deployada em prod** (Step 2). Se ainda não,
     a verificação falha → fazer este passo DEPOIS do deploy.
5. **Subscribe fields:** marcar **`messages`** (cobre mensagens inbound + status entregue/lido).
   - `message_template_status_update` é opcional (aprovação de template é puxada pelo cron `meta-template-sync`).

---

## 6. Entregar os 2 valores pro lado Torque

Depois dos passos acima você terá:

| Valor | Origem | Onde colar |
|---|---|---|
| `config_id` | passo 3 | EasyPanel env `VITE_META_WA_CONFIG_ID` |
| `META_APP_ID` (já existe) | Supabase secret / app dashboard | EasyPanel env `VITE_META_APP_ID` |

EasyPanel → serviço frontend → Environment → adicionar as 2 vars → **Rebuild** (são build-time, entram no bundle).

---

## Ordem prática (resolve o ovo-galinha do screencast)

App Review (passo 4) costuma pedir screencast do fluxo, mas o fluxo precisa de Advanced Access pra rodar fora
de dev. Saída:

1. Passos 0–3 + 5 (add produto, Embedded Signup config, webhook).
2. **Step 2 deploy** (edge fns + migration) — sem isso nada roda em prod.
3. Setar VITE vars (passo 6) → rebuild → testar o Embedded Signup **em modo dev** com o seu próprio número /
   número de teste (funciona sem Advanced Access pra contas com papel no app).
4. Gravar o screencast desse teste.
5. Submeter App Review (passo 4) com o screencast.
6. Aprovado → qualquer org conecta número real em produção.

---

## Checklist

- [ ] Business Verified
- [ ] Produto WhatsApp adicionado ao app Track A
- [ ] Embedded Signup configuration criada → `config_id` copiado
- [ ] Webhook WhatsApp Verified (callback + verify token reusado) + field `messages` subscrito
- [ ] App Review submetido: `whatsapp_business_messaging` (+ `business_management` se faltava)
- [ ] EasyPanel: `VITE_META_APP_ID` + `VITE_META_WA_CONFIG_ID` setados + rebuild
- [ ] App Review APROVADO → go-live por org
