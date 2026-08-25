const log = require("./logging");

// This function is used to augment remote and local
// package objects with additional functionality/properties
// beyond what is included in the metadata sent by the server.
module.exports = (NativeCodePush) => {
  const remote = () => {
    return {
      /**
       * @param downloadProgressCallback Called as the archive is received.
       * @param updateArchiveResultCallback Called with `{ status, archive, fallbackReason?,
       *        totalDurationMs, attempts }` when the update was published with a binary patch,
       *        so that the app can observe how the archives went. It says nothing about whether
       *        the download succeeded - archives that could not be applied are reported here
       *        and the update is downloaded in full - and it is the only place the result is
       *        ever available.
       */
      async download(downloadProgressCallback, updateArchiveResultCallback) {
        if (!this.downloadUrl) {
          throw new Error("Cannot download an update without a download url");
        }

        let downloadProgressSubscription;
        if (downloadProgressCallback) {
          // Use event subscription to obtain download progress.
          downloadProgressSubscription = NativeCodePush.addDownloadProgressListener(
            downloadProgressCallback
          );
        }

        // Use the downloaded package info. Native code will save the package info
        // so that the client knows what the current package version is.
        try {
          const updatePackageCopy = Object.assign({}, this);
          Object.keys(updatePackageCopy).forEach((key) => (typeof updatePackageCopy[key] === 'function') && delete updatePackageCopy[key]);

          const downloadResult = await NativeCodePush.downloadUpdate(updatePackageCopy, !!downloadProgressCallback);

          // The archive result describes the download that just happened, not the update it
          // delivered, and the package is handed around as the update's metadata from here
          // on - it is even written back to the native side on install. So the result is
          // taken off the package and reported on its own, leaving the package exactly what
          // the native side saved.
          const { updateArchiveResult, ...downloadedPackage } = downloadResult ?? {};
          if (updateArchiveResult && updateArchiveResultCallback) {
            // The result is an observation, so an observer that throws must not turn a
            // downloaded update into a failed one.
            try {
              updateArchiveResultCallback(updateArchiveResult);
            } catch (error) {
              log(`The update archive result callback threw: ${error?.message ?? error}`);
            }
          }

          return { ...downloadedPackage, ...local };
        } finally {
          downloadProgressSubscription && downloadProgressSubscription.remove();
        }
      },

      isPending: false // A remote package could never be in a pending state
    };
  };

  const local = {
    async install(installMode = NativeCodePush.InstallMode.ON_NEXT_RESTART, minimumBackgroundDuration = 0, updateInstalledCallback) {
      const localPackage = this;
      const localPackageCopy = Object.assign({}, localPackage); // In dev mode, React Native deep freezes any object queued over the bridge
      await NativeCodePush.installUpdate(localPackageCopy, installMode, minimumBackgroundDuration);
      updateInstalledCallback && updateInstalledCallback();
      if (installMode == NativeCodePush.InstallMode.IMMEDIATE) {
        NativeCodePush.restartApp(false);
      } else {
        NativeCodePush.clearPendingRestart();
        localPackage.isPending = true; // Mark the package as pending since it hasn't been applied yet
      }
    },

    isPending: false // A local package wouldn't be pending until it was installed
  };

  return { local, remote };
};
