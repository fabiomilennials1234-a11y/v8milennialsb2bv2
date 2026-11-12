// Live regression test. Call with ordinary user and anonymous Supabase clients;
// authentication is supplied by the operator, never persisted here.
// Creates uniquely named temporary objects/records and removes them in finally.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

const bucket = 'product-materials';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Storage authorization probes never carry customer content to foreign paths.
export const probeBytes = Buffer.from('%PDF-1.4\n% Synthetic permission probe; no customer data\n%%EOF\n');

export async function verifyProductMaterialAccess({
  client, anonymous, organizationId, productId, files,
  foreignOrganizationId, foreignProductId, foreignPath, foreignStillExists,
}) {
  assert.ok(files.length > 0);
  const runId = `qa-permissions-${randomUUID()}`;
  const pendingPaths = new Set();
  const pendingRows = new Set();
  const checks = [];
  const record = name => { checks.push(name); console.log(`PASS ${name}`); };
  const removeObject = async path => {
    const result = await client.storage.from(bucket).remove([path]);
    assert.ifError(result.error);
    assert.equal(result.data.length, 1, 'Own temporary object must be deleted');
    pendingPaths.delete(path);
  };
  const denyUpload = async (who, path, label) => {
    // Track even unexpected successes so a failed test still cleans them up.
    pendingPaths.add(path);
    const result = await who.storage.from(bucket).upload(path, probeBytes, {
      contentType: 'application/pdf', upsert: false,
    });
    if (result.error) pendingPaths.delete(path);
    assert.ok(result.error, `${label}: upload must be denied`);
    assert.match(result.error.message, /row.level security|unauthorized|access denied/i);
    record(label);
  };
  try {
    for (const file of files) {
      const safeName = file.name.replace(/\.\./g, '').replace(/[\/\\]/g, '_').replace(/^\./, '_');
      const path = `${organizationId}/${productId}/${runId}-${safeName}`;
      pendingPaths.add(path);
      const uploaded = await client.storage.from(bucket).upload(path, file.bytes, {
        contentType: file.type, upsert: false,
      });
      if (uploaded.error) pendingPaths.delete(path);
      assert.ifError(uploaded.error);
      const inserted = await client.from('product_materials').insert({
        organization_id: organizationId, product_id: productId,
        file_name: `${runId}-${file.name}`, file_path: path,
        file_size: file.bytes.length, mime_type: file.type,
        material_type: file.type.startsWith('image/') ? 'imagem' : 'documento',
        description: 'Temporary attachment permission verification',
      }).select('id').single();
      assert.ifError(inserted.error);
      pendingRows.add(inserted.data.id);
      const signed = await client.storage.from(bucket).createSignedUrl(path, 30);
      assert.ifError(signed.error);
      const response = await fetch(signed.data.signedUrl);
      assert.equal(response.status, 200);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(file.bytes));
      const anonymousRead = await anonymous.storage.from(bucket).createSignedUrl(path, 30);
      assert.ok(anonymousRead.error, 'Anonymous user must not read private materials');
      await removeObject(path);
      const removed = await client.from('product_materials').delete().eq('id', inserted.data.id).select('id');
      assert.ifError(removed.error);
      assert.equal(removed.data.length, 1);
      pendingRows.delete(inserted.data.id);
      record(`upload, metadata, signed download, anonymous denial and cleanup: ${file.name}`);
    }
    await denyUpload(client, `${foreignOrganizationId}/${foreignProductId}/${runId}.pdf`, 'other organization upload denied');
    await denyUpload(client, `${organizationId}/${foreignProductId}/${runId}.pdf`, 'mismatched product organization denied');
    await denyUpload(client, `${organizationId}/${randomUUID()}/${runId}.pdf`, 'nonexistent product denied');
    await denyUpload(client, `${organizationId}/${productId}/extra/${runId}.pdf`, 'malformed path denied');
    await denyUpload(anonymous, `${organizationId}/${productId}/${runId}.pdf`, 'anonymous upload denied');
    assert.ok((await client.storage.from(bucket).createSignedUrl(foreignPath, 30)).error);
    const foreignDelete = await client.storage.from(bucket).remove([foreignPath]);
    assert.ifError(foreignDelete.error);
    assert.equal(foreignDelete.data.length, 0);
    assert.ok(await foreignStillExists(), 'Foreign object must survive unauthorized delete');
    record('other organization read and delete denied');
    return { runId, checks, files: files.length };
  } finally {
    // Never use a broad prefix or bucket delete: clean only this invocation's IDs.
    for (const path of pendingPaths) {
      const result = await client.storage.from(bucket).remove([path]);
      assert.ifError(result.error);
      assert.equal(result.data.length, 1, `Temporary object cleanup failed: ${path}`);
    }
    for (const id of pendingRows) {
      const result = await client.from('product_materials').delete().eq('id', id).select('id');
      assert.ifError(result.error);
      assert.equal(result.data.length, 1, `Temporary record cleanup failed: ${id}`);
    }
  }
}
