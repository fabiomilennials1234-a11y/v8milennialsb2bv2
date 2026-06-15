/**
 * leadgen-import — pure leadgen→lead transform + import planning for the
 * polling model (ADR-0009, slice 4). No DB, no network. The cron edge function
 * wraps these with I/O (fetch seen ids, call graph-client, upsert leads).
 *
 * Field-mapping semantics are kept identical to the legacy webhook path
 * (meta-webhook/processLeadgen) so behaviour does not drift on the cutover.
 */

import type { MetaLead } from "./graph-client.ts";

export interface FieldMapping {
  meta_field: string;
  lead_field: string;
}

/** Lead columns a Meta form field may be mapped onto. */
export const MAPPABLE_LEAD_FIELDS = new Set([
  "name", "email", "phone", "company", "segment", "urgency",
  "faturamento", "notes", "utm_campaign", "utm_source", "utm_medium",
  "utm_content", "utm_term", "meta_campaign_id", "meta_adset_id", "meta_ad_id",
]);

/** Flattens Graph `field_data` (`[{name, values}]`) into `{ name: firstValue }`. */
export function flattenFieldData(fieldData: MetaLead["field_data"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldData ?? []) out[f.name] = f.values?.[0] ?? "";
  return out;
}

/**
 * Maps flat form fields onto lead columns. Configured `mappings` win; essential
 * columns (name/email/phone/company) fall back to Meta's standard field names.
 */
export function applyFieldMappings(
  formFields: Record<string, string>,
  mappings: FieldMapping[] | null | undefined,
): Record<string, string | null> {
  const leadData: Record<string, string | null> = {};

  if (mappings && mappings.length > 0) {
    for (const m of mappings) {
      if (MAPPABLE_LEAD_FIELDS.has(m.lead_field) && formFields[m.meta_field]) {
        leadData[m.lead_field] = formFields[m.meta_field];
      }
    }
  }

  if (!leadData.name) {
    leadData.name = formFields.full_name
      || (formFields.first_name
        ? `${formFields.first_name} ${formFields.last_name || ""}`.trim()
        : null)
      || "Lead Meta Ads";
  }
  if (!leadData.email) leadData.email = formFields.email || null;
  if (!leadData.phone) leadData.phone = formFields.phone_number || formFields.phone || null;
  if (!leadData.company) leadData.company = formFields.company_name || formFields.company || null;

  return leadData;
}

export interface PlannedLead {
  leadgenId: string;
  createdTime: string;
  fields: Record<string, string | null>;
  raw: Record<string, string>;
}

export interface LeadgenImportPlan {
  toImport: PlannedLead[];
  skipped: string[];
  /** Newest created_time across ALL polled leads (epoch seconds) — next cursor. */
  newestCreatedTime: number | null;
}

/**
 * Plans an import batch: drops leads whose leadgen id was already seen
 * (idempotency), maps the rest, and computes the next poll cursor from the
 * newest lead — including skipped ones, so the cursor advances past them.
 */
export function planLeadgenImport(input: {
  leads: MetaLead[];
  seenLeadgenIds: Set<string>;
  fieldMappings: FieldMapping[] | null | undefined;
}): LeadgenImportPlan {
  const toImport: PlannedLead[] = [];
  const skipped: string[] = [];
  let newestCreatedTime: number | null = null;

  for (const lead of input.leads) {
    const t = Math.floor(Date.parse(lead.created_time) / 1000);
    if (!Number.isNaN(t) && (newestCreatedTime == null || t > newestCreatedTime)) {
      newestCreatedTime = t;
    }
    if (input.seenLeadgenIds.has(lead.id)) {
      skipped.push(lead.id);
      continue;
    }
    const raw = flattenFieldData(lead.field_data);
    toImport.push({
      leadgenId: lead.id,
      createdTime: lead.created_time,
      fields: applyFieldMappings(raw, input.fieldMappings),
      raw,
    });
  }

  return { toImport, skipped, newestCreatedTime };
}
