# Telemetry Callbacks

[한국어](./telemetry-callbacks.ko.md)

`CodePushOptions` provides optional callbacks for observing an update's progress and result.

The callbacks are **for observation only**.

- The library does not store or send callback data. Your app must send the data itself to record it in telemetry.
- Registering callbacks does not change update behavior.
- Callback failures do not affect update behavior.

See `CodePushOptions` for the other available options.

## When is each callback called?

| Callback | Called when | Receives | Notes |
| --- | --- | --- | --- |
| `onDownloadStart` | The download of an available update begins | `(label)` | Indicates only that the download has started. |
| `onDownloadSuccess` | The download of an available update finishes | `(label)` | Installation and successful execution are not guaranteed yet. |
| `onUpdateArchiveResult` | A binary patch or asset diff update has finished downloading, before installation | `(label, result)` | Shows which archive was used and whether patch fallback occurred. |
| `onUpdateSuccess` | An installed update runs and is confirmed successful through `notifyAppReady` | `(label)` | This is the point to record an actual update success. |
| `onUpdateRollback` | An installed update fails to run and rolls back to the previous version | `(label)` | This is separate from download or installation success. |
| `onRolloutSkipped` | The device is outside the active rollout, so the latest release is excluded from the candidates | `(label)` | The release was not deployed to this device. |
| `onSyncError` | `sync()` ends with `SyncStatus.UNKNOWN_ERROR` | `(label, error)` | Classify the cause by `error.code`, not `error.message`. |

`label` is the release being reported. (Example: `"1.0.3"`) If `sync()` fails before a release is resolved, `onSyncError` receives `"unknown"`.

> **Note:** The type definition for `onRolloutSkipped` includes a second `error` parameter, but the runtime passes no value for it, so it is always `undefined`.

## How to record errors

Group errors by `error.code`, not `error.message`.

On iOS, the message may be localized. On Android, it includes the original error text. By contrast, `error.code` is better suited for aggregation and alert conditions.

| Platform | `error.code` format | Example |
| --- | --- | --- |
| iOS | An `NSURLError` code as a string. Errors raised directly by CodePush use `-1`. | `"-1005"`: connection lost |
| Android | A category that represents the cause of the failure. | `"CODE_PUSH_NETWORK"` |

### Android error codes

| Code | Meaning | Worth downloading again |
| --- | --- | --- |
| `CODE_PUSH_NETWORK` | The connection was lost, timed out, or could not be opened. | Worth retrying after the network recovers |
| `CODE_PUSH_HTTP` | The server responded with an HTTP status of `400` or above. The message contains the status code. | Depends on the status code |
| `CODE_PUSH_INTEGRITY` | The downloaded contents do not match the release's `package hash`, or do not contain a JS bundle with the name the app expects. | No |
| `CODE_PUSH_UNKNOWN` | Any other error. | Unknown |

`CodePush.sync()` also rejects with the same error. Therefore, callers that directly await the result of `sync()` do not need to register `onSyncError` separately.

## Registering callbacks

Pass the callbacks to the `CodePush({ ... })` wrapper when applying CodePush to your app.

Callbacks registered this way run for every `sync()`, regardless of `checkFrequency`, including `CodePush.sync()` calls made directly by the app.

```ts
export default CodePush({
  checkFrequency: CodePush.CheckFrequency.MANUAL,
  releaseHistoryFetcher,
  onUpdateSuccess: (label) => {
    // Send to your own telemetry if needed.
  },
  onUpdateArchiveResult: (label, result) => {
    // Send to your own telemetry if needed.
  },
})(MyApp);
```

### Registering a callback for a specific `sync()`

`onUpdateArchiveResult` is the only telemetry callback that can also be passed to an individual `sync()` call.

A callback passed to an individual call overrides the `onUpdateArchiveResult` registered on the wrapper for that call. For example, you can use it to record results from a specific action with a separate tag.

```ts
CodePush.sync({
  onUpdateArchiveResult: (label, result) => {
    // Record only the result of this sync call.
  },
});
```

