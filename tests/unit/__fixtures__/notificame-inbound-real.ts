/**
 * Corpos REAIS de eventos de entrada do NotificaMe, extraídos de produção.
 *
 * Origem, verificável:
 *
 *   select raw_payload from channel_messages
 *    where direction = 'incoming'
 *      and (instance_id = '7312692e-b9b4-4f90-aba3-09cff992bbfc'  -- Chique, WhatsApp oficial
 *           or messaging_channel_id is not null)                   -- as 2 caixas de Instagram
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

/** Uma amostra de cada tipo já visto nas 2 caixas de Instagram. */
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
    "id": "a7cf9fa4-4c9a-4cf8-985b-e7ac86ed9449",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "a7cf9fa4-4c9a-4cf8-985b-e7ac86ed9449",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "1408118237296130",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Quatro",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Quatro"
      },
      "contents": [
        {
          "id": "18608852215040282",
          "text": "Valor ?",
          "type": "comment",
          "media": {
            "id": "18148980826506280",
            "link": "https://www.instagram.com/reel/Dbt5dh9BduB/",
            "caption": "X100 Elite ✅\n\n✅ 2x Baterias (até 100km de autonomia)\n✅ 2x Motores (1750W de potência)\n✅ Desempenho e elegância \n\nDisponível a pronta entrega na Goletric \n\n#bikeeletrica #bicicletaeletrica #mobilidadeeletrica",
            "image_url": "https://scontent-iad3-1.cdninstagram.com/o1/v/t16/f2/m84/AQNfTHmQjao5wItKhCJbIvtFvtC60z2vwFq_BNwVDzpChZrl0xTLVsKHVNRIVgYJTrqFHYk3Chg2Q2iL9HWc8RZHLt1iiUuHq1v6Fks.mp4?_nc_cat=101&_nc_sid=5e9851&_nc_ht=scontent-iad3-1.cdninstagram.com&_nc_ohc=y8CV6bUBhMAQ7kNvwFu3c2v&efg=eyJ2ZW5jb2RlX3RhZyI6Inhwdl9wcm9ncmVzc2l2ZS5JTlNUQUdSQU0uQ0xJUFMuQzMuNzIwLmRhc2hfYmFzZWxpbmVfMV92MSIsInhwdl9hc3NldF9pZCI6MTY0OTAzODkyOTUyODczNywiYXNzZXRfYWdlX2RheXMiOjExLCJ2aV91c2VjYXNlX2lkIjoxMDgyNywiZHVyYXRpb25fcyI6MTUsInVybGdlbl9zb3VyY2UiOiJ3d3cifQ%3D%3D&ccb=17-1&vs=4ad09c56cb013d79&_nc_vs=HBksFQIYTGlnX2JhY2tmaWxsX3RpbWVsaW5lX3ZvZC8xNjRDNzUxODczRTY1MEY2NzdBRUMzNENEM0Y2MUE5M192aWRlb19kYXNoaW5pdC5tcDQVAALIARIAFQIYUWlnX3hwdl9wbGFjZW1lbnRfcGVybWFuZW50X3YyLzBENEU1MzZEOUE2Mzg4MTc2MkZCQjQ5Q0NFQ0FEQjg4X2F1ZGlvX2Rhc2hpbml0Lm1wNBUCAsgBEgAoABgAGwKIB3VzZV9vaWwBMRJwcm9ncmVzc2l2ZV9yZWNpcGUBMRUAACbCnuy52fLtBRUCKAJDMywXQC_dsi0OVgQYEmRhc2hfYmFzZWxpbmVfMV92MREAdf4HZZapAQA&_nc_gid=hVML0HM2rhTthzu_pmlchQ&edm=ANQ71j8EAAAA&_nc_zt=28&_nc_tpa=Q5bMBQIYOrbjoXaHd9zHp6sb31XwJ0OWtEWyMtkNiIpUfr7ImTM7wXJ3f2KRAhOSvoa4dyOk-ywwp5oROQ&oh=00_AQEz7Tik2HAr0G7JdGjf7FhnHpN111lccOXfE_J9NKjfug&oe=6A868573"
          }
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-20 01:33:48 am"
    },
    "direction": "IN",
    "timestamp": "2026-08-20 01:33:48 am",
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
    "id": "7484d839-e893-4d81-accb-4ad13630abd4",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "7484d839-e893-4d81-accb-4ad13630abd4",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "1064842539301868",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "text": "GHLVAN",
          "type": "story",
          "story": {
            "id": "18111183607824293",
            "url": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=18111183607824293&signature=Ab1E2UwE2Fw7iur2mGrTJEhExYqB5u2iNIOyaIAqRqVU0Yr-yJfnrjD8q1q-YKMx5wgDd8Au0NIANh37JX8R_GKBncRFLgGVW1xVFaaZPPYY_zi_aY0idD_lrD3nVKzxMVNlnXsqaoEb2D8_O8K2U3Tb97BnPcqt-KJ78AIoY0IjGrzTeriFUQdKINVNmmHcyNL7g1roJRuo2Q5aWzDX7b8qIDRVbQts"
          }
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-20 01:16:42 am"
    },
    "direction": "IN",
    "timestamp": "2026-08-20 01:16:42 am",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUE1REpCTnRndjExK0xxZ1doelRDVFdSUHZKeERFVHR4MTQwVTBySDM3dk85TGhDenhHK1huZDdoR1RaZ3VYbWxveTd1a2k0MmxTSUhOUHJWNlEzeGlMUzBwa0l1Zm9yMW1ORFR6VTRrWm9TdGF4NDdsWHFzQVVUZkswd0hndTdSaz0="
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
    "id": "98db22a8-aefd-4a92-a3bf-d7b0694bf3c8",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "98db22a8-aefd-4a92-a3bf-d7b0694bf3c8",
      "to": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "from": "27580288268339817",
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
            "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUJaTGE3bEJ3Vm9nR3pIcW9sSFpLSVJ5c255ZDdtY1ZaUm1jVUZtZW9LTDZjNUkvNVd5cTUyV2NXREZoWmtyeWRXT3c4Qm5MVXFOZ25tazVXNGJROVNmR1hZcHEzL3hBUlJKelBwNElFYUkwcytKdkJWdHRtcUgrcGd2cVczQ1F1bz0="
          }
        }
      ],
      "direction": "IN",
      "timestamp": "2026-08-20 01:51:27 am"
    },
    "direction": "IN",
    "timestamp": "2026-08-20 01:51:27 am",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87"
  },
};

