# Coletor de Instagram (login real)

Serviço que lista os seguidores de uma conta pública do Instagram e lê, de cada perfil
público, o contato que ele mesmo publica (e-mail comercial, telefone do botão de contato,
link e WhatsApp da bio). Usa **contas reais de Instagram** com a biblioteca
[`instagrapi`](https://github.com/subzeroid/instagrapi). É a alternativa sem custo em dólar
à Apify (ADR-0042), trocando dinheiro por **risco de conta e ritmo lento**.

O worker da Lista fria fala com ele pela mesma interface que usa com a Apify
(`INSTAGRAM_COLETOR_URL`). Quem escolhe o provedor é o worker: coletor, se configurado; senão Apify.

## Leia antes: o que isto é e o que não é

- **Viola os termos de uso da Meta.** Contas usadas aqui podem ser limitadas ou suspensas a
  qualquer momento. O desenho assume isso: a conta é **consumível**.
- **Nunca a conta pessoal ou a da marca.** Só contas dedicadas, com e-mail próprio, 2FA e
  alguns dias de uso normal antes de entrar no rodízio. Conta nova e fria cai mais rápido.
- **Seguidores de Instagram são, na maioria, pessoas físicas.** O risco de LGPD é maior que o
  de dado de empresa. Só dado público do perfil, sem envio nenhum (a Lista fria não dispara).
- **Lento por desenho.** A lista de seguidores não traz contato; só a leitura de cada perfil
  traz, uma requisição por perfil. Com pausa de 3 a 8 s entre perfis (média de 5,5 s), mais o atraso da
  biblioteca e a própria requisição, são **cerca de 400 perfis por hora por conta** (estimativa
  de projeto, não medida). Uma busca de 800 contas leva **cerca de 2 h**.
- **Não foi exercitado contra o Instagram de verdade.** Falta uma conta para testar. A API da
  biblioteca foi conferida instalando a versão fixada (`3.2.2`); o motor, o ritmo, a saúde das
  contas, a API HTTP e o mapeamento dos erros (com as classes reais da biblioteca) têm teste.
  O primeiro uso real é o teste: comece com **1 conta e 20 perfis**.

## Como protege a conta

| Medida | Efeito |
|---|---|
| Pausa aleatória de 3 a 8 s entre perfis + atraso interno da biblioteca antes de cada requisição | ritmo irregular, não de robô |
| Pausa longa (30 a 90 s) a cada 25 perfis | ninguém lê 200 perfis seguidos sem parar |
| Teto de requisições por conta por dia (padrão 250) | o dia de uma conta é limitado |
| Sessão e "aparelho" reutilizados entre jobs (`sessoes/`) | login novo a cada job é o que parece robô |
| **Primeiro checkpoint (desafio) PARA o job inteiro** | insistir com a mesma conta e IP transforma desafio em suspensão |
| Limite de ritmo / bloqueio de ação: conta em **cooldown** (30 min / 6 h) e o job passa à próxima | espalha a carga sem martelar quem foi limitado |
| Chamada que não volta em 75 s (90 s no login) vira cooldown | uma chamada pendurada não prende a conta nem o job |
| Handlers interativos da biblioteca (`input()` do código de desafio) trocados por "checkpoint e para" | num serviço ninguém digita código |
| Uma conta por IP (`proxy` por conta) | misturar IPs numa conta dispara bloqueio |

**IP importa.** IP de datacenter é o que o Instagram mais barra. Rodar o serviço numa conexão
residencial/escritório é de graça mas frágil; proxy residencial por conta resolve e custa dinheiro.

## Contas

`/data/contas.json` (volume; modo 600; **nunca** versionado nem no banco do Torque):

```json
[
  { "username": "conta.dedicada.1", "password": "..." },
  { "username": "conta.dedicada.2", "sessionid": "...", "proxy": "http://usuario:senha@host:porta" }
]
```

- **`sessionid` é preferível a `password`:** faça login numa janela de navegador normal, copie o
  cookie `sessionid` e use-o. A senha nunca entra no serviço, e evita o fluxo de login
  automatizado (o que mais dispara desafio).
- O arquivo é relido a cada job: adicionar ou remover conta não exige reiniciar.
- Senha, `sessionid` e `proxy` nunca aparecem em log, em resposta HTTP nem em `repr`.

### Tabela de saúde

`GET /v1/contas` (com o Bearer):

```json
[{ "username": "conta.dedicada.1", "status": "cooldown", "apta_agora": false, "cooldown_restante_s": 1520,
   "usos_hoje": 212, "limite_dia": 250, "em_uso": false, "ultimo_erro": "PleaseWaitFewMinutes" }]
```

- `ok`: no rodízio. `cooldown`: volta sozinha. **`checkpoint` e `login_falhou` só saem na mão:**
  resolva o desafio no app e libere com `POST /v1/contas/<username>/liberar`.

## API (interna)

```
POST /v1/jobs                 {handle, max_seguidores} -> 201 {id}
GET  /v1/jobs/{id}                                      -> {status, mensagem, total}
GET  /v1/jobs/{id}/itens?offset=&limit=                 -> [item]
POST /v1/jobs/{id}/abort
GET  /v1/contas                                         -> tabela de saúde
POST /v1/contas/{username}/liberar
GET  /saude
```

`status`: `RUNNING`, `SUCCEEDED`, `FAILED` (com `mensagem`: `checkpoint`, `sem_conta_disponivel`,
`alvo_invalido`, `erro:<Tipo>`), `ABORTED`. Os itens têm os mesmos campos do Actor da Apify.
**Sem autenticação forte por desenho:** só pode ficar numa rede interna (o compose não publica a
porta). `COLETOR_SEGREDO` põe um Bearer na frente, como defesa em profundidade.
Jobs e itens ficam na memória: reiniciar o serviço apaga os jobs em andamento (o worker conclui
a busca com o que já ingeriu).

## Variáveis

| | padrão | |
|---|---|---|
| `IG_DADOS` | `/data` | volume: `contas.json`, `saude.sqlite`, `sessoes/` |
| `COLETOR_PORTA` | 8090 | |
| `COLETOR_SEGREDO` | — | Bearer exigido |
| `IG_RITMO_MIN_S` / `IG_RITMO_MAX_S` | 3 / 8 | pausa entre perfis |
| `IG_ATRASO_REQ_MIN_S` / `IG_ATRASO_REQ_MAX_S` | 1 / 3 | atraso interno da biblioteca |
| `IG_CAP_DIA` | 250 | requisições por conta por dia (lista e perfil contam 1) |
| `IG_JOB_MAX_SEGUIDORES` | 800 | teto por job |

## Testes

```
cd services/instagram-coletor
pip install -r requirements.txt   # só para o teste que usa as classes de erro reais da biblioteca
python -m unittest discover -s tests -t .
```

Cobrem: ritmo e pausa longa, rodízio por cooldown e por teto diário, **parada ao primeiro
checkpoint sem tentar outra conta**, aborto no meio, alvo privado/inexistente, página vazia,
prazo de chamada pendurada, API HTTP (inclusive 401), tabela de saúde sem segredo, e o
mapeamento de 19 classes de erro reais da biblioteca. O worker tem um teste que sobe este serviço
(com cliente falso) e roda uma busca de ponta a ponta (`tests/integration/lista-fria-coletor.test.mjs`).

## Primeiro uso real (faça nesta ordem)

1. 1 conta dedicada, de preferência com `sessionid`, e uma conta-alvo pública pequena.
2. `max_seguidores: 20`. Confira `GET /v1/contas` e os itens (`public_email`, `contact_phone_number`).
3. Se algum campo não vier, ou a conta cair, **pare e me avise**: o motor foi escrito contra a
   documentação da biblioteca, não contra o Instagram.
4. Só depois aumente o volume e ligue o cartão do Instagram na tela (`INSTAGRAM_DISPONIVEL`).
