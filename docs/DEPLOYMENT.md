# Deployment

The public source repository is https://github.com/ChetanGk123/api-workbench.

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

## The update check

Settings → **Check for update** reads
`https://raw.githubusercontent.com/ChetanGk123/api-workbench/main/package.json`
and compares its `version` against the version compiled into the bookmark. It
reports a newer published version and points at the install page; it cannot
replace the bookmark, because page script has no access to the bookmark bar.

The read is the one network request the bundle makes, and `scripts/build.mjs`
asserts that this URL is the only absolute URL that survives bundling. It is
read as data and never evaluated. Three conditions govern it:

- **The repository must stay public.** raw.githubusercontent returns 404 for a
  private repository without a token, and a token cannot be embedded in a
  bookmarklet — its text is readable, and it would be exposed to every page the
  bookmarklet runs on. Making the repository private again disables the check;
  it does not break the panel, which falls back.
- **CORS.** raw.githubusercontent answers with `Access-Control-Allow-Origin: *`
  and caches for 300 seconds. GitHub Pages sends no CORS headers, so the
  deployed site cannot serve this manifest.
- **The host page's CSP.** The bookmarklet runs in the page's origin, so a
  `connect-src` that excludes raw.githubusercontent blocks the request. This is
  not detectable in advance, so the failure is silent and falls back.

The fallback is the previous behavior: the newest build recorded in this
origin's IndexedDB at launch. `main` can be ahead of what is published on the
install page; the check reports what the repository holds, not what Pages last
deployed.

## Hosting

Pages activation was rejected with HTTP 422 while the repository was private:
“Your current plan does not support GitHub Pages for this repository.” The
repository was made public on 25 September 2026, which cleared the restriction.
Pages is now enabled with `build_type: workflow`, so pushes to `main` deploy
through `.github/workflows/deploy.yml`.

The project URL is `https://chetangk123.github.io/api-workbench/`, with the
installer at `install.html`. Making the repository private again would both
take the site down and disable the update check.

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
