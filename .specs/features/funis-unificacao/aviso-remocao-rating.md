# Aviso — API do Torque: o campo `rating` sai do lead

> **Rascunho para envio pelo CTO.** O envio é decisão dele: canal, data e
> recorte da audiência.
>
> **Audiência sugerida — dois grupos, mensagens diferentes:**
>
> | Grupo | Quem | Por quê |
> |---|---|---|
> | **A — precisa agir** | Orgs com chave de API ativa que leem ou escrevem `rating` | É o único grupo cuja integração muda de comportamento. |
> | **B — só informação** | As 48 orgs com leads marcados na tela (`rating <> 0`) | Não têm integração; para elas isto é sumiço de um controle na interface, e quem conta isso é a nota de versão, não um e-mail de API. |
>
> Para levantar o grupo A antes do envio: cruzar `api_keys` ativas com quem
> chamou `PATCH /api/v1/leads/{id}` com `rating` no corpo, ou `GET /leads`, nos
> últimos 90 dias. Sem esse recorte, o aviso vai para 49 orgs e 47 delas não
> entendem do que se trata — e aviso que não se aplica a você ensina a ignorar
> o próximo.

---

## Assunto: Mudança na API: o campo `rating` do lead será removido

Olá!

Vamos aposentar o campo **`rating`** (a nota de 0 a 10 do lead) na API do
Torque. Se a sua integração não menciona `rating` em lugar nenhum, **nada muda
para você** e pode parar de ler aqui.

### O que muda, e quando

**A partir de agora**

- **Leitura** (`GET /api/v1/leads` e `GET /api/v1/leads/{id}`): o campo
  `rating` continua aparecendo na resposta, mas **sempre com o valor `null`**.
- **Escrita** (`PATCH /api/v1/leads/{id}`): o campo `rating` continua sendo
  **aceito** no corpo da requisição e passa a ser **ignorado**. Nenhuma
  chamada sua vai falhar por causa dele — o resto do PATCH é aplicado
  normalmente.

**A partir de 03/11/2026**

- O campo `rating` **sai da resposta** e sai da especificação OpenAPI.

Fizemos nessa ordem de propósito: primeiro o valor vira `null` (estado que a
API já emitia para os leads sem nota), depois a chave some. Assim você tem a
janela inteira para ajustar sem nenhuma chamada quebrada no meio.

### Por que estamos removendo

O Torque tinha **duas** notas de calor medindo a mesma coisa: o `rating` na
pessoa e um "calor" no negócio dentro do funil. Elas nunca concordaram, e nem
podiam: quem não tinha nota era lido como "5" — o meio da régua. Ou seja, o
sistema inventava um valor morno e depois deixava você filtrar por ele.

Em vez de escolher uma das duas e manter a confusão, removemos as duas. A
priorização de lead passa a ter **um lugar só**.

### O que fazer se você lia esse campo

Use **`qualification_score`** (0 a 100), que continua na API, nos mesmos
endpoints, e é calculado pelo Torque a partir do comportamento real do lead —
em vez de depender de alguém lembrar de clicar nas estrelas.

| Se você fazia... | Passe a fazer |
|---|---|
| Ler `lead.rating` para priorizar | Ler `lead.qualification_score` |
| Filtrar por nota mínima | Filtrar por `qualification_score` |
| Gravar `rating` no PATCH | Remover o campo do corpo (já é ignorado hoje) |
| Espelhar a nota em outro sistema | Espelhar `qualification_score`, ou uma **etiqueta** própria, se a régua for sua |

Se a sua régua de priorização é particular e não bate com a nossa, o caminho é
**etiqueta** (`tags`): ela é sua, você nomeia, e ninguém aposenta.

### Os seus dados

Nenhuma nota é perdida no caminho: guardamos uma cópia de todas as notas já
registradas antes de remover a coluna. Se você precisar delas para migrar
para outro campo, é só pedir — respondemos com a exportação da sua
organização.

### Dúvidas

Respondam este e-mail ou abram um chamado dentro do Torque. Se você quiser
que a gente olhe a sua integração junto antes de 03/11, é só dizer.

Abraço,
Equipe Torque CRM