/** O clique de botão que abriu a fatia — última mensagem da conversa da Chique. */
export const CLIQUE_DE_BOTAO = CONVERSA_CHIQUE[CONVERSA_CHIQUE.length - 1];

/** Reação com `reaction_to`, o único corpo que aponta para outra mensagem. */
export const REACAO = AMOSTRAS_INSTAGRAM["reaction"];

/**
 * Eventos de SAÍDA — as respostas que o vendedor deu pelo aplicativo.
 *
 * 193 destes foram descartados entre 17 e 19/08/2026, em 51 conversas, sob o
 * rótulo `unreadable_direction` — que mente: a direção é `"OUT"` e o parser a lê
 * perfeitamente. O guard parkava tudo que não fosse `incoming`.
 *
 * ⚠️ NELES O INTERLOCUTOR TROCA DE LADO. `message.to` é o cliente;
 * `message.from` é o id do CANAL, não uma pessoa; e `visitor` descreve QUEM
 * MANDOU — o vendedor. Ler o contato como se fosse entrada criaria uma conversa
 * fantasma, endereçada ao id do canal e batizada com o nome do vendedor.
 */
export const SAIDAS_DO_APLICATIVO: Record<string, unknown> = {
  "audio": {
    "id": "14dd991c-c539-40d2-8ba4-fcc09de7972c",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "14dd991c-c539-40d2-8ba4-fcc09de7972c",
      "to": "1040563002306564",
      "from": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Quatro",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Quatro"
      },
      "contents": [
        {
          "type": "audio",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1068876578858048&signature=Ab1a6HgCa12-tJOC0Z9OAovswJpzxxtWQ25N9ktYI1Cyy1l_3XL-sR9CY_Rwf8KTrwom6Hp9vBkc9iA0qPzPclZHeg_8hMTxJLuyt--Esjqvxmm1gu9iR_ppXSdP9y34qmWv-DgmJlkqBOB23zUW5wW-R7_LvYx1jm-HCMFENCEUiLusSFqMwFIxpcTjjvCwbJelGu_pWx5aPIDXio6HfYV53gwA-ZE",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "OUT",
      "timestamp": "2026-08-19 07:17:17 pm"
    },
    "direction": "OUT",
    "timestamp": "2026-08-19 07:17:17 pm",
    "subscriptionId": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGR0piVE5zWnE2ZTUwNXhiaGxBMTUwM0Q4M2RRcElubWRtTXJPUWZVamp6V0lTYyt6Z1E1cERDdk1wdzNPRzJLT0syTDNLR0NHVzZsaWRXQmx4WjNJTTc5RGRKb0RJZFVST2ZpTzdnekN5cUxWTjVDRkg3M1d0dnhvZldLeXB4SXQ5cTUrL0tGdkpEeW9nZFVUZ0RpSTZWeUNyekdCb3RxNFlmNG5MaUZCWGVTZkdOZXh3cngzQzNVbkVka2QxcHRBcz0="
  },
  "ig_post": {
    "id": "cc734bfb-ee45-4edb-8b9e-d46ab4c49126",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "cc734bfb-ee45-4edb-8b9e-d46ab4c49126",
      "to": "1797289824603894",
      "from": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Quatro",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Quatro"
      },
      "contents": [
        {
          "type": "ig_post",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=18036351014823984&signature=Ab23d3V0SeCfKNAolE9o_-cMeAhRk_vnUhpc8XCrXCTlCpY_Mnr86aR4vfgnfEGS3FY0TKogL1P_1w7KxuYmj-H-WV5-eG9ng2I93RbunZKBXcSHOSWxICDZYPkNaZtBDiouDx3SdhKdEFk8gddKD34qwR1km9uxpl6gL5fE9iw-XccOXzkUYiA8TWyRq1L7OiRy8KoVxHS4hLZ5wYojbfYi8EmFVYux",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "OUT",
      "timestamp": "2026-08-18 06:28:22 pm"
    },
    "direction": "OUT",
    "timestamp": "2026-08-18 06:28:22 pm",
    "subscriptionId": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGR0piVE5zWnE2ZTUwNXhiaGxBMTUwM0Q4M2RRcElubWRtTXJPUWZVamp6V0lTYyt6Z1E1cERDdk1wdzNPRzJLT0k5MVJxbU1WVGFuSGc5T2tZWXJTOURhM21sUTZzTk9qODVuUFpGNG9ldlJiOEw2Ty9xQk9jL1JOWEZQQTJ0a3dwSXFoeU5xUktsVVNDbS9hL1BJWUwxQWl6bGxtQWN2THVsK3VqeExKcm1ON04wd3R5WWRDaTFwYXFqc0h6TFRoQT0="
  },
  "ig_reel": {
    "id": "8fd39215-506f-482f-848d-e2e9fad38ae1",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "8fd39215-506f-482f-848d-e2e9fad38ae1",
      "to": "1848701096490207",
      "from": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Quatro",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Quatro"
      },
      "contents": [
        {
          "type": "ig_reel",
          "fileUrl": "https://www.instagram.com/reel/DcKDoHEvB41/",
          "fileName": "DcKDoHEvB41",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "OUT",
      "timestamp": "2026-08-18 12:00:44 am"
    },
    "direction": "OUT",
    "timestamp": "2026-08-18 12:00:44 am",
    "subscriptionId": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGR0piVE5zWnE2ZTUwNXhiaGxBMTUwM0Q4M2RRcElubWRtTXJPUWZVamp6V0lTYyt6Z1E1cERDdk1wdzNPRzJLT0thcHZwcnFQVWJjZ3ZpYmxjQ0U4c2tQRmIvYTJsOE9BdUVqYko2VGRmWi92UFlrejhKemVLeEc3TXBLN0lFSklNUjYzblNubHpJNXRIR1BNRGM5a0lWQ0lhakVlSk5jTklZellVeWtjMzZaZy9NWnh5ODdTK2x2NDFFZ3dRcGNmWT0="
  },
  "image": {
    "id": "4a9391c0-1431-45cc-9d6a-d3d0c403a07b",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "4a9391c0-1431-45cc-9d6a-d3d0c403a07b",
      "to": "2157687601828182",
      "from": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1039743868968948&signature=Ab04HvZLTxVrimvupri1xLmgBzPydqzOM7px-JSgNpN7fnhWXgB6rUVYY45D5jKsyCpi8kt5NtlP1vSSFdMRJBcxBQed10N1AmwcdbN6DjNU0Y9islnwfyeHEjMDufXeNfiBCZK7z5lsxry_5zx5ShnlcYm2zN8r_zassdq9YJBH1lU2jgk5yexWEjOCjyfUzmWReIsvlX8W7gAtMKvYWsezhoDnTiw",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1378311073714403&signature=Ab3JPeh1swmYBlAsRR0OQyQXApXjX7nBUFReF3KjdiszZD_zfnoAudPc2NsdN4u0409Yv-TJ2VKsH0VUV6wlDTj-Lf4Jw2ny-CaF4O3z83aGP6s88zjq6YFtvnt4aiuIpgeW9N7jmUSKk4ckiU08Pfaq8FmAWvSk6VHcS8xhUjqb4-19QNeRxjAFdLT1ChddnMiekpru-sYXeX4FPofhpf8eGVvn0Os",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2537240786794018&signature=Ab17kHVV8ukw3TN6zT4DeIWpKRR19XDTGLkyDKR99t2RbhEDuLkmEHfpV8k9vqycQ4u9qQOOTc1Xfm8h-TcWm9tEfcM0WW9LaRljd3u_iODkT888IiP8YKIoMUdV1Cls2Mkm55YbfhiUEHn_gj0eh6iSzBSPn5lDjnvdzJAVcOdQ8fdPQHW2QYnRzUmRJ9SAMUC6j6GYXk5mTRFTsyWJgYfSNP4lxtg",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1219382551269726&signature=Ab1qnxgQRw3sFDRMcordI3ZiwWVYk-PexRYr_ATLex7OJmTmgAhwyqS0Cctbk92cVYCS7v3eTuTgMljWdveZmKB1tResy45VOdbynSReMJJlv2xUY0SY3syg1Owz_DP3GyaH2rA038dGkJZdz_ZFthY2VZuctMPwhKp7MGRRDe7j6DTbiSsvdiuN8qqM4lAgwKh9l8K9OiS6SqXs8kkZvfdbcIfxJK0",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1742720323603541&signature=Ab15rhMVzUev4QzC_MVBF4mEg0tE-ZVt6qg4a221wxglRBWDLd6ZzZNoff9w-TKiZnTSTv-5U996AlnugRN-FR2vO_SdNSlQKNBdZBHzfEd9zRdtuz7PoQSM6twMX3leJW8S-HyPFLT14zqyIl1HGhLJMY1ZDDpLepMpYSZBI9pmTfdiE3cSZyHxK2CYevquSfGA2tT35nhiwKgusKJgknEnFDaD7ok",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=27564365876580019&signature=Ab2mDGLId9nEeWz9WJ73mz5gGPbZILiWsZi4SKVJH5m2MSBh5mD1J8OzC56rpawtd3xm-4juneUxr_PSPb8r3JcKJEDe-5OWODhHkmA3ZVMwEOCM0MiOy1V2NRpPD7D31ov_GiNGJ_CQz-kFddxDdaBpRvJqMFS5ZkeKlKPktOgJkk8QZ7NY3pbIAGpjRmRhLl3rtjrJ4KMk3mzHahQerUW2xjTKmZBB",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1421316576570522&signature=Ab0yUpQ7E5iQEhK5smVMrVhkqQ6ILPv5K1IGUtvA5VU35XMfglzpBa2X1BonmXs3Vb_FIZMgwNwCMWCvuZpQJspG33kZmBvyJleGKI8vdTHuhx3982r5XakR0loSOtqsxC0Sdq583Y9TF8i0nbRFGZAzQrFLm-TQaefJ8Fh345ukUiRravKIUVzrOsqCjT8O4vIBjgMPmiNvxq6XtdwDbt3hqKHEP-8",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2268143690688051&signature=Ab1e3a5FWiaLKi7r3uttJJJnJxL0RHDhFL9jHWkvhtZzILXS0pROT5BbYhS4gVJ9E-SDA0DAk-lclQprnagLOLYspnS2p9hQXBlLPi2TEl51q6zRMEOuMMC2zB5TFtMsiUYKhQ9_H9Lgxo4y4iPJ4BU40xYVusuZTRsZQmAcoCqjO9dtiC6ydx6O4X7h9d1qvVs79XL0kQqH4gwwEziRInF-Uye7-ok",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2264125167695344&signature=Ab36_D13bywQyCAqaNoIfB6rgPfEMfqHaeH2lfU16DkChEwUgfCU06IoWHem5gp7Rh3f3RtRPCwz222XsO8djm2zrFCYv1p-ebbBsQbEC0Oh_kFOLk3egQ8PFems3SvawTpx-ZWWygsjKvigBWszaIYBmNOi2H6IeG35xMq_MuZkm-WRX-0wRAh7XPJh7-OfqnffNz8luvxH1zJzI2YCaFBu3h9nTHo",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1058327887133694&signature=Ab04Acu7PU1mMM7sjZUJ_V-FjD5NZh6KBeV466KtU5xO9HSeJK6-T5gOQlZnuR7jWxyG22O581vYiGuKGygDiNRrPs--QUIKuZJEc8ajlT-eZsyvZIqjgBL2e0fByCTqJSF5anqFP7slu1CfwJr1w_DAHg23RpbQyp6Q_2cSoXZxxz1kplg765KjlBRFvMSIZ8ZJyq2vKQk_kyRJXPTHvTQ7lPTaby4",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1059013086515766&signature=Ab0XBVRTCc35iaXg-V70Jsigb2apn9egpDbZ9Qg_pvNgtzfeULzm9wcU0HXXVUY950BKusn8pfS9BZqNwLUBZ6haYSKlPNMQ_idihfJYTT7uZ9BhJHeuGaYBFG6cnlFeX0gKFzGkdhNhb4b1Mn0NtoV2q9PgExo2LXCikdo1EZcCHCoxAjd5cq5FDQ_d346r7lTFT3DwGJeDIzTHM_jyT1FYPeONpRU",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=903462422487097&signature=Ab23ZvdLnNtLUrUhtDKYkvojJ_PW70r3-VVfAjz0khCXQJtOJueSoMZWeRWI-y4_QyQLoFLrfqoeQfrwNVO5QfocekGYaAAhWUEH-f2VziXuIYctpGvfg2YnnK-gMhXYqQkXvluup3yp0ogGsfZx2nYeYsxLNneyMG7mObMLT7_ood4nDLHsvGC4BHBpl4YtPqOlUWIHhAVYwRIJLvKT5Q46SzcYOw",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=37777664655181357&signature=Ab2hGgtj6zKbg1jsEVqbRLu7fAFkfWBTxVCZ8Nh0PYf6pJGur49QazGxcZ1u5XLzSpZLHCCE2iaXzD1yysZj3feZ7Vljsum2Rc_qPN8JjbGdqEyRNYi99aRY1yVYv2Gr-NWFmegFEvAk4fvKw6Zq2vR0B_uROQwG9377H1RWWLAaU2_h2mN3gF1E5dDdEHGnPy0fNmpHF5KCrp8SLkw9lMm0BawYI8tE",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1782992052948988&signature=Ab1ATv5sMFMzmi0VXFcoAGK0Hd58MHe1S1PVAxJYBnCIr_Lu2N0kn_vcgAeUM6nByHPniZ-nqzXuv0zqCXSmYShQ74N-v0D4qj2D8vN1ikpA2Ns1y1zv2cEZB0MqtA2ab6Cmudp6a5F6dc3yxzDsunHHeshmRfivFq6N3ihQ_dmyHVJDtm1YbleOcw8z7wa6Md9Nii7GcrRhvuSBTt5Vi5g030xK1sA",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        },
        {
          "type": "image",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1403832948352589&signature=Ab3IH6GLjv3Z6mpMUq7hLb9nunjBso_8vUMmnKLZ5nJkXWwPV0vk2v_GXmV4BM-Hwi_6O1MbPCX7Ex-NgvLTpM6Vcq4QIFwA-rxs69Q4HLM5_3UuUVcsY3V3Xct_q_kMl_KXnxZym7aVG_T6-5VITopLp99LB_gpXDY_4w2EhrRt3JOgebeJvdx6mv24E8nBxzun0yviX-SXXe8sgRkxib_pUZpKjD8",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "OUT",
      "timestamp": "2026-08-19 04:13:26 pm"
    },
    "direction": "OUT",
    "timestamp": "2026-08-19 04:13:26 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUJUQjVhRkc0T21lOVZWLzM4S2Iyd2ZSck1FNmRQcXpnaytTRjk3M0tCQ0trbVJpNGttUnFzYVlVQWg0V0RVWEd4T2NGQ3E4MkU4cFpoR3FVdmp6VUpvMEhjditrQk5QTE9YaUx6S3RiZWNRbC9ERWs2SGRKQmdtdHdKZ1Iwalh2ST0="
  },
  "story_mention": {
    "id": "7daea4e4-633b-4111-89b7-cf32405afd73",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "7daea4e4-633b-4111-89b7-cf32405afd73",
      "to": "940408022430143",
      "from": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Quatro",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Quatro"
      },
      "contents": [
        {
          "type": "story_mention",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=18018243095881343&signature=Ab1yOasm3FvSfqXcwfgI45NL0Kv2NyXWlXAdrDLzhrpVZUyDf8-i0aNjnog7KYpPsvS8pzgT4OKsltuLO1Vp7eQzoTyZbTHUG52WrYvXSexXKwUf8GULNyZjhZmUNMJqPJUyHop7GRm31QwnR0TAo7tM_6dHm2QYEmhNH7sG4bqXdeWAWpIjmy3uiBU__c0R7deSUsKgwD-XJ022gicXui41FjLMUPhQ",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "OUT",
      "timestamp": "2026-08-18 11:20:45 pm"
    },
    "direction": "OUT",
    "timestamp": "2026-08-18 11:20:45 pm",
    "subscriptionId": "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGR0piVE5zWnE2ZTUwNXhiaGxBMTUwM0Q4M2RRcElubWRtTXJPUWZVamp6V0lTYyt6Z1E1cERDdk1wdzNPRzJLT0wyQ05CaTdnaldPdzVwL1YyTG56RWRaWjQ5Uk02TEVuYXFFY0VnNmdKOHF3Tis0LzhSbm5QZ3pCTlR5NHhRbVVKOXlFcEJVOUlzekZwbFlwRW5BRlVUQ3VtZVFmVTVQbUkxWURYNm02YjlLSjhQMWZxMXcvZ3BlNFlDSDU2d3Y5dz0="
  },
  "text": {
    "id": "d067fe36-df12-48f5-b9a9-3480f4897ca3",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "d067fe36-df12-48f5-b9a9-3480f4897ca3",
      "to": "24613954364877163",
      "from": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "text": "Claro, me fala seu número para te chamar pfv",
          "type": "text"
        }
      ],
      "direction": "OUT",
      "timestamp": "2026-08-19 09:29:18 pm"
    },
    "direction": "OUT",
    "timestamp": "2026-08-19 09:29:18 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUFVNTV6endaQStoZFl6dGRrQnBkNjVzbUoxSTJhUlFaVUd5RDM2dklFN3lsczF4YXVzTXkxWUoycEE5Z2VUYTNxNnRkMjQxWHJSVVQraldJb1loTnFWUytnZDFONzZ6QW5JVVViWnNuQU92ellnSWJTWUE2UHBPNTZPblkxQUhwaz0="
  },
  "video": {
    "id": "a855d430-30d8-4cbd-b65a-43ae2291e0c2",
    "type": "MESSAGE",
    "channel": "instagram",
    "message": {
      "id": "a855d430-30d8-4cbd-b65a-43ae2291e0c2",
      "to": "932631639884808",
      "from": "ff596caa-2374-4591-8a51-3e8f27417c87",
      "channel": "instagram",
      "visitor": {
        "name": "Cliente Um",
        "picture": "",
        "lastName": "",
        "firstName": "Cliente Um"
      },
      "contents": [
        {
          "type": "video",
          "fileUrl": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1288557636548007&signature=Ab35HqLO35-BLBY8yhvScXJJbfoTZzQU7SrO2cXXB-osQ2NjEUnNq7Z_5RdjnH1FE84A0FDPx3yuQMZvvSnDXshgePjfstN2TqkiCHOWiI3l7e6ixoo3chrW45HkYmu1S7tly2kmsYtZVGx9IVvd-hUAaFm4sIw52BEBZg_FRrkBVE3SNIkhXGyTsVShEX_FowG-3naU8oFEJ0aHEZifUdlYqc7irHA",
          "fileName": "ig_messaging_cdn",
          "fileMimeType": "text/html"
        }
      ],
      "direction": "OUT",
      "timestamp": "2026-08-19 03:20:41 pm"
    },
    "direction": "OUT",
    "timestamp": "2026-08-19 03:20:41 pm",
    "subscriptionId": "ff596caa-2374-4591-8a51-3e8f27417c87",
    "providerMessageId": "dGg3ZzQwYnh3cFMwcWl2VDRFb0VDVWZ3TnFOVXRndTVqc2hDWFhqQjNGSHBoN243V1BNS2NFZTBpODg2cmVhcVhJbFlEMFBCT0I3SitDaEhoMWNqaVFTakdBNkFZc3lyL0JUaHFSUnhIaUNxT1BJOEF0T0lGUU4rMGpKMk1KaElUalhnMnhvaDVZOWFwMXNmcVFCbmdKTS9FRHdKQVdrVTJBbmtnaUFTbkcxcGNkUXlhcUh0TXZnSnFHNWpkM0gxOC85TUgvSzN2V2pSeFpUUmx0dWRmcnNKUVJDZEd6YUhIN1ZTalVYNDVoOD0="
  },
};
