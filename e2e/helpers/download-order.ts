import { clearRequestLog, getRequestLog } from "../mock-server/server";

/**
 * Which archive of an update the app asked the mock server for.
 *
 * A release published with a binary patch offers at least two archives that install to
 * the same contents, so the app looks and behaves identically whether it applied the
 * patch or downloaded the full update after the patch failed. What the two cases do not
 * share is which archives were requested: a patch install fetches the patch alone, a
 * fallback fetches the patch and then the full archive, and a release without a patch
 * fetches the full archive alone.
 *
 * An asset diff archive is a third form of the same contents, offered to a client whose
 * installed update is the base it was built against, and told apart the same way: a diff
 * install fetches the diff alone, and a diff that cannot be installed falls back to the
 * patch archive when it failed on its asset side, and to the full archive otherwise.
 */
export type DownloadedArchive = "binary-patch" | "asset-diff" | "full";

export function startRecordingDownloads(): void {
  clearRequestLog();
}

/** The update archives the app downloaded, in the order it asked for them. */
export function getDownloadedArchives(): DownloadedArchive[] {
  return getRequestLog()
    .filter((request) => request.method === "GET" && request.url.startsWith("/bundles/"))
    .map((request) => {
      if (request.url.includes("/binary-patch/")) return "binary-patch";
      if (request.url.includes("/asset-diff/")) return "asset-diff";
      return "full";
    });
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

/**
 * The result the app's `onUpdateArchiveResult` callback reported for one download, exactly
 * as the library handed it over.
 */
interface ReportedUpdateArchiveResult {
  label: string;
  result: {
    status: string;
    archive: string;
    fallbackReason?: string;
    totalDurationMs: number;
    attempts: Array<{
      archive: string;
      fallbackReason?: string;
      durationMs: number;
      applyDurationMs?: number;
    }>;
  };
}

/** The results the app reported since recording started, in the order it reported them. */
function getReportedUpdateArchiveResults(): ReportedUpdateArchiveResult[] {
  return getRequestLog()
    .filter((request) => request.method === "GET" && request.url.startsWith("/e2e/update-archive-result?"))
    .map((request) => {
      const data = new URLSearchParams(request.url.split("?")[1]).get("data");
      if (!data) {
        throw new Error(`An update archive result report carries no data: ${request.url}`);
      }
      return JSON.parse(data) as ReportedUpdateArchiveResult;
    });
}

/** How long the runner gives the app's report to arrive before it calls the run failed. */
const REPORT_ARRIVAL_TIMEOUT_MS = 5000;
const REPORT_POLL_INTERVAL_MS = 100;

/**
 * Waits for exactly one report to reach the mock server's request log.
 *
 * The app sends it and moves straight on to installing, which for a mandatory update ends
 * in a restart, so the report and the assertion race. Waiting turns the far likelier half
 * of that race - the request in flight when the runner reads the log - into a pass. The
 * other half, the bridge going down before the request is even dispatched, no wait can fix;
 * the timeout below is what says so out loud.
 */
async function waitForOneReport(scenario: string): Promise<ReportedUpdateArchiveResult> {
  const deadline = Date.now() + REPORT_ARRIVAL_TIMEOUT_MS;

  for (;;) {
    const reports = getReportedUpdateArchiveResults();
    if (reports.length > 1) {
      throw new Error(
        `${scenario}: expected exactly one update archive result report, but the app sent ${reports.length}`,
      );
    }
    if (reports.length === 1) {
      return reports[0];
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${scenario}: no update archive result report arrived within ${REPORT_ARRIVAL_TIMEOUT_MS} ms. `
        + "Either the app never called the callback, or it was killed before the report was dispatched.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, REPORT_POLL_INTERVAL_MS));
  }
}

/**
 * How one attempt ended, as the assertion string spells it.
 *
 * An attempt that named a fallback reason is spelled by that reason, whatever the result
 * says overall - so a report claiming an archive was applied while its last attempt still
 * carries a reason shows the contradiction rather than swallowing it. Among the attempts
 * that named none, only the last can be the one that installed, and only when the result
 * says an archive was applied; the rest failed without any applier having a word for it.
 */
function attemptOutcome(attempt: { fallbackReason?: string }, isLast: boolean, status: string): string {
  if (attempt.fallbackReason !== undefined) {
    return attempt.fallbackReason;
  }
  return isLast && status === "applied" ? "applied" : "no-verdict";
}

/**
 * Asserts what the app was told about the update archives of its last download, compressed
 * into one line: the status and final archive, then every attempt as `archive=outcome`,
 * where the outcome is the attempt's own fallback reason, or `applied` for the attempt
 * that installed, or `no-verdict` for a failure no applier had a word for. The downloaded
 * archives say what the app asked the server for; this says the same story reached the
 * app's own callback, reasons and all.
 *
 * The report is waited for rather than read once, because the app dispatches it and moves
 * straight on to installing: it can still be in flight when the runner first looks.
 */
export async function assertReportedArchiveResult(scenario: string, expected: string): Promise<void> {
  const { result } = await waitForOneReport(scenario);
  const attempts = result.attempts ?? [];
  const actual = [
    result.status,
    result.archive,
    ...attempts.map(
      (attempt, index) =>
        `${attempt.archive}=${attemptOutcome(attempt, index === attempts.length - 1, result.status)}`,
    ),
  ].join(":");

  if (actual !== expected) {
    throw new Error(`${scenario}: expected the archive result "${expected}", but the app reported "${actual}"`);
  }

  console.log(`[assert] ${scenario}: the app reported "${actual}"`);
}

/**
 * Asserts that no binary patch and no asset diff archive was offered to the app, let alone
 * downloaded - it took the full archive and nothing else.
 */
export function assertFullArchivesOnly(scenario: string): void {
  const archives = getDownloadedArchives();

  if (archives.some((archive) => archive !== "full")) {
    throw new Error(`${scenario}: expected full archives only, but the app downloaded [${archives.join(", ")}]`);
  }
  if (archives.length === 0) {
    throw new Error(`${scenario}: expected at least one full archive download, but nothing was downloaded`);
  }

  console.log(`[assert] ${scenario}: downloaded [${archives.join(", ")}]`);
}
