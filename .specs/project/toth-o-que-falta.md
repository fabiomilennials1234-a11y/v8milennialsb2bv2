# ERP Toth — o que falta para entrar em operação

**SCRUM-229 · PR #1649 (base `develop`) · 18/08/2026**

Documento de pendências, organizado **por quem executa**. Cada bloco pode ser
enviado isolado ao responsável.

---

## Onde estamos

O código está pronto e revisado: 5 commits no PR #1649, 32 arquivos, gates verdes
(`lint`/`typecheck`/`test` ratchet, build, `deno check`, 131 testes). O que
existe hoje:

| Camada | Estado |
|---|---|
| Cofre de credenciais (AES-256-GCM, deny-all) | ✅ pronto |
| Guarda anti-SSRF da `base_url` | ✅ pronto |
| Cliente HTTP (login, reautenticação, `POST` de formulário) | ✅ pronto |
| Mapeadores (clientes + cobranças) fixados no payload real | ✅ pronto |
| Sync de clientes e de cobranças | ✅ pronto |
| Tela de conexão + card no catálogo | ✅ pronto |
| Manifesto de capacidades (`clientes`, `receivables`) | ✅ pronto |

**Nada disso está rodando.** A migration não foi aplicada, as edge functions não
foram deployadas, e o ERP ainda responde sem TLS. As seções abaixo são o caminho
entre "código pronto" e "cliente usando".

---

## 🔴 Bloco 1 — GON Informática (rede)

### 1.1 HTTPS no endereço do Toth

**Hoje:** `http://cafejurere.ddns.net:8080/toth/services` — sem certificado.

**Por que bloqueia:** usuário, senha e token trafegam em texto claro pela
internet aberta, e o token vai na query string, que é a parte mais registrada de
uma requisição (log de servidor, log de proxy, cabeçalho `Referer`). Quem estiver
no caminho de rede lê a senha do ERP e passa a conseguir tudo que ela consegue.

**O que resolve**, em ordem de preferência:

- **Cloudflare Tunnel** na frente do serviço — entrega HTTPS válido, dispensa
  abrir porta de entrada no firewall e permite exigir token de serviço na borda.
- **Proxy reverso com Let's Encrypt** no mesmo servidor, publicando **apenas** o
  path `/toth/services`.

**Não serve:** liberação por IP no firewall. O consumidor é uma função
serverless, que não tem IP de saída fixo — a allowlist ou cai de forma
intermitente, ou precisa ser tão ampla que deixa de proteger. A restrição tem que
ser por credencial (token no cabeçalho ou mTLS).

**Pronto quando:** `curl https://<host>/toth/services/users/login` responde com
certificado válido.

> Enquanto isso não existir, a integração só conecta com **aceite explícito de
> tráfego sem criptografia**, marcado por organização. Funciona, mas a tela
> mantém o aviso permanente e o card do catálogo mostra "Conectado · sem
> criptografia".

---

## 🟠 Bloco 2 — Fornecedor do ERP Toth

**Respondido em 18/08, 15h31–15h48.** Os quatro pedidos enviados de manhã
voltaram assim:

| Pedido | Resposta |
|---|---|
| Data de pagamento em `/cobrancas` | "Daria pra colocar a última data de pagamento" — ofertado, sem prazo |
| Filtro por data | "Pode usar esse parâmetro" → `dataInicio` / `dataFim` (`dd/MM/yyyy`) |
| **Pedidos de venda** | **"Vamos solicitar para desenvolver"** — em desenvolvimento |
| Paginação, volume, token em cabeçalho | "Vou passar para nossa equipe analisar" |

Também confirmou que **não existe campo de situação** e que `valorDocumento` é o
**saldo** — as duas informações que corrigiram o cálculo de inadimplência.

O que segue aberto, em ordem de valor:

### 2.1 `dataUltimoPagamento` no retorno de `/cobrancas`

**Hoje:** o retorno traz o saldo, mas não **quando** foi pago.

**Por que importa:** sem essa data não há **prazo médio de recebimento** — o
indicador que responde "meu cliente paga em dia?". O saldo diz *quanto* falta, não
*como* esse cliente se comporta.

**Estado do nosso lado:** o mapeador já procura o campo (`dataUltimoPagamento`,
`dataPagamento`, `ultimoPagamento`, `dtPagamento`). Quando passar a vir, aparece
sem mudança de código — é deploy, não desenvolvimento.

**Pronto quando:** o campo vem preenchido nos títulos quitados e vazio nos em
aberto.

### 2.2 Qual campo `dataInicio` / `dataFim` filtram?

**Hoje:** os parâmetros existem e estão implementados, mas **desligados**.

**Por que:** não sabemos se a janela recorta por **data de emissão** ou por **data
de vencimento**. A diferença é material — filtrar por emissão numa janela recente
**perde títulos antigos ainda em aberto**, que são exatamente os inadimplentes,
ou seja, o motivo de a integração existir. Aplicar um filtro cujo significado não
se conhece descarta linhas em silêncio, e título que some da inadimplência não
gera erro: gera cobrança que não acontece.

**Pronto quando:** houver resposta por escrito. Aí a janela vira sincronização
incremental por padrão, e a carga no servidor deles cai.

### 2.3 O `cnpj` é obrigatório em `/cobrancas`?

**Hoje:** consultamos cliente a cliente — uma requisição por CNPJ.

**Por que importa:** se o endpoint aceitar `cnpj` vazio e devolver o período
inteiro, trocamos centenas de chamadas por uma. Menos carga no servidor deles,
sincronização muito mais rápida, e some o teto de clientes por execução.

