// EVALUATION FIXTURE - fictional code.
export type FieldType = "text" | "number" | "select";

export interface CustomFieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Only meaningful when type is "select". */
  options: string[];
  required: boolean;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateFieldValue(def: CustomFieldDef, value: unknown): ValidationResult {
  if (value === undefined || value === null || value === "") {
    return def.required ? { ok: false, reason: "required" } : { ok: true };
  }
  if (def.type === "text") return typeof value === "string" ? { ok: true } : { ok: false, reason: "expected text" };
  if (def.type === "number") return typeof value === "number" && Number.isFinite(value) ? { ok: true } : { ok: false, reason: "expected a number" };
  // select
  return typeof value === "string" && def.options.includes(value) ? { ok: true } : { ok: false, reason: "not one of the allowed options" };
}
