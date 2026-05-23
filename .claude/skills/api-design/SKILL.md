---
name: api-design
description: Design and document API endpoints following project conventions. Use when creating new endpoints or modifying existing ones.
user-invocable: false
paths:
  - "src/backend/**"
  - "src/api/**"
---

> **MVP sprint override (active until exit criteria in `docs/10-mvp-sprint.md` are met).**
> During the MVP sprint the conventions below are intentionally relaxed:
> - Only one route exists: `POST /api/chat` (Next.js Route Handler)
> - It returns an AI SDK 5 UI message stream — **not** JSON, **not** the `{data, meta, error}` envelope
> - No `/api/v1/` prefix, no plural-noun resources, no pagination, no auth
> - Player turn is persisted before streaming; narrator turn is persisted in `onFinish`
> The full conventions below resume at Phase 1 proper.

## API Design Conventions

### Endpoint Structure
- RESTful resource naming: `/api/v1/<resource>` (plural nouns)
- Use HTTP methods correctly: GET (read), POST (create), PUT (replace), PATCH (update), DELETE (remove)
- Nested resources for relationships: `/api/v1/users/:id/posts`

### Request Validation
- Validate all request bodies with a schema validator (Zod, Joi, etc.)
- Return 400 with specific field-level errors for invalid input
- Validate path params and query strings

### Response Format
```json
{
  "data": {},
  "meta": { "page": 1, "total": 100 },
  "error": null
}
```

### Error Response Format
```json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [{ "field": "email", "message": "Invalid email format" }]
  }
}
```

### Status Codes
- 200: Success
- 201: Created
- 204: No Content (successful delete)
- 400: Bad Request (validation)
- 401: Unauthorized (not authenticated)
- 403: Forbidden (not authorized)
- 404: Not Found
- 409: Conflict (duplicate resource)
- 429: Rate Limited
- 500: Internal Server Error

### Pagination
- Use cursor-based pagination for large datasets
- Query params: `?cursor=<id>&limit=20`
- Include `nextCursor` in response meta

### Authentication
- Bearer token in Authorization header
- API key endpoints use `X-API-Key` header
- All mutating endpoints require authentication
