# Integração Torque CRM ↔ ERP Toth — Café Jurerê

**Documento de requisitos técnicos para viabilização da integração**

| | |
|---|---|
| **Solicitante** | Milennials Tech — Torque CRM |
| **Destinatário** | Fornecedor do ERP Toth / TI Café Jurerê |
| **Data** | 17 de agosto de 2026 |
| **Referência interna** | SCRUM-229 — Integração ERP Café Jurerê |
| **Organização (Torque)** | Café Jurerê — `4922638c-4909-494e-ba10-12282ec0b161` |
| **Contato técnico** | Marcelo Montemezzo — milennialstech@gmail.com |

---

## 1. Objetivo

O Torque CRM manterá uma integração com o ERP Toth utilizado pela Café Jurerê, com dois propósitos:

1. **Enriquecer a carteira de clientes do CRM** com o cadastro do ERP (identificação por CNPJ), sem sobrescrever dados curados pela equipe comercial.
2. **Reconhecer os três momentos do dinheiro** — vendido, faturado e recebido — trazendo pedidos, notas fiscais e títulos a receber do ERP para dentro das métricas de pós-venda do CRM (saúde da carteira, receita em risco, inadimplência).

O Torque já opera uma camada de integração de ERP neutra em relação ao fornecedor (hoje com TinyERP e Omie conectados). O Toth entra como uma terceira implementação dessa mesma camada. **Não pedimos nada que o ERP já não faça internamente** — pedimos exposição controlada e documentada do que ele já sabe.

## 2. Material recebido até o momento

Recebemos uma coleção Postman (`Coleção café.postman_collection.json`) com dois endpoints e um par de credenciais:

| Método | Endpoint | Autenticação |
|---|---|---|
| `POST` | `http://localhost:8080/toth/services/users/login` | `user` + `password` (form urlencoded) |
| `GET` | `http://localhost:8080/toth/services/clientes/?token=…` | token na query string |

Esse material é suficiente para entender a **forma** da API, mas **não é suficiente para construir a integração**. As seções seguintes detalham exatamente o que falta, e por quê.

---

## 3. Requisitos bloqueantes

Sem estes itens a integração não pode existir tecnicamente.

### 3.1 Endereço público e acessível da API

**O que precisamos:** a URL base pública do serviço Toth da Café Jurerê, no formato `https://<host>:<porta>/toth/services`.

**Por quê:** a coleção aponta para `http://localhost:8080`. `localhost` significa "a própria máquina" — é acessível apenas de dentro do servidor onde o Toth roda. O Torque CRM executa em nuvem (Supabase Edge Functions) e não tem como alcançar esse endereço. Enquanto a API só existir em `localhost`, nenhum dado trafega.

**Alternativas aceitáveis**, em ordem de preferência:

- **(A) Exposição direta** — o Toth publicado em um host/domínio alcançável pela internet, com HTTPS. Preferido: mais simples, menos peças móveis.
- **(B) Túnel reverso** — o servidor do ERP abre um túnel de saída (Cloudflare Tunnel, ngrok ou equivalente) e nos entrega a URL pública gerada. Não exige abrir porta de entrada no firewall.
- **(C) Modelo invertido (push)** — o ERP, ou um agente rodando na rede da Café Jurerê, envia os dados para um webhook do Torque. Nesse caso nós fornecemos a URL e o segredo de autenticação. Viável, porém exige desenvolvimento do lado do ERP.

**Precisamos saber qual das três é possível**, porque a arquitetura da integração muda conforme a resposta.

### 3.2 HTTPS obrigatório

