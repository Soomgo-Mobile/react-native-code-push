const { resolveIosTeamIdForMaestro } = require("./resolve-ios-team-id");

function createProvider({ certificateOutput = "", profileOutput = "" } = {}) {
  return {
    readCertificateSubjectOutput: () => certificateOutput,
    readProfileTeamIdOutput: () => profileOutput,
  };
}

describe("resolveIosTeamIdForMaestro", () => {
  test("returns undefined for android", () => {
    const result = resolveIosTeamIdForMaestro({
      platform: "android",
      provider: createProvider({
        certificateOutput: "subject= /OU=AAAAAAAAAA/CN=Apple Development: Test",
      }),
    });

    expect(result).toBeUndefined();
  });

  test("uses CLI team id when provided", () => {
    const result = resolveIosTeamIdForMaestro({
      platform: "ios",
      cliTeamId: "ABCDEFGHIJ",
      provider: createProvider({
        certificateOutput: "subject= /OU=ZZZZZZZZZZ/CN=Apple Development: Test",
      }),
    });

    expect(result).toBe("ABCDEFGHIJ");
  });

  test("uses environment team id when CLI team id is missing", () => {
    const result = resolveIosTeamIdForMaestro({
      platform: "ios",
      env: { APPLE_TEAM_ID: "BCDEFGHIJK" },
      provider: createProvider(),
    });

    expect(result).toBe("BCDEFGHIJK");
  });

  test("uses detected team id from certificates when one value exists", () => {
    const result = resolveIosTeamIdForMaestro({
      platform: "ios",
      provider: createProvider({
        certificateOutput: [
          "subject= /UID=ABCDEF/OU=KLMNOPQRST/CN=Apple Development: Tester",
          "subject= /UID=ABCDEF/OU=KLMNOPQRST/CN=Apple Development: Tester 2",
        ].join("\n"),
      }),
    });

    expect(result).toBe("KLMNOPQRST");
  });

  test("uses detected team id from profiles when certificate output is empty", () => {
    const result = resolveIosTeamIdForMaestro({
      platform: "ios",
      provider: createProvider({
        profileOutput: ["ZYXWVUTSRQ", "ZYXWVUTSRQ"].join("\n"),
      }),
    });

    expect(result).toBe("ZYXWVUTSRQ");
  });

  test("throws when multiple team ids are detected", () => {
    expect(() =>
      resolveIosTeamIdForMaestro({
        platform: "ios",
        provider: createProvider({
          certificateOutput: "subject= /OU=AAAAAAAAAA/CN=Apple Development: Test",
          profileOutput: "BBBBBBBBBB",
        }),
      }),
    ).toThrow("Multiple iOS Team IDs detected");
  });

  test("throws when no team id is available", () => {
    expect(() =>
      resolveIosTeamIdForMaestro({
        platform: "ios",
        provider: createProvider(),
      }),
    ).toThrow("Could not resolve iOS Team ID");
  });
});
