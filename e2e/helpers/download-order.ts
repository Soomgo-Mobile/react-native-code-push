import { clearRequestLog, getRequestLog } from "../mock-server/server";

/**
 * Which archive of an update the app asked the mock server for.
 *
 * A release published with a binary patch offers two archives that install to the same
 * contents, so the app looks and behaves identically whether it applied the patch or
 * downloaded the full update after the patch failed. What the two cases do not share is
 * which archives were requested: a patch install fetches the patch alone, a fallback
 * fetches the patch and then the full archive, and a release without a patch fetches the
 * full archive alone.
 */
export type DownloadedArchive = "patch" | "full";

export function startRecordingDownloads(): void {
  clearRequestLog();
}

/** The update archives the app downloaded, in the order it asked for them. */
export function getDownloadedArchives(): DownloadedArchive[] {
  return getRequestLog()
    .filter((request) => request.method === "GET" && request.url.startsWith("/bundles/"))
    .map((request) => (request.url.includes("/binary-patch/") ? "patch" : "full"));
}

export function assertDownloadedArchives(scenario: string, expected: DownloadedArchive[]): void {
  const actual = getDownloadedArchives();

  if (actual.length !== expected.length || actual.some((archive, index) => archive !== expected[index])) {
    throw new Error(
      `${scenario}: expected the app to download [${expected.join(", ")}], but it downloaded [${actual.join(", ")}]`,
    );
  }

  console.log(`[assert] ${scenario}: downloaded [${actual.join(", ")}]`);
}

/** Asserts that no patch archive was offered to the app, let alone downloaded. */
export function assertNoPatchDownloads(scenario: string): void {
  const archives = getDownloadedArchives();

  if (archives.includes("patch")) {
    throw new Error(`${scenario}: expected full archives only, but the app downloaded [${archives.join(", ")}]`);
  }
  if (archives.length === 0) {
    throw new Error(`${scenario}: expected at least one full archive download, but nothing was downloaded`);
  }

  console.log(`[assert] ${scenario}: downloaded [${archives.join(", ")}]`);
}
