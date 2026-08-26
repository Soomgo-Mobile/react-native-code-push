# Telemetry Callbacks

[한국어](telemetry-callbacks.ko.md)

`CodePushOptions` takes optional callbacks that report what an update did. They exist to be
observed and nothing more: the library neither stores what they report nor sends it
anywhere, so an app that wants any of it in its telemetry sends it itself. Registering none
changes nothing about how updates behave, and a callback that throws is logged to the
console rather than failing the update it is reporting on.

For the per-option reference, alongside every other option, see
[`CodePushOptions`](api-js.md#codepushoptions).

## The callbacks

| Callback | Called when | Receives |
|---|---|---|
| `onDownloadStart` | the download of an available update begins | `(label)` |
| `onDownloadSuccess` | the download of an available update has completed. The install happens afterwards, so this says nothing about whether the update could be installed | `(label)` |
| `onUpdateArchiveResult` | an update published with a binary patch has been downloaded, before it is installed | `(label, result)` |
| `onUpdateSuccess` | an installed update has run successfully, as of the [`notifyAppReady`](api-js.md#codepushnotifyappready) that marks it successful | `(label)` |
| `onUpdateRollback` | an installed update failed to run and was rolled back to the previous version | `(label)` |
| `onRolloutSkipped` | the device falls outside the latest release's active rollout, so the update check leaves that release out of the candidates | `(label)` |
| `onSyncError` | the sync ends in the [`SyncStatus.UNKNOWN_ERROR`](api-js.md#syncstatus) state | `(label, error)` |

`label` is the release the report is about. `onSyncError` passes `"unknown"` instead when
the sync failed before a release was resolved.

> [!NOTE]
> The typings declare a second `error` parameter on `onRolloutSkipped`, but the runtime only
> ever passes the label.

## What `error` carries

Group reports by `error.code`, not by the message: the message is localized on iOS and is
the exception's own words on Android.

| Platform | `error.code` | Example |
|---|---|---|
| iOS | the [`NSURLError`](https://developer.apple.com/documentation/foundation/1508628-url_loading_system_error_codes) code as a string, or `-1` for an error CodePush raised itself | `"-1005"`, the connection dropped |
| Android | the category of the failure | `"CODE_PUSH_NETWORK"`, the connection dropped |

Android categories:

| Code | Means | Worth downloading again |
|---|---|---|
| `CODE_PUSH_NETWORK` | The connection dropped, timed out, or never opened. | Once the network is back |
| `CODE_PUSH_HTTP` | The server answered with a status of 400 or above. The status is in the message. | Depends on the status |
| `CODE_PUSH_INTEGRITY` | The downloaded contents do not hash to the release's package hash, or hold no JS bundle by the name the app looks for. | No |
| `CODE_PUSH_UNKNOWN` | Anything else. | Unknown |

`CodePush.sync()` rejects with the same error, so a caller that awaits it does not need
this callback.

## Registering them

Pass them to the `CodePush({ ... })` wrapper from
["CodePush-ify" Your App](../README.md#4-codepush-ify-your-app). They run for every sync,
whatever the `checkFrequency` is, including the `CodePush.sync()` calls you make yourself.

```typescript
export default CodePush({
  checkFrequency: CodePush.CheckFrequency.MANUAL, // or something else
  releaseHistoryFetcher: releaseHistoryFetcher,
  onUpdateSuccess: (label) => {
    // Send it to your own telemetry, if you want it there.
  },
  onUpdateArchiveResult: (label, result) => {
    // Send it to your own telemetry, if you want it there.
  },
})(MyApp);
```

`onUpdateArchiveResult` is the only callback that you can also pass to an individual
`sync()` call. Passing it there overrides the registered one for that call - to tag the
result of one particular sync, for instance.

```typescript
CodePush.sync({
  onUpdateArchiveResult: (label, result) => {
    // Send it to your own telemetry, if you want it there.
  },
});
```

## What `onUpdateArchiveResult` reports

A release published with a binary patch offers the client patch archives to download in
place of the full one. See
[Asset diff archives](diff-updates.md#asset-diff-archives) for what those are and when a
release carries them. This callback reports which of them the download came from, and what
happened to the ones it did not.

### `UpdateArchiveResult`

| Field | Type | Description |
|---|---|---|
| `status` | `"applied" \| "fallback"` | Whether one of the patch archives produced the update, or the full archive had to be downloaded instead. |
| `archive` | `UpdateArchive` | The archive of the last attempt: the one the update came from, or the last one given up on. |
| `fallbackReason` | `ArchiveFallbackReason` | Why the full archive had to be downloaded. Absent on `"applied"`, and when the last attempt ended in an error no applier has a word for. |
| `totalDurationMs` | `number` | How long the whole patch path took, from the first archive starting to download to the last attempt being finished with. The full download that follows a fallback is not part of it. |
| `attempts` | `UpdateArchiveAttempt[]` | Every archive that was tried, in the order it was tried. The full archive is never among them. |

`UpdateArchive` is `"binary-patch"` or `"asset-diff"`.

### `UpdateArchiveAttempt`

| Field | Type | Description |
|---|---|---|
| `archive` | `UpdateArchive` | Which archive this attempt downloaded. |
| `fallbackReason` | `ArchiveFallbackReason` | Why this archive was given up on. Absent for the attempt the update came from. |
| `durationMs` | `number` | How long this attempt ran, whichever way it ended. |
| `applyDurationMs` | `number` | How long the applier took to rebuild the bundle from this archive's patch. Absent when the attempt ended before the bundle was restored. |

Most downloads leave a single attempt. A second one appears when an asset diff failed on its
asset side - the merge with the installed update failing (`asset_merge_failed`), or the
merged contents failing the package hash (`package_verification_failed`). The client then
tries the binary patch, which carries every asset and depends on nothing installed. A diff
that failed in the bundle patch both archives carry skips the binary patch and goes straight
to the full archive, because it would fail there the same way.

### `fallbackReason`

Every platform's applier reports the same words, so a rollout can be judged by them
whichever platform it is running on.

| Reason | Description |
|---|---|
| `base_bundle_unavailable` | The bundle inside the app binary could not be opened or read. |
| `base_hash_mismatch` | The bundle inside the app binary is not the one the patch was computed against. |
| `invalid_manifest` | The manifest is missing, malformed, points outside the archive, or asks for too much. |
| `unsupported_format` | The patch was produced by a format or a codec this client cannot apply. |
| `patch_apply_failed` | The applier refused the patch, or the restored bundle could not be written. |
| `target_verification_failed` | The restored bundle is not the one the manifest promised. |
| `asset_merge_failed` | The asset diff could not be merged with the installed update it was built against. |
| `package_verification_failed` | The update restored from the patch did not pass the checks that follow the restore. |

### A fallback is not a failed update

The update is downloaded in full instead and installed as usual. Nothing about the update
depends on what this callback is told.

A fallback does show in `downloadProgressCallback`, though: each download after one reports
a progress stream of its own, counting `receivedBytes` from zero again against its own
`totalBytes`.
