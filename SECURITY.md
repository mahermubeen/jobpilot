# Security

## Reporting

Found a vulnerability? Email mahermubeenahmad@gmail.com. Please don't open a public issue.

## Risks I considered

| Risk | How it's handled |
|---|---|
| Secrets | API keys, the Gmail app password and tokens are entered in Settings and stored only in the local database under `data/`, which is gitignored. They are never sent to the browser: the UI only gets `secretsStatus()` booleans (`lib/settings.ts`). `.env*` is gitignored; see `.env.example`. |
| Personal data | Your CV, scraped jobs, contacts (names, emails, phones) and generated PDFs all live in `data/`. Tests and prompt examples use fictional people and reserved numbers (+1 555 01xx). |
| Network exposure | `npm run dev` and `npm start` bind to `127.0.0.1` only. There are no user accounts, so the app is never meant to be on a public URL. |
| CSRF from other websites | `proxy.ts` checks every `/api/*` request. A write (POST, PUT, PATCH, DELETE) with an `Origin` other than a loopback page or the browser extension gets 403. Browsers can send `text/plain` POSTs cross-site without a preflight, so the content type is not relied on. |
| DNS rebinding | `proxy.ts` rejects any request whose `Host` is not `127.0.0.1`, `localhost` or `[::1]`, so a rebound domain can't read your CV or settings. |
| CV data to the extension | `/api/apply/*` routes also check the origin on reads (`lib/apply/guard.ts`), because they return CV content. |
| Sending email | Nothing is sent without a click in the Outbox. The daily run only prepares drafts. Guessed addresses need an extra confirmation, and there is a daily send cap. |
| Invented CV content | Tailored CVs can only select and reorder content from the master CV. `sanitizeVariant` (`lib/cv/variant.ts`) drops anything else in code, not only in the prompt. |
| Prompt injection | Job descriptions and company pages are untrusted text. They are wrapped in tagged blocks, and the reply is parsed as JSON and checked field by field (scores, labels, CV selections) before use. The model has no tools and can't send mail or change settings. |
| Browser extension | Content scripts run only on a fixed list of job sites. The extension fills fields; it never presses Submit. It talks only to `127.0.0.1`. The API trusts only this extension's fixed ID (set by the public key in `extension/manifest.json`); every other extension is refused, for reads as well as writes. Out of scope: other software running as you on this computer, which can read `data/` directly. |
| Fetching untrusted links (SSRF) | Company research fetches job links and company sites taken from scraped posts. `lib/sources/safe-url.ts` allows only public http(s) hosts: loopback, LAN, link-local/cloud-metadata and other private addresses are refused after DNS resolution, and each redirect hop is checked (at most 3). |
| Browser hardening | Every page sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy` (`next.config.ts`). |
| Third-party services | Apify, Apollo, Gmail and AI providers are called only with keys you supply, and only for requests you trigger or schedule. |
| Dependencies | Versions are locked in `package-lock.json`. CI runs lint, typecheck, tests, `npm audit` (fails on high), a build, a gitleaks secret scan, CodeQL and dependency review on pull requests. Dependabot opens weekly update PRs. |

The full checklist these were checked against is [`docs/standards/SECURITY_CHECKLIST.md`](docs/standards/SECURITY_CHECKLIST.md). AI behaviour is covered in [`EVALS.md`](EVALS.md).

## Known gaps

- There is no script Content-Security-Policy yet (Next.js inline scripts would need nonces). Only framing is restricted.
- The SSRF check resolves DNS before fetching, so a host that changes its DNS answer between the check and the request (DNS rebinding) is not fully covered. Fetched text only reaches the AI prompt.
- Secrets are stored unencrypted in the local database. Anyone with access to your user account on this machine can read them.
- There is no authentication; a single local user is assumed. Don't expose the port (tunnels, `0.0.0.0`, hosting) without adding auth first.
- Collecting jobs from LinkedIn and Indeed through Apify actors is subject to those sites' terms. Check them for your use.
- Contacts found for a company are personal data. You are responsible for how you store and email them (GDPR, CAN-SPAM).
