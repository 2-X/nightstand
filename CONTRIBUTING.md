# Contributing

Nightstand is a personal fork of
[jmew/free-sleep](https://github.com/jmew/free-sleep), which builds on
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep). I
maintain it for my own Pod. Issues and pull requests are welcome, and I merge
fixes that are useful to others, but there is no roadmap, and a feature
request may not be picked up. For changes to the broader project, contribute
to [throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep)
(see its CONTRIBUTING.md) or to
[jmew/free-sleep](https://github.com/jmew/free-sleep).

## Where to start

- Open pull requests against `dev`. Work lands there, and `main` moves only
  at a release (see
  [Release cadence and promotion](#release-cadence-and-promotion)).
- [AGENTS.md](AGENTS.md) is written for coding agents, and it is also the
  shortest orientation for people: repository layout, commands, where the
  scheduling and hardware code lives, and the hardware cautions.
- [server/README_SERVER.md](server/README_SERVER.md) covers running the
  server on your computer or on a Pod, and lists the API routes.
  [app/README_APP.md](app/README_APP.md) covers the app's dev server,
  including a demo mode that needs no Pod.
- Read [docs/EIGHT_SLEEP_PROTOCOL.md](docs/EIGHT_SLEEP_PROTOCOL.md) before
  changing anything that talks to the hardware.

## AI-assisted contributions

Contributions written with AI tools are welcome and are reviewed like any
other. Point your tool at [AGENTS.md](AGENTS.md) first. However the code was
written, the person who opens the pull request is its author: you have read
and tested it, and you respond to review feedback and to any problems it
causes. No disclosure is needed either way.

## Setup

Use the Node version in `.nvmrc` (Volta users get the version pinned in
`server/package.json`). Install dependencies in both packages. The app
imports schema files from `server/src`, so it needs the server's dependencies
as well:

```
(cd server && npm ci && npm run generate)
(cd app && npm ci)
```

`npm run generate` builds the Prisma client, which the server's build and
tests need.

## Before a pull request

Typecheck, lint, and test both packages. From the repository root:

```
(cd server && npx tsc --noEmit && npm run lint && npm test)
(cd app && npx tsc -b && npm run lint && npm test)
```

CI runs the same checks, plus two more that are worth running locally when
your change touches that area:

- Biometrics (Python 3.9, with `cbor2 numpy scipy pandas watchdog pytest`
  installed): `python -m pytest biometrics/__tests__/`
- End-to-end tests against the demo build:
  `cd app && npx playwright install chromium && npm run build:demo && npx playwright test`

The Pod runs prebuilt code, so `server/dist/` and `server/public/` (the app's
build output) are committed. They must match the source on `main`, so a
release rebuilds them as its last step. On `dev` they may lag behind between
batches; rebuild once at the end of a batch rather than after every change.
Rebuild from a clean `npm ci` with `npm run build:pr` in both `server/` and
`app/`, then run `scripts/check-bundles.sh`: the builds do not delete old
output, and it lists files nothing uses anymore so you can remove them.
`ops/deploy.sh` refuses to ship bundles older than the source. CI rebuilds
from a clean `npm ci` and fails on `main` if the result differs from what is
committed; on `dev` it only notes it.

## Tests

New code comes with tests. Some older code has little coverage; it gains
tests as it is changed, and anything added now should land with tests for its
logic.

- Server: `node:test`, with test files next to the code they cover
  (`server/src/**/*.test.ts`). When the important part of a change is hard
  to test directly (shell scripts, UI wiring), move the logic into a plain
  module and test that, or at least test the invariants that would otherwise
  break without anyone noticing. `server/src/updaterScripts.test.ts` shows
  the pattern.
- App: Vitest with jsdom, Testing Library, and MSW. A change to an app
  component or page comes with a colocated `*.test.tsx` that renders it
  against the mock data using `renderWithProviders` or `renderApp`.
  [app/src/test/README.md](app/src/test/README.md) explains the harness.

## Optional features

Anything a user might reasonably want off ships behind a toggle in the
Features group in Settings:

- A key in `defaultFeatures` in `server/src/db/settingsSchema.ts`, with a
  default that keeps existing Pods behaving as they did.
- A row in `app/src/pages/SettingsPage/FeaturesSection/FeaturesSection.tsx`.
- An entry in `server/src/features/featuresManifest.ts`, whose tests fail if a
  settings feature key has no entry.

Always-on work also gets a manifest entry, with `flag: null` and the reason in
`rationale`. Manifest ids are never renamed, since `releases.json` lists them.
New settings keys are merged into stored settings at startup (see
`server/src/db/settings.ts`), so they need no migration.

## Running your changes on a Pod

The in-app updater installs published releases only. To run your own changes
on a Pod:

- `ops/deploy.sh` deploys the committed `HEAD` of your local clone over the
  LAN, with the same backup, health check, and automatic rollback as the
  updater (see [ops/ANTIBRICK.md](ops/ANTIBRICK.md)). `ops/deploy.sh --check`
  runs the preflight checks without deploying.
- `scripts/deploy-dev.sh` is the faster loop for iteration: it builds locally
  and copies only the files whose content changed since the last deploy. It
  has no backup or rollback step. Set `POD_HOST` to your Pod's address; the
  script header lists the other options.

Both scripts push code rather than running a full install, so a new systemd
unit can need a one-time manual step. The RAW-file archive section of
[server/README_SERVER.md](server/README_SERVER.md) describes the one case
today. For hot reload of server code, run the server directly on the Pod, as
described in the same file.

## Commit style

Conventional Commits, matching the existing history:

```
type(scope): subject
```

- Types: `feat`, `fix`, `ui`, `docs`, `build`, `ops`, `ci`, `refactor`,
  `chore`, `test`.
- Scope is optional. Common ones are `app`, `server`, `biometrics`, `ops`,
  and `install`.
- The subject is lowercase and imperative, with no trailing period.
- No trailers. The body explains why the change is needed, not only what it
  does.
- Before pushing, fold small follow-ups (a lint fix, a test tweak) into the
  commit they belong to with `git commit --fixup <commit>` and
  `git rebase -i --autosquash`. Pushed commits are not rewritten.

## Versioning

Semver, `MAJOR.MINOR.PATCH`, always with all three parts. The version is set
in one place, `server/src/serverInfo.json`.

- PATCH: a bug fix or internal change with no new behavior.
- MINOR: a new user-facing feature that is backward compatible.
- MAJOR: a breaking change to data schemas, the API, or on-Pod configuration
  that needs manual attention when deploying.

Nightstand's version stream started at 3.0.0 when it split from jmew's fork,
which was at 2.1.4 and followed the original project's 2.x line.
`upstreamBase` in the same file records the original-project release this
build is based on. Change it only when a build moves to a newer base.

Every release is also recorded in `releases.json` at the repository root,
with a `channel` of `stable` or `beta` and a `kind` of `bundle` (`agent` is
an older value the app still accepts; no release uses it),
and tagged in git as `v<version>` (for example `v3.2.0`).

## Release cadence and promotion

Cut a release when a coherent set of user-facing work is ready, not after
every change. Work lands on `dev`, with notes under a `## [Unreleased]`
heading in `CHANGELOG.md`. When there is enough for a version, that heading
becomes the release, `main` is fast-forwarded to `dev`, and the release
commit is tagged.

`main` moves only at a release, so it always matches the newest release.
This matters because installed Pods read `releases.json` from `main`, and
fresh installs and older updaters download `main` itself. Beta and stable are
not branches: each release's channel is a field in `releases.json`.

Avoid a series of one-commit releases. They make the changelog noisy and the
version number less meaningful.

Every release starts on `beta`, which gets new work first and has had less
testing. A release moves to `stable` at the maintainer's discretion, usually
after it has been in everyday use for a while without problems; there is no
fixed waiting period, so `stable` changes less often.
`scripts/promote_release.sh <version>` changes a single entry's channel in
`releases.json` and prints the matching `gh release edit` command to run.

- Trivial or documentation-only releases can start on `stable` directly.

Downgrades and rollbacks never reverse a Prisma migration: the older server
runs against the newer schema. This works because migrations are additive,
which is a standing rule. A new migration must never drop or rename a column
or table that an older, still-installable release reads.

New SQLite migrations must use one `BEGIN; ... COMMIT;` transaction. Never
edit a shipped migration: tests pin its checksum. The compatibility check
allows new tables, non-unique indexes, and additive columns; a required column
on an existing table needs a non-null default. Drops, renames, new constraints
on existing tables, and table rebuilds are refused. Test an upgrade and an
older reader against a copy of the resulting database before release.

## Release ritual

1. Bump the version in `server/src/serverInfo.json`.
2. Add the new release to the top of `releases.json`, following the shape of
   the entry below it: `kind` (always `bundle`), `version`, `date`, and
   `channel` (`beta` unless there is a reason to ship straight to `stable`).
   A bundle also carries its own `upstreamBase`, the release it was built
   from, and its `features` list.
3. Add a matching entry at the top of `CHANGELOG.md` (the `## [Unreleased]`
   notes become `## [<version>] - <date>`), starting with a one-sentence
   summary on its own line before the notes. The app shows it as the
   release's preview.
4. Rebuild both packages from a clean `npm ci` (`npm run build:pr` in
   `server/` and `app/`), remove any files `scripts/check-bundles.sh` lists,
   and commit the output. The release commit is the last commit before the
   tag.
5. Commit everything together on `dev`, fast-forward `main` to it
   (`git switch main && git merge --ff-only dev`), then tag:
   `git tag -a v<version> -m "..."`.
6. Push both branches and the tag: `git push origin main dev v<version>`.
7. Create the GitHub Release: `gh release create v<version> --title
   "v<version>" --notes-file <path>`, with that version's `CHANGELOG.md`
   section as the notes. Add `-R LTimothy/nightstand` if `gh` picks the
   wrong default repository (this clone has several other forks configured
   as remotes for cherry-picking). Pass `--prerelease` for a `beta` release.
   When a release is later promoted to `stable` in `releases.json`, also run
   `gh release edit v<version> --prerelease=false` (and `--latest` if it is
   the newest stable release) to match.
