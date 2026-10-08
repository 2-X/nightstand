const RELOAD_KEY = 'nightstand:route-reload-at';
const RELOAD_WINDOW_MS = 5 * 60 * 1000;

// An open tab may request chunks removed by a reinstall, including one of the same version.
export async function loadRoute<Module>(
  importPage: () => Promise<Module>,
  reload: () => void = () => window.location.reload(),
): Promise<Module> {
  try {
    return await importPage();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const chunkFailed = [
      /Failed to fetch dynamically imported module|error loading dynamically imported module/i,
      /Importing a module script failed|Loading chunk .* failed/i,
      /Unable to preload CSS|Unexpected token ['"]</i,
    ].some(pattern => pattern.test(message));
    if (!chunkFailed) throw error;
    try {
      const previous = Number(window.sessionStorage.getItem(RELOAD_KEY));
      const now = Date.now();
      if (previous && now - previous < RELOAD_WINDOW_MS) throw error;
      window.sessionStorage.setItem(RELOAD_KEY, String(now));
    } catch {
      throw error;
    }
    reload();
    // Keep the route suspended until the browser replaces this document.
    return new Promise<never>(() => {});
  }
}
