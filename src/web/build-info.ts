declare const __SHALE_BUILD_COMMIT__: string;
declare const __SHALE_BUILD_DATE__: string;

const commit = __SHALE_BUILD_COMMIT__;

export const buildInfo = Object.freeze({
  commit,
  shortCommit: commit === "unknown" ? commit : commit.slice(0, 12),
  date: __SHALE_BUILD_DATE__,
});
