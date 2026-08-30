import { describe, expect, it, vi } from "vitest";
import { checkForUpdates } from "../../src/web/update-check";

const currentCommit = "1234567890abcdef1234567890abcdef12345678";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("update checks", () => {
  it("reports the current build when GitHub returns the same commit", async () => {
    const fetcher = vi.fn(async () => response({ sha: currentCommit }));

    await expect(checkForUpdates(currentCommit, fetcher)).resolves.toBe("current");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/EleventhLucas/shale/commits/main",
      expect.objectContaining({ cache: "no-store", referrerPolicy: "no-referrer" }),
    );
  });

  it("accepts a short embedded commit and reports newer commits", async () => {
    await expect(
      checkForUpdates(currentCommit.slice(0, 12), async () => response({ sha: currentCommit })),
    ).resolves.toBe("current");
    await expect(
      checkForUpdates(currentCommit, async () =>
        response({ sha: "abcdef1234567890abcdef1234567890abcdef12" }),
      ),
    ).resolves.toBe("available");
  });

  it("reports failures without throwing", async () => {
    await expect(
      checkForUpdates("unknown", async () => response({ sha: currentCommit })),
    ).resolves.toBe("failed");
    await expect(checkForUpdates(currentCommit, async () => response({}, 403))).resolves.toBe(
      "failed",
    );
    await expect(
      checkForUpdates(currentCommit, async () => {
        throw new Error("offline");
      }),
    ).resolves.toBe("failed");
  });
});
