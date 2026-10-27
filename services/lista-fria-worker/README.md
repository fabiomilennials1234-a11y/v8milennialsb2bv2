# Worker da Lista Fria

Executa as buscas do **Google Maps** que o cliente cria na aba Lista fria
(ADR-0042). O banco é a fila; o worker é só um consumidor.

```
lista_fria_buscas (na_fila) ──reivindicar──▶ worker ──▶ gosom (coleta no Maps, lê o site, acha e-mail)
                                               │
                                               ├─ lê o CSV parcial a cada 5 s, só o que é novo
                                               ├─ IA (opcional): tira o que não é do nicho
                                               ├─ site do negócio: WhatsApp/e-mail que o gosom não trouxe
                                               ├─ valida: celular BR / MX do e-mail
                                               └─ lista_fria_worker_registrar ──▶ cobra 1 crédito por contato novo e válido
```

## O que ele garante

- **O banco decide o gasto.** O worker pede `registrar` e obedece `limite_atingido`. Nunca soma crédito.
- **"Parar e ficar com o que achou" funciona:** como a ingestão é incremental, o que já foi achado já está no banco, cobrado e importável. O worker percebe a parada no `progresso`, apaga o job no gosom e sai sem encerrar (o banco já fechou a busca).
- **Quem já é lead não é cobrado** (decidido na RPC, por telefone normalizado e por e-mail).
- **Sem IA, funciona.** Chave ausente ou API fora do ar: busca = nicho × cidade, e todo lugar achado vale.
- **Instagram:** fecha a busca como `falhou: instagram_indisponivel` e devolve a reserva, em vez de segurar a fila.
- **Worker morto:** sem sinal por 10 min, `lista_fria_worker_recuperar_travadas` fecha a busca e devolve a sobra. SIGTERM encerra a busca em andamento como `parada`.

## Rodar

```
cp services/lista-fria-worker/.env.example .env
docker compose -f services/lista-fria-worker/compose.yaml up -d --build
```

| Variável | |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | obrigatórias. A chave de serviço só chama as RPCs `lista_fria_worker_*` (só o `service_role` tem EXECUTE) |
| `GOSOM_URL` | padrão `http://gosom:8080` |
| `ANTHROPIC_API_KEY` | opcional. Liga a expansão por bairro/sinônimo e o filtro de nicho (Claude Haiku 4.5) |
| `GOSOM_MAX_TIME_S` | teto do job no gosom, padrão 3600 |
| `POLL_MS`, `IDLE_MS`, `WORKER_ID` | 5000, 5000, `<host>-<pid>` |

Pode haver mais de um worker: a fila usa `FOR UPDATE SKIP LOCKED`.

## Segurança

- **O gosom não tem autenticação.** Quem alcança a porta cria job, lê resultado e apaga. O compose não publica a porta; mantenha assim.
- **Leitura de site é SSRF-safe** (`src/ssrf.ts`). O endereço vem do listing do Maps, texto de terceiro, e o worker tem a chave de serviço no ambiente. O IP é validado na conexão (não antes, por causa de DNS rebinding), só portas 80/443, sem credencial na URL, redirecionamento seguido à mão com as mesmas regras, corpo e tempo limitados, só `text/html`.
- **Texto do Maps nunca é instrução para a IA.** Título e categoria entram como JSON de dado, a saída é forçada por ferramenta e só booleanos/strings curtas validadas voltam.
- **Termos de uso.** Raspar o Google Maps contraria os termos do Google; o risco é nosso (decisão do CTO, ADR-0042). Ritmo baixo, um job por vez por worker, e só dado de listagem pública.

## Contrato do gosom (medido na imagem real em 27/10/2026)

O spec que a imagem serve (`/static/spec/spec.yaml`) e a resposta real divergem. O que vale é o medido:

- `POST /api/v1/jobs` → `201 {"id": …}`. Body: `name`, `keywords[]`, `lang`, `zoom`, `depth`, `email`, `max_time` (segundos).
- **`lang` é ISO curto:** `pt` vale; `pt-BR` volta `422 invalid lang`.
- `GET /api/v1/jobs/{id}` volta com chaves **maiúsculas** (`ID`, `Status`, `Data`), ao contrário do spec. `Status`: `pending`, `working`, `ok`, `failed`. `max_time` volta em nanossegundos.
- `GET /api/v1/jobs/{id}/download` devolve o CSV também com o job em `working` (parcial). A última linha pode vir cortada: o parser descarta linha com aspas abertas ou colunas a menos.
- `website` às vezes é um link `wa.me/55…`: vira o telefone (WhatsApp) em vez de ser lido como site.
- A coluna `emails` já vem preenchida pelo gosom quando ele acha; o worker só lê o site quando falta e-mail ou WhatsApp.

A imagem está fixada por digest no compose. Atualizar = rodar `validar-contra-gosom.ts` e os testes antes.

## Validar

```
node --test tests/integration/lista-fria-worker.test.mjs        # 97 testes, sem rede
docker run -d -p 8080:8080 -v ./gmapsdata:/gmapsdata gosom/google-maps-scraper -data-folder /gmapsdata
node services/lista-fria-worker/validar-contra-gosom.ts "dentista" "Pinheiros, São Paulo - SP" 8   # gosom real, raspa o Maps
```

Medido em 27/10/2026 com o segundo comando: 8 contatos em 34 s, parou no limite, job apagado no gosom.

## Limites conhecidos

- **Cobertura da cidade** vem de sinônimos e bairros que a IA sugere (até 30 buscas por job). Sem IA, é uma busca só por nicho × cidade, que rende poucas dezenas de lugares. Uma grade por coordenada (`lat`/`lon`/`radius` do gosom) seria o próximo passo.
- **"Verificado" = formato válido**, não "confirmado": celular brasileiro plausível ou e-mail cujo domínio recebe e-mail (MX). Não consulta se o número tem WhatsApp (isso exige uma instância conectada da própria org).
- **IA validada só com `fetch` falso.** O caminho real da Anthropic API não foi exercitado nesta entrega (sem chave no ambiente de teste).
- **Instagram** sem adaptador.
