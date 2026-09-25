# Testing

Cross-cutting test suites that don't belong inside a single app or package:

- `e2e/` — end-to-end (Playwright), critical flows only
- `load/` — dispatch-hour load tests (Constitution VI.7)
- `contract/` — consumer-driven contract tests per event (Constitution VI.4)
- `fixtures/` — shared synthetic test data

Unit and integration tests live next to the code they test
(`apps/backend/test/`, `apps/owner-app/src/**/*.test.ts`,
`apps/driver-app/app/src/test/`) per the test pyramid (Constitution VI.1).
