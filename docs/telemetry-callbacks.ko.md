# 텔레메트리 콜백

[English](./telemetry-callbacks.md)

`CodePushOptions`는 업데이트의 진행 결과를 관찰할 수 있는 선택적 콜백을 제공합니다.

콜백은 **관찰 전용**입니다.

- 라이브러리는 콜백 데이터를 저장하거나 전송하지 않습니다. 텔레메트리에 남기려면 앱에서 직접 전송해야 합니다.
- 콜백을 등록해도 업데이트 동작은 바뀌지 않습니다.
- 콜백 오류는 업데이트 동작에 영향을 주지 않습니다.

다른 옵션까지 함께 확인하려면 `CodePushOptions`를 참고하세요.

## 어떤 시점에 어떤 콜백이 호출되나요?

| 콜백 | 호출 시점 | 전달값 | 주의할 점 |
| --- | --- | --- | --- |
| `onDownloadStart` | 사용 가능한 업데이트 다운로드를 시작할 때 | `(label)` | 다운로드 자체의 시작을 의미합니다. |
| `onDownloadSuccess` | 사용 가능한 업데이트 다운로드를 마쳤을 때 | `(label)` | 아직 설치 또는 정상 실행이 보장된 것은 아닙니다. |
| `onUpdateArchiveResult` | binary patch / asset diff 업데이트 다운로드가 끝난 뒤, 설치 전에 | `(label, result)` | 어떤 아카이브를 사용했고 patch fallback이 있었는지 확인합니다. |
| `onUpdateSuccess` | 설치한 업데이트가 실행되고 `notifyAppReady`로 성공을 확정했을 때 | `(label)` | 실제 업데이트 성공을 기록할 시점입니다. |
| `onUpdateRollback` | 설치한 업데이트 실행에 실패해 이전 버전으로 롤백할 때 | `(label)` | 다운로드 성공이나 설치 성공과는 별개입니다. |
| `onRolloutSkipped` | 기기가 활성 rollout 범위 밖이어서 최신 릴리스를 후보에서 제외할 때 | `(label)` | 해당 릴리스가 이 기기에 배포되지 않았음을 뜻합니다. |
| `onSyncError` | `sync()`가 `SyncStatus.UNKNOWN_ERROR`로 끝날 때 | `(label, error)` | 실패 원인은 `error.message`가 아니라 `error.code`로 분류하세요. |

`label`은 보고 대상 릴리스입니다. (예시: `"1.0.3"`) 릴리스가 결정되기 전에 `sync()`가 실패하면 `onSyncError`에는 `"unknown"`이 전달됩니다.

> **참고:** `onRolloutSkipped`의 타입 정의에는 두 번째 `error` 매개변수가 존재하지만, 실제로는 아무것도 전달하지 않아 항상 `undefined` 값을 갖습니다.

## 오류를 기록하는 방법

오류는 `error.message`가 아니라 `error.code`로 묶어 기록하세요.

메시지는 iOS에서는 현지화된 메시지가 전달될 수 있고, Android에서는 원본 에러의 문구를 포함합니다. 반면 `error.code`는 집계와 알림 조건으로 활용하기에 더 적합합니다.

| 플랫폼 | `error.code` 형식 | 예시 |
| --- | --- | --- |
| iOS | `NSURLError` 코드를 문자열로 전달합니다. CodePush가 직접 던진 오류는 `-1`입니다. | `"-1005"`: 연결 끊김 |
| Android | 실패 원인을 나타내는 카테고리입니다. | `"CODE_PUSH_NETWORK"` |

### Android 오류 코드

