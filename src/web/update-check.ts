export const shaleRepositoryUrl = "https://github.com/EleventhLucas/shale";
const latestCommitUrl = "https://api.github.com/repos/EleventhLucas/shale/commits/main";

export type UpdateCheckStatus = "idle" | "checking" | "failed" | "available" | "current";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function commitMatches(current: string, latest: string): boolean {
  return current === latest || current.startsWith(latest) || latest.startsWith(current);
}

export async function checkForUpdates(
  currentCommit: string,
  fetcher: Fetcher = fetch,
): Promise<Exclude<UpdateCheckStatus, "idle" | "checking">> {
  const normalizedCurrent = currentCommit.trim().toLocaleLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(normalizedCurrent)) return "failed";

  try {
    const response = await fetcher(latestCommitUrl, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) return "failed";
    const body = (await response.json()) as { sha?: unknown };
    const latest = typeof body.sha === "string" ? body.sha.toLocaleLowerCase() : "";
    if (!/^[0-9a-f]{40}$/.test(latest)) return "failed";
    return commitMatches(normalizedCurrent, latest) ? "current" : "available";
  } catch {
    return "failed";
  }
}
