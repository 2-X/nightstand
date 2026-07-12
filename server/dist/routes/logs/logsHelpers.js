// Pure helpers for the log-listing/tailing route, split out so they're
// testable without spinning up Express/fs.watch.
import path from 'path';
export const isLogFilename = (name) => name.endsWith('.log');
// The tailing route joins this filename onto a fixed logs directory with no
// further sanitization, so a path-traversal or absolute-path value here
// (e.g. "../../etc/passwd") would read arbitrary files off the pod. Reject
// anything whose basename doesn't match itself, on top of the existing
// .log-suffix check.
export const isSafeLogFilename = (name) => isLogFilename(name) && name === path.basename(name);
// Splits a chunk of bytes freshly appended to a log file into whole lines.
// A trailing empty string from a chunk that ends exactly on a newline isn't
// a real line, so drop it. A trailing non-empty fragment (the writer hasn't
// finished the line yet) is kept; the next poll's chunk will complete it as
// a separate SSE message rather than being merged in, since these are tail
// reads on an actively-written file, not a buffered stream.
export const linesFromAppendedChunk = (chunk) => chunk.split('\n').filter((line, i, arr) => !(i === arr.length - 1 && line === ''));
//# sourceMappingURL=logsHelpers.js.map