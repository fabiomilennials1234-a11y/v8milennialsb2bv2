/**
 * Sub-barrel — hooks dos **pipes canônicos legacy** (views `pipe_*`).
 *
 * Operam as views `pipe_whatsapp` / `pipe_confirmacao` / `pipe_propostas`
 * (coluna `status` = `stage_key` slug). Contraste com `../model` (modelo novo
 * `pipeline_entries`, coluna `stage_id` uuid).
 *
 * Reexportado pela API pública (`../../index.ts`). Não importe este barrel a
 * partir dos leaves deste grupo — use os arquivos diretamente para evitar ciclos.
 */
export * from "./usePipeWhatsapp";
export * from "./usePipeConfirmacao";
export * from "./usePipeConfirmacaoByLeadId";
export * from "./usePipePropostas";
export * from "./usePipePropostaByLeadId";
export * from "./usePipePropostaItems";
