---
paths:
  - "src/backend/**"
  - "src/api/**"
  - "src/routes/**"
  - "src/handlers/**"
---

# Backend API Rules

## Route Organization
- Group routes by resource: `/api/v1/users`, `/api/v1/posts`
- Keep handler functions thin — delegate business logic to service layer
- Middleware for cross-cutting concerns (auth, logging, rate limiting)

## Request Handling
- Validate request body/params/query at the handler level
- Return early on validation failure — don't proceed with bad input
- Use async/await — no callback-based patterns
- Set appropriate timeouts on external calls

## Response Standards
- Always return JSON with consistent structure
- Include appropriate HTTP status codes (don't return 200 for errors)
- Paginate list endpoints by default
- Never expose internal IDs, stack traces, or implementation details in error responses

## Database Access
- Use a repository or service layer — don't query directly in handlers
- Use transactions for multi-step operations
- Close connections properly (use connection pooling)
- Handle constraint violations gracefully (unique, foreign key)

## Logging
- Log request ID on every request for traceability
- Log: timestamp, level, message, request ID, relevant IDs
- Don't log: passwords, tokens, PII, full request bodies
- Use structured logging (JSON) for production

## Error Handling
- Catch errors at the route level with a global error handler
- Map domain errors to HTTP status codes
- Log unexpected errors with full stack trace
- Return user-friendly messages (not raw error strings)
