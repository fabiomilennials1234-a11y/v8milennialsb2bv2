# Worker da Lista fria na VPS (Hostinger / EasyPanel)

Tira o worker da máquina do CTO e o coloca onde o Torque já roda. O worker é **só um consumidor de
fila**: ele pega buscas em `lista_fria_buscas` (status `na_fila`), grava o resultado e devolve o saldo.
Não recebe tráfego de fora e **não publica porta nenhuma**.

> Os nomes de menu do EasyPanel mudam entre versões. O que importa está nos blocos de configuração.

## 0. Antes de começar: a VPS aguenta?

O worker divide a máquina com o Torque. No terminal da VPS:

```
free -h && nproc && df -h /
```

| | mínimo | observação |
|---|---|---|
| Memória **livre** | 4 GB | gosom/Chromium até 3 GB (limitado no compose) + worker 1 GB |
| CPU | 2 núcleos livres | gosom 2 + worker 1, ambos com teto |
| Disco livre | 3 GB | base de CNPJ 450 MB + imagens |

Se a memória livre for menor que isso, **não suba o gosom** (Maps) nessa VPS: o Chromium disputa memória
com o Torque. Dá para subir só o worker (CNPJ não usa gosom) e deixar o Maps para outra máquina.

## 1. Imagem

O workflow `Lista fria · imagem do worker` publica `ghcr.io/<org>/<repo>/lista-fria-worker` a cada merge
que mexe em `services/lista-fria-worker/`. O resumo do job mostra a linha pronta para colar:

```
LISTA_FRIA_IMAGEM=ghcr.io/<org>/<repo>/lista-fria-worker:sha-abc1234
```

**Use sempre a tag `sha-…`, nunca `:latest`**: deploy e rollback ficam um copiar e colar de tag.
O pacote no ghcr pode estar privado: o EasyPanel precisa de um token de leitura de pacotes (o mesmo que já
puxa a imagem do front).

## 2. Serviço no EasyPanel

1. Projeto novo (ex.: `lista-fria`) > serviço do tipo **Docker Compose** > cole o conteúdo de
   `compose.vps.yaml`.
2. Em **Environment**, defina (segredos só aqui, nunca no repositório):

```
SUPABASE_URL=https://jsjsmuncfkbsbzqzqhfq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role de PRODUÇÃO>
LISTA_FRIA_IMAGEM=ghcr.io/<org>/<repo>/lista-fria-worker:sha-abc1234
ANTHROPIC_API_KEY=            # vazio = sem IA (como hoje)
```

3. **Sem domínio e sem porta**: não crie entrada em Domains/Ports.
4. Deploy.

## 3. Conferir que funcionou (nesta ordem)

1. Logs do `worker`, em até ~1 min:
   - `worker_iniciado`
   - `base_cnpj_atualizada ... "partes":14` (primeiro boot baixa ~450 MB; ~1 min) e depois `base_cnpj ... "disponivel":true`
2. Estado do container: `healthy` (leva até ~5 min no primeiro boot por causa da base).
3. Crie uma **busca pequena** pela tela (10 créditos, qualquer fonte) e veja `busca_reivindicada` nos logs
   da VPS, **não** na sua máquina.
4. Só então **derrube o worker local** (`docker compose down` na sua máquina). Dois workers não corrompem
   nada (a fila usa `SKIP LOCKED`), mas você não saberia qual atendeu.

## 4. Saúde e alerta

**Healthcheck do container.** O worker só se declara saudável se falou com o banco nos últimos 2 min.
Chave revogada, banco fora ou rede caída reprovam o healthcheck; o `restart: unless-stopped` reinicia.
Ative a notificação de serviço indisponível do EasyPanel para este serviço.

**Fila parada.** O healthcheck não vê um worker saudável porém travado numa busca, nem o worker desligado
por engano. Rode esta consulta de tempos em tempos (ou ligue num alerta):

```sql
-- Buscas esperando há mais de 5 min = ninguém está atendendo.
select id, fonte, organization_id, now() - created_at as esperando
  from public.lista_fria_buscas
 where status = 'na_fila' and created_at < now() - interval '5 minutes'
 order by created_at;

-- Buscas "executando" sem sinal de vida há mais de 3 min.
select id, fonte, worker_id, now() - heartbeat_at as sem_sinal
  from public.lista_fria_buscas
 where status = 'executando' and heartbeat_at < now() - interval '3 minutes';
```

O próprio worker fecha como `falhou` e devolve a reserva as buscas sem sinal por 10 min
(`lista_fria_worker_recuperar_travadas`), então o usuário nunca perde crédito por queda.

## 5. Atualizar e voltar atrás

- **Atualizar:** novo merge no worker > pegue a tag `sha-…` no resumo do job > troque `LISTA_FRIA_IMAGEM` >
  redeploy. Busca em andamento é encerrada pelo SIGTERM (`parada`, fica com o que já achou).
- **Voltar:** troque `LISTA_FRIA_IMAGEM` para a tag anterior > redeploy.
- **Base de CNPJ:** não precisa fazer nada. O worker confere o manifesto a cada 6 h e baixa as partes novas
  quando o job mensal (`lista-fria-base.yml`) publica.

## 6. Segurança

- `SUPABASE_SERVICE_ROLE_KEY` dá acesso total ao banco. Fica **só** no EasyPanel. Se já passou por chat ou
  arquivo local, **rotacione** em Supabase > Settings > API e atualize aqui.
- O gosom não tem autenticação: por isso o compose não publica porta e ele só fala com o worker pela rede
  interna. Não adicione domínio a ele.
- O worker só **lê** a internet (Maps, sites das empresas, DNS). A leitura de sites tem proteção contra SSRF
  (`src/ssrf.ts`): não alcança IP privado, nem o painel do EasyPanel.

## 7. Limites conhecidos

- **Um worker, uma busca por vez.** Uma busca grande (Maps ou 100 mil créditos de CNPJ) faz as outras
  esperarem. O banco limita a 3 buscas abertas por organização, mas não há prioridade entre organizações.
- Instagram segue desligado na tela.
