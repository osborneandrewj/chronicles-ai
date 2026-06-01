import { z } from 'zod'

// generateObject validates the model's JSON against a Zod schema and discards
// the ENTIRE object if any single field fails. Two malformations recur with the
// Haiku/Grok agents and throw away otherwise-good patches:
//   1. emitting `null` for a field the model means to leave unset, and
//   2. returning a nested object as a stringified JSON blob.
// These helpers rescue both at the schema boundary so one stray field can no
// longer nuke a whole patch (e.g. losing a valid daily_loop because a sibling
// activity_append came back null).

// Drop null-valued keys BEFORE validation — but only for fields that do not
// themselves accept null. Fields declared `.nullable()` use null deliberately
// ("set null to clear"); their nulls are preserved. A null on a plain
// `.optional()` (non-nullable) field is treated as "absent" instead of failing.
export function tolerateNulls<T extends z.ZodObject>(schema: T): z.ZodType<z.infer<T>> {
  const shape = schema.shape as Record<string, z.ZodType>
  return z.preprocess((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null) {
        out[key] = v
        continue
      }
      // null: keep it only if this field genuinely accepts null.
      const field = shape[key]
      if (field && field.safeParse(null).success) out[key] = v
    }
    return out
  }, schema)
}

// If the model returns an object/array field as a stringified JSON blob, parse
// it back before validation. Non-string or unparseable values pass through
// untouched (and fail validation exactly as they would have without this).
export function coerceJsonObject<T extends z.ZodType>(schema: T): z.ZodType<z.infer<T>> {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }, schema)
}
