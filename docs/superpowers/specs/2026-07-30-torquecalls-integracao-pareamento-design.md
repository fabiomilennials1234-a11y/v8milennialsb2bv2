# TorqueCalls como integração do CRM — pareamento self-service

**Data:** 2026-07-30
**Autor:** CTO (decisões) + Claude (levantamento e desenho)
**Estado:** aprovado para plano de implementação

## Problema

A chamada de voz existe e funciona, mas ligar um número a ela hoje exige rodar
um script de terminal contra a VPS. Cliente não faz isso. Enquanto o
pareamento não tiver superfície no produto, a voz é uma feature construída e
nunca ligada.

Três achados do levantamento explicam por que não é só "criar uma tela":

1. **Não existe tela de pareamento em lugar nenhum.** `createSession` e
   `pairSession` só vivem na edge function `torquecalls-control`, e as funções
   `torquecalls-*` existem **apenas em produção** — em dev devolvem 404.
2. **O script que existe na VPS está morto.** `capture-qr.sh` manda
   `X-API-Key`, o esquema fail-open do espelho AstraCalls. O binário atual
   exige token Ed25519 assinado pelo CRM e responde 401 sem explicação.
3. **`createSession` não liga `voice_calls_enabled`.** Sem isso o cliente
   pareia com sucesso e toda ligação continua recusada com
   `voice_calls_disabled`, na raiz, dentro de `fn_voip_call_reserve`.

## Fatos que moldam o desenho

Levantados contra o código e o banco de produção, não deduzidos.

- **Voz é capacidade de um número que já existe.**
  `voip_sessions.whatsapp_instance_id` é `NOT NULL` com FK para
  `whatsapp_instances`. A tela não cria números; ela liga voz nos que a
  organização já tem.
- **O QR não é imagem persistida.** Diferente do Uazapi, que guarda base64 em
  `whatsapp_instances.qr_code`, o QR do TorqueCalls é string crua, entregue só
  pelo SSE `/api/events`, rotaciona a cada ~20 s e nunca é gravada. O código
  chama isso de credencial, textualmente: *quem o lê pareia o WhatsApp da
  organização*.
- **O front nunca consumiu SSE.** O único `setInterval` em `useVoiceCall` é
  renovação de token. O transporte escolhido aqui será o primeiro, e é o mesmo
  que a chamada entrante vai usar nas fatias seguintes.
- **`EventSource` nativo não aceita header `Authorization`,** e token em query
  string está proibido no projeto — `exchangeSdp` documenta o porquê: query
  vaza para log de proxy, histórico e `Referer`.
- **Distribuição real de números por organização** (56 orgs, 137 instâncias):
  40 orgs com 1 número, 7 com 2, 6 com 3, 1 com 4, 1 com 5, 1 com 56.
- **Custo medido de uma sessão pareada em repouso:** 10,28 MiB e 0,00% de CPU.
  O `mem_limit` do container é 2 GB.

## Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | Transporte do QR: **SSE direto no navegador**, via `fetch` + `ReadableStream`, com `streamToken` no header | Único caminho que não persiste credencial nem afrouxa o desenho de segurança. O leitor é reaproveitado pela chamada entrante, então não é custo perdido. |
| D2 | **Duas chaves em série** para a voz: `voice_calls_enabled` acompanha parear/desconectar (chave do cliente); gate de organização controla quem vê a integração (chave nossa) | Dá autonomia no uso diário sem perder o kill-switch. Derrubar o gate tira a integração da tela, e não há botão para o cliente religar. |
| D3 | Teto de números de voz **configurável por organização**, padrão 10 | Cobre 55 das 56 orgs com folga e resolve a de 56 números por exceção, sem abrir para todos. Substitui o `MAX_SESSIONS_PER_ORG = 2` escrito à mão. |
| D4 | Escopo v1: **parear e desconectar**, só | Estado ao vivo, teto diário editável e consentimento de voz ficam para depois. |

