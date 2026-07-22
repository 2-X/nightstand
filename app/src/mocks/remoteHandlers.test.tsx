import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { useReleases } from '@api/releases.ts';
import { useServerInfo } from '@api/serverInfo.ts';
import { useRemoteChangelog } from '@api/changelog.ts';
import { useRollbackInfo, postUpdate } from '@api/update.ts';

// Proves the demo mocks now cover the requests that previously bypassed MSW:
// the three raw-GitHub fetches, the rollback-info GET, and the update POST.
function RemoteProbe() {
  const releases = useReleases();
  const info = useServerInfo();
  const changelog = useRemoteChangelog();
  const rollback = useRollbackInfo();
  const ready = releases.data && info.data && changelog.data && rollback.data;
  return <div>{ ready ? 'remote-ready' : 'remote-loading' }</div>;
}

describe('remote and update MSW handlers', () => {
  it('resolves the GitHub fetches and rollback-info against MSW', async () => {
    renderWithProviders(<RemoteProbe />);
    expect(await screen.findByText('remote-ready')).toBeInTheDocument();
  });

  it('accepts a POST to /api/update', async () => {
    await expect(postUpdate({ targetVersion: '3.0.0', allowDowngrade: false })).resolves.toBeDefined();
  });
});
