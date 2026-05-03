---
name: test-suite
description: Run the full test suite with coverage analysis and failure diagnosis. Use to validate changes before committing or merging.
---

## Current Branch
!`git branch --show-current`

## Recent Changes
!`git diff --stat HEAD~1 2>/dev/null || echo "No prior commits"`

## Test Execution

1. **Unit tests**: `npm test -- --coverage`
2. **Lint check**: `npm run lint`
3. **Type check**: `npm run type-check`

## On Failure

For each failing test:
1. Read the test file to understand what it expects
2. Read the source file it tests
3. Identify whether the bug is in the test or the source
4. Report: test name, file path, expected vs actual, and likely cause

## Report Format

```
## Test Results
- Unit tests: PASS/FAIL (X passed, Y failed, Z skipped)
- Lint: PASS/FAIL
- Type check: PASS/FAIL
- Coverage: X%

## Failures (if any)
### <test-name>
- File: <path>
- Expected: <what>
- Actual: <what>
- Likely cause: <analysis>
```
