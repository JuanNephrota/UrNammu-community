<!--
Thanks for contributing to Nammu! Fill out the sections below. Keep the PR
focused — one logical change per PR makes review (and revert) much easier.
-->

## Summary

<!-- One or two sentences: what does this PR do and why? -->

## Changes

<!-- Bulleted list of user-visible or architectural changes. Link to issues. -->

-
-

Closes #

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (schema migration, API surface, or config rename)
- [ ] Docs only
- [ ] Refactor / internal only (no user-visible change)
- [ ] CI / tooling / dependencies

## How was this tested?

<!-- Describe verification. "Runs on my machine" isn't enough for anything
touching auth, the proxy, or migrations. -->

- [ ] `npx tsc --noEmit` passes (main app)
- [ ] `npx tsc --noEmit` passes (ai-proxy, if touched)
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] Manually verified in the browser (dev server) if UI changed

## Security-sensitive review checklist

Tick **every** box that applies. If any are ticked, a CODEOWNER must approve.

- [ ] Touches authentication (`auth.ts`, `auth-guard.ts`, NextAuth config)
- [ ] Touches authorization or role checks (`withRole`, permission logic)
- [ ] Touches the API proxy (`anthropic-proxy.ts`, `mcp-passthrough.ts`, `proxy-bucket-writer.ts`, `ai-proxy/`)
- [ ] Touches secret handling (`settings.ts`, `SETTINGS_ENCRYPTION_KEY`, stored credentials)
- [ ] Adds / changes a Prisma migration (`prisma/migrations/`)
- [ ] Adds / changes an API route that accepts user input
- [ ] Adds / changes a background job or cron endpoint
- [ ] Changes CI, branch protection, or repo config (`.github/`, `vercel.json`)
- [ ] None of the above

## Migration / deploy notes

<!-- If this needs a migration, a setting change, a re-deploy of ai-proxy,
     a revoked credential, or anything that isn't "merge and forget" —
     write it here. -->

- [ ] No deploy-time steps required
- [ ] Requires `prisma migrate deploy` on production
- [ ] Requires `func azure functionapp publish` for ai-proxy
- [ ] Requires a new environment variable or Setting value:
- [ ] Requires credential rotation:
- [ ] Other:

## Screenshots / recordings

<!-- For UI changes, drop in a before/after screenshot or short clip. -->

## Breaking changes / user impact

<!-- If this changes existing behavior, what do operators or contributors
     need to know? Link to updated docs. -->
