import semver from "semver";

const DEFAULT_SETUP_PODS_COMMAND =
  "bundle install && cd ios && bundle exec pod install";

export function buildSetupPodsScript(rnVersion: string): string {
  if (semver.gte(rnVersion, "0.81.0-0") && semver.lt(rnVersion, "0.84.0-0")) {
    return "bundle install && cd ios && RCT_USE_RN_DEP=1 RCT_USE_PREBUILT_RNCORE=1 bundle exec pod install";
  }

  return DEFAULT_SETUP_PODS_COMMAND;
}