### Sobre D2, em detalhe

`voice_calls_enabled` é lida por `fn_voip_call_reserve` antes de qualquer outra
coisa. `false` mata a ligação sem tocar a VPS. Hoje nasce `false` nas 137
instâncias e nada a liga.

Na v1: o pareamento concluído liga; desconectar desliga. O gate de organização
é independente e prevalece — sem ele a integração não aparece, e o cliente não
tem como religar nada.

O gate é uma feature de organização nova, `voice_calls`, no mesmo mecanismo que
as demais integrações já usam (`OrgFeaturesContext` / `org_features`). Hoje não
existe nenhuma feature de voz cadastrada — foi conferido. Ela nasce desligada
para todas as organizações, e o `IntegrationsCatalog` só mostra o cartão do
TorqueCalls quando ela estiver ligada. Isso vale também para o servidor: as
ações de `torquecalls-control` verificam a mesma feature, porque um gate só de
interface não é gate.

### Sobre D3, em detalhe

`MAX_SESSIONS_PER_ORG = 2` é constante em `torquecalls-control`, de quando nada
tinha sido medido. Vira a coluna `organizations.voice_sessions_cap`, do tipo
`integer NOT NULL DEFAULT 10`, com `CHECK (voice_sessions_cap >= 0)`. A edge
function passa a ler dela em vez da constante. Diferente de `daily_call_cap`,
aqui `0` significa mesmo zero: organização sem direito a número de voz. O
limite real
não é por organização e sim global: 137 sessões em repouso dariam ~1,4 GB dos
2 GB do container. **O custo de uma chamada ativa nunca foi medido nesta VPS** —
é ele que decide quantas ligações simultâneas a caixa aguenta, e continua
desconhecido. Ver Riscos.

## Arquitetura

`TorqueCallsSettings` entra no `IntegrationsCatalog` como os irmãos
(`WhatsAppSettings`, `OmieSettings`), renderizado no modal do catálogo. Os
hooks e a lib ficam em `communication`, onde `torquecallsApi` já mora, e são
consumidos pelo barrel `@/modules/communication`.

A tela é a lista de números de WhatsApp da organização, cada um com voz ligada
ou desligada, respeitando o teto de D3.

### Unidades

| Unidade | Responsabilidade | Interface |
|---|---|---|
| `communication/lib/torquecallsEvents.ts` | Esconde `fetch`, `ReadableStream`, parse de `data:` e renovação de token | `subscribeSessionEvents({ sessionId, onEvent, signal }): Promise<void>` |
| `communication/lib/torquecallsApi.ts` | Ganha `createSession`, `logoutSession`, `deleteSession`; `requestStreamToken` ganha `pair` | funções nomeadas, uma por ação |
| `communication/hooks/useVoipSessions.ts` | Lista de sessões da org (o hook atual é singular) | `useVoipSessions(): UseQueryResult<VoipSession[]>` |
| `communication/hooks/useVoicePairing.ts` | A máquina de estados do pareamento | `useVoicePairing(instanceId)` |
| `communication/components/voice/VoicePairingDialog.tsx` | O modal: QR renderizado, rotação, estados | props: `instanceId`, `open`, `onOpenChange` |
| `platform/components/settings/TorqueCallsSettings.tsx` | A lista, as ações e o teto | sem props (padrão dos irmãos) |

`torquecallsEvents` é a unidade que justifica o desenho: recebe o `fetch` por
injeção, então o parse de SSE — evento partido entre chunks, `data:` de várias
linhas, renovação no meio do stream, cancelamento — é testado sem navegador e
sem VPS.

### Fluxo do pareamento

