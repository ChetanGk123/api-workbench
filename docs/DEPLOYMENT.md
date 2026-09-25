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

Settings → **Check for update** reads `version.json` from
`https://chetangk123.github.io/api-workbench/` and compares it against the
version compiled into the bookmark. When a newer version is published, **Copy
new bookmarklet** fetches `bookmarklet.txt` from the same deployment and puts
it on the clipboard.

Both files are uploaded by the same Pages deployment, so the version reported
and the bookmarklet handed over always match. The build emits `version.json`
from `package.json`, and `deploy.yml` stages it with the rest. Reading the
repository instead would report versions that are on `main` but not yet
installable.

These two reads are the only network requests the bundle makes, and
`scripts/build.mjs` asserts that this site is the only absolute URL surviving
bundling. Neither response is evaluated:

- **The copy is not an install.** Page script cannot reach the bookmarks bar,
  so nothing can replace a saved bookmark. The user pastes the copied text into
  the bookmark's URL field and reloads before launching it. The running build
  is untouched either way.
- **The copied text is verified first.** It must start with `javascript:` and
  contain the version that was promised, so a deployment caught midway between
  uploading `version.json` and `bookmarklet.txt` is refused rather than copied.
- **The host page's CSP.** The bookmarklet runs in the page's origin, so a
  `connect-src` that excludes the Pages site blocks both reads. This is not
  detectable in advance, so the check falls back to the newest build recorded
  in this origin's IndexedDB at launch, and the copy reports why it failed.
- **The repository must stay public**, since making it private takes the Pages
  site down with it. The panel falls back; it does not break.

Releasing an update is therefore: bump `package.json`, push to `main`, and let
the workflow deploy. Anyone who presses **Check for update** afterwards is
offered the new bookmarklet.

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
