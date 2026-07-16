# Contributing

This is a personal fork, maintained for one Pod and one household. You're
welcome to open issues and PRs, and useful fixes will get merged, but there's
no roadmap, no SLA, and no promise that a feature request goes anywhere. If
you want changes for the broader project, take them to
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep)
(coordinate on their Discord first, per their CONTRIBUTING.md) or to
[jmew/free-sleep](https://github.com/jmew/free-sleep), which this fork is
based on.

## AI-assisted contributions

Welcome, and treated no differently from any other kind. [AGENTS.md](AGENTS.md)
is kept current as the entry point for coding agents (layout, commands,
hardware cautions), so point your tool there first. Whatever wrote the code,
you own the PR: you have read it, tested it, and you are the one accountable
for review feedback and for any issues it causes. Nothing else in this
document changes based on how the code was produced.

## Commit style

Conventional Commits, matching the history already here:

```
type(scope): subject
```

- Types: `feat`, `fix`, `ui`, `docs`, `build`, `ops`, `refactor`, `chore`, `test`.
- Scope is optional; existing ones include `biometrics`, `schedule`, `server`,
  `base`, `versioning`.
- Subject is lowercase and imperative, with no trailing period.
- Plain messages with no trailers; the body explains why, not just what.

## Versioning

Semver, `MAJOR.MINOR.PATCH`, always all three parts. One source of truth:
`server/src/serverInfo.json`.

- PATCH: bug fix or internal change, no new behavior.
- MINOR: new user-facing feature, backward compatible.
- MAJOR: breaking change to data schemas, the API, or on-pod config that
  needs manual attention when deploying.

Nightstand's stream started at 3.0.0 at the hard fork from jmew's fork (which
was at 2.1.4, tracking the original project's 2.x line). `upstreamBase` in the
same file records the original-project release this build was made from;
update it when a build moves to a newer base, not after every review.

Every release is also recorded in `releases.json` (repo root) with a channel
of `stable` or `beta`, a `kind` of `agent` or `bundle`, and tagged in git as
`v<version>` (e.g. `v3.2.0`).

## Release cadence and promotion

Cut a release when a coherent, user-facing bundle of work is ready, not once
per change. Work accumulates on `main` under a `## [Unreleased]` heading in
`CHANGELOG.md`; when there's enough to justify a version, that heading becomes
the release. A steady trickle of one-commit releases makes the changelog noise
and the version number meaningless, so resist it.

Every release is born on `beta`. Promotion to `stable` is part of the ritual,
not an afterthought: at each release, sweep the existing betas and promote any
that have soaked at least **seven nights** on real hardware with no regressions.
Use `scripts/promote_release.sh <version>` to flip a single entry's channel in
`releases.json` (it prints the matching `gh release edit` command to run). Two
rules keep the channels honest:

- **Stable floor.** The newest `stable` release must never lag behind a beta
  that has already cleared its seven-night soak. Betas are for soaking, not for
  parking finished work indefinitely.
- Trivial or doc-only releases can be born `stable` directly.

Downgrades and rollbacks never reverse a Prisma migration: the older server
just runs against the newer schema. This works because migrations are
additive, and that's a standing rule: a new migration must never drop or
rename a column/table that an older, still-installable release reads.

## Release ritual

1. Bump the version in `server/src/serverInfo.json`.
2. Add the new release to the top of `releases.json`, copying the shape of the
   entry below it: `kind` (`agent` or `bundle`), `version`, `date`, and channel
   (`beta` unless there's a reason to ship straight to `stable`). A bundle also
   carries its own `upstreamBase`, the release it was built from, and its
   `features` list.
3. Add a matching entry at the top of `CHANGELOG.md`.
4. Rebuild both halves (`npm run build:pr` in `server/` and `app/`) and commit
   the output.
5. Commit everything together, then tag: `git tag -a v<version> -m "..."`.
6. Push with tags: `git push origin main --tags`.
7. Create the GitHub Release: `gh release create v<version> --title
   "v<version>" --notes-file <path>` with that version's `CHANGELOG.md`
   section as the notes, `-R LTimothy/nightstand` if `gh`'s default-repo
   detection picks the wrong remote (this repo has several forks configured
   as remotes for cherry-picking). Pass `--prerelease` for a `beta`-channel
   release; when a release is later promoted to `stable` in `releases.json`,
   also run `gh release edit v<version> --prerelease=false` (and
   `--latest` if it's the newest stable one) to match.

## Tests

New code comes with tests. The inherited tree is mostly untested and gets
backfilled incrementally as things are touched, but anything added now should
land with coverage for its logic. The server uses `node:test` with test files
next to the code they cover (`src/**/*.test.ts`); when the interesting part
of a change is hard to test directly (shell scripts, UI wiring), extract the
logic into a plain module and test that, or at minimum gate the invariants
that would break silently (see `src/updaterScripts.test.ts` for the pattern).

## Before a PR

Lint and typecheck both halves, and run the server test suite.

```
cd server && npx tsc --noEmit && npm run lint && npm test
cd app && npx tsc -b && npm run lint
```

The pod runs prebuilt code, so `server/dist/` and `server/public/` (the app's
build output) are committed. If your change touches source, rebuild
(`npm run build:pr` in both `server/` and `app/`) and commit the output,
otherwise the deploy ships stale code.
