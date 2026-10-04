// Set while setupJobs re-plans every job. Between cancelling the old jobs and
// planning the new ones the job list is empty, so it says nothing about what is due.
let rebuilding = false;
export const isRebuilding = () => rebuilding;
export function setRebuilding(on) {
    rebuilding = on;
}
//# sourceMappingURL=rebuildState.js.map