## Understanding `onUpdateArchiveResult`

For a diff update, the client can try a patch archive before the full archive.

- `asset-diff`: The difference from a previous OTA update
- `binary-patch`: The difference from the bundle embedded in the app binary
- `full`: The entire update

`onUpdateArchiveResult` tells you:

1. Which patch archive was used to build the update that will be applied
2. Whether the client gave up applying a patch and downloaded the full archive
3. How long each patch attempt took and why it fell back

The `full` archive itself is not included in `attempts`.

### `UpdateArchiveResult`

| Field | Type | Description |
| --- | --- | --- |
| `status` | `"applied" \| "fallback"` | Whether a patch archive produced the update or the full archive was required. |
| `archive` | `UpdateArchive` | The archive that produced the update, or the last patch archive that was abandoned. |
| `fallbackReason` | `ArchiveFallbackReason` | Why the full archive was required. There is no value when `status` is `"applied"`. It may also be absent if the last attempt ended with an error that did not produce a reason code. |
| `totalDurationMs` | `number` | The time from the start of the first patch download until the final patch attempt finished. It does not include the full download that follows a fallback. |
| `attempts` | `UpdateArchiveAttempt[]` | Every patch archive attempted, in order. It does not include the full archive. |

`UpdateArchive` is `"binary-patch"` or `"asset-diff"`.

### `UpdateArchiveAttempt`

| Field | Type | Description |
| --- | --- | --- |
| `archive` | `UpdateArchive` | The archive downloaded for this attempt. |
| `fallbackReason` | `ArchiveFallbackReason` | Why this archive was abandoned. The field is absent on the attempt that produced the update. |
| `durationMs` | `number` | How long this attempt took, whether it succeeded or failed. |
| `applyDurationMs` | `number` | How long it took to restore the bundle from this archive's patch. The field is absent if the attempt ended before the bundle was restored. |

### How to read the `attempts` array

Most downloads record only one attempt.

A second attempt may be recorded if the asset diff fails while applying the asset differences, or if the asset diff URL returns an HTTP status of 400 or above.

1. The client tries `asset-diff`.
2. It tries `binary-patch` if the asset diff could not be merged with the installed update (`asset_merge_failed`), the merged result failed package hash verification (`package_verification_failed`), or the asset diff URL returned an HTTP status of 400 or above.
3. If `binary-patch` also cannot be applied, the client downloads the full archive.

By contrast, if the shared bundle patch step fails for an asset diff, the binary patch is certain to fail in the same way. The client skips the binary patch and downloads the full archive immediately.

## `fallbackReason`

Both platforms report fallback reason codes. This allows telemetry to be aggregated using the same criteria without interpreting platform-specific error messages.

| Reason | Description |
| --- | --- |
| `base_bundle_unavailable` | The bundle inside the app binary could not be opened or read. |
| `base_hash_mismatch` | The bundle inside the app binary differs from the bundle used as the base when the patch was generated. |
| `invalid_manifest` | The manifest is missing or malformed, points outside the archive, or requests an operation beyond the permitted limits. |
| `unsupported_format` | The patch was generated in a format or with a codec that the client cannot apply. |
| `patch_apply_failed` | The applier rejected the patch, or the resulting bundle could not be used. |
| `target_verification_failed` | The resulting bundle does not match what the manifest specified. |
| `asset_merge_failed` | The asset diff could not be merged with the installed update it was based on. |
| `package_verification_failed` | The result of applying the patch failed verification. |

## A fallback is not an update failure

`status: "fallback"` means the patch path was abandoned, not that the update itself failed.

The app then attempts to download and install the full archive. The result received by this callback does not affect update behavior.

A fallback also appears in `downloadProgressCallback`. Each download that starts after a fallback has an independent progress stream, so `receivedBytes` is calculated afresh against each archive's `totalBytes`. For releases that can fall back, interpret recorded progress as **per-archive progress**, not cumulative progress for the entire update.

If a progress bar or percentage is displayed in the UI, it may move back to a lower value when fallback occurs and then fill again.
