# Scope and workflow

- Work only in this standalone logistics cost project.
- Do not access, inspect, scan, reuse, deploy to or modify the label management system, including its website, domain, server, DB, credentials and infrastructure. This prohibition includes read-only investigation. Do not add network permissions for it or propose sharing its host.
- Use this project's independent code, development server, SQLite DB and example-data review artifact. Do not create paid AWS resources without the user selecting paid hosting.
- Preserve `data/` and `backups/`. Never reset a user DB, create a fixed password, or automatically upload historical browser data. The user will supply real Excel after site construction.
- Use Node.js 24+. `npm start` runs the authenticated SQLite-backed application. `npm run review` builds and serves an isolated example-data review UI; it does not call the application's API.
- `npm run review:build` regenerates `artifacts/scm-logistics-review.html` after UI changes. Provide the updated artifact for iterative user review.
- `npm test` covers application/server/import calculations. `npm run test:review` uses Python Playwright/Chromium, a disposable local server and browser data to verify the complete review workflow. Run checks appropriate to actual changes, not unrelated repeated suites.
- Stop only project-owned processes; keep production systems untouched. Do not publish localhost URLs as user-facing cloud previews.
