import { execSync } from "child_process";

type Platform = "ios" | "android";

interface TeamIdProvider {
  readCertificateSubjectOutput: () => string;
  readProfileTeamIdOutput: () => string;
}

interface ResolveIosTeamIdOptions {
  platform: Platform;
  cliTeamId?: string;
  env?: NodeJS.ProcessEnv;
  provider?: TeamIdProvider;
}

const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;
const TEAM_ID_ENV_KEYS = [
  "MAESTRO_IOS_TEAM_ID",
  "APPLE_TEAM_ID",
  "IOS_TEAM_ID",
  "TEAM_ID",
] as const;

export function resolveIosTeamIdForMaestro(
  options: ResolveIosTeamIdOptions,
): string | undefined {
  if (options.platform !== "ios") {
    return undefined;
  }

  const cliTeamId = normalizeTeamId(options.cliTeamId);
  if (cliTeamId !== undefined) {
    assertValidTeamId(cliTeamId, "--team-id");
    return cliTeamId;
  }

  const env = options.env ?? process.env;
  for (const key of TEAM_ID_ENV_KEYS) {
    const value = normalizeTeamId(env[key]);
    if (value === undefined) {
      continue;
    }
    assertValidTeamId(value, key);
    return value;
  }

  const provider = options.provider ?? createDefaultProvider();
  const detectedTeamIds = uniqueTeamIds([
    ...extractTeamIds(provider.readCertificateSubjectOutput()),
    ...extractTeamIds(provider.readProfileTeamIdOutput()),
  ]);

  if (detectedTeamIds.length === 1) {
    return detectedTeamIds[0];
  }

  if (detectedTeamIds.length > 1) {
    throw new Error(
      `Multiple iOS Team IDs detected: ${detectedTeamIds.join(", ")}. `
      + "Pass --team-id <APPLE_TEAM_ID> or set MAESTRO_IOS_TEAM_ID.",
    );
  }

  throw new Error(
    "Could not resolve iOS Team ID for maestro-runner. "
    + "Pass --team-id <APPLE_TEAM_ID> or set MAESTRO_IOS_TEAM_ID.",
  );
}

function createDefaultProvider(): TeamIdProvider {
  return {
    readCertificateSubjectOutput: () =>
      runCommand("security find-identity -v -p codesigning 2>/dev/null"),
    readProfileTeamIdOutput: () =>
      runCommand(
        "for p in \"$HOME\"/Library/MobileDevice/Provisioning\\ Profiles/*.mobileprovision; do "
        + "security cms -D -i \"$p\" 2>/dev/null | "
        + "plutil -extract TeamIdentifier.0 raw -o - - 2>/dev/null; "
        + "done",
      ),
  };
}

function runCommand(command: string): string {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function normalizeTeamId(rawValue: string | undefined): string | undefined {
  if (typeof rawValue !== "string") {
    return undefined;
  }

  const normalized = rawValue.trim().toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
}

function assertValidTeamId(teamId: string, source: string): void {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error(
      `Invalid iOS Team ID from ${source}: "${teamId}". `
      + "Expected a 10-character uppercase alphanumeric value.",
    );
  }
}

function extractTeamIds(output: string): string[] {
  const teamIds = new Set<string>();

  addMatches(teamIds, output, /OU=([A-Z0-9]{10})/g);
  addMatches(teamIds, output, /\(([A-Z0-9]{10})\)/g);

  for (const rawLine of output.split(/\r?\n/)) {
    const line = normalizeTeamId(rawLine);
    if (line !== undefined && TEAM_ID_PATTERN.test(line)) {
      teamIds.add(line);
    }
  }

  return Array.from(teamIds);
}

function addMatches(target: Set<string>, output: string, pattern: RegExp): void {
  for (const match of output.matchAll(pattern)) {
    target.add(match[1]);
  }
}

function uniqueTeamIds(teamIds: string[]): string[] {
  return Array.from(new Set(teamIds)).sort();
}
