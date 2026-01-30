# Deploy no EasyPanel

Como publicar o app **v8milennialsb2b** (Vite + React) no **EasyPanel** que você já tem (por exemplo na VPS Hostinger ou em outro servidor).

O repositório já tem **Dockerfile** e **docker-compose.yml**; o EasyPanel usa o Dockerfile ao fazer deploy a partir do GitHub.

---

## Pré-requisitos

- EasyPanel instalado e acessível (ex.: `https://seu-easypanel.dominio.com`)
- Repositório no GitHub: **https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2**
- (Opcional) Token do GitHub para o EasyPanel conectar ao repo — [GitHub: Personal Access Token](https://github.com/settings/tokens)

---

## Passo a passo no EasyPanel

### 1. Abrir o EasyPanel

Acesse a URL do seu EasyPanel no navegador e faça login.

### 2. Criar um projeto (se ainda não tiver)

- Clique em **Create project** ou **New project**.
- Dê um nome, por exemplo: **v8milennialsb2b** (ou o nome que preferir).

### 3. Adicionar um App a partir do GitHub

- Dentro do projeto, clique em **Create** ou **Add service**.
- Escolha o tipo **App** (não Database, não Cron).
- Em **Source** / **Code source**, selecione **GitHub**.

### 4. Conectar o repositório

- Se for a primeira vez, o EasyPanel pode pedir para **conectar à conta GitHub** (usando um **Personal Access Token**).
- Depois de conectado:
  - **Repository:** `fabiomilennials1234-a11y/v8milennialsb2bv2`
  - **Branch:** `main` (ou o branch que você usa).
- Como o repo tem **Dockerfile**, o EasyPanel deve detectar e usar o **Dockerfile** para o build (não precisa escolher Nixpacks).

### 5. Configurar variáveis de ambiente (build)

O app Vite precisa das variáveis no **momento do build**. No EasyPanel, na tela do App:

- Vá em **Environment** / **Environment variables**.
- Adicione as variáveis que o seu `.env` local tem, por exemplo:

| Nome | Valor (exemplo) |
|------|------------------|
| `VITE_SUPABASE_URL` | `https://seu-projeto.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | sua anon key |
| `VITE_SUPABASE_PROJECT_ID` | seu project id |
| `VITE_CALENDAR_SERVICE_URL` | URL do serviço de calendário (se usar) |

*(Use os mesmos valores que estão no seu `.env` local.)*

### 6. Porta e domínio

- **Port:** o container expõe a porta **80** (Nginx). No EasyPanel, configure o App para usar a porta **80** (ou a que o painel mapear, ex.: 80 → 80).
- Se o EasyPanel pedir **domínio**: informe o domínio que aponta para o servidor do EasyPanel (ex.: `app.seudominio.com`) ou use o domínio padrão que o EasyPanel oferece.

### 7. Fazer o deploy

- Clique em **Deploy** / **Save and deploy**.
- O EasyPanel vai:
  1. Clonar o repositório
  2. Fazer o build com o Dockerfile (npm install + npm run build + Nginx)
  3. Subir o container na porta 80

Aguarde o build terminar (pode levar alguns minutos). Quando o status ficar verde/“Running”, o app está no ar.

### 8. Acessar o site

- Use a URL que o EasyPanel mostrar para o App (ex.: `https://v8milennialsb2b.seudominio.com` ou `http://IP:porta`).

---

## Atualizar o app (novo deploy)

- **Manual:** no EasyPanel, abra o App e clique em **Redeploy** / **Deploy**.
- **Automático:** se tiver configurado **webhook do GitHub** no EasyPanel, cada `git push` no branch configurado pode disparar um novo deploy.

---

## Resumo

| Onde | O que fazer |
|------|-------------|
| EasyPanel → Create project | Nome, ex.: v8milennialsb2b |
| Add App → Source | GitHub → repo `fabiomilennials1234-a11y/v8milennialsb2bv2`, branch `main` |
| Build | Usar Dockerfile (já no repo) |
| Environment | `VITE_SUPABASE_*` e outras que o app usa |
| Port | 80 (Nginx no container) |
| Deploy | Deploy / Redeploy e acessar a URL do App |

Sim: você faz esse deploy **no EasyPanel** que você já tem; não precisa usar o painel da Hostinger para Docker nem fazer tudo manualmente por SSH, desde que o EasyPanel esteja rodando na sua VPS ou em outro servidor.
