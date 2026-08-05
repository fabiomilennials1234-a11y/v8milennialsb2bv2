-- Bucket agent-documents: 20MB → 26MB.
--
-- `process-agent-document` passou a aceitar PDF de até 25MB, mas o bucket
-- rejeitava em 20MB. O upload morreria com 413 do storage antes de a função ver
-- o arquivo — e o usuário receberia um erro genérico de upload em vez da
-- mensagem que explica o limite.
--
-- 26MB (e não 25MB exatos) de propósito: deixa o gate da edge function ser
-- sempre quem recusa, com mensagem em português dizendo o limite e o que fazer.
-- Empatar os dois números faria arquivos na fronteira caírem no 413 do storage,
-- dependendo do overhead do multipart.
--
-- Só config de bucket. Não toca objeto, não toca dado de cliente.
UPDATE storage.buckets
SET file_size_limit = 26 * 1024 * 1024
WHERE id = 'agent-documents';
