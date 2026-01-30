# Por que os áudios não tocavam e como foi resolvido

## O que impedia os áudios de tocar ao clicar

Três coisas podiam impedir a reprodução ao clicar no player:

### 1. CORS (principal)

- O áudio fica no **Supabase Storage** (bucket `media`), em um domínio como `https://xxx.supabase.co`.
- A aplicação roda em **outro domínio** (ex.: `http://localhost:8081`, `https://v8-mvp-teste...`).
- O navegador trata isso como **requisição cross-origin**.
- Para o **elemento `<audio src="url">`**: o GET até pode ser feito, mas em muitos casos o Storage **não envia** o header `Access-Control-Allow-Origin` para o domínio da app. Sem esse header, o navegador pode bloquear o uso da resposta (e o player falha).
- Para o **fallback** (fetch da URL para converter OGG→MP3 no frontend): o `fetch(url, { mode: "cors" })` **exige** que o servidor envie CORS. Se o bucket não tiver CORS configurado para a origem da app, o fetch falha e aparece “Não foi possível reproduzir o áudio”.

**Resumo:** Sem CORS no Storage (ou com origem errada), o navegador bloqueia o uso do áudio vindo do Storage, e o player quebra.

### 2. Formato do arquivo (OGG/WebM)

- Áudios **recebidos** pelo WhatsApp vêm em **OGG Opus** (ou WebM).
- **Safari/iOS** não reproduzem OGG/WebM no `<audio>`.
- O frontend tentava um fallback: buscar o arquivo com `fetch` e converter para MP3. Esse fallback já dependia de CORS (item 1) e, no Safari, a decodificação de WebM também falha. Resultado: mesmo com fallback, o áudio não tocava.

**Resumo:** Em Safari/iOS, áudios em OGG/WebM não tocam; a conversão no frontend não resolve sozinha e ainda depende de CORS.

### 3. Bucket privado ou URL inválida

- Se o bucket `media` estivesse **privado**, a URL pública retornaria **403** e o player falharia.
- No nosso caso o bucket é **público** e a URL é válida; o bloqueio era sobretudo CORS e formato.

---

## O que foi feito para resolver

### A) Proxy de áudio (Edge Function `stream-media`)

- Foi criada a Edge Function **`stream-media`**, que:
  - Recebe o **path** do arquivo no bucket `media` (ex.: `whatsapp-media/org-id/file.mp3`).
  - Baixa o arquivo do Storage **no servidor** (sem CORS, usando service role).
  - Devolve o áudio para o navegador com **headers CORS permitindo a origem da app** e `Content-Type` correto.
- No frontend, para mensagens de áudio cuja `media_url` é do Storage do Supabase, a URL usada no player passa a ser a da função:
  - `getAudioPlaybackUrl(media_url)` monta:  
    `https://<projeto>.supabase.co/functions/v1/stream-media?path=<path_no_bucket>`  
  - O `<audio src="...">` passa a pedir o áudio à **Edge Function** (que já envia CORS), e não mais direto ao Storage.
- Com isso, **o bloqueio por CORS deixa de impedir** a reprodução ao clicar.

### B) Conversão para MP3 no webhook (já existente)

- No webhook **evolution-webhook**, os áudios recebidos (OGG/Opus) são convertidos para **MP3** antes de salvar no Storage (conversão in-edge com `ogg-opus-decoder` + `lamejs`).
- Assim, o arquivo servido pelo `stream-media` é **MP3**, que todos os navegadores (incluindo Safari) conseguem reproduzir.

### C) Fluxo final ao clicar para ouvir

1. O frontend usa `getAudioPlaybackUrl(message.media_url)` e define `src` do `<audio>` como a URL do `stream-media`.
2. O navegador faz GET em `.../functions/v1/stream-media?path=...`.
3. A Edge Function baixa o arquivo do Storage e responde com o áudio em MP3 e com CORS correto.
4. O navegador recebe o áudio e o player reproduz ao clicar.

---

## O que você precisa fazer

1. **Fazer deploy da Edge Function `stream-media`:**
   ```bash
   supabase functions deploy stream-media
   ```
2. **Garantir que o webhook `evolution-webhook` está em deploy** (com a conversão OGG→MP3), para que áudios **novos** já sejam salvos em MP3.
3. **Áudios antigos** (já salvos em OGG/WebM) passam a ser servidos pelo proxy `stream-media` (CORS resolvido); em navegadores que não tocam OGG/WebM (ex.: Safari), esses antigos ainda podem falhar até serem regravados. Novos áudios (MP3) funcionam em todos.

---

## Resumo em uma frase

**O que impedia:** CORS (Storage não liberava a origem da app) e, em parte, formato OGG/WebM no Safari.  
**O que resolve:** Servir o áudio pela Edge Function `stream-media` (com CORS) e salvar áudios recebidos já em MP3 no webhook.
