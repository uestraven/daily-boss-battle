# Deploying to Cloudflare Pages

The game is a static build with no server. Everything it needs — the verified encounter
pool, sprites, audio — ships in the bundle, so there is nothing to run and nothing to
scale.

## One-time setup

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, point
it at `uestraven/daily-boss-battle`, then set:

| Setting | Value |
| --- | --- |
| Framework preset | **None** |
| Build command | `npm run web:build` |
| Build output directory | `web-dist` |
| Root directory | *(leave blank — the repo root)* |
| Production branch | `main` |

Node version comes from `.node-version` (22). Cloudflare runs `npm ci` automatically
because `package-lock.json` is committed, and installs devDependencies, which the build
needs for `tsc` and `vite`.

That is the whole configuration. Every push to `main` deploys; every pull request gets a
preview URL.

### Optional: email reminders

The signup form only renders when an endpoint is configured, so without this it is simply
absent rather than silently discarding addresses. Add an environment variable under
**Settings → Environment variables**, for production and preview:

```
VITE_REMINDER_ENDPOINT = https://your-form-provider.example/f/abc123
```

Buttondown and Formspree both accept a plain form POST, which is what the component sends.
It is a build-time variable, so changing it needs a redeploy.

## Deploying from a terminal

`wrangler.toml` keeps the output directory in version control and makes direct uploads
work, which is useful for testing a build without pushing:

```bash
npm run web:build
npx wrangler pages deploy web-dist
```

## What the config files do

- **`web/public/_headers`** — Vite copies this to the build root. Caching splits three
  ways: Vite's `/assets/*` are content-hashed so they are immutable forever; files served
  from `public/` are *not* hashed, so they get a day of freshness plus a week of
  stale-while-revalidate, which is fast for repeat visitors while still letting an updated
  asset propagate; and `index.html` must revalidate or a deploy never reaches anyone. It
  also sets `nosniff`, a referrer policy, `X-Frame-Options` and a `Permissions-Policy`.
- **`.node-version`** — pins the build to Node 22, matching CI.
- **`wrangler.toml`** — names the project and the output directory.

There is deliberately **no SPA fallback** (`/* /index.html 200`). The app has no
client-side routing, and a catch-all would return `index.html` with a 200 for a missing
asset, which would hide a genuinely missing sprite or sound behind a successful-looking
response. Unknown paths should 404.

## Before the first production deploy

```bash
npm run verify       # tests, behaviour guard, verified pool freshness
npm run pwa:check    # manifest and icons
npm run audio:check  # which audio is present, and its size
npm run web:build    # the build Cloudflare will run
```

Then open the preview URL on a phone and check:

- the battle plays, and the theme starts on the first action
- **Add to Home Screen** on iOS shows the sword icon, not a screenshot of the page
- the result card's **Share image** opens the native share sheet with a PNG attached
- safe-area insets keep the UI clear of the system bars

## Known gaps at launch

- **No service worker**, so Chrome on Android will not offer "Install app" and there is no
  offline play. iOS "Add to Home Screen" works regardless. This is the next piece of work;
  the game is fully playable offline by design, so it is mostly about caching the shell.
- **No Content-Security-Policy.** Worth adding, but a wrong one is a blank page, so it
  should be set and verified against a preview deployment rather than guessed. The email
  endpoint needs to be allowed in `connect-src` if one is configured.
- **Results are per-browser and unverified.** There is no account and no server
  adjudication; the UI says so. See the technical plan for what a backend would add.
