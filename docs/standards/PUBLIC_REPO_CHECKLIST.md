# Before making a repo public

Run `scripts/public-ready.sh` first; it automates most of section 1–3. Then a human goes through the rest.

## 1. Secrets (blocking)
- [ ] `gitleaks git` over the **whole history** is clean. Anything found: **rotate the key first**, then rewrite history (`git filter-repo`) or publish a fresh repo with a squashed history.
- [ ] No `.env`, keys, keystores, `google-services.json` with secrets, service-account JSON, `.npmrc` tokens, database dumps, ever committed.
- [ ] CI secrets live in the platform's secret store, not in workflow files.

## 2. Personal and company data (blocking)
- [ ] No real customer/user data, emails, phone numbers, addresses, screenshots with real data.
- [ ] No employer/client code, names, internal URLs, IPs, Slack/Jira links, or anything under NDA.
- [ ] No absolute paths revealing your username/machine.
- [ ] Commit author emails are ones you're happy to publish (or use the GitHub `noreply` address going forward).

## 3. Hygiene
- [ ] `README.md`: the problem it solves, a screenshot/GIF or live demo link, how to run it, architecture, **decisions and trade-offs**, and limitations.
- [ ] `LICENSE` (MIT/Apache-2.0 for most portfolio projects).
- [ ] `SECURITY.md` with a private reporting route and the risks you considered.
- [ ] `.env.example` lists every variable with fake values.
- [ ] `.gitignore` covers env files, keys, build output, dependencies, editor files.
- [ ] No large binaries, build output or `node_modules` tracked.
- [ ] `EVALS.md` if there's any AI feature; `CONTRIBUTING.md` if you want contributions.

## 4. Quality signals a reviewer will look at
- [ ] CI badge green: lint, types, tests, build, secret scan, dependency audit.
- [ ] Tests exist and are meaningful; the main flows are covered.
- [ ] Clean, conventional commit history on `main` (squash the "wip" noise).
- [ ] Repo description, topics and website link set on GitHub.
- [ ] Pinned on your profile if it's a flagship.

## 5. GitHub settings after publishing
- [ ] Settings → Code security: Dependabot alerts + security updates, **secret scanning + push protection**, CodeQL default setup.
- [ ] Branch protection / ruleset on `main`: require PR, require CI to pass, no force-push.
- [ ] Private vulnerability reporting enabled.
- [ ] Actions: default `GITHUB_TOKEN` permissions read-only.
