# Contributing

Contributions are welcome! Free Sleep is a community-driven project, and even small improvements help a lot. To keep everything smooth and avoid duplicate work, please follow these guidelines:

## 🚫 Core Project Policies (Please Read Before Making Changes)

To keep Free Sleep stable, predictable, and easy for everyone to work on, there are a few core parts of the project that should not be changed without explicit discussion first:

## 1. Don’t switch core tooling
Tools like:
- Volta (for Node version management)
- npm (for package management)
- TypeScript
- Prettier / ESLint configuration

These are intentionally chosen and should not be replaced with alternatives like Bun, Yarn, or other system-wide changes.
If you think a tool could be upgraded or swapped, please discuss it first in Discord. The Pod has a finicky environment and stability is important.


## 2. Avoid editing shell scripts unless necessary
- The scripts in scripts/*.sh handle installation, updates, and automation across many Pods in real homes.
- Small changes can break installs or updates for users, so:
  - Don’t modify shell scripts unless absolutely needed.
  - Open an issue or discuss changes on Discord before making a PR.


## 3. Coordinate Before You Start
- Message me on Discord @free_sleep before starting any feature or fix.
- This helps avoid two people working on the same thing and keeps the project moving efficiently.


## 4. Code Style & Quality
- Run `npm run lint` & `npm run build` in both server/ and app/ before opening a PR.
- Keep changes clean, consistent, and focused on a single purpose.


## 5. Git & Pull Requests
- Your branch must be conflict-free with main before submitting.
- I don’t have bandwidth to resolve merge conflicts for contributors.
- Write clear commit messages so others can understand your changes.
- Test your changes on an actual Pod if possible, or clearly describe what environment you used.


## 6. TypeScript Only
- All contributions must be in TypeScript — no JavaScript or mixed-language files.


## 7. Keep PRs Small
- Smaller, focused PRs are much easier to review and merge quickly.
- Large “kitchen sink” PRs will be delayed or rejected.
- Test your changes.


## 8. Be Respectful of Stability
- Free Sleep runs on real hardware that people depend on every night.
- **Please avoid** risky changes without testing or discussion first.
