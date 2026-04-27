/**
 * PDF chunking pra evitar WORKER_RESOURCE_LIMIT em PDFs grandes.
 *
 * Estratégia:
 *  1. Carrega PDF original via pdf-lib
 *  2. Split em sub-PDFs de N páginas cada (default 3)
 *  3. Cada sub-PDF é processado individualmente pelo multimodal LLM
 *  4. Texto extraído é concatenado em ordem
 *
 * Por que pdf-lib:
 *  - ESM compativel com Deno (https://esm.sh/pdf-lib)
 *  - Sem dependencias nativas
 *  - API simples: PDFDocument.load + create + copyPages
 */

import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

export interface PdfChunkingOptions {
  /** Páginas por sub-PDF. Default: 3. Mais = menos calls, mais memória. */
  pagesPerBatch?: number;
  /** Máximo de páginas total. PDFs maiores que isso = erro. Default: 100. */
  maxPages?: number;
}

export interface PdfBatch {
  /** 1-indexed page numbers (ex: [1,2,3]) */
  pageNumbers: number[];
  /** Sub-PDF bytes (já contem só essas páginas) */
  bytes: Uint8Array;
  /** Tamanho do sub-PDF em bytes */
  size: number;
}

/**
 * Carrega PDF e retorna sub-PDFs com batches de N páginas.
 * Cada sub-PDF é independente — pode ser enviado ao LLM separadamente.
 */
export async function splitPdfIntoBatches(
  pdfBytes: Uint8Array,
  options: PdfChunkingOptions = {},
): Promise<{ batches: PdfBatch[]; totalPages: number }> {
  const pagesPerBatch = options.pagesPerBatch ?? 3;
  const maxPages = options.maxPages ?? 100;

  const sourceDoc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
  });

  const totalPages = sourceDoc.getPageCount();

  if (totalPages > maxPages) {
    throw new Error(
      `PDF tem ${totalPages} páginas. Máximo suportado: ${maxPages}. Reduza o documento.`,
    );
  }

  const batches: PdfBatch[] = [];

  for (let start = 0; start < totalPages; start += pagesPerBatch) {
    const end = Math.min(start + pagesPerBatch, totalPages);
    const pageIndices: number[] = [];
    for (let i = start; i < end; i++) pageIndices.push(i);

    const subDoc = await PDFDocument.create();
    const copiedPages = await subDoc.copyPages(sourceDoc, pageIndices);
    copiedPages.forEach((page) => subDoc.addPage(page));

    const subBytes = await subDoc.save();
    batches.push({
      pageNumbers: pageIndices.map((i) => i + 1),
      bytes: subBytes,
      size: subBytes.length,
    });
  }

  return { batches, totalPages };
}

/**
 * Encoda batch como base64 inline (pronto para multimodal LLM).
 *
 * Cast pra ArrayBuffer porque a Deno std `encode()` aceita string|ArrayBuffer,
 * e Uint8Array<ArrayBufferLike> retornado por pdf-lib não casa com o type
 * narrowed. O subjacente .buffer é compatível em runtime.
 */
export function encodeBatchAsBase64(batch: PdfBatch): string {
  return encodeBase64(batch.bytes.buffer as ArrayBuffer);
}
