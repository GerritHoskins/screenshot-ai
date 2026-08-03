# E2E Tests - Workstream H.2

End-to-end tests for the ScreenshotAI Electron application.

## Test Structure

- **`setup.ts`** - Test harness utilities for launching and interacting with Electron windows
- **`capture-flow.test.ts`** - Tests for capture functionality
- **`analysis-flow.test.ts`** - Tests for AI analysis flow
- **`settings-flow.test.ts`** - Tests for settings UI
- **`error-handling.test.ts`** - Tests for error handling scenarios

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npm run test:e2e -- tests/e2e/capture-flow.test.ts

# Run with watch mode
npm run test:watch -- tests/e2e
```

## Test Utilities

The `setup.ts` file provides utilities for:
- Launching Electron app windows
- Waiting for elements to appear
- Interacting with UI elements (click, input, etc.)
- Executing JavaScript in renderer process
- Cleanup between tests

## Notes

- E2E tests require the Electron app to be built (`npm run build`)
- Tests use Electron's built-in testing capabilities
- Some tests simulate IPC events rather than actual OS-level interactions
- Tests run with a 10-second timeout by default

## CI Integration

E2E tests are included in the CI workflow but marked as `continue-on-error: true` because:
- They may be flaky in CI environments
- They require Electron to be properly built
- OS-level interactions (like global hotkeys) may not work in CI

## Future Enhancements

- Add tests for actual capture flow (requires OS-level access)
- Add tests for real API interactions (with mocked providers)
- Add visual regression tests
- Add performance tests
