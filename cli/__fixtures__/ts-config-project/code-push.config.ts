// Loaded by the CI smoke test through the compiled CLI: a TypeScript config that uses
// `export default` and a tsconfig `paths` alias, the two things the loader must handle.
import type { CliConfigInterface, ReleaseHistoryInterface } from "@bravemobile/react-native-code-push";
import { downloadUrlFor } from "@helpers/host";

const config: CliConfigInterface = {
  bundleUploader: async (source) => ({ downloadUrl: downloadUrlFor(source) }),
  getReleaseHistory: async (targetBinaryVersion): Promise<ReleaseHistoryInterface> => ({
    [targetBinaryVersion]: { enabled: true, mandatory: false, downloadUrl: downloadUrlFor("fixture.zip"), packageHash: "fixture" },
  }),
  setReleaseHistory: async () => {},
};

export default config;
