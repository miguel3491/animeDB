# animeDB revival plan

This plan is designed to bring the application back to a healthy, maintainable state in phases.

## 0) Confirm current baseline

- [x] Verify project builds (`npm run build`).
- [x] Inventory current warnings and risky patterns.
- [ ] Capture expected user journeys (search anime, view top list, paginate results).

## 1) Stabilize API connectivity first

### Problems to address
- Browser-to-third-party API calls can fail due to rate limits, CORS changes, transient upstream outages, or stricter bot/edge filtering.
- Errors are not surfaced to users; the app silently fails.

### Actions
1. Create a dedicated API module (e.g., `src/api/jikan.js`) to centralize fetch logic.
2. Move URL construction into one place and use `REACT_APP_API_BASE_URL`.
3. Add request timeout + retry with backoff for recoverable failures.
4. Normalize API responses and throw typed errors.
5. Add UI states in `MainContent`: loading, empty, and error with retry button.

### Optional hardening
- Add a lightweight backend proxy (Express/Cloudflare Worker) to shield API keys/rate handling and normalize CORS.
- Cache high-traffic endpoints like top anime.

## 2) Clean up code quality and UX risks

### Current warnings to resolve
- Unused imports/variables (`AnimeCard`, router imports, etc.).
- Missing `rel="noreferrer noopener"` when using `target="_blank"`.
- Invalid anchor usage (`<a>` tags without `href`).
- Redundant alt text and accessibility issues.

### Actions
1. Remove dead imports/components and commented blocks that are no longer relevant.
2. Replace invalid anchors with buttons where navigation is not intended.
3. Ensure all external links include safe `rel` attributes.
4. Add an error boundary and basic empty-state visuals.

## 3) Add test coverage for critical flows

### Minimum test suite
- Render test for app shell.
- API client tests for success, timeout, and error normalization.
- Main content tests for loading, results, pagination callback, and error UI.

### Tooling
- Keep Jest + React Testing Library initially.
- Add CI command: `npm run build && npm test -- --watch=false`.

## 4) Modernize build/runtime stack

### Why
Create React App is now a legacy choice for many teams; modern alternatives provide faster builds and better DX.

### Actions
1. Migrate to Vite (lowest-friction path) while preserving component structure.
2. Introduce TypeScript gradually (`allowJs` first, then convert modules incrementally).
3. Split UI and data logic into reusable hooks/components.

## 5) Operational readiness

1. Add `.env.example` documenting required variables.
2. Add monitoring hooks (Sentry or console-to-service bridge).
3. Document deployment steps and rollback procedure.
4. Add dependency update workflow (Renovate/Dependabot).

## Proposed execution order (fastest path)

1. API client + UI error/loading states.
2. Lint/security/accessibility cleanup.
3. Basic test coverage + CI.
4. Toolchain migration (CRA -> Vite).
5. Optional backend proxy for resilience.

## Exit criteria for “back to live”

- Users can consistently search and paginate anime without silent failures.
- Build + tests pass in CI.
- No critical lint/security warnings remain.
- Deployment and environment configuration are documented.
