-- channel_messages.metadata — a forma NOSSA do que o fornecedor mandou.
--
-- ─── POR QUE UMA COLUNA, E NÃO LER O raw_payload NA TELA ────────────────────
--
-- O corpo cru já está gravado, e a tela poderia lê-lo. Não vai: isso faria a UI
-- conhecer o formato do fornecedor, e cada mudança dele passaria a quebrar tela
-- em vez de teste. Aqui entra o resultado de um parser puro e testado contra
-- corpos reais de produção; quando o formato dele mudar, muda o parser.
--
-- ─── O QUE ESTA COLUNA CARREGA ──────────────────────────────────────────────
--
--   { tipo: 'texto'|'midia'|'resposta'|'link'|'reacao'|'localizacao'|'contato',
--     midia?:       { url, especie, mime, nome },
--     resposta?:    { titulo, payload },      -- clique de botão / escolha de lista
--     reacao?:      { emoji, alvoProviderMessageId },
--     localizacao?: { latitude, longitude, nome, endereco },
--     contatos?:    [{ nome, telefones, emails }],
--     link?:        { url, especie },         -- reel/post: página, não arquivo
--     citacao?:     { providerMessageId, de } }
--
-- ─── ADITIVA POR CONSTRUÇÃO ─────────────────────────────────────────────────
--
-- Sem NOT NULL e sem DEFAULT: as duas coisas forçariam reescrita da tabela, que
-- hoje tem mais de 11 mil linhas e recebe mensagem em tempo real. NULL significa
-- "ainda não normalizada" — o estado de toda linha anterior a esta migration, e
-- o que o backfill preenche depois, em lotes.
alter table public.channel_messages
  add column if not exists metadata jsonb;

comment on column public.channel_messages.metadata is
  'Leitura normalizada do corpo do fornecedor (notificame-content.ts). NULL = ainda não normalizada.';
