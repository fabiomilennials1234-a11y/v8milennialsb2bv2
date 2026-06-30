# Motor 100 — mídia dos disparos de reativação (2026-06-30)

Alinha os **5 workflows de disparo por dia da semana** (org Motor 100
`1003870a-ceea-487b-8dd5-910018c7a7d7`, **PROD** `jsjsmuncfkbsbzqzqhfq`) ao
workflow-modelo **Terça**. Mudança aplicada via **Data API PATCH** no campo
`definition` (preserva handles `replied`/`timeout`, posições e os
`wait_response` / trigger próprios de cada dia — `workflow_build` recompilaria e
quebraria isso).

## O que muda

Por workflow, partindo do clone de "Reativação Inativos — Onda 1" (4 ondas,
cada uma texto + áudio + imagem):

1. **Remove os audio nodes das ondas 3 e 4** (`action-8`, `action-11`) nos 4
   workflows não-Terça e religa as edges
   (`action-7→action-9`, `action-10→action-12`). Sobram **2 audio nodes**
   (ondas 1 e 2), igual ao modelo Terça.
2. **Anexa os áudios** aos 2 restantes:
   - `action-2` (onda 1) → áudio de prospecção
   - `action-5` (onda 2) → 2º áudio pós-prospecção
3. **Anexa a imagem** "TEMOS UM PRESENTE / AutoSecurity" aos **4 image nodes**
   (`action-3`, `action-6`, `action-9`, `action-12`).

Resultado: 5 `definition` estruturalmente idênticas (19 nós / 21 edges); só os
timeouts dos waits e o stage do trigger variam por dia.

| Workflow | id | trigger stage | waits (w1/w2/w3/w4 h) |
|---|---|---|---|
| Segunda | `2203a57f-f907-49a4-8489-3fc72c06e0ee` | `disparo_segunda` | 72/120/72/120 |
| Terça (modelo) | `8d5b9cd4-ae1d-4b5c-bfc6-5fa8c1919e10` | `disparo_terca` | 72/120/120/72 |
| Quarta | `762627e2-3512-4ab8-9f06-e0f1978fbfa7` | `disparo_quarta` | 120/72/120/72 |
| Quinta | `d824b021-fe82-4836-a8b5-e49a7cc275d3` | `disparo_quinta` | 120/72/120/120 |
| Sexta | `9d4df301-14cc-40db-925a-8f7c8d099f6a` | `disparo_sexta` | 120/120/72/120 |

## Assets (bucket público `media`)

- Áudio prospecção → `workflow-audios/<org>/76eb3a9f-51ce-49f9-b341-a861f5284530.mp3`
- 2º áudio pós-prospecção → `workflow-audios/<org>/e4f87654-4d01-4986-a1ef-f18d13a4fce2.mp3`
- Imagem presente → `workflow-assets/<org>/991340c8-a747-431f-be48-dfa1ef08aa7a.png`

Upload feito por `upload_assets.sh` (lê arquivos locais; mantidos fora do repo).

## Credenciais

`service_role` de PROD obtido on-the-fly via Management API
(`/v1/projects/<ref>/api-keys?reveal=true`) usando o PAT `sbp_` da
2ª linha `SUPABASE_ACCESS_TOKEN` em `.env.development` (conta-wide, cobre prod).
Nenhum segredo neste diretório.

## Uso

```bash
# aplicar (idempotente)
python scripts/recovery/motor100_dispatch_media/apply.py

# reverter (re-insere audio nodes ondas 3&4 + limpa URLs de mídia)
python scripts/recovery/motor100_dispatch_media/revert.py
```

## Gates de go-live (pré-existentes, não introduzidos aqui)

1. Re-parear instância WhatsApp "Rubens Teste" `d6f26c2c` (morta desde 2026-06-25).
2. Deploy do executor para o node `send_to_number` (avisar vendedor).

Sem esses, a definição está correta mas o envio real não dispara.
