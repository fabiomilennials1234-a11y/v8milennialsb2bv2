/**
 * spreadsheet-upsert — pure partition of an uploaded blast list (ADR-0014, #906).
 *
 * The spreadsheet source upserts Leads keyed by canonical phone:
 *   - match      → dispatch as-is, never overwrite the existing Lead
 *   - non-match  → create a new Lead
 *   - no phone   → invalid (reported, not sent)
 *   - in-file duplicate phone → collapse to a single send
 *
 * This module is the pure, IO-free decision. It partitions mapped rows against
 * the set of existing Leads (already loaded by the caller); creation/dispatch
 * happen downstream. Phone keying reuses the canonical normalizer so a spread-
 * sheet number keys identically to a stored `normalized_phone` — no local copy.
 */

import { normalizeCanonicalPhone } from "../copilot-v2/phone-normalizer.ts";

export interface MappedRow {
  phone: string;
  name?: string;
  company?: string;
  email?: string;
}

export interface ExistingLead {
  id: string;
  /** Stored canonical phone (normalized_phone column). */
  normalizedPhone: string;
}

export interface CreateEntry {
  normalizedPhone: string;
  row: MappedRow;
}

export interface MatchEntry {
  normalizedPhone: string;
  leadId: string;
  row: MappedRow;
}

export interface SpreadsheetPartition {
  toCreate: CreateEntry[];
  matched: MatchEntry[];
  invalid: MappedRow[];
  duplicates: MappedRow[];
}

export function partitionSpreadsheet(
  rows: MappedRow[],
  existing: ExistingLead[],
): SpreadsheetPartition {
  const result: SpreadsheetPartition = {
    toCreate: [],
    matched: [],
    invalid: [],
    duplicates: [],
  };

  const existingByPhone = new Map<string, string>();
  for (const lead of existing) {
    const key = normalizeCanonicalPhone(lead.normalizedPhone);
    if (key) existingByPhone.set(key, lead.id);
  }

  const seenInFile = new Set<string>();
  for (const row of rows) {
    const normalizedPhone = normalizeCanonicalPhone(row.phone);
    if (!normalizedPhone) {
      result.invalid.push(row);
      continue;
    }
    if (seenInFile.has(normalizedPhone)) {
      result.duplicates.push(row);
      continue;
    }
    seenInFile.add(normalizedPhone);

    const leadId = existingByPhone.get(normalizedPhone);
    if (leadId) {
      result.matched.push({ normalizedPhone, leadId, row });
    } else {
      result.toCreate.push({ normalizedPhone, row });
    }
  }

  return result;
}
