import 'server-only'

// Retry wrapper for the AI SDK's generateObject. Reasoning-tier models (notably
// grok-4.3 used by the crew generator) intermittently finish a turn WITHOUT a
// schema-valid object — the SDK then throws AI_NoObjectGeneratedError even though
// a retry usually succeeds, because the failure is non-deterministic rather than
// structural. World creation calls the generator exactly once, so a transient
// miss would fail the whole "new world" flow; a few retries make it robust at a
// cost of, at worst, a couple of extra calls on a bad roll.
//
// Generic over the call so the SDK's overloaded generateObject typing stays at
// the call site (pass a thunk: () => generateObject({...})). On exhausting the
// attempts it rethrows the last error so the caller still surfaces a real failure.

export async function withObjectRetry<T>(
  call: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await call()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
