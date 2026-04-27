# CORS no bucket de Storage (áudio no chat)

Se a aplicação roda em um domínio diferente do Supabase (ex.: app em `https://app.seudominio.com` e Storage em `https://xxx.supabase.co`), o bucket **media** precisa permitir requisições do domínio da app para que áudios do chat carreguem corretamente.

## Como configurar

1. Acesse o **Supabase Dashboard** do projeto.
2. Vá em **Storage** e abra o bucket **media**.
3. Em **Configuration** (ou **CORS**), adicione o domínio da sua aplicação em **Allowed origins**.
   - Ex.: `https://v8-mvp-teste.v318jq.easypanel.host` ou `https://seudominio.com`
   - Para desenvolvimento local: `http://localhost:5173` (ou a porta usada pelo Vite).
4. Salve as alterações.

Com isso, o elemento `<audio>` consegue carregar os arquivos de áudio do Storage quando a app está em outro domínio.
