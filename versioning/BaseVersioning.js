/**
 * @type {BaseVersioning}
 */
class BaseVersioning {
  /**
   * @param {ReleaseHistoryInterface} releaseHistory
   * @param {SortingMethod} sortingMethod
   */
  constructor(releaseHistory, sortingMethod) {
    if (this.constructor == BaseVersioning) {
      throw new Error("Abstract classes can't be instantiated.");
    }
    if (releaseHistory == null || sortingMethod == null) {
      throw new Error("param releaseHistory and sortingMethod is needed");
    }

    /** @type {SortingMethod} */
    this.sortingMethod = sortingMethod;

    /** @type {ReleaseHistoryInterface} */
    this.originalReleaseHistory = releaseHistory;

    /** @type {[ReleaseVersion, ReleaseInfo][]} */
    this.sortedReleaseHistory = Object.entries(releaseHistory).sort(
      ([a], [b]) => this.sortingMethod(a, b)
    );
  }

  /**
   * @return {[ReleaseVersion, ReleaseInfo][]}
   */
  get sortedEnabledReleaseHistory() {
    return this.sortedReleaseHistory.filter(([_, bundle]) => bundle.enabled);
  }

  /**
   * @return {[ReleaseVersion, ReleaseInfo][]}
   */
  get sortedMandatoryReleaseHistory() {
    return this.sortedEnabledReleaseHistory.filter(
      ([_, bundle]) => bundle.mandatory
    );
  }

  /**
   * find latest release in releaseHistory
   * @return {[ReleaseVersion, ReleaseInfo]}
   */
  findLatestRelease() {
    const latestReleaseInfo = this.sortedEnabledReleaseHistory.at(0);

    if (!latestReleaseInfo) {
      throw new Error("There is no latest release.");
    }

    return latestReleaseInfo;
  }

  /**
   * check if the update is mandatory
   * @param {ReleaseVersion|undefined} runtimeVersion
   * @return {boolean}
   */
  checkIsMandatory(runtimeVersion) {
    if (this.shouldRollback(runtimeVersion)) {
      // rollback is always mandatory
      return true;
    }

    if (this.sortedMandatoryReleaseHistory.length === 0) {
      return false;
    }

    if (!runtimeVersion) {
      // This means that there is at least one mandatory update, but the update has not been installed yet.
      // So, the update is mandatory.
      return true;
    }

    const [latestMandatoryVersion, _] = this.sortedMandatoryReleaseHistory[0];
    const [larger] = [latestMandatoryVersion, runtimeVersion].sort(this.sortingMethod);

    return runtimeVersion !== latestMandatoryVersion && larger === latestMandatoryVersion;
  }

  /**
   * determine whether to rollback and execute it
   * @param {ReleaseVersion|undefined} runtimeVersion
   * @return {boolean}
   */
  shouldRollback(runtimeVersion) {
    if (!runtimeVersion) {
      // Rollback is not possible because no updates have been installed.
      return false;
    }

    const [latestRelease] = this.findLatestRelease();
    const [larger] = [latestRelease, runtimeVersion].sort(this.sortingMethod);

    return runtimeVersion !== latestRelease && larger === runtimeVersion;
  }

  /**
   * Determine whether to clear the currently running bundle.
   * If it returns true, the CodePush bundle will be erased, and the app will restart.
   * @param {ReleaseVersion} runtimeVersion
   * @return {boolean}
   */
  shouldRollbackToBinary(runtimeVersion) {
    if (!runtimeVersion) {
      // Rollback is not possible because no updates have been installed.
      return false;
    }

    const [latestReleaseVersion] = this.findLatestRelease();
    const [binaryAppVersion] = this.sortedReleaseHistory.at(-1);

    return (
      runtimeVersion !== latestReleaseVersion &&
      this.shouldRollback(runtimeVersion) &&
      latestReleaseVersion === binaryAppVersion
    );
  }
}

module.exports = { BaseVersioning: BaseVersioning };
