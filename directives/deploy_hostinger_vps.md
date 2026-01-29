# Deploy na VPS Hostinger (v8milennialsb2b)

## Objetivo
Publicar o frontend Vite + React na VPS Hostinger com deploy automatizado, usando MCP Hostinger quando possível e scripts determinísticos para build e envio.

## Pré-requisitos
- Conta Hostinger com VPS ativa
- Token API em hPanel → Perfil → API (já configurado no `.mcp.json` como `hostinger-mcp`)
- Para **fluxo Docker**: repositório no GitHub com este projeto (Dockerfile + docker-compose na raiz)
- Para **fluxo rsync**: SSH habilitado na VPS, chave SSH no hPanel e variáveis no `.env` (ver abaixo)

---

## Fluxo A: Deploy via Docker (MCP Hostinger) — recomendado para automatizar

O MCP Hostinger expõe a ferramenta **VPS_createNewProjectV1**, que sobe um projeto Docker na VPS a partir de um repositório GitHub ou URL do `docker-compose`.

### Passos (orquestração)

1. **Garantir que o código está no GitHub**  
   - Repo com `Dockerfile`, `docker-compose.yml` (ou `docker-compose.yaml`) na raiz.  
   - Variáveis de build (Supabase, etc.) podem ser passadas no parâmetro `environment` da API.

2. **Obter o ID da VPS**  
   - Usar MCP: ferramenta **VPS_getVirtualMachinesV1** (lista VPS).  
   - Anotar o `virtualMachineId` da máquina onde quer fazer o deploy.

3. **Criar o projeto na VPS**  
   - Usar MCP: **VPS_createNewProjectV1**  
   - Parâmetros:
     - `virtualMachineId`: ID da VPS
     - `project_name`: nome do projeto (ex.: `v8milennialsb2b`, só alfanumérico, hífens e underscores)
     - `content`: URL do repositório GitHub (ex.: `https://github.com/SEU_USER/v8milennialsb2b`) **ou** URL raw do `docker-compose` **ou** conteúdo YAML bruto do compose
     - `environment`: (opcional) objeto com variáveis para o build, ex.:
       - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
       - `VITE_CALENDAR_SERVICE_URL`, `VITE_INVITE_API_URL` ou `VITE_INTERNAL_API_KEY` se usar

4. **Atualizar o deploy (novas versões)**  
   - Usar MCP: **VPS_updateProjectV1** com o mesmo `virtualMachineId` e `project_name`.  
   - A VPS vai fazer pull/rebuild conforme o compose.

### Edge cases
- Se a API esperar `docker-compose.yaml` e o repo tiver só `docker-compose.yml`, usar a URL do repo (a Hostinger pode aceitar os dois) ou informar URL raw do arquivo `.yml`.
- Build na VPS pode demorar; conferir status com **VPS_getProjectListV1** e **VPS_getProjectLogsV1** em caso de falha.

---

## Fluxo B: Deploy por build local + rsync (sem Docker na VPS)

Quando não quiser usar Docker na VPS (ex.: servidor já com Nginx/Apache), usar o script de execução que faz build e envia só a pasta `dist/`.

### Entradas
- Projeto na pasta atual (raiz do `v8milennialsb2b-main`)
- `.env` carregado com variáveis do frontend (já usado no `vite build`)
- Variáveis de **conexão VPS** no `.env`:
  - `VPS_HOST`: IP ou hostname da VPS (obtível via MCP **VPS_getVirtualMachineDetailsV1**)
  - `VPS_USER`: usuário SSH (geralmente `root` ou usuário criado no hPanel)
  - `VPS_PATH`: diretório no servidor onde colocar os arquivos (ex.: `/var/www/html` ou `/home/usuario/public_html`)
  - `VPS_SSH_KEY`: (opcional) caminho da chave privada SSH; se vazio, usa a chave padrão do usuário

### Ferramenta de execução
- Script: `execution/deploy_vps_rsync.sh`  
- Uso: a partir da raiz do projeto, `./execution/deploy_vps_rsync.sh` ou `bash execution/deploy_vps_rsync.sh`

### O que o script faz
1. Carrega `.env` (se existir)
2. Roda `npm run build` (gera `dist/`)
3. Envia `dist/` para `VPS_USER@VPS_HOST:VPS_PATH` via `rsync` (exclui arquivos desnecessários)
4. Usa `VPS_SSH_KEY` se definido

### Saídas
- Site estático servido em `VPS_PATH` no servidor; configurar Nginx/Apache para apontar o document root para esse path.

### Edge cases
- Se `rsync` ou `ssh` não estiverem instalados, o script falha: instalar no macOS (rsync já costuma vir) e na VPS.
- Primeira conexão SSH: confirmar fingerprint quando pedido ou usar `StrictHostKeyChecking=no` apenas em ambiente controlado.
- Permissões: `VPS_PATH` deve ser gravável pelo `VPS_USER`.

---

## Resumo de ferramentas MCP (Hostinger) úteis para VPS

| Ação              | Ferramenta MCP                |
|-------------------|-------------------------------|
| Listar VPS        | VPS_getVirtualMachinesV1      |
| Detalhes da VPS   | VPS_getVirtualMachineDetailsV1|
| Criar projeto     | VPS_createNewProjectV1        |
| Atualizar projeto | VPS_updateProjectV1           |
| Listar projetos   | VPS_getProjectListV1          |
| Logs do projeto   | VPS_getProjectLogsV1          |
| Reiniciar projeto| VPS_restartProjectV1           |

---

## Atualização desta diretiva
- Se surgirem limites de API, erros comuns ou mudanças no fluxo (ex.: nome do compose), atualizar este arquivo com os aprendizados.
- Não criar novas diretivas de deploy sem permissão; manter uma única SOP para Hostinger VPS aqui.
