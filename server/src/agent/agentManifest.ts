// The committed definition of the agent overlay: the smallest set of files
// that turns a stock upstream install into one that can update itself, roll
// back, and revert to stock, with no other behavior change.
//
// This is a server-side tooling artifact, not client code, and is not
// imported by the app bundle. ops/build-agent.sh reads it to generate the
// overlay; agentManifest.test.ts gates it.
//
// Modes:
//   add   the file is absent from stock and is copied in
//   copy  the file exists in stock and is replaced wholesale
//   patch the file exists in stock and is edited surgically, because
//         copying it would drag the rest of this tree along with it

export type AgentMode = 'add' | 'copy' | 'patch';

export type AgentEntry = {
  path: string;
  mode: AgentMode;
  why: string;
};

// Upstream publishes no tags at all, so the version string below resolves to
// no ref and cannot identify a tree. The sha is the base; the version is a
// label for humans, read out of upstream's own serverInfo.json. If upstream
// pushes to main without bumping that version, "2.1.5" silently denotes a
// different tree, which is why the sha is what gets pinned.
export const AGENT_BASE = {
  repo: 'https://github.com/throwaway31265/free-sleep.git',
  version: '2.1.5',
  sha: 'dc0c710f2800a7b6c0e3356abd5c5c166e0a36e1',
};

// What agent files may reach for outside the agent itself. Every one of these
// is verified present in stock at AGENT_BASE.sha. This is the agent's contract
// with stock: keeping it short is what keeps the agent small, and
// agentManifest.test.ts fails if any agent file imports outside it.
export const STOCK_CONTRACT = {
  paths: [
    'app/src/api/api.ts',
    'app/src/api/jobs.ts',
    'server/src/logger.ts',
    'server/src/serverInfo.json',
  ],
  packages: [
    'react',
    'axios',
    'semver',
    '@mui/material',
    '@mui/icons-material',
    '@tanstack/react-query',
    'child_process',
    'express',
    'zod',
  ],
};

export const AGENT_MANIFEST: AgentEntry[] = [
  // The update path. Stock already has an updater; the agent replaces it with
  // one that also does rollback, revert to stock, and targeted versions.
  { path: 'app/src/api/serverInfo.ts', mode: 'copy', why: 'asks this fork for the latest version rather than upstream' },
  { path: 'app/src/api/update.ts', mode: 'add', why: 'update, rollback and revert API client' },
  { path: 'app/src/api/updateSchema.ts', mode: 'add', why: 'shared update request and response types' },
  { path: 'app/src/api/useUpdateProgress.ts', mode: 'add', why: 'polls for the pod coming back on a new version' },
  { path: 'app/src/components/VersionStatus.tsx', mode: 'copy', why: 'hosts the update prompt and the rollback and revert rows' },
  { path: 'app/src/pages/SettingsPage/DeviceSettingsSection/UpdateFreeSleepButton.tsx', mode: 'copy', why: 'triggers the pod self-updater' },
  { path: 'app/src/pages/SettingsPage/VersionsPage/RollbackRow.tsx', mode: 'add', why: 'instant offline rollback to the previous tree' },
  { path: 'app/src/pages/SettingsPage/VersionsPage/RevertToStockRow.tsx', mode: 'add', why: 'the reversibility claim: return the pod to plain upstream' },

  // Pod-side machinery.
  { path: 'scripts/install.sh', mode: 'copy', why: 'installs this fork and wires the agent units' },
  { path: 'scripts/update.sh', mode: 'copy', why: 'download, back up, swap, health check, auto rollback' },
  { path: 'scripts/update_service.sh', mode: 'copy', why: 'systemd entry point for the updater' },
  { path: 'scripts/rollback_pod.sh', mode: 'add', why: 'swaps the live and previous trees offline' },
  { path: 'scripts/revert-to-stock.sh', mode: 'add', why: 'restores the stock install snapshotted at bootstrap' },
  { path: 'scripts/systemd/free-sleep-rollback.service', mode: 'add', why: 'stock has no systemd directory; it writes its unit inline' },
  { path: 'scripts/systemd/free-sleep-revert.service', mode: 'add', why: 'stock has no systemd directory; it writes its unit inline' },

  // Server routes and jobs.
  { path: 'server/src/jobs/update.ts', mode: 'copy', why: 'runs update.sh via the sudoers-permitted unit' },
  { path: 'server/src/jobs/rollback.ts', mode: 'add', why: 'runs rollback_pod.sh via its unit' },
  { path: 'server/src/jobs/revertToStock.ts', mode: 'add', why: 'runs revert-to-stock.sh via its unit' },
  { path: 'server/src/routes/update/update.ts', mode: 'add', why: 'POST /api/update and the rollback availability read' },
  { path: 'server/src/routes/update/updateSchema.ts', mode: 'add', why: 'validates the update target' },
  { path: 'server/src/serverInfo.json', mode: 'copy', why: 'identifies the build: version, branch, fork, upstream base' },
  { path: 'server/package.json', mode: 'patch', why: 'needs the test script added, since stock has no test runner entry; a copy would drag in every dependency of this tree' },
  { path: 'server/src/setup/routes.ts', mode: 'patch', why: 'aggregates every route in the tree, so a copy imports routes stock does not have' },

  // Tests travel with the code they cover.
  { path: 'server/src/updaterScripts.test.ts', mode: 'add', why: 'pins update.sh invariants' },
  { path: 'server/src/rollbackScript.test.ts', mode: 'add', why: 'pins rollback_pod.sh invariants' },
  { path: 'server/src/revertToStockScript.test.ts', mode: 'add', why: 'pins revert-to-stock.sh invariants' },
];