```
ocioso
  │ cliente clica "Ativar voz" num número
  ▼
criando sessão ──── createSession({ whatsapp_instance_id })  [torquecalls-control]
  │                 devolve tc_session_id, status pending
  ▼
pedindo credencial ─ requestStreamToken({ tc_session_id, pair: true })
  │                 [torquecalls-signal] devolve token de 60 s + vps_url
  ▼
aguardando QR ───── subscribeSessionEvents() abre o SSE
  │                 evento session-qr
  ▼
QR na tela ──────── renderizado no cliente; rotaciona a cada ~20 s
  │                 cliente escaneia
  ▼
pareado ─────────── liga voice_calls_enabled, fecha o modal, invalida a lista
```

Desconectar: `logoutSession` e `voice_calls_enabled = false`.

O token de stream vale 60 s e a resposta já traz `renew_in_ms`; a renovação
acontece dentro de `torquecallsEvents`, invisível para quem consome.

## Erros

Nenhum destes tem tradução hoje. Todos são silenciosos ou crus, que é o modo
de falha que este projeto mais paga caro.

| Situação | O que acontece hoje | O que a tela faz |
|---|---|---|
| WhatsApp com 4 aparelhos já vinculados | erro cru da VPS | explica o limite do WhatsApp e o que desvincular |
| Teto de números atingido (D3) | HTTP 409 `session_cap_reached` | mostra o teto **antes**, na lista, e desabilita a ação |
| QR expira sem ninguém escanear | nada | oferece gerar outro, sem recriar a sessão |
| Sessão nasce na VPS e fica órfã no CRM | `session_orphaned`, já previsto no código | explica e oferece a adoção que a rota já implementa |
| SSE cai no meio | nada | reconecta uma vez; falhando, oferece recomeçar |

## Segurança

- O QR é credencial. Não é persistido, não vai para log e não sai do stream
  autenticado. `streamToken` só emite `pairSid` para quem é admin da org ou tem
  `voip.session.manage` — a checagem já existe em `torquecalls-signal`.
- Token no header, nunca em query string.
- O gate de organização (D2) é a chave que o cliente não alcança.
- Nada aqui afrouxa a exigência de consentimento de voz para `outbound`, que
  segue valendo em `fn_voip_call_reserve`.

## Testes

Toda asserção de fronteira nasce com uma planta que a deixa vermelha. Nesta
sessão dois "verdes" eram falsos — um por comando ausente, outro por catálogo
sem seed — e só apareceram quando o defeito oposto foi plantado.

- `torquecallsEvents`: evento partido entre dois chunks; `data:` de várias
  linhas; renovação de token no meio do stream; `abort` encerrando limpo.
- `useVoicePairing`: a máquina inteira, incluindo QR rotacionando e pareamento
  concluindo; e o caminho de erro de cada linha da tabela acima.
- `TorqueCallsSettings`: teto respeitado, ação desabilitada no limite, cada
  erro traduzido.
- Integração: `voice_calls_enabled` verdadeiro depois de parear e falso depois
  de desconectar — com planta que prova a asserção, porque é exatamente o elo
  que hoje está faltando.

## Fora de escopo

Estado da sessão ao vivo; teto diário editável na tela; superfície de
consentimento de voz do lead; escolher de qual número ligar no `ChatHeader`
quando houver mais de um. Todos dependem desta fatia e vêm depois.

## Riscos e desconhecidos

- **Custo de chamada ativa não medido nesta VPS.** Sessão em repouso custa
  10 MiB; chamada com áudio, opus e SRTP não foi medida. É o número que decide
  quantas simultâneas a caixa aguenta. Medir antes de subir
  `-max-calls-per-session` acima de 8.
- **Memória global do container.** 137 sessões pareadas dariam ~1,4 GB de 2 GB.
  O teto por organização não protege disso; um teto global protegeria.
- **As funções `torquecalls-*` só existem em produção.** Testar esta tela em
  desenvolvimento exige apontar o front local para o Supabase de produção, o
  que significa dado real de cliente na tela. Enquanto não houver deploy em
  dev, essa é a condição de trabalho.