**Pronto quando:** houver resposta. Se for sim, a função de sync muda de laço
para chamada única.

---

## 🟡 Bloco 3 — Nosso (infraestrutura)

Ordem importa: cada passo depende do anterior.

### 3.1 Aplicar a migration

`supabase/migrations/20270817100000_toth_foundation.sql` — cria
`toth_connections` e `toth_connection_secrets`. Só schema, sem DML.

**Pronto quando:** as duas tabelas existem no alvo, com RLS ligada.

### 3.2 Definir `TOTH_ENCRYPTION_KEY`

Chave AES-256 em hex — **32 bytes, 64 caracteres hex**.

Sem ela, `toth-connect` recusa gravar credencial (falha explícita, não silenciosa).

> ⚠️ Rotacionar essa chave depois **invalida as credenciais já guardadas** — a
> decifra falha e a org precisa reconectar. Guarde onde as outras chaves de
> integração vivem.

### 3.3 Deployar as 5 edge functions

`toth-connect` · `toth-disconnect` · `toth-probe` · `toth-sync-clientes` ·
`toth-sync-cobrancas`

`toth-probe` é a ferramenta de diagnóstico: descreve a **forma** de um retorno do
ERP (campo, tipo, formato, taxa de preenchimento) **sem devolver valor nenhum**.
Vale deployar junto — é ela que vai fixar o contrato dos endpoints novos que o
fornecedor construir.

### 3.4 Regenerar os tipos e remover a ponte

Depois do apply, regenerar `src/integrations/supabase/types.ts` e **apagar**
`src/modules/integrations/lib/toth-table.ts`, trocando `tothConnectionsTable()`
por `supabase.from("toth_connections")` em `hooks/useToth.ts`.

A ponte existe porque `types.ts` é gerado do **prod**, e a tabela ainda não está
lá. As instruções de remoção estão no cabeçalho do próprio arquivo.

### 3.5 🔴 Agendar a sincronização — ainda NÃO existe

**Lacuna identificada em 18/08.** As duas funções de sync aceitam
`x-cron-secret`, mas **nenhum job foi criado**. Hoje elas só rodam pelo botão
"Sincronizar agora" da tela.

Consequência: sem alguém clicando, a carteira não atualiza e a inadimplência
envelhece sem avisar — falha silenciosa, do tipo que só aparece quando alguém
estranha o número.

Falta uma migration de `cron.schedule` nos moldes de
`schedule_omie_sync_dispatch`. Cadência proposta: **clientes 1× por dia**,
**cobranças a cada 2 horas**. A ordem importa — cobranças são buscadas por CNPJ
de cliente já casado, então clientes roda antes.

### 3.6 Conectar a org da Café Jurerê

Org `4922638c-4909-494e-ba10-12282ec0b161`. Precisa de:

- usuário técnico dedicado, **somente leitura** (o usuário atual foi compartilhado
  por canal não cifrado e deve ser considerado comprometido — **trocar a senha**);
- endereço do ERP;
- aceite de tráfego sem TLS, enquanto o bloco 1 não estiver resolvido.

---

## 🟢 Bloco 4 — Produto (o que sobra depois de tudo rodar)

### 4.1 Inadimplência não tem tela

`useTitulos` e `useNotasFiscais` existem e **não têm nenhum consumidor**. O dado
chega ao banco, o gate de capacidade está ligado, mas nenhuma superfície da
Carteira renderiza títulos.

Ou seja: terminado o bloco 3, o Toth sincroniza e **ninguém vê o resultado**.
Esta é a fatia que transforma dado em produto — receita em risco por cliente,
lista de atrasados, e o alerta que faz o vendedor agir.

### 4.2 Pedidos de venda — 🟢 em desenvolvimento no fornecedor

Fecha o ciclo dos três momentos do dinheiro. Hoje temos o **quem** (clientes) e o
**recebido** (cobranças); falta o **vendido**.

O fornecedor respondeu "vamos solicitar para desenvolver" em 18/08. Quando o
endpoint existir, o trabalho do nosso lado é: mapeador → `toth-sync-pedidos` →
`TOTH_CAPABILITIES.syncPedidos: true`. O manifesto declara `false` hoje, e a
tela do Toth lê dele, então a linha "Pedidos de venda" acende sozinha na hora em
que a capacidade virar — sem edição de texto.

**Ao receber o endpoint:** rodar `toth-probe` contra ele antes de escrever
mapeador. É para isso que a ferramenta existe — descreve a forma do retorno sem
devolver dado de cliente, e evita repetir o erro de mapear por suposição (foi
assim que `numeroInscricao` e o saldo passaram despercebidos na primeira volta).

---

## Caminho crítico

```
GON: HTTPS  ─────────────────────────────┐
                                          ├──> 3.6 conectar a org ──> 4.1 tela de inadimplência
3.1 migration ─> 3.2 chave ─> 3.3 deploy ─┤
                              3.4 tipos   │
                              3.5 cron ───┘

Fornecedor: 2.1 data de pagamento ──> prazo médio de recebimento
            2.2 semântica da janela ─> sync incremental
            2.3 cnpj opcional ───────> 1 chamada em vez de N
```

Os três blocos correm **em paralelo**. O bloco 3 não espera ninguém — dá para
aplicar, deployar e agendar hoje, e a integração já funciona com o aceite de
tráfego sem TLS. O bloco 1 remove um risco real de segurança. O bloco 2 melhora
o que já funciona.

**O único item que trava valor de negócio é o 4.1**: sem tela, a integração
sincroniza para ninguém.
