# Security Rules

These rules apply to ALL code in the project.

## Secrets Management
- Never hardcode API keys, passwords, tokens, or connection strings
- Use environment variables for all secrets
- Never log secrets or include them in error messages
- Add sensitive file patterns to .gitignore (.env, *.pem, credentials.*)

## Input Validation
- Validate and sanitize all user input at system boundaries
- Use allowlists over denylists for input validation
- Validate file upload types, sizes, and names
- Reject unexpected fields in request bodies

## Authentication
- Hash passwords with bcrypt (cost factor 12+) or argon2
- Use constant-time comparison for token validation
- Implement token expiration and refresh rotation
- Invalidate sessions on password change

## Authorization
- Check permissions on every protected endpoint (not just the frontend)
- Use role-based or attribute-based access control
- Verify resource ownership before allowing access
- Audit log all privilege escalation actions

## Data Protection
- Use HTTPS everywhere — no exceptions
- Encrypt sensitive data at rest
- Use parameterized queries for all database operations
- Sanitize HTML output to prevent XSS
- Set security headers: CSP, X-Frame-Options, X-Content-Type-Options

## AI-Specific Security
- Never send user PII to LLM APIs without explicit consent
- Sanitize LLM input against prompt injection
- Sanitize LLM output before rendering (treat as untrusted)
- Implement server-side rate limiting and cost caps for LLM calls
- Keep API keys server-side only — never expose to client