| 코드 | 의미 | 다시 다운로드할 가치 |
| --- | --- | --- |
| `CODE_PUSH_NETWORK` | 연결이 끊겼거나, 시간 초과됐거나, 연결을 열 수 없습니다. | 네트워크가 복구된 뒤에는 다시 시도할만 함 |
| `CODE_PUSH_HTTP` | 서버가 HTTP `400` 이상으로 응답했습니다. 상태 코드는 메시지에 있습니다. | 상태 코드에 따라 달라짐 |
| `CODE_PUSH_INTEGRITY` | 다운로드 내용의 hash가 릴리스 `package hash` 값과 다르거나, 앱이 찾는 이름의 JS 번들이 없습니다. | 없음 |
| `CODE_PUSH_UNKNOWN` | 그 밖의 오류입니다. | 알 수 없음 |

`CodePush.sync()`도 같은 오류로 거절됩니다. 따라서 `sync()`의 리턴값을 직접 기다리는 호출자는 `onSyncError` 콜백을 별도로 등록할 필요가 없습니다.

## 콜백 등록하기

앱에 CodePush를 적용할 때 `CodePush({ ... })` 래퍼에 콜백을 전달합니다.

이렇게 등록한 콜백은 `checkFrequency` 값과 관계없이, 앱이 직접 호출한 `CodePush.sync()`를 포함한 모든 `sync()`에서 실행됩니다.

```ts
export default CodePush({
  checkFrequency: CodePush.CheckFrequency.MANUAL,
  releaseHistoryFetcher,
  onUpdateSuccess: (label) => {
    // 필요하면 자체 텔레메트리로 전송합니다.
  },
  onUpdateArchiveResult: (label, result) => {
    // 필요하면 자체 텔레메트리로 전송합니다.
  },
})(MyApp);
```

### 특정 `sync()`에만 콜백 등록하기

`onUpdateArchiveResult`는 개별 `sync()` 호출에도 추가로 전달할 수 있는 유일한 텔레메트리 콜백입니다.

개별 호출에 전달한 콜백은 그 호출에 한해 래퍼에 등록한 `onUpdateArchiveResult`를 덮어씁니다. 예를 들어 특정 동작에서 발생한 결과만 별도 태그로 기록할 때 사용할 수 있습니다.

```ts
CodePush.sync({
  onUpdateArchiveResult: (label, result) => {
    // 이 sync 호출의 결과만 기록합니다.
  },
});
```

## `onUpdateArchiveResult` 이해하기

Diff 업데이트라면 full 아카이브 대신 patch 아카이브를 먼저 시도할 수 있습니다.

- `asset-diff`: 이전 OTA 업데이트를 기준으로 한 차이
- `binary-patch`: 앱 바이너리에 내장된 번들을 기준으로 한 차이
- `full`: 업데이트 전체

`onUpdateArchiveResult`는 다음을 알려 줍니다.

1. 적용할 업데이트가 어떤 patch 아카이브를 사용해 만들어졌는지
2. patch 적용을 포기하고 full 아카이브를 받았는지
3. 각 patch 시도에 걸린 시간과 fallback 이유

`full` 아카이브 자체는 `attempts`에 포함되지 않습니다.

### `UpdateArchiveResult`

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `status` | `"applied" \| "fallback"` | patch 아카이브로 업데이트를 만들었는지, 또는 full 아카이브가 필요했는지 나타냅니다. |
| `archive` | `UpdateArchive` | 업데이트를 만든 아카이브 또는 마지막으로 포기한 patch 아카이브입니다. |
| `fallbackReason` | `ArchiveFallbackReason` | full 아카이브가 필요했던 이유입니다. `status`가 `"applied"`라면 정보는 없습니다. 마지막 시도가 reason 코드를 만들지 못한 오류로 끝난 경우에도 없을 수 있습니다. |
| `totalDurationMs` | `number` | 첫 patch 다운로드 시작부터 마지막 patch 시도가 끝날 때까지의 시간입니다. fallback 뒤 full 다운로드 시간은 포함하지 않습니다. |
| `attempts` | `UpdateArchiveAttempt[]` | 시도한 모든 patch 아카이브를 시도 순서대로 담습니다. full 아카이브는 포함하지 않습니다. |

`UpdateArchive`는 `"binary-patch"` 또는 `"asset-diff"`입니다.

### `UpdateArchiveAttempt`

