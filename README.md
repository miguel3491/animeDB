# animeDB

A React-based anime discovery app that uses the [Jikan API](https://docs.api.jikan.moe/) to list top anime and search by title.

## Current project status

This repository is an older Create React App project and needs modernization work before production use.

### What is currently working
- Core React UI renders and production build succeeds.
- Search/top anime views are wired to Jikan endpoints.

### What is currently risky/outdated
- API calls are made directly from the browser without retries, graceful error states, or a configurable API base URL.
- Tooling is based on Create React App with aging dependencies and warning-heavy lint output.
- There is no project-specific test suite to validate core behavior.

See [`docs/REVIVAL_PLAN.md`](docs/REVIVAL_PLAN.md) for a practical step-by-step recovery plan.

## Local development

```bash
npm install
npm start
```

## Validation commands

```bash
npm run build
```

## Suggested near-term priorities

1. Add a resilient API client layer with loading/error states and environment-based configuration.
2. Clean up lint warnings and improve accessibility/security attributes.
3. Add smoke tests for rendering + API fallback behavior.
4. Migrate from CRA to a modern build tool (Vite or Next.js) once behavior is stabilized.
