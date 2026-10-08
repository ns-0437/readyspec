# Hosted demo

Public URL: **https://ns-0437.github.io/readyspec/**

The GitHub Pages site is a separate browser-only demonstration, not a deployment of the Next.js
server. It uses curated excerpts from the fictional notification fixture, deterministic product
decisions, editable criteria, human review acknowledgement, and labelled downloadable briefs.
There are no model requests, repository uploads, API keys, accounts, or server sessions.

## What visitors can do

1. Filter four public code excerpts; inspect their line ranges, hashes, and commit-pinned source.
2. Decide security exceptions, pause duration, and channel scope, or keep them unresolved.
3. Inspect proposed criteria and tests, follow their evidence, and edit the criterion wording.
4. Record a reviewer and acknowledgement, then download Markdown, JSON, or an issue checklist.
5. Explicitly save a local draft. Reviewer names and review approval are never stored. Reloading
   restores compatible choices and edits but requires review again. Reset clears the demo draft.

Changing decisions resets edited criteria to keep them consistent with the selected policy.
Editing criteria clears approval. These browser controls demonstrate review behavior; they do
not run the full app's verifier and do not prove semantic correctness. Tests in the brief are
proposals, not tests executed against an implementation.

## Develop and verify

```bash
npm ci
npm run demo:build
npm run demo:check
npm run demo:serve
```

Open `http://127.0.0.1:4173/readyspec/`. The subpath matches Pages, and all internal assets use
relative URLs. `demo/tsconfig.json` compiles native browser ES modules using the repository's
existing TypeScript dependency. No additional frontend dependency is required.

`scripts/build-demo.ts` copies only named public files and four explicitly allowlisted fixture
excerpts. `scripts/check-demo.ts` rejects unexpected artifact files, unresolved asset/module links,
server-only references, and source/hash drift. The site uses a self-only Content Security Policy;
its only runtime fetch is the bundled evidence JSON. Drafts use the visitor's localStorage only.

## Publish and roll back

GitHub Pages must use **GitHub Actions** as its build source. The `Deploy demo to GitHub Pages`
workflow tests the demo, builds and verifies `dist-demo`, uploads that directory, then deploys it
using the `github-pages` environment. It never uploads the repository root. Only its deployment
job receives Pages write and identity-token permissions. Pull requests run build validation in CI.

Merges affecting the demo trigger publication; `workflow_dispatch` supports a manual redeploy.
To roll back, revert the offending change through a PR and merge it; the same workflow publishes
the reverted artifact. Update the GitHub repository's About website field if the public URL changes.

Use the [local setup](../README.md#try-locally) for arbitrary repositories, actual retrieval,
consent-controlled model calls, persisted server sessions, and the full verifier.
