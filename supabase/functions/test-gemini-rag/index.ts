import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbedding, generateEmbeddingsBatch } from "../_shared/embeddings.ts";

Deno.serve(async (_req) => {
  const results: any = { tests: [], passed: 0, failed: 0 };

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ─── Test 1: Single Embedding (1536 dims) ───
  try {
    const emb = await generateEmbedding("Teste de embedding Gemini para CRM B2B", GEMINI_API_KEY!);
    const pass = Array.isArray(emb) && emb.length === 1536;
    results.tests.push({ name: "Single Embedding", pass, dims: emb?.length });
    pass ? results.passed++ : results.failed++;
  } catch (e: any) {
    results.tests.push({ name: "Single Embedding", pass: false, error: e.message });
    results.failed++;
  }

  // ─── Test 2: Batch Embedding ───
  try {
    const embs = await generateEmbeddingsBatch([
      "Quanto custa o plano premium?",
      "Como funciona o CRM para vendas?",
      "Quais funcionalidades do copilot de IA?"
    ], GEMINI_API_KEY!);
    const pass = Array.isArray(embs) && embs.length === 3 && embs.every(e => e.length === 1536);
    results.tests.push({ name: "Batch Embedding (3 texts)", pass, count: embs?.length, dims: embs?.[0]?.length });
    pass ? results.passed++ : results.failed++;
  } catch (e: any) {
    results.tests.push({ name: "Batch Embedding", pass: false, error: e.message });
    results.failed++;
  }

  // ─── Test 3: pgvector compatibility (insert + cosine search via raw SQL) ───
  try {
    // Gerar embeddings para 3 docs de teste
    const docs = [
      "O plano Premium custa R$299 por mês e inclui até 10 usuários, CRM completo e automação de WhatsApp.",
      "O suporte técnico funciona de segunda a sexta, das 9h às 18h. Para emergências, plantão 24h.",
      "A integração com TinyERP permite sincronizar pedidos, notas fiscais e controle de estoque."
    ];
    const docEmbeddings = await generateEmbeddingsBatch(docs, GEMINI_API_KEY!);

    // Gerar embedding da query
    const queryEmb = await generateEmbedding("qual o preço do plano?", GEMINI_API_KEY!);

    // Testar similaridade por cosseno diretamente (sem precisar inserir no banco)
    // cosine_similarity = dot(a,b) / (norm(a) * norm(b))
    const dot = (a: number[], b: number[]) => a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const norm = (a: number[]) => Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const cosineSim = (a: number[], b: number[]) => dot(a, b) / (norm(a) * norm(b));

    const similarities = docs.map((doc, i) => ({
      doc: doc.substring(0, 60) + "...",
      similarity: cosineSim(queryEmb, docEmbeddings[i])
    }));

    similarities.sort((a, b) => b.similarity - a.similarity);

    const topIsPrice = similarities[0].doc.includes("R$299");
    results.tests.push({
      name: "Cosine Similarity: 'preço do plano' → doc de preço",
      pass: topIsPrice,
      query: "qual o preço do plano?",
      rankings: similarities.map(s => ({ ...s, similarity: s.similarity.toFixed(4) }))
    });
    topIsPrice ? results.passed++ : results.failed++;

    // Testar outra query
    const queryEmb2 = await generateEmbedding("como funciona o atendimento ao cliente?", GEMINI_API_KEY!);
    const sims2 = docs.map((doc, i) => ({
      doc: doc.substring(0, 60) + "...",
      similarity: cosineSim(queryEmb2, docEmbeddings[i])
    }));
    sims2.sort((a, b) => b.similarity - a.similarity);

    const topIsSupport = sims2[0].doc.includes("suporte");
    results.tests.push({
      name: "Cosine Similarity: 'atendimento ao cliente' → doc de suporte",
      pass: topIsSupport,
      query: "como funciona o atendimento ao cliente?",
      rankings: sims2.map(s => ({ ...s, similarity: s.similarity.toFixed(4) }))
    });
    topIsSupport ? results.passed++ : results.failed++;

    // Testar query ERP
    const queryEmb3 = await generateEmbedding("integração com sistema de gestão e notas fiscais", GEMINI_API_KEY!);
    const sims3 = docs.map((doc, i) => ({
      doc: doc.substring(0, 60) + "...",
      similarity: cosineSim(queryEmb3, docEmbeddings[i])
    }));
    sims3.sort((a, b) => b.similarity - a.similarity);

    const topIsERP = sims3[0].doc.includes("TinyERP");
    results.tests.push({
      name: "Cosine Similarity: 'notas fiscais' → doc de ERP",
      pass: topIsERP,
      query: "integração com sistema de gestão e notas fiscais",
      rankings: sims3.map(s => ({ ...s, similarity: s.similarity.toFixed(4) }))
    });
    topIsERP ? results.passed++ : results.failed++;

  } catch (e: any) {
    results.tests.push({ name: "Cosine Similarity Tests", pass: false, error: e.message });
    results.failed++;
  }

  // ─── Test 4: pgvector match function exists ───
  try {
    // Gerar embedding fake e testar que a RPC function existe (mesmo sem dados)
    const testEmb = await generateEmbedding("teste", GEMINI_API_KEY!);
    const embStr = `[${testEmb.join(",")}]`;

    const { error } = await supabase.rpc("match_document_chunks", {
      query_embedding: embStr,
      agent_id_filter: "00000000-0000-0000-0000-000000000000",
      match_count: 1,
      similarity_threshold: 0.9
    });

    const pass = !error;
    results.tests.push({
      name: "pgvector match_document_chunks RPC callable",
      pass,
      error: error?.message
    });
    pass ? results.passed++ : results.failed++;
  } catch (e: any) {
    results.tests.push({ name: "pgvector RPC", pass: false, error: e.message });
    results.failed++;
  }

  // ─── Test 5: match_faqs RPC ───
  try {
    const testEmb = await generateEmbedding("teste", GEMINI_API_KEY!);
    const embStr = `[${testEmb.join(",")}]`;

    const { error } = await supabase.rpc("match_faqs", {
      query_embedding: embStr,
      agent_id_filter: "00000000-0000-0000-0000-000000000000",
      match_count: 1,
      similarity_threshold: 0.9
    });

    const pass = !error;
    results.tests.push({
      name: "pgvector match_faqs RPC callable",
      pass,
      error: error?.message
    });
    pass ? results.passed++ : results.failed++;
  } catch (e: any) {
    results.tests.push({ name: "pgvector match_faqs RPC", pass: false, error: e.message });
    results.failed++;
  }

  // ─── Test 6: match_lead_memories RPC ───
  try {
    const testEmb = await generateEmbedding("teste", GEMINI_API_KEY!);
    const embStr = `[${testEmb.join(",")}]`;

    const { error } = await supabase.rpc("match_lead_memories", {
      query_embedding: embStr,
      lead_id_filter: "00000000-0000-0000-0000-000000000000",
      match_count: 1,
      similarity_threshold: 0.9
    });

    const pass = !error;
    results.tests.push({
      name: "pgvector match_lead_memories RPC callable",
      pass,
      error: error?.message
    });
    pass ? results.passed++ : results.failed++;
  } catch (e: any) {
    results.tests.push({ name: "pgvector match_lead_memories RPC", pass: false, error: e.message });
    results.failed++;
  }

  // ─── Test 7: Embedding dimension compatibility with pgvector(1536) ───
  try {
    const emb = await generateEmbedding("Teste de dimensão", GEMINI_API_KEY!);
    const pass = emb.length === 1536;
    results.tests.push({
      name: "Embedding dim === pgvector(1536)",
      pass,
      expected: 1536,
      got: emb.length
    });
    pass ? results.passed++ : results.failed++;
  } catch (e: any) {
    results.tests.push({ name: "Dimension check", pass: false, error: e.message });
    results.failed++;
  }

  results.summary = `${results.passed}/${results.passed + results.failed} tests passed`;

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});
