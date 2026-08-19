/**
 * Corpos REAIS de eventos de entrada do NotificaMe, extraídos de produção.
 *
 * Origem, verificável:
 *
 *   select raw_payload from channel_messages
 *    where direction = 'incoming'
 *      and (instance_id = '7312692e-b9b4-4f90-aba3-09cff992bbfc'  -- Chique, WhatsApp oficial
 *           or messaging_channel_id is not null)                   -- as 4 caixas de Instagram
 *
 * ⚠️ GERADAS, não digitadas. Payload copiado à mão testa a cópia, não o
 * fornecedor — e foi assim que `contents[0].url` entrou no parser e nunca casou
 * com nada: o campo dele chama `fileUrl`.
 *
 * A única edição é o bloco `visitor`: nome e foto de pessoa real viram
 * pseudônimo. Ids, telefones, assinaturas de CDN e a ESTRUTURA ficam intactos —
 * é o que o parser lê, e a assinatura do CDN é o que o espelhamento reconhece.
 */

/** A caixa oficial da Chique, do primeiro evento ao último. */
export const CONVERSA_CHIQUE = [
  {
    "id": "f1a73670-36cf-47a8-98de-62f49df0795d",
    "type": "MESSAGE",
    "channel": "whatsapp_business_account",
    "message": {
      "id": "f1a73670-36cf-47a8-98de-62f49df0795d",
      "to": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
      "from": "554884334050",
      "channel": "whatsapp_business_account",
      "from_id": "BR.4118747468417357",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "text": "Olá, testando a conexão",
          "type": "text"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-18 07:03:28 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-18 07:03:28 pm",
    "subscriptionId": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    "providerMessageId": "U2hTM01ZaXNNL0VhWk5tWG9uTFBPMmM3K0xyM1ZHVmpUd0YzcXVCN0NwcUlrd216MUk4WDJkSjM4aUJzcHJHS0gwNEkwMHlSOE11U1oxNmxMaEtjcjArMURGa1dGSDI2NWp6dis5ck9GaVE9"
  },
  {
    "id": "c239eb64-8961-4028-ba33-ea0818274118",
    "type": "MESSAGE",
    "channel": "whatsapp_business_account",
    "message": {
      "id": "c239eb64-8961-4028-ba33-ea0818274118",
      "to": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
      "from": "555596705908",
      "channel": "whatsapp_business_account",
      "from_id": "BR.1777660836943212",
      "visitor": {
        "name": "Cliente Dois",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Dois"
      },
      "contents": [
        {
          "text": "oi",
          "type": "text"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 11:31:38 am"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 11:31:38 am",
    "subscriptionId": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    "providerMessageId": "MWpRZ2NNMVVZOFZDU0JXZzJ3OHpLVS9jRXVDd1NkbjhlQ0E3YkdrY3g1ektoU3phQVhuL1p2UkxKMFlhSUtKaFVUZXhmWndJRXBkT1R0RFMrTlhMUFl4U3JWRzJzOXoxVXRPRzhWM2lrY1U9"
  },
  {
    "id": "61b5500f-fb9d-4ccb-8c4f-6044eda41a4b",
    "type": "MESSAGE",
    "channel": "whatsapp_business_account",
    "message": {
      "id": "61b5500f-fb9d-4ccb-8c4f-6044eda41a4b",
      "to": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
      "from": "554884334050",
      "channel": "whatsapp_business_account",
      "from_id": "BR.4118747468417357",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "text": "SHOW",
          "type": "text"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 02:57:33 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 02:57:33 pm",
    "subscriptionId": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    "providerMessageId": "U2hTM01ZaXNNL0VhWk5tWG9uTFBPMmM3K0xyM1ZHVmpUd0YzcXVCN0NwcVRuNm9HOTdGUFBaRWtDSFhqSCsxei9SaFdhV1BLY0p2dVlvZ0FGcUFNS1A5VktCWGRlWE4zeEM2bEt1OCttcUE9"
  },
  {
    "id": "00f00e04-6d98-41a8-b29f-491b7d9cac47",
    "type": "MESSAGE",
    "channel": "whatsapp_business_account",
    "message": {
      "id": "00f00e04-6d98-41a8-b29f-491b7d9cac47",
      "to": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
      "from": "554884334050",
      "channel": "whatsapp_business_account",
      "from_id": "BR.4118747468417357",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "text": "teste real time",
          "type": "text"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 02:57:50 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 02:57:50 pm",
    "subscriptionId": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    "providerMessageId": "U2hTM01ZaXNNL0VhWk5tWG9uTFBPMmM3K0xyM1ZHVmpUd0YzcXVCN0NwcEk2U1JiUXQvUnFnVW5rL2VlaG9xQzNManFXSEVySmVXRS9LNnlPcXJTRWxQOXAwVnN6TzltUGJEUHJ4M1NveWs9"
  },
  {
    "id": "ebaec818-e3cb-4695-a70b-f7a19957fcb9",
    "type": "MESSAGE",
    "channel": "whatsapp_business_account",
    "message": {
      "id": "ebaec818-e3cb-4695-a70b-f7a19957fcb9",
      "to": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
      "from": "555596705908",
      "channel": "whatsapp_business_account",
      "from_id": "BR.1777660836943212",
      "visitor": {
        "name": "Cliente Dois",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Dois"
      },
      "contents": [
        {
          "text": "oi",
          "type": "text"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 03:01:22 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 03:01:22 pm",
    "subscriptionId": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    "providerMessageId": "MWpRZ2NNMVVZOFZDU0JXZzJ3OHpLVS9jRXVDd1NkbjhlQ0E3YkdrY3g1d25LdEYrT216VS9FemRXaGpjSlg4OGpZelJaR2NvMmpjZ3RFb3VRT0w4WUZZRkFqdGZOOEpCTlpSYXN0VG8wNkU9"
  },
  {
    "id": "38c2bfb2-1b12-464d-accd-50caf8b90903",
    "type": "MESSAGE",
    "channel": "whatsapp_business_account",
    "message": {
      "id": "38c2bfb2-1b12-464d-accd-50caf8b90903",
      "to": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
      "from": "554884334050",
      "channel": "whatsapp_business_account",
      "context": {
        "id": "U2hTM01ZaXNNL0VhWk5tWG9uTFBPMkdxcnFoN1psZGtHcnd0M0g2NW92MkRsZ0ZjYjVJdEk0cXR6NVpIajQvL2RmaDVmcDFMaDRSUU1Mc2EreDFCOUE9PQ==",
        "from": "5555924815238"
      },
      "from_id": "BR.4118747468417357",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "type": "button",
          "button": {
            "text": "Sim",
            "payload": "Sim"
          }
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 10:27:33 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 10:27:33 pm",
    "subscriptionId": "d1205fbe-99c7-4744-ac6b-899cfbf03179",
    "providerMessageId": "U2hTM01ZaXNNL0VhWk5tWG9uTFBPMmM3K0xyM1ZHVmpUd0YzcXVCN0NwcXM4UDUyYS9lcTdDRFJLWnVETzFYTkNXSU80WFJ4RmJDZ3JnRkExWmdvTzdSL2MzRTRyQklLclA5Vm1GVWNSaTg9"
  }
] as const;

/** Uma amostra de cada tipo já visto nas 4 caixas de Instagram. */
export const AMOSTRAS_INSTAGRAM: Record<string, unknown> = {
  "audio": {
    "id": "e293886c-2e4d-4dc5-be63-69a12cfd347d",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "e293886c-2e4d-4dc5-be63-69a12cfd347d",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "932631639884808",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Três",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Três"
      },
      "contents": [
        {
          "type": "audio",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1734912694399353&signature=Ab242dZLwSanKv1wI1J_j1ccs7XTr5W-jo9GDFUi9e0HHKIdMsfQS6QbeOILLgZ26oBVXvjdpDvDd_PUor9LJIjW6dtE50oiQ7n3-q5VXW962ecQi8Kw-TOO3TeuLxKVB5oYwA-Qes3AN67eb0BJhtb2aqLNrPoKmt9XbfFIAOPIkLYyCd7EYFUaGMer5l6HSOXtFHunz_z6TVq4AohX0CJfuPOBF8Q",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 08:04:15 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 08:04:15 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUNxT1BJOEF0T0lGUU4rMGpKMk1KaElUalhnMnhvaDVZOWFwMXNmcVFCbmdGY2dDQWZVSTFxNk83N01uTWFBVEtqbVY3d0xpNFhERWoyNVJyN1NpenY3ZjBHRXlQaXZFVS9oY05YQzRDbnlQcmUvSWNHWE1laDhxaGFESnlFcjU4az0="
  },
  "comment": {
    "id": "22950293-4b90-4970-a30d-27b603ae912a",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "22950293-4b90-4970-a30d-27b603ae912a",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "1078047038064386",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Quatro",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Quatro"
      },
      "contents": [
        {
          "id": "18107047847134558",
          "text": "Valor",
          "type": "comment",
          "media": {
            "id": "18455456323117865",
            "link": "https://www.instagram.com/reel/DYiXxQlB8a1/",
            "caption": "Moto elétrica 3000W vs Bicicleta elétrica de dois motores \n\nR300 e X100 Elite, as queridinha da @goletric \n\n85KM/H vs 55KM/H\n\n#bikeeletrica #bicicletaeletrica #mobilidadeeletrica",
            "image_url": "https://scontent-iad3-2.cdninstagram.com/o1/v/t2/f2/m86/AQMYJpTPKDL_CE2l9ZpjzsS-pFK-Jw6XHFQL2kBSYlCX20V9aL_21L6jPkxPdQ1vCB6jHnj2M-ozXdKgcx29vdEsghoXcDS8sDDUnJs.mp4?_nc_cat=103&_nc_sid=5e9851&_nc_ht=scontent-iad3-2.cdninstagram.com&_nc_ohc=Pl51945siWQQ7kNvwFgabCt&efg=eyJ2ZW5jb2RlX3RhZyI6Inhwdl9wcm9ncmVzc2l2ZS5JTlNUQUdSQU0uQ0xJUFMuQzMuNzIwLmRhc2hfYmFzZWxpbmVfMV92MSIsInhwdl9hc3NldF9pZCI6MTUzMjg0MjYwNTE3OTkwMiwiYXNzZXRfYWdlX2RheXMiOjkwLCJ2aV91c2VjYXNlX2lkIjoxMDgyNywiZHVyYXRpb25fcyI6MjAsInVybGdlbl9zb3VyY2UiOiJ3d3cifQ%3D%3D&ccb=17-1&vs=47394e3498298b5&_nc_vs=HBksFQIYUmlnX3hwdl9yZWVsc19wZXJtYW5lbnRfc3JfcHJvZC9FQTRFMEI4QzY5RjU4QzQ3MURBMjhBOURBRENCMDVBMF92aWRlb19kYXNoaW5pdC5tcDQVAALIARIAFQIYUWlnX3hwdl9wbGFjZW1lbnRfcGVybWFuZW50X3YyLzFFNDRGMzU3QkUxQjE5OUYyOTNBQzRDQTEzREY0NkE4X2F1ZGlvX2Rhc2hpbml0Lm1wNBUCAsgBEgAoABgAGwKIB3VzZV9vaWwBMRJwcm9ncmVzc2l2ZV9yZWNpcGUBMRUAACb8z9Ovl4e5BRUCKAJDMywXQDRMzMzMzM0YEmRhc2hfYmFzZWxpbmVfMV92MREAdf4HZZapAQA&_nc_gid=uwjeD83ZqzruSLkAvbiEjg&edm=ANQ71j8EAAAA&_nc_zt=28&_nc_tpa=Q5bMBQIQfX8EKam49TxA35YCnDtItRwn23LZgmfCTY4jLg9mvd9UGGMGYIF6q90L_wWx_kqvb5BRFfc4mQ&oh=00_AQFL3WafUrfZtvioAvI9OAlIru92pDjHVEYJ6exl02rPcw&oe=6A8674D8"
          }
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 10:37:08 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 10:37:08 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87"
  },
  "ig_post": {
    "id": "6d5a0dd2-f678-4d32-85b6-76168a4c6d94",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "6d5a0dd2-f678-4d32-85b6-76168a4c6d94",
      "to": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
      "from": "1797289824603894",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "type": "ig_post",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=18388656697166949&signature=Ab1hSqbD4Mk24ZEW3eCJh8xlhJdbVc8fkISZEv09Uthu1AgX7DEGaZpx-VTH5ixIMUPheByxXIt2ksUowIQ44mBL2TdT9ibESyKYM7IlXF7qCC2oBR2A5e6YSb7eIH6yEs1rqstwWwVskXoOkfKkvcsT6oOB7vOIcPd80pPkEYVkvWMRhFvSUvB0NszX5jLroagTjqd7WaUG2dV-EF9ablgGkZtochHo",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 09:27:12 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 09:27:12 pm",
    "subscriptionId": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGR0piVE5zWnE2ZTUwNXhiaGxBMTUwM0Q4M2RRcElubWRtTXJPUWZVamp6V0lTYyt6Z1E1cERDdk1wdzNPRzJLT0k5MVJxbU1WVGFuSGc5T2tZWXJTOURhM21sUTZzTk9qODVuUFpGNG9ldlJTd1lTNVZWdmNJQnZleWIvdm5QOEFSQk9Wbm1maXovdWV0SE9iN0RYWmRIRDFPdEpFTnAwaWlITHM0NlVsZ25SK1FqNFhxc1BXRktJam9jVlM2b1F0cz0="
  },
  "ig_reel": {
    "id": "0ed624c4-6204-45f2-8675-4825b44a352e",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "0ed624c4-6204-45f2-8675-4825b44a352e",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "1524683785192260",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Dois",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Dois"
      },
      "contents": [
        {
          "type": "ig_reel",
          "fileUrl": "https://www.instagram.com/reel/DcAMx69vMsr/",
          "fileName": "DcAMx69vMsr",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 09:42:51 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 09:42:51 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUF0bVNSRDJUU2V6TmZLa1g0NlBTZE1vTmVvbnBZeGZZSkxPNlFTdWNUQUI4dnpRNUh3R3lJUXpoNTM3c2FIUUR2RGl6Q1JZMENIVjdXTTVtbHBQYkRiL3JtdnZVVGFoNjlnVEhZMDZtZk9iQyttMzl6ekVITy84RCs3TlhXNElPQT0="
  },
  "image": {
    "id": "0dae49fa-8807-4981-8dd7-588224c9f79b",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "0dae49fa-8807-4981-8dd7-588224c9f79b",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "24613954364877163",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Três",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Três"
      },
      "contents": [
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2578845579236720&signature=Ab1H_F4CFVKZpjmXY22_biy-9o8wc7u0ZUbVbQPO5_UpgMuOoqBX7FBwtBF5hq9YLK_CA6OgNfUh8tfALRcrVEJnH4AocrgBCmFChCHFQKpXvTzrNHAIgvXGMgB-avJjOzOY43a4NP-zaUXjjjEPs79yLZjg9WsHFZc2KD5OZsR8v2TbpGZAgFQY-f9TSyf_h7iWiIo7iUHr2tUmuF-GeD0uayXJ5VQ",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 02:33:32 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 02:33:32 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUFVNTV6endaQStoZFl6dGRrQnBkNjVzbUoxSTJhUlFaVUd5RDM2dklFN3lwcTd5amxqbzUybnhockdFekM5MXduTjBaMkNzcXB3aHF5d29xdmNkeDR2RkxOQkJVRmNPOG5GNEY0Mm85a3VFSHViZlc0ZmlQRUUvS1VUSnBBWjNoND0="
  },
  "reaction": {
    "id": "ae285e3e-4f6f-4167-9aa4-4448c1ec7935",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "ae285e3e-4f6f-4167-9aa4-4448c1ec7935",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "1443473977311602",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Quatro",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Quatro"
      },
      "contents": [
        {
          "type": "reaction",
          "reaction": {
            "emoji": "👍",
            "reaction": "like",
            "reaction_to": {
              "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaURlZHpRaEl5ZUpZbTdtNjVKdzM4cVhOWkRXRnVKYnJPc0lqNDUreUJvK1hRWkhTbTRzU2o0amdDaFF0dVoxZ3VzQVZuVWk3ZGZiaTFudFJrMUdSTEhxTUtXVVZoT3hKallSWE14cEtISXlSZGp1dkhOc0kxTnZTYVMzM2xLQXlpMD0="
            }
          }
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 02:56:02 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 02:56:02 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87"
  },
  "story": {
    "id": "fa31ae3b-4a4f-47e2-bd2d-d277afe51f8e",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "fa31ae3b-4a4f-47e2-bd2d-d277afe51f8e",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "1023506896947002",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "text": "Olá, tenho uma Coswheel comprada sábado , aceita ela como entrada ?",
          "type": "story",
          "story": {
            "id": "17894632266391566",
            "url": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=17894632266391566&signature=Ab0WLRJ2Vu-7jCRZ20QSLTd3mfdAFXLkTJVFl1aEHh_63VVH6i05eInny4RsBxwBqpfj4WkF-B1sbd-VpB9ndVHHrVTAKxNGgE6mZKVJ8CiTBZcpwhOepr-aNK-glxVwIPvH6fhk1we1gVvOMa8vPqdIb2o-hXKVrnIqs6RSGi39BowbmOXYWyIf9Q8fusv5SYoziXAfbsCnxGQ4bhBdWTiXieGLjYOB"
          }
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 09:49:33 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 09:49:33 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUFkWlJuclIzRExRQVZBWDRCdFN3SmREcURpUXFXcWNyZFU2c0RrekcxY2FuNUFiWUlUT2hSdXZlUkxlRW0zWlBweTJ3cGFLY3NqdThYUDNQQzIrT2RneEhoZmtHMUJpSEdQZDBYNitxQU9KZnBYeU9pYjRCdnhHVC9qZ0tueW9nVT0="
  },
  "story_mention": {
    "id": "6b99fe97-a1ce-493b-9219-fc707339d63d",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "6b99fe97-a1ce-493b-9219-fc707339d63d",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "1959576684648462",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Dois",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Dois"
      },
      "contents": [
        {
          "type": "story_mention",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=18107771444028486&signature=Ab2cZEzuUtHClwp5yS59Sf6fA6EOna4uZMtXf5bxT4-7q3PioJ1Tsvx-k28RokaAuAa_Rok7p3shqeslrH0URQeAbrFsiUdtuKqqQjtdQEIbe2we1ocBr11WDNFUXL75Ury4Bl5IWnaEo37AQnQH30wm5PQWyGpIK_wfid1f0EhkE-IkJYF6WI7p97oh6IEJnPb-Jkz9XHhPImtQINhFutRgG_Jq2mSo",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 02:31:48 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 02:31:48 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUNhcmhBTWkrSW51b3hJbHlxREtjdlZCL3diQVF4a21BTldydSs4VTV4emZlUnU1cEtPeWNVekl6UmY3S0NnOXR4NEh1Qy96UWRTV2IxVXpKTmJkMC9NOE8vekdpSGxrOCtIQ2Y5aUNaQnpCb1N5RkdCcVAwa1RBZm9tWDhBdmZUdz0="
  },
  "text": {
    "id": "958e076f-023b-4f93-94b0-c3a877151585",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "958e076f-023b-4f93-94b0-c3a877151585",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "1254940770035695",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Três",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Três"
      },
      "contents": [
        {
          "postback": {
            "title": "Liberar catálogo",
            "payload": "ACT::fb208a323c1a3e6a2059909870cee8ab",
            "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUFldU85aWJwdlZuUHc0VFZvSnNXWHNsdi9MbWZ5OUdpWkJoOCtBTGxESkZqWlVKY0owS0g5cWczYksyalp3UGc4bVFrSnR4WVZuQUJ0dzNzaytlUEtaUnM1enVPZUxWaXZ4cjB4U0xadTdQaWlNT25nRHF0NnYrRnJyVzgySVNETT0="
          }
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-19 10:54:05 pm"
    },
    "direction": "IN",
    "timestamp": "2026-08-19 10:54:05 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87"
  },
};

/** O clique de botão que abriu a fatia — última mensagem da conversa da Chique. */
export const CLIQUE_DE_BOTAO = CONVERSA_CHIQUE[CONVERSA_CHIQUE.length - 1];

/** Reação com `reaction_to`, o único corpo que aponta para outra mensagem. */
export const REACAO = AMOSTRAS_INSTAGRAM["reaction"];
