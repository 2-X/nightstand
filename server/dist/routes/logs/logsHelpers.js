// Pure helpers for the log-tailing route, split out so they're testable
// without spinning up Express/fs.watch.
import path from 'path';
// The tailing route joins this filename onto a fixed logs directory with no
// further sanitization, so a path-traversal or absolute-path value here
// (e.g. "../../etc/passwd") would read arbitrary files off the pod. Reject
// anything whose basename doesn't match itself.
export const isSafeLogFilename = (name) => name.endsWith('.log') && name === path.basename(name);
//# sourceMappingURL=logsHelpers.js.map