---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "tests/**"
---

# Testing Rules

## Test Structure
- One test file per source module
- Use descriptive test names: `it('returns 404 when user does not exist')`
- Group related tests with `describe` blocks
- Follow Arrange-Act-Assert pattern

## What to Test
- Happy path: the expected behavior works
- Edge cases: empty input, null, boundary values, large inputs
- Error cases: invalid input, missing data, network failures
- Integration: API endpoints with real database (not mocks for critical paths)

## What NOT to Test
- Framework internals or third-party library behavior
- Private implementation details — test through public interfaces
- Trivial code (getters, simple assignments)

## Mocking
- Mock external services (APIs, email, payment providers)
- Prefer real database for data layer tests
- Reset mocks between tests to prevent state leakage
- Mock at the boundary, not deep inside the module

## Assertions
- One logical assertion per test (multiple expects are fine if testing one behavior)
- Assert on specific values, not just truthiness
- Test both the positive and negative case
- For async code, always await and assert on resolved/rejected values
