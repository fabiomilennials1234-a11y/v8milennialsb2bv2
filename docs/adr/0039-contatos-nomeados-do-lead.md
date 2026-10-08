# 39. Contatos nomeados do lead: vários telefones, cada um com o nome de quem atende

Date: 2026-10-08

## Status

Accepted

Chamado **82c50502** (Café Jurerê). Ordem dos Chamados decidida pelo CTO em 08/10:
**93027ffb** (CPF/CNPJ editável, já em main) → **82c50502** (este) → **793f4b05** (N donos, rebaseia
sobre a assinatura nova de `abrir_negocio`).

## Context

"Sistema puxa no cliente somente um contato." No ERP Toth, o cliente tem uma aba **Contatos**: cada
pessoa ("José Luiz - Compras") com seus telefones. O Torque guardava UM número por lead
(`leads.phone`), e o mapper do Toth reduzia `telefones[]` a esse número, descartando o resto e o nome.

### O que foi medido (08/10, `GET /clientes`, só leitura, só contagens)

- Todo item de `telefones[]` traz `prefixoArea, numero, isWhatsApp, nomeContato, idContato`. O
  diagnóstico de 07/10 dizia que telefone não tinha nome: estava errado.
- Café Jurerê: 11.548 clientes, 14.885 telefones, **8.362 (56%) com `nomeContato`**.
- Telefones por cliente: 0→79, 1→8.809, 2→2.120, 3→399, 4→92, 5+→49.
- Contatos nomeados distintos por cliente (agrupando por `nomeContato`): 0→5.172, 1→4.949, 2→1.193,
  3→174, 4→41, 5+→19. **97% dos contatos nomeados têm um telefone só.**
- **`idContato` é o id da LINHA de telefone, não da pessoa**: 14.885 ids distintos para 14.885
  telefones, nenhum repetido.
- 90 clientes repetem o mesmo número em duas linhas.

No banco: `contacts`/`companies`/`deal_contacts` têm 0 linhas, UNIQUE(org, normalized_phone) e RLS na
`get_user_organization_id()` singular. Não servem.

## Decision

1. **Decisões do CTO (não reabrir).** 07/10: vários telefones nomeados no cliente; escolha obrigatória
   do telefone ao abrir negócio em lead com 2+; links (wa.me, "abrir conversa") a partir do escolhido;
   nada de companies/contacts. 08/10: o nome de toda conversa de cliente no chat é
   **`Cód - Nome do contato - Lead`**; os contatos vêm do ERP com o nome.

2. **Modelo: `lead_phones`** (lead_id, label, label_locked, phone, normalized_phone, phone_digits,
   is_primary, is_whatsapp, source crm|erp, erp_phone_id, soft delete) e **`deals.lead_phone_id`**.
   - `leads.phone` continua sendo o principal; um gatilho espelha o principal em `lead_phones` (mão
     única). Trocar o principal é `UPDATE leads.phone`; o número antigo fica como contato.
   - "Contato" na UI é o agrupamento por `label` dentro do lead. **Não há entidade pessoa**: com 97%
     dos contatos tendo um telefone, criar a tabela agora é escopo sem retorno.
   - Sem UNIQUE por org: o mesmo número existe em dois clientes do ERP.
   - `deals.lead_phone_id` é `ON DELETE SET NULL` (não RESTRICT): `lead_phones` some em cascata
     quando o lead é purgado ou a org apagada, e RESTRICT travaria a purga.

3. **`idContato` = `erp_phone_id`**, chave estável do sync. **Nunca agrupa pessoa** — pessoa é o
   mesmo `nomeContato`.

4. **O ERP sugere, o CRM manda.** O sync:
   - insere o telefone que o lead ainda não tem (`source='erp'`);
   - atualiza o nome de linha `erp` não travada; em linha `crm` só preenche o que está vazio;
   - nunca ressuscita telefone apagado no CRM (o UNIQUE de `erp_phone_id` inclui as apagadas);
   - nunca mexe em `is_primary`, nunca apaga, **nunca sobrescreve `leads.phone`** — nem em
     `canonical` (o modo deixa de escrever `phone` em cliente existente; só preenche vazio).
   - Nome editado no CRM liga `label_locked`; dali em diante o ERP não toca mais naquele nome.

5. **As três portas que criam negócio.**
   - `abrir_negocio(..., p_lead_phone_id DEFAULT NULL)`: informado → tem de ser telefone ativo do
     mesmo lead (`lead_phone_invalid`); omitido por **humano** com 2+ telefones → `lead_phone_required`;
     com 1 telefone grava esse. Workflow/import/API não são obrigados.
   - `api_create_deal(..., p_lead_phone_id)`: opcional, valida posse, não exige. O hash de
     idempotência só inclui o telefone quando ele vem (chaves antigas continuam batendo).
   - `garantir_negocio_da_entrada`: assinatura igual; grava o telefone só se o lead tem exatamente 1.
   - A assinatura antiga das duas primeiras é dropada na mesma migration (sobrecarga faria o PostgREST
     escolher a errada).

6. **Webhook.** `resolve_message_lead_id` mantém as 3 passadas em `leads.phone_digits` e ganha a 4ª, em
   `lead_phones` ativas da org (dígitos exatos, depois `normalize_br_mobile`). Número em mais de um
   lead: vence o que tem negócio aberto com aquele telefone, depois o telefone atualizado por último,
   depois o id. Determinístico. Telefone que entra no lead adota mensagens órfãs do mesmo número.

7. **Nome no chat** (flag `chat_nome_cod_contato_lead`, só WhatsApp e não grupo):
   `withErpCode(contato ? "contato - lead" : lead, erpCode)`. Sem contato: `Cód - Lead`. Sem código:
   `Contato - Lead`. Contato igual ao nome do lead não se repete. Código já digitado no nome não
   duplica (o `withErpCode` é idempotente). Lista, topo e painel usam a mesma função. A flag nova vence
   `chat_nome_do_lead`, que vence `chat_nome_do_whatsapp`; sem ela nada muda em nenhuma org.
   **Código e contato nunca são gravados em `leads.name`**: disparo, Copilot e `{{nome}}` seguem com o
   nome puro.

## Consequences

- O vendedor escolhe com quem fala: no negócio (seletor obrigatório com 2+ telefones) e no painel do
  chat ("Falando com", nomear contato, abrir conversa com outro contato do lead).
- Mensagem de qualquer telefone do lead cai no lead; `lead-service` não cria lead duplicado para o
  número secundário.
- Disparo, Copilot e workflows continuam no telefone principal. Disparo por telefone secundário fica
  fora deste ADR.
- E-mails do ERP com nome de contato (2.193 clientes) ficam fora.
- N donos (793f4b05) vale aqui sem mudança: a RLS de `lead_phones` herda a visibilidade do lead por
  `EXISTS` em `leads`.
