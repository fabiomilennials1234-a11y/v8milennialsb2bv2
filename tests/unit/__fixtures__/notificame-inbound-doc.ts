/**
 * Corpos derivados da DOC do fornecedor — NÃO medidos em produção.
 *
 * Arquivo separado de `notificame-inbound-real.ts` de propósito. Lá está o que o
 * fornecedor comprovadamente manda; aqui está o que ele DIZ que manda, e as duas
 * coisas já divergiram: a doc não menciona `postback` em lugar nenhum, e ele
 * chegou; e ela descreve `contents` como string serializada, enquanto todo corpo
 * real traz um array.
 *
 * Fonte: https://app.notificame.com.br/docs/api.md — a versão de 167 KB, que é a
 * que a SPA oficial carrega. O host `hub.` serve uma cópia menor e desatualizada,
 * também com HTTP 200.
 *
 * ⚠️ Os envelopes da doc são de ENVIO. O de recebimento é assumido simétrico, o
 * que é uma aposta — por isso o parser lê por chave presente e tolera variação,
 * e por isso estes casos estão marcados aqui e não lá.
 */

const ENVELOPE = {
  id: "doc-0001",
  type: "MESSAGE",
  channel: "whatsapp_business_account",
  direction: "IN",
  timestamp: "2026-08-19 10:00:00 am",
  subscriptionId: "d1205fbe-99c7-4744-ac6b-899cfbf03179",
  providerMessageId: "doc-provider-0001",
};

/** Doc, seção "Enviar localização": os campos ficam NO NÍVEL do content. */
export const LOCALIZACAO_DOC = {
  ...ENVELOPE,
  message: {
    id: "doc-0001",
    from: "554884334050",
    to: "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    direction: "IN",
    contents: [
      {
        type: "location",
        longitude: -48.310882,
        latitude: -25.510785,
        name: "Name of location",
        address: "Address of location",
      },
    ],
  },
};

/** Doc, seção "Enviar contato". */
export const CONTATO_DOC = {
  ...ENVELOPE,
  message: {
    id: "doc-0002",
    from: "554884334050",
    to: "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    direction: "IN",
    contents: [
      {
        type: "contacts",
        contacts: [
          {
            name: {
              formatted_name: "Notificame Test",
              first_name: "Notificame",
              last_name: "Test",
            },
            phones: [{ phone: "+55 44 99999-9999", wa_id: "5544999999999", type: "WORK" }],
            emails: [{ email: "test@example.com", type: "WORK" }],
          },
        ],
      },
    ],
  },
};

/**
 * Escolha numa mensagem de lista.
 *
 * A doc do fornecedor documenta o ENVIO da lista (`interactive.type = "list"`);
 * o corpo de RETORNO é o da Meta, `list_reply` dentro de `interactive`. Nunca
 * observado nesta integração — a primeira lista ainda não foi enviada.
 */
export const ESCOLHA_DE_LISTA_DOC = {
  ...({
    id: "doc-0003",
    type: "MESSAGE",
    channel: "whatsapp_business_account",
    direction: "IN",
    timestamp: "2026-08-19 10:00:00 am",
    subscriptionId: "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    providerMessageId: "doc-provider-0003",
  }),
  message: {
    id: "doc-0003",
    from: "554884334050",
    to: "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    direction: "IN",
    contents: [
      {
        type: "interactive",
        interactive: {
          type: "list_reply",
          list_reply: {
            id: "sku-4471",
            title: "Cabo de aço 6mm",
            description: "Rolo com 100 metros",
          },
        },
      },
    ],
  },
};
