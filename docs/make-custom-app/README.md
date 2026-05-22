# Torque CRM — Custom App Make.com

App privado para o time criar automações no Make.com sem código.
O node "Torque CRM → Criar Lead" aparece como app nativo no Make.

## Setup (uma vez)

### 1. Abrir Make Developer Hub

- Acesse: https://www.make.com/en/custom-apps
- Clique "Create a new app"

### 2. Criar o App

- **App Name**: `Torque CRM`
- **Description**: `CRM de vendas B2B. Crie leads automaticamente a partir de qualquer fonte.`
- **Audience**: Private (só sua org)
- **Logo**: usar logo Torque (PNG 512x512, fundo transparente)

### 3. Configurar Connection

No app criado, vá em **Connections** → **Create a Connection**.

- **Label**: `Torque CRM API`
- **Type**: Custom (API Key)

Cole o conteúdo de `connection.json` na aba **Communication**.
Cole o conteúdo de `connection-parameters.json` na aba **Parameters**.

### 4. Criar Module "Criar Lead"

Vá em **Modules** → **Create a Module**.

- **Label**: `Criar Lead`
- **Description**: `Cria um novo lead no Torque CRM`
- **Type**: Action
- **Connection**: selecione "Torque CRM API"

Cole o conteúdo de `module-criar-lead-communication.json` na aba **Communication**.
Cole o conteúdo de `module-criar-lead-parameters.json` na aba **Parameters** (Mappable parameters / Static parameters).
Cole o conteúdo de `module-criar-lead-interface.json` na aba **Interface** (output).

### 5. Testar

1. Crie um cenário no Make
2. Adicione o módulo "Torque CRM → Criar Lead"
3. Configure a connection com as credenciais
4. Preencha: Nome = "Teste Make", Phone = "5511999990000"
5. Run once
6. Verifique no Torque CRM se o lead apareceu

### 6. Compartilhar com o time

- No Developer Hub → App → Settings → Invite team
- Ou: compartilhe o link do app privado com membros da org Make

---

## Arquivos

| Arquivo | Onde colar no Make |
|---------|-------------------|
| `connection.json` | Connection → Communication |
| `connection-parameters.json` | Connection → Parameters |
| `module-criar-lead-communication.json` | Module → Communication |
| `module-criar-lead-parameters.json` | Module → Mappable Parameters |
| `module-criar-lead-interface.json` | Module → Interface (output) |

## Credenciais necessárias

| Campo | Valor | Onde encontrar |
|-------|-------|----------------|
| `supabaseUrl` | `https://jsjsmuncfkbsbzqzqhfq.supabase.co` | Fixo (prod) |
| `anonKey` | Supabase anon key | Supabase Dashboard → Settings → API |
| `webhookApiKey` | Valor do env `WEBHOOK_API_KEY` | Supabase Dashboard → Edge Functions → Secrets |
| `organizationId` | UUID da org | Tabela `organizations` |

## Campos disponíveis pro time

### Campos padrão

| Campo no Make | Obrigatório | Descrição |
|---------------|-------------|-----------|
| Nome | Não | Nome do lead |
| Telefone | Sim* | Telefone com DDI+DDD (ex: 5511999999999) |
| Email | Sim* | Email do lead |
| Empresa | Não | Nome da empresa |
| Origem | Não | Dropdown: Make, Meta Ads, Google Ads, Site, Indicação, WhatsApp, Calendly, LinkedIn, Evento, Outro |
| Tags | Não | Tags separadas por vírgula (máx. 50) |
| Pipeline | Não | Dropdown: WhatsApp, Confirmação, Propostas |
| Estágio | Não | Dropdown com estágios por pipeline |
| Data da Reunião | Não | Data/hora ISO 8601 (salva em compromisso_date) |
| Responsável (User ID) | Não | UUID do membro do time. Vazio = round robin automático |
| Notas | Não | Campo texto multilinha |
| Segmento | Não | Segmento de mercado (ex: Indústria, Varejo) |
| Faturamento | Não | Faixa de faturamento (ex: 1M-5M) |
| Urgência | Não | Dropdown: Baixa, Média, Alta, Urgente |
| Rating | Não | Nota de 0 a 10 |
| Atualizar existente | Não | Toggle. Se on, atualiza lead com mesmo tel/email |

*Pelo menos um dos dois (telefone ou email) é obrigatório.

### Campos avançados (UTM)

Ficam escondidos por padrão. Aparecem ao clicar "Show advanced settings".

| Campo | Descrição |
|-------|-----------|
| UTM Source | utm_source |
| UTM Medium | utm_medium |
| UTM Campaign | utm_campaign |
| UTM Content | utm_content |
| UTM Term | utm_term |

### Campos personalizados (ilimitados)

Botão **"+ Add item"** na seção "Campos Personalizados". Cada item tem:

| Sub-campo | Descrição |
|-----------|-----------|
| Nome do Campo | Nome do campo custom (ex: `cidade`, `cargo`, `cnpj`, `num_funcionarios`) |
| Valor | Valor do campo. Pode mapear de módulos anteriores do cenário Make. |

Adicione quantos campos custom precisar. Todos viram campos personalizados no lead dentro do Torque CRM. Esses campos são criados automaticamente no sistema.

**Exemplo**: Se um formulário Typeform tem campo "Qual seu cargo?" → no Make, mapeia: Nome do Campo = `cargo`, Valor = saída do Typeform.

## Como funciona (IML)

O módulo usa `merge()` + `toCollection()` do Make IML pra fundir campos padrão + custom num único objeto `fields`. O webhook aceita qualquer chave extra como campo personalizado — não precisa cadastrar antes.

```
fields = merge(
  {name, phone, email, company, ...campos padrão},
  toCollection(customFields, 'key', 'value')  ← campos dinâmicos
)
```

Tags são convertidas de texto separado por vírgula pra array automaticamente via `split()`.
Pipeline só é enviado se selecionado (via `if()` no IML).
