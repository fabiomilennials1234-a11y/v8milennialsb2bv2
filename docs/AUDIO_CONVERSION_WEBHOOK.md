# Conversão de áudio recebido para MP3 (webhook)

Áudios recebidos pelo WhatsApp (Evolution) costumam vir em OGG/WebM. Para que todos os áudios reproduzam em qualquer navegador (incluindo Safari/iOS), o webhook pode converter o áudio para MP3 antes de salvar no Storage.

## Comportamento

- Se **AUDIO_CONVERSION_API_URL** estiver definida nas variáveis de ambiente da Edge Function `evolution-webhook`, o áudio recebido (tipo `audio` ou `ptt`) é enviado para essa API; a resposta em MP3 é salva no Storage e a mensagem usa essa URL.
- Se a variável não estiver definida ou a API falhar, o áudio é salvo no formato original (comportamento atual).

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `AUDIO_CONVERSION_API_URL` | Não | URL do serviço que converte áudio para MP3 (ex.: sua própria Edge Function ou ConvertAPI). |
| `AUDIO_CONVERSION_API_KEY` | Não | Chave de API, enviada em `Authorization: Bearer` e `X-API-Key`. |

## Contrato da API de conversão

- **Método:** POST  
- **Body (JSON):** `{ "base64": "<conteúdo base64 do áudio>", "mimeType": "audio/ogg" }`  
- **Resposta esperada:**  
  - **Opção 1:** corpo binário com `Content-Type: audio/mpeg` (ou `application/octet-stream`).  
  - **Opção 2:** JSON `{ "base64": "<conteúdo base64 do MP3>" }`.

Assim, você pode usar um serviço externo (ex.: ConvertAPI, CloudConvert) ou uma Edge Function própria que use FFmpeg para converter OGG/WebM em MP3.
