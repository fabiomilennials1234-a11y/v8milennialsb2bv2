# 0019 — Vídeo em artigo de ajuda: allowlist de embed, nunca HTML cru

**Status:** Aceito · 2026-07-10

## Contexto

A Central de Ajuda renderiza o corpo do Artigo de Ajuda com `ReactMarkdown` + `remarkGfm` — Markdown, sem HTML cru. Queremos vídeos de treino (Loom/YouTube) nos artigos.

O caminho óbvio — e errado — é ligar `rehype-raw` e deixar o autor colar um `<iframe>` no corpo. O corpo do artigo é um campo **editável por admin** (inclusive admin de organização-cliente, não só Torque). Renderizar HTML cru dali é um vetor de injeção: um `<iframe>` para um host hostil, um `<script>` que `rehype-raw` deixe passar, clickjacking sobre a UI do CRM. O que protege hoje é justamente o Markdown **não** interpretar HTML.

## Decisão

1. **O corpo do artigo continua Markdown sem `rehype-raw`.** HTML cru nunca é renderizado.
2. **Vídeo é um campo dedicado (`video_url`), não markup no corpo.** Um por artigo, em destaque no topo.
3. **A URL é parseada e normalizada para uma URL de embed canônica, contra uma allowlist de host.** Só `loom.com` e `youtube.com`/`youtu.be` são reconhecidos; a URL vira `youtube.com/embed/<id>` ou `loom.com/embed/<id>`. Qualquer outro host é rejeitado na hora de salvar, com aviso no admin — nunca chega a virar `src` de iframe.
4. **O iframe renderizado tem `sandbox` e `allow` mínimos** (só o necessário pra tocar vídeo), e nunca recebe uma URL que não passou pelo parser.

## Consequências

- Um dev futuro que queira "só embedar um Vimeo" precisa adicionar o host à allowlist e ao parser — de propósito. Não há atalho por HTML cru.
- Autores não colam embed arbitrário. Pra um formato novo de mídia, muda-se o código, não o conteúdo.
- O corpo do artigo permanece um alvo pobre: sem HTML, a pior coisa que um markdown malicioso faz é um link — que o `remarkGfm` já trata.

## Alternativas descartadas

- **`rehype-raw` + iframe livre no corpo:** máxima flexibilidade, mas abre injeção num campo que admin de tenant edita. Reversível só até o primeiro artigo depender disso.
- **Upload de MP4 no bucket `help-media`:** hospedagem própria, mas pesada (banda, tamanho, sem streaming adaptativo) e o bucket é público (link eterno, indexável — ADR-0018). Embed externo ganha.
- **Item `type:"video"` no array `media`:** reusaria a estrutura, mas `media` é tipado pra arquivo enviado ao bucket; vídeo é URL de embed. Misturar as duas semânticas confunde render e validação.
