# Changelog

Notable changes to Nightstand, in its own version stream starting at 3.0.0
(see [CONTRIBUTING.md](CONTRIBUTING.md) for how versions get bumped). Nightstand
is a hard fork; for the history of the projects it descends from, see
[jmew/free-sleep](https://github.com/jmew/free-sleep) and
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep).

## [Unreleased]

## [3.0.0] - 2026-07-16

Nightstand's first release under its own identity: a minimal agent that
turns a stock free-sleep install into one with update, rollback, and
revert-to-stock built in. Everything else that has landed on top of that
agent so far, Franken hardening, biometrics, the sleep and schedule
pages, the updater surface, ships in this same tree today, and becomes
the first flag-gated feature bundle in a later release once the flag
system exists.

The git history itself was rebuilt from a fresh clone of upstream
throwaway31265/free-sleep, with each prior feature ported or
reimplemented as its own commit, attributed to its original author
wherever a commit could be taken directly. See [README.md](README.md)
for the fork lineage and [CONTRIBUTING.md](CONTRIBUTING.md) for how
versions get cut.
