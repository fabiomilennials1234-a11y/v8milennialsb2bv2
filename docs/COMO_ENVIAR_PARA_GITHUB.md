# Como enviar o projeto para o GitHub

Use este guia para publicar a pasta **v8milennialsb2b-main** em um repositório no GitHub (útil para deploy na VPS Hostinger via Docker).

---

## Passo 1: Criar o repositório no GitHub

1. Acesse [github.com](https://github.com) e faça login.
2. Clique em **"New"** (ou **"+"** → **"New repository"**).
3. Preencha:
   - **Repository name:** por exemplo `v8milennialsb2b` ou `Projeto-Torque-frontend`.
   - **Visibility:** Public ou Private.
   - **Não** marque "Add a README" (o projeto já tem arquivos).
4. Clique em **"Create repository"**.
5. Anote a URL do repositório, por exemplo:  
   `https://github.com/SEU_USUARIO/v8milennialsb2b.git`

---

## Passo 2: Abrir o terminal na pasta do projeto

Abra o terminal e entre na pasta do app:

```bash
cd /Users/gabrielaureliogipp/Desktop/PROJETO/v8milennialsb2b-main
```

---

## Passo 3: Inicializar Git (só se essa pasta ainda não for um repo)

Se essa pasta **ainda não** tem um repositório Git próprio (só a pasta, não a home), rode:

```bash
git init
git branch -M main
```

Se já tiver um `git init` feito aí antes, pule para o passo 4.

---

## Passo 4: Adicionar o remote do GitHub

Substitua `SEU_USUARIO` e `NOME_DO_REPO` pela URL que você anotou:

```bash
git remote add origin https://github.com/SEU_USUARIO/NOME_DO_REPO.git
```

Exemplo:

```bash
git remote add origin https://github.com/fabiomilennials1234-a11y/v8milennialsb2b.git
```

Se já existir um `origin` e você quiser trocar:

```bash
git remote remove origin
git remote add origin https://github.com/SEU_USUARIO/NOME_DO_REPO.git
```

---

## Passo 5: Adicionar arquivos, commitar e enviar

```bash
git add .
git status
```

Revise a lista (o `.gitignore` já evita `node_modules`, `.env`, etc.). Depois:

```bash
git commit -m "Initial commit: app Vite + React + deploy Hostinger VPS"
git push -u origin main
```

Se o GitHub pedir usuário/senha, use um **Personal Access Token** em vez da senha da conta (Settings → Developer settings → Personal access tokens).

---

## Atualizações depois (quando mudar o código)

Sempre dentro da pasta `v8milennialsb2b-main`:

```bash
git add .
git commit -m "Descrição do que mudou"
git push
```

Depois disso, na VPS Hostinger você pode usar **VPS_updateProjectV1** (MCP) para puxar a nova versão.

---

## Resumo rápido

| Ação              | Comando |
|-------------------|--------|
| Entrar na pasta   | `cd /Users/gabrielaureliogipp/Desktop/PROJETO/v8milennialsb2b-main` |
| Iniciar repo      | `git init` e `git branch -M main` |
| Conectar GitHub   | `git remote add origin https://github.com/USUARIO/REPO.git` |
| Primeiro envio    | `git add .` → `git commit -m "Initial commit"` → `git push -u origin main` |
| Próximos envios   | `git add .` → `git commit -m "..."` → `git push` |
