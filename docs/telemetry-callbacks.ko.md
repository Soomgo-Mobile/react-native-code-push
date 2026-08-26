# 텔레메트리 콜백

[English](telemetry-callbacks.md)

`CodePushOptions`는 업데이트가 수행한 일을 보고하는 선택적 콜백을 받습니다. 이 콜백은 순전히 관찰을 위한 것이며 그 외의 역할은 없습니다. 라이브러리는 보고된 내용을 저장하거나 전송하지 않으므로, 텔레메트리에 기록하려면 앱에서 직접 전송해야 합니다. 콜백을 등록하지 않아도 업데이트 동작은 달라지지 않으며, 콜백이 예외를 던져도 해당 업데이트를 실패시키지 않고 콘솔에 기록합니다.

다른 모든 옵션과 함께 각 옵션의 세부 내용을 확인하려면 [`CodePushOptions`](api-js.md#codepushoptions)를 참고하세요.

## 콜백

| 콜백 | 호출 시점 | 전달값 |
|---|---|---|
| `onDownloadStart` | 사용 가능한 업데이트의 다운로드가 시작될 때 | `(label)` |
| `onDownloadSuccess` | 사용 가능한 업데이트의 다운로드가 완료될 때. 설치는 이후에 이뤄지므로, 업데이트를 설치할 수 있다는 뜻은 아닙니다. | `(label)` |
| `onUpdateArchiveResult` | binary patch로 배포된 업데이트가 다운로드된 뒤, 설치되기 전 | `(label, result)` |
| `onUpdateSuccess` | 성공 상태를 확정하는 [`notifyAppReady`](api-js.md#codepushnotifyappready) 호출을 기준으로, 설치된 업데이트가 정상 실행됐을 때 | `(label)` |
| `onUpdateRollback` | 설치된 업데이트가 실행에 실패해 이전 버전으로 롤백될 때 | `(label)` |
| `onRolloutSkipped` | 기기가 최신 릴리스의 활성 rollout 범위 밖이라 업데이트 검사에서 해당 릴리스를 후보에서 제외할 때 | `(label)` |
| `onSyncError` | sync가 [`SyncStatus.UNKNOWN_ERROR`](api-js.md#syncstatus) 상태로 종료될 때 | `(label, error)` |

`label`은 보고 대상 릴리스입니다. 릴리스가 결정되기 전에 sync가 실패하면 `onSyncError`에는 대신 `"unknown"`이 전달됩니다.

> [!NOTE]
> 타입 정의에서 `onRolloutSkipped`는 두 번째 `error` 매개변수를 선언하지만, 런타임은 항상 `label`만 전달합니다.

## 등록

[앱에 CodePush 적용하기](../README.md#4-codepush-ify-your-app)의 `CodePush({ ... })` 래퍼에 콜백을 전달하면, `checkFrequency` 값과 무관하게 직접 호출한 `CodePush.sync()`를 포함한 모든 sync에서 실행됩니다.

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

`onUpdateArchiveResult`는 개별 `sync()` 호출에도 전달할 수 있는 유일한 콜백입니다. 여기에 전달하면 그 호출에 한해 래퍼에 등록한 콜백을 덮어씁니다. 예를 들어 특정 sync의 결과만 별도로 태그할 때 사용할 수 있습니다.

```typescript
CodePush.sync({
  onUpdateArchiveResult: (label, result) => {
    // Send it to your own telemetry, if you want it there.
  },
});
```

## `onUpdateArchiveResult`가 보고하는 내용

binary patch로 배포한 릴리스는 full 아카이브 대신 다운로드할 수 있는 patch 아카이브를 제공합니다. 아카이브의 종류와 릴리스에 포함되는 조건은 [asset diff 아카이브](diff-updates.ko.md#asset-diff-아카이브)를 참고하세요. 이 콜백은 업데이트를 어떤 아카이브에서 다운로드했는지와, 업데이트에 쓰이지 못한 나머지 아카이브에 어떤 일이 있었는지를 보고합니다.

### `UpdateArchiveResult`

| 필드 | 타입 | 설명 |
|---|---|---|
| `status` | `"applied" \| "fallback"` | patch 아카이브 중 하나로 업데이트를 만들었는지, 아니면 full 아카이브를 다운로드해야 했는지 나타냅니다. |
| `archive` | `UpdateArchive` | 마지막 시도 아카이브입니다. 업데이트를 가져온 아카이브이거나, 마지막으로 포기한 아카이브입니다. |
| `fallbackReason` | `ArchiveFallbackReason` | full 아카이브를 다운로드해야 했던 이유입니다. `"applied"`일 때는 없으며, 마지막 시도가 어느 applier도 이유 코드를 부여하지 못한 오류로 끝났을 때도 없습니다. |
| `totalDurationMs` | `number` | 첫 번째 아카이브 다운로드 시작부터 마지막 시도가 끝날 때까지 patch 경로 전체에 걸린 시간입니다. fallback 뒤에 이어지는 full 다운로드 시간은 포함하지 않습니다. |
| `attempts` | `UpdateArchiveAttempt[]` | 시도한 모든 아카이브를 시도한 순서대로 담습니다. full 아카이브는 포함하지 않습니다. |

`UpdateArchive`는 `"binary-patch"` 또는 `"asset-diff"`입니다.

### `UpdateArchiveAttempt`

| 필드 | 타입 | 설명 |
|---|---|---|
| `archive` | `UpdateArchive` | 이 시도에서 다운로드한 아카이브입니다. |
| `fallbackReason` | `ArchiveFallbackReason` | 이 아카이브를 포기한 이유입니다. 업데이트를 가져온 시도에는 없습니다. |
| `durationMs` | `number` | 성공·실패와 관계없이 이 시도에 걸린 시간입니다. |
| `applyDurationMs` | `number` | applier가 이 아카이브의 patch로 번들을 복원하는 데 걸린 시간입니다. 번들을 복원하기 전에 시도가 끝나면 없습니다. |

대부분의 다운로드에는 시도가 하나만 남습니다. asset diff가 asset 영역에서 실패하면 두 번째 시도가 생깁니다. 설치된 업데이트와 병합하지 못했거나(`asset_merge_failed`), 병합된 내용이 package hash 검증에 실패한 경우(`package_verification_failed`)입니다. 이때 클라이언트는 모든 asset을 포함하고 설치된 업데이트에 의존하지 않는 binary patch를 시도합니다. 반면 두 아카이브가 공유하는 bundle patch에서 asset diff가 실패하면 binary patch도 같은 방식으로 실패하므로 건너뛰고 곧바로 full 아카이브를 다운로드합니다.

### `fallbackReason`

모든 플랫폼의 applier는 같은 이유 코드를 보고하므로, 실행 플랫폼과 관계없이 rollout을 판단할 수 있습니다.

| 이유 | 설명 |
|---|---|
| `base_bundle_unavailable` | 앱 바이너리 안의 번들을 열거나 읽을 수 없습니다. |
| `base_hash_mismatch` | 앱 바이너리 안의 번들이 patch를 생성할 때 기준으로 삼은 번들과 다릅니다. |
| `invalid_manifest` | manifest가 없거나 잘못됐거나, 아카이브 밖의 경로를 가리키거나, 허용 범위를 초과한 작업을 요청합니다. |
| `unsupported_format` | 클라이언트가 적용할 수 없는 형식 또는 codec으로 patch가 생성됐습니다. |
| `patch_apply_failed` | applier가 patch 적용을 거부했거나, 복원한 번들을 쓸 수 없습니다. |
| `target_verification_failed` | 복원한 번들이 manifest가 약속한 내용과 다릅니다. |
| `asset_merge_failed` | asset diff를 생성할 때 기준으로 삼았던 설치된 업데이트와 병합할 수 없습니다. |
| `package_verification_failed` | patch로 복원한 업데이트가 복원 뒤 검증에 실패했습니다. |

### fallback은 업데이트 실패가 아닙니다

대신 full 아카이브를 다운로드하고 평소처럼 설치합니다. 이 콜백이 전달받는 내용은 업데이트 동작에 영향을 주지 않습니다.

다만 fallback은 `downloadProgressCallback`에도 나타납니다. fallback 이후 이어지는 각 다운로드는 자체 progress stream을 가지며, 각각의 `totalBytes`를 기준으로 `receivedBytes`를 다시 0부터 계산합니다.
