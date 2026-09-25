# Deployment

The private source repository is https://github.com/ChetanGk123/api-workbench.

`.github/workflows/deploy.yml` installs locked development dependencies with
`npm ci` and runs `npm run build` on every push and pull request. The build
includes TypeScript checking and assertions against external runtime assets.
Only successful builds on `main` deploy. Generated files stay out of Git.

The Pages artifact contains `index.html`, `install.html`, `bookmarklet.txt`,
both JavaScript bundles, and `sizes.json`. Local installation size experiments
remain in `dist/install-probes.html` and are excluded from the hosted site.

The landing page and installer contain the newly built bookmarklet. Saved
bookmarks do not update automatically: replace the bookmark and reload the
application before launching a new version.

## Hosting prerequisite

On 25 September 2026, GitHub rejected Pages activation for this private
repository with HTTP 422: “Your current plan does not support GitHub Pages
for this repository.” Hosting is not live. An eligible GitHub plan or a
different publishing destination is required before deployment can succeed.

With an eligible plan, enable Settings → Pages → Source → GitHub Actions,
then rerun the workflow on `main`. The expected project URL is
`https://chetangk123.github.io/api-workbench/`, with the installer at
`install.html`. A private source repository does not make a standard Pages
site private.

## Local verification

```sh
npm ci
npm run build
npx playwright test tests/showcase.spec.mjs tests/m0.spec.mjs
```

These browser checks do not prove real saved-bookmark installation. Verify
saved-bookmark launch and persistence separately in desktop Chrome and Edge.

To publish a change, commit it and push to `main`. Failed builds leave the
previous deployment intact. To roll back, revert the unwanted commit and
push the revert to `main`.
