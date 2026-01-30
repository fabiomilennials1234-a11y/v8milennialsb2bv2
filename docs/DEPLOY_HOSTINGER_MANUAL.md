# Deploy manual na Hostinger (VPS)

Guia passo a passo para publicar o app **v8milennialsb2b** (Vite + React) na VPS Hostinger **sem scripts nem MCP** — tudo pelo painel ou terminal.

---

## Pré-requisitos

- Conta Hostinger com **VPS ativa**
- Repositório no GitHub: **https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2** (já com `Dockerfile` e `docker-compose.yml`)
- (Opcional) Domínio apontando para o IP da VPS

---

## Opção 1: Deploy via hPanel (Docker + GitHub)

Use quando quiser que a Hostinger clone o repo e suba o Docker sozinha.

### 1. Entrar no hPanel

1. Acesse [hpanel.hostinger.com](https://hpanel.hostinger.com) e faça login.
2. Clique na sua **VPS** (nome ou IP).

### 2. Abrir a área de Docker / Deploy

- Procure um menu como **“Docker”**, **“Applications”**, **“Deploy”** ou **“Web”** (o nome pode variar conforme o plano).
- Se não aparecer “Docker”, pode ser **“SSH”** ou **“File Manager”** — nesse caso use a **Opção 2** (SSH).

### 3. Criar projeto a partir do GitHub

1. Clique em **“New project”** ou **“Add application”** (ou equivalente).
2. Escolha **“Deploy from GitHub”** / **“Connect repository”**.
3. Informe:
   - **Repositório:** `fabiomilennials1234-a11y/v8milennialsb2bv2`
   - **Branch:** `main` (ou o branch que você usa).
4. Se pedir **variáveis de ambiente** (Supabase, etc.), preencha:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
   - (Outras que o app usar: `VITE_CALENDAR_SERVICE_URL`, etc.)
5. Confirme / **Deploy**. A Hostinger vai clonar o repo, rodar o `Dockerfile` e subir o container (porta 80).

### 4. Acessar o site

- Após alguns minutos, abra no navegador: **http://IP_DA_VPS** (ou **https://seu-dominio.com** se já tiver configurado domínio e SSL).

---

## Opção 2: Deploy manual via SSH (sem Docker no painel)

Use quando não houver “Docker” no hPanel ou quando quiser controle total pelo terminal.

### 1. Habilitar SSH e pegar os dados da VPS

1. No hPanel, vá em **VPS** → sua máquina.
2. Anote o **IP** da VPS.
3. Vá em **SSH** ou **Access** e:
   - Ative o acesso SSH (se estiver desativado).
   - Anote **usuário** (geralmente `root`) e **senha**, ou cadastre uma **chave SSH** e use ela para conectar.

### 2. Conectar na VPS pelo terminal

No seu Mac/PC:

```bash
ssh root@IP_DA_VPS
```

(Substitua `IP_DA_VPS` pelo IP anotado. Se usar outro usuário, troque `root`.)

### 3. Instalar Docker na VPS (se ainda não tiver)

Na sessão SSH:

```bash
# Exemplo para Ubuntu/Debian
apt update && apt install -y docker.io docker-compose
systemctl enable docker && systemctl start docker
```

*(Se a Hostinger já tiver Docker, pode pular ou ajustar o comando conforme o sistema deles.)*

### 4. Clonar o repositório na VPS

Ainda via SSH:

```bash
cd /var/www   # ou outro diretório de sua preferência
git clone https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2.git
cd v8milennialsb2bv2
```

### 5. Configurar variáveis de ambiente (build)

Crie um arquivo `.env` na pasta do projeto **na VPS** (com as mesmas variáveis que você usa no `.env` local):

```bash
nano .env
```

Adicione pelo menos (ajuste os valores):

```
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua_anon_key
VITE_SUPABASE_PROJECT_ID=seu_project_id
```

Salve (Ctrl+O, Enter) e saia (Ctrl+X).

### 6. Subir o projeto com Docker

Na mesma pasta (`v8milennialsb2bv2`):

```bash
docker compose up -d --build
```

*(Ou `docker-compose up -d --build` se o comando for o antigo.)*

O Docker vai fazer o build da imagem (Vite + Nginx) e subir o container na porta 80.

### 7. Verificar e acessar

- Ver containers: `docker ps`
- Ver logs: `docker compose logs -f` (ou `docker-compose logs -f`)
- Acesse no navegador: **http://IP_DA_VPS**

---

## Opção 3: Deploy só dos arquivos estáticos (sem Docker)

Use quando quiser só servir a pasta **dist/** (build feito no seu PC) com Nginx ou Apache já instalado na VPS.

### 1. Fazer o build no seu computador

Na pasta do projeto (no Mac/PC):

```bash
cd /Users/gabrielaureliogipp/Desktop/PROJETO/v8milennialsb2b-main
npm run build
```

Isso gera a pasta **`dist/`**.

### 2. Enviar a pasta `dist/` para a VPS

Pelo terminal (no seu Mac/PC), por exemplo com **rsync**:

```bash
rsync -avz --delete dist/ root@IP_DA_VPS:/var/www/html/
```

(Substitua `IP_DA_VPS` e o caminho `/var/www/html/` se na sua VPS for outro.)

Se pedir, use a **senha do root** ou garanta que a chave SSH está configurada.

### 3. Configurar Nginx na VPS (se ainda não estiver)

Conecte na VPS por SSH e crie/edite o site (exemplo para Nginx):

```bash
ssh root@IP_DA_VPS
nano /etc/nginx/sites-available/default
```

Exemplo de configuração (document root = pasta para onde você enviou o `dist/`):

```nginx
server {
    listen 80;
    root /var/www/html;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Recarregue o Nginx:

```bash
nginx -t && systemctl reload nginx
```

Acesse **http://IP_DA_VPS**.

---

## Resumo rápido

| Método | Onde | Quando usar |
|--------|------|-------------|
| **Opção 1 – hPanel + Docker** | Painel Hostinger | Quer deploy com um clique a partir do GitHub. |
| **Opção 2 – SSH + Docker** | Terminal (SSH + `docker compose`) | Tem VPS com SSH e quer controle total. |
| **Opção 3 – Build local + rsync** | Seu PC + Nginx na VPS | Já tem Nginx/Apache e quer só enviar a pasta `dist/`. |

---

## Atualizar o site depois

- **Opção 1:** No hPanel, use o botão de **“Redeploy”** / **“Update”** do projeto conectado ao GitHub.
- **Opção 2:** Na VPS, na pasta do repo: `git pull` e depois `docker compose up -d --build`.
- **Opção 3:** Rode de novo `npm run build` no seu PC e `rsync ... dist/` para a mesma pasta na VPS.

Se algo falhar (erro no build, 502, página em branco), confira os logs do container (`docker compose logs`) ou do Nginx (`journalctl -u nginx -f` ou arquivos em `/var/log/nginx/`).