| 필드 | 타입 | 설명 |
| --- | --- | ---|
| `archive` | `UpdateArchive` | 이 시도에서 내려받은 아카이브입니다. |
| `fallbackReason` | `ArchiveFallbackReason` | 이 아카이브를 포기한 이유입니다. 업데이트를 가져온 시도에는 필드가 없습니다. |
| `durationMs` | `number` | 성공/실패와 관계없이 이 시도에 걸린 시간입니다. |
| `applyDurationMs` | `number` | 이 아카이브의 patch로 번들을 복원하는 데 걸린 시간입니다. 번들 복원 전에 시도가 끝나면 필드가 없습니다. |

### `attempts` 배열을 읽는 방법

대부분의 다운로드에는 시도 내역 하나만 남습니다.

asset diff가 asset 차이점 적용 범주에서 실패하거나 asset diff URL이 HTTP 400 이상의 응답을 반환하면 두 번째 시도가 생길 수 있습니다.

1. `asset-diff`를 시도합니다.
2. 설치된 업데이트와 병합하지 못했거나(`asset_merge_failed`), 병합 결과가 package hash 검증에 실패했거나(`package_verification_failed`), asset diff URL이 HTTP 400 이상의 응답을 반환하면 `binary-patch`를 시도합니다.
3. `binary-patch`도 적용할 수 없으면 full 아카이브를 다운로드합니다.

반대로 asset diff와 binary patch가 공유하는 bundle patch 과정에서 실패한 경우에는 binary patch도 같은 방식으로 실패할 것이 확실합니다. 이때는 binary patch를 건너뛰고 곧바로 full 아카이브를 다운로드합니다.

## `fallbackReason`

양 플랫폼에서 fallback 사유 코드를 보고합니다. 따라서 플랫폼별 오류 문구를 해석하지 않고도 동일한 기준으로 telemetry를 집계할 수 있습니다.

| 사유 | 설명 |
| --- | --- |
| `base_bundle_unavailable` | 앱 바이너리 안의 번들을 열거나 읽을 수 없습니다. |
| `base_hash_mismatch` | 앱 바이너리 안의 번들이 patch 생성 시 기준으로 사용한 번들과 다릅니다. |
| `invalid_manifest` | manifest가 없거나 잘못됐거나, 아카이브 밖의 경로를 가리키거나, 허용 범위를 초과한 작업을 요청합니다. |
| `unsupported_format` | 클라이언트가 적용할 수 없는 형식 또는 codec으로 patch가 생성됐습니다. |
| `patch_apply_failed` | applier가 patch 적용을 거부했거나, 적용 결과물 번들을 사용할 수 없습니다. |
| `target_verification_failed` | 적용 결과물 번들이 manifest가 약속한 내용과 다릅니다. |
| `asset_merge_failed` | asset diff의 기준이 된 설치된 업데이트와 병합할 수 없습니다. |
| `package_verification_failed` | patch 적용 결과물이 검증에 실패했습니다. |

## fallback은 업데이트 실패가 아닙니다

`status: "fallback"`은 patch 경로를 포기했다는 뜻이지 업데이트 자체가 실패했다는 뜻은 아닙니다.

이 때 앱은 full 아카이브 다운로드와 설치를 시도합니다. 이 콜백이 받은 결과도 업데이트 동작에 영향을 주지 않습니다.

fallback은 `downloadProgressCallback`에도 나타납니다. fallback 뒤에 시작하는 각 다운로드는 독립된 progress stream을 가지므로, `receivedBytes`는 각 아카이브의 `totalBytes`를 기준으로 새로 계산됩니다. 따라서 fallback이 가능한 릴리스에서 progress를 기록할 때는 전체 업데이트의 누적 진행률이 아니라 **아카이브별 진행률**로 해석해야 합니다.

만약 progress bar UI나 진행률 퍼센트를 화면에 표시한다면, fallback 발생 시점에 진행률이 이전보다 낮은 값으로 되돌아갔다가 다시 차오를 수 있습니다.