**O que precisamos:** certificado TLS válido no endereço público (Let's Encrypt é suficiente).

**Por quê:** em `http://` puro, o usuário, a senha e o token trafegam em texto claro e podem ser lidos por qualquer intermediário da rota. Estamos tratando de cadastro de clientes — dado pessoal e empresarial sob a LGPD. Não conectaremos uma integração de produção sobre HTTP não cifrado.

### 3.3 Token no cabeçalho, não na query string

**O que precisamos:** que a API aceite o token de autenticação em um cabeçalho HTTP — `Authorization: Bearer <token>` ou `X-Auth-Token: <token>`.

**Por quê:** hoje o token vai em `?token=…`. A query string é registrada em log de servidor web, log de proxy, histórico de navegador e cabeçalho `Referer`. Na prática, a credencial fica gravada em texto claro em vários lugares fora do nosso e do seu controle. Cabeçalho não é logado por padrão.

Se a mudança for inviável no curto prazo, informe — trataremos como dívida técnica com prazo acordado, não como bloqueio permanente.

### 3.4 Contrato de autenticação

**O que precisamos, por escrito:**

1. Corpo exato da resposta de `POST /users/login` em caso de sucesso (exemplo real, com valores fictícios).
2. **Tempo de validade do token.** Ele expira? Em quanto tempo? É renovável, ou é preciso refazer o login?
3. Qual é a resposta quando o token está **expirado ou inválido** — código HTTP e corpo. Precisamos distinguir "token venceu, refaça login" de "credencial errada, pare de tentar" e de "o ERP está fora do ar".
4. Existe limite de sessões simultâneas por usuário? Um login novo invalida o token anterior?

**Por quê:** sem isso, a integração não sabe quando reautenticar e passa a alternar entre falhar silenciosamente e martelar o endpoint de login.

---

## 4. Requisitos de contrato de dados

### 4.1 Esquema completo de `GET /clientes`

**O que precisamos:**

1. **Exemplo real de resposta**, com pelo menos 2 ou 3 registros (pode vir com dados mascarados/fictícios, desde que a *estrutura* e os *tipos* sejam reais).
2. **Dicionário dos campos** — nome, tipo, obrigatoriedade e significado de cada um.
3. Confirmação explícita de quais campos carregam: **identificador interno do cliente**, **CNPJ/CPF**, **razão social**, **nome fantasia**, **e-mail**, **telefone**, **data de cadastro** e **data da última alteração**.

**Por quê:** sem o esquema, qualquer código que escrevermos para ler essa resposta é adivinhação. Um campo com nome diferente do suposto faz a integração importar registros vazios sem erro aparente — a pior classe de falha, porque não avisa.

### 4.2 Identificador imutável

**O que precisamos:** confirmação de qual campo é o **identificador interno, único e imutável** do cliente no Toth.

**Por quê:** é a chave de idempotência da integração. É por ela que sabemos que o cliente que chegou hoje é o mesmo que chegou ontem, e atualizamos em vez de duplicar. Não pode ser um campo editável pelo usuário (código do cliente, por exemplo, costuma ser editável — se for o caso, precisamos saber).

O **CNPJ** é a nossa chave secundária, usada para casar o cliente do ERP com o cliente já existente no CRM. Precisamos que ele venha sempre que existir.

### 4.3 Paginação

**O que precisamos:**

1. Como paginar `GET /clientes` — parâmetros aceitos (`page`/`offset`/`limit`/`per_page`) e como a resposta informa o total de registros e de páginas.
2. Existe limite máximo de registros por página?
3. **Volume atual**: quantos clientes existem hoje na base da Café Jurerê?

**Por quê:** se o endpoint devolve a base inteira em uma única resposta, precisamos dimensionar. Se pagina, precisamos saber como — e sem o total de páginas a integração não sabe quando parou.

### 4.4 Consulta incremental

**O que precisamos:** um parâmetro de filtro por data de alteração — algo como `GET /clientes?alterado_apos=2026-08-17T00:00:00`.

**Por quê:** sem ele, toda sincronização precisa varrer a base inteira. Isso desperdiça banda dos dois lados e impede que a sincronização rode com frequência. Com filtro incremental, a rotina periódica lê apenas o que mudou desde a última execução — tipicamente algumas dezenas de registros em vez de milhares.

Se o campo de data de alteração existe no cadastro mas não é filtrável hoje, informe — é um pedido de baixo custo de implementação e alto ganho operacional.

---

## 5. Endpoints adicionais necessários

A coleção cobre apenas o cadastro de clientes. O objetivo descrito na seção 1 exige mais. Para cada item abaixo: **existe hoje? está documentado? pode ser exposto?**

| # | Recurso | Para quê no CRM |
|---|---|---|
| 5.1 | **Pedidos de venda** (cabeçalho + itens) | Registrar o momento **vendido**: valor, data, cliente, produtos, situação do pedido |
| 5.2 | **Notas fiscais emitidas** | Registrar o momento **faturado**: número, chave de acesso, valor, data de emissão, situação, pedido de origem |
| 5.3 | **Títulos a receber** | Registrar o momento **recebido**: valor, vencimento, situação (aberto/pago/atrasado), data de pagamento, cliente e pedido vinculados |
| 5.4 | **Produtos** | Catálogo, para vincular item de pedido a produto do CRM |

Para os itens 5.1 a 5.3, precisamos também da **enumeração dos códigos de situação** (por exemplo: quais valores `situacao` pode assumir em um pedido, e o que cada um significa). Códigos de status são a parte que mais frequentemente quebra integrações, porque cada ERP usa um vocabulário próprio e sem a lista completa a integração trata um estado desconhecido como se fosse um estado conhecido.

**Prioridade:** 5.1 e 5.3 são os de maior valor — permitem calcular inadimplência e receita em risco por cliente, que é o que a Café Jurerê não consegue ver hoje no CRM. O item 5.4 é opcional em uma primeira fase.

---

## 6. Requisitos operacionais

### 6.1 Credenciais dedicadas de integração

**O que precisamos:** um usuário técnico exclusivo para a integração — **não** um usuário de pessoa física.

Características desejadas:
- Permissão **somente leitura** nos recursos acordados.
- Sem acesso a telas administrativas ou a recursos fora do escopo desta integração.
- Identificável no log do ERP como "integração Torque", para auditoria.

**Por quê:** um usuário nominal amarra a integração à permanência daquela pessoa na empresa; quando ela sai e a conta é desativada, a integração cai sem explicação aparente. Permissão somente leitura garante que uma falha nossa não escreva no ERP.

O usuário `milennialstech` e a senha compartilhados até aqui foram usados **apenas** para leitura da documentação e devem ser considerados **comprometidos** (trafegaram por canal não cifrado). Solicitamos a **troca dessa senha** e a emissão do usuário técnico definitivo.

### 6.2 Como armazenamos as credenciais

Para transparência sobre o nosso lado:

- Credenciais ficam cifradas em repouso com **AES-256-GCM**, em tabela dedicada com política de acesso **deny-all** — nenhum usuário do CRM, de nenhuma organização, consegue lê-las. Apenas as funções de servidor da própria integração decifram, em memória, no momento da chamada.
- A chave de cifra vive em variável de ambiente do servidor, fora do banco e fora do código-fonte.
- Nenhuma credencial é gravada em log.
- Enquanto o escopo for de leitura, a integração **não escreve nada** no ERP. Qualquer escrita futura será objeto de acordo específico.

### 6.3 Limites de uso e janela de manutenção

**O que precisamos saber:**
1. Existe limite de requisições por minuto/hora? Qual, e qual a resposta quando excedido?
2. Existe janela de manutenção ou de indisponibilidade programada (fechamento mensal, backup) em que devemos suspender as chamadas?
3. Qual a frequência de sincronização aceitável do ponto de vista de vocês? Nossa proposta inicial: **cadastro de clientes 1× por dia**; **pedidos e títulos a cada 1 ou 2 horas**; mais uma sincronização sob demanda acionada manualmente pelo usuário no CRM.

### 6.4 Ambiente de homologação

**O que precisamos:** um ambiente de teste separado da produção, com dados fictícios ou mascarados, e credenciais próprias.

**Por quê:** desenvolver contra a base de produção do cliente significa que cada erro de código acontece sobre dado real. Um ambiente de homologação é o que nos permite validar o contrato antes de tocar em produção.

Se não houver ambiente separado, informe — trabalharemos com leitura restrita em produção sob combinação prévia, mas é a opção menos segura para os dois lados.

### 6.5 Como restringir o acesso (não por IP)

**O que precisamos:** um mecanismo de restrição de acesso baseado em **credencial**, não em endereço de origem.

**Por quê:** o consumidor da API é uma função serverless (Supabase Edge Functions). Esse tipo de execução **não possui IP de saída fixo** — o endereço muda entre invocações e não é publicado pelo provedor. Uma allowlist de IP no firewall, portanto, ou bloqueia a integração de forma intermitente, ou precisa ser tão ampla que deixa de proteger.

Opções que funcionam, em ordem de preferência:

- **Cloudflare Tunnel + Cloudflare Access com service token** — o servidor abre a conexão para fora (sem porta de entrada no firewall) e só requisições portando o token chegam ao serviço.
- **Cabeçalho secreto validado no proxy reverso** — um header fixo, longo e rotacionável, exigido antes de encaminhar ao Toth.
- **mTLS** — certificado de cliente emitido para a integração. Mais rígido, mais trabalhoso de rotacionar.

Em qualquer das três, o proxy deve expor **apenas** o path `/toth/services` — nada mais do servidor.

> Correção registrada: uma versão anterior desta seção oferecia o envio da nossa faixa de IPs de origem. Isso estava errado para a arquitetura em uso e foi substituído pelo acima.

---

## 7. Fora de escopo nesta fase

Registrado para evitar mal-entendido sobre o que **não** estamos pedindo agora:

- Escrita de qualquer natureza no ERP (criar cliente, criar pedido, emitir nota).
- Webhooks de saída do ERP para o Torque (notificação em tempo real). É uma evolução desejável para uma segunda fase; a sincronização periódica atende o caso de uso atual.
- Sincronização financeira em tempo real. Latência de 1 a 2 horas é aceitável para inadimplência.

---

## 8. Resumo do que solicitamos

| # | Item | Bloqueia? |
|---|---|---|
| 1 | URL base pública da API (ou definição do modelo de conexão: exposição / túnel / push) | 🔴 Sim |
| 2 | HTTPS com certificado válido | 🔴 Sim |
| 3 | Exemplo real de resposta do `login` + validade e renovação do token | 🔴 Sim |
| 4 | Exemplo real de resposta de `GET /clientes` + dicionário de campos | 🔴 Sim |
| 5 | Qual campo é o identificador imutável do cliente | 🔴 Sim |
| 6 | Parâmetros de paginação e volume atual da base | 🟠 Alto |
| 7 | Filtro por data de alteração (consulta incremental) | 🟠 Alto |
| 8 | Token aceito em cabeçalho HTTP em vez de query string | 🟠 Alto |
| 9 | Endpoints de pedidos, notas fiscais e títulos a receber + enumeração de situações | 🟠 Alto |
| 10 | Usuário técnico dedicado, somente leitura + troca da senha atual | 🟠 Alto |
| 11 | Limites de requisição e janela de manutenção | 🟡 Médio |
| 12 | Ambiente de homologação | 🟡 Médio |
| 13 | Endpoint de produtos | 🟢 Baixo |

**Divisão de responsabilidade:** os itens 1 e 2 (rede e exposição) são da **GON Informática**, que responde pela infraestrutura da Café Jurerê. Os demais são do fornecedor do ERP Toth. Os dois caminhos correm em paralelo — nenhum depende do outro para começar.

---

# Adendo — resposta do fornecedor, 18/08/2026

O fornecedor respondeu e entregou a maior parte do que foi pedido. Esta seção
registra o que ficou resolvido, o que mudou de entendimento e o que segue aberto.
**Em conflito, vale este adendo, não as seções acima.**

## A.1 Resolvido

| # | Item | Como ficou |
|---|---|---|
| 1 | Endereço público | ✅ `http://cafejurere.ddns.net:8080/toth/services` |
| 3 | Contrato do login | ✅ `{"login":"…","user":"…","token":"…"}` |
| 4 | Estrutura de `/clientes` | ✅ Exemplo real recebido |
| 5 | Identificador imutável | ✅ `codigoCliente`; CNPJ em **`numeroInscricao`** |
| 9 | Títulos a receber | ✅ `POST /cobrancas` criado |

Três coisas do retorno real que corrigiram suposições nossas:

- **O CNPJ chama `numeroInscricao`.** Não existe campo `cnpj` no cadastro.
- **Contato vem em lista, não em campo.** `emails[]` e `telefones[]`, com o
  telefone partido em `prefixoArea` + `numero` e um marcador `isWhatsApp`.
- **A mesma API usa dois formatos de data.** `aaaa-mm-dd` no cadastro,
  `dd/mm/aaaa` no financeiro.

E um comportamento que muda o desenho do cliente HTTP: **a expiração do token é
sinalizada no corpo** (`[{"error":"Acesso nao autorizado! "}]`), com status HTTP
não especificado. O token, nas palavras do fornecedor, "não tem tempo definido
(aleatório), mas expira". Nosso client trata o corpo como fonte da verdade.

## A.2 Aberto — e agora com uma via para resolver

O fornecedor ofereceu construir endpoints sob medida: *"outros endpoint eu posso
estar solicitando pra fazer, como será especial para vocês pode passar os
parâmetros e o retorno desejado."* Os pedidos abaixo estão em ordem de valor.

### A.2.1 🔴 `dataPagamento` no retorno de `/cobrancas`

O retorno traz `valorPago`, mas **não traz quando foi pago nem um campo de
situação**. Consequências diretas na tela de Inadimplência:

- pagamento **parcial** não tem como ser distinguido de "não pago";
- **não é possível medir prazo médio de recebimento** — o indicador que responde
  "meu cliente paga em dia?" não pode ser calculado.

Pedido: acrescentar `dataPagamento` (vazio quando em aberto) e, se existir no
Toth, o campo de situação do título com a lista de valores possíveis.

### A.2.2 🟠 Filtro por data de alteração

Um parâmetro `alteradoApos=aaaa-mm-dd` em `/clientes` e `/cobrancas`. Sem ele,
toda sincronização relê a base inteira. Com ele, lê dezenas de registros em vez
de milhares — menos carga no servidor de vocês, e sincronização mais frequente.

### A.2.3 🟠 Pedidos de venda

Cabeçalho (número, data, cliente, valor total, situação) e itens (produto,
quantidade, valor unitário). É o que fecha os três momentos do dinheiro:
`/clientes` dá o **quem**, `/cobrancas` dá o **recebido**, e falta o **vendido**.

### A.2.4 🟡 Paginação em `/clientes`

Confirmar se o endpoint aceita paginação e qual o volume total da base. Hoje
assumimos varredura completa com parada por página repetida.

### A.2.5 🟡 Token em cabeçalho

Segue valendo o pedido da seção 3.3: `Authorization: Bearer` ou `X-Auth-Token`,
em vez de `?token=`. Na query, a credencial fica gravada em log de proxy e no
cabeçalho `Referer`.

## A.3 🔴 O que NÃO foi resolvido: HTTPS

O endereço entregue é `http://` puro. Usuário, senha e token trafegam **em texto
claro pela internet aberta**, e o token vai na query string, que é o lugar mais
registrado de uma requisição. Não é uma questão de conformidade abstrata: quem
estiver no caminho de rede lê a senha do ERP e passa a conseguir tudo que ela
consegue.

Isso é assunto da **GON Informática**, não do fornecedor do ERP, e continua sendo
o único item verdadeiramente bloqueante do ponto de vista de segurança. Duas
saídas, ambas de baixo custo:

- **Cloudflare Tunnel** na frente do serviço — entrega HTTPS válido, dispensa
  abrir porta no firewall e permite exigir token de serviço na borda;
- **proxy reverso com Let's Encrypt** no mesmo servidor, publicando apenas o
  path `/toth/services`.

Enquanto isso não existe, a integração do Torque só aceita esse endereço com um
**aceite explícito de tráfego sem criptografia**, registrado por organização —
não é o comportamento padrão do produto, e a tela de configuração exibe o aviso
de forma permanente, não só no momento da configuração.

## 9. Próximo passo

Os itens 1 a 5 são suficientes para iniciarmos o desenvolvimento da primeira fase (sincronização de clientes). Os demais podem chegar em paralelo, sem travar o início.

Ficamos à disposição para uma conversa técnica de 30 minutos com quem mantém a API do Toth — costuma ser mais rápido que a troca por escrito, e podemos fechar os itens 3, 4 e 5 na própria chamada.

---

*Documento gerado para a issue SCRUM-229. Contexto arquitetural interno: ADR-0020 — camada de ERP neutra em relação ao fornecedor.*
