# Diff 업데이트

[English](./diff-updates.md)

release 명령은 기본적으로 업데이트 전체를 담은 **full 아카이브**를 배포합니다. Diff 업데이트를 업데이트에 필요한 차이만 내려받도록 할 수 있습니다.

이 기능은 선택 사항입니다. 아무것도 설정하지 않으면 `release`는 full 아카이브만 배포합니다. 또한 diff 업데이트를 사용할 수 없거나 적용에 실패해도, 네트워크 연결 오류가 아닌 한 앱은 full 아카이브로 fallback하여 업데이트를 설치합니다.

## 어떤 아카이브가 배포되나요?

| 아카이브 | 비교 기준 | 포함 내용 | 사용할 수 있는 상황 |
| --- | --- | --- | --- |
| full | 없음 | 업데이트 전체 | 언제든 사용 가능 |
| binary patch | 앱 바이너리에 내장된 JS 번들 | JS 번들 차이와 모든 asset | 비교 기준 바이너리 버전을 실행 중인 경우 |
| asset diff | 이전 OTA 업데이트 | JS 번들 차이, 새 asset, 삭제할 asset 목록 | 비교 기준 OTA 업데이트를 실행 중인 경우 |

### binary patch

binary patch는 스토어에 배포한 앱 바이너리의 내장 JS 번들을 기준으로 산출됩니다.

같은 배포 대상(binary version)이면 동일한 내장 번들이 들어있어야 합니다. 내장 번들을 보관해두면 같은 바이너리 버전을 대상으로 배포하는 업데이트는 모두 binary patch를 적용할 수 있습니다.

#### Hermes 바이트코드 정렬이 중요한 이유

`release`에 `--binary-bundle-path`를 전달하면 CLI는 보관한 내장 번들을 `hermesc -base-bytecode` 옵션으로 전달해 기준 번들로 사용합니다. 새 바이트코드의 내부 배치를 기준 번들에 맞춰 소스 변경과 무관한 바이트 이동을 줄이고, binary patch가 실제 변경 내용에 집중하도록 합니다.

실제 앱에서 측정한 결과는 다음과 같습니다.

| 조건 | 결과 |
| --- | --- |
| 약 25MB Hermes 번들, 5일간 153개 파일 변경 | 정렬을 적용한 HDiffPatch의 크기는 355–382KB였습니다. 정렬하지 않으면 비교한 모든 codec에서 patch가 3–5배 커졌습니다. ([PR #150](https://github.com/Soomgo-Mobile/react-native-code-push/pull/150)) |
| 약 18MB Android 번들, 소스 23줄 변경 | `-base-bytecode`를 사용했더라도, binary와 update의 `--minify` 조건이 다르면 patch의 크기가 약 12.5배 커졌습니다. ([PR #165](https://github.com/Soomgo-Mobile/react-native-code-push/pull/165)) |

두 번째 결과에서 보듯 `-base-bytecode`만 전달하는 것으로는 충분하지 않습니다. 업데이트 번들도 바이너리 내장 번들과 마찬가지로 `--minify false` 조건으로 생성해야 하며, `npx code-push` CLI는 이 옵션을 기본으로 적용합니다.

측정값은 앱과 변경 내용에 따라 달라질 수 있습니다.

### asset diff

asset diff는 이전에 배포한 OTA 업데이트를 기준으로 산출됩니다. 따라서 기준이 된 OTA 업데이트를 실행 중인 앱에서만 이 방식의 업데이트를 사용할 수 있습니다.

binary patch가 모든 asset을 담는 것과 달리, asset diff에는 기준 업데이트에 없던 asset만 포함됩니다. 기준 업데이트와 새 릴리스의 asset 차이가 작을수록 이 업데이트의 크기도 작아집니다.

## 시작하기 전에 준비할 것

Diff 업데이트를 배포하려면 다음이 필요합니다.

1. **binary patch용 내장 번들 export**
   지원할 바이너리 버전마다, 실제 스토어 바이너리에 들어간 JS 번들을 보관해야 합니다.

2. **asset diff용 이전 아카이브 다운로드 설정**
   asset diff도 배포하려면 `code-push.config.ts`에 `bundleDownloader`를 구현해야 합니다.

또한 패치 생성 전에 생성 도구를 한 번 빌드해야 합니다. 자세한 내용은 [**사전 준비: patch 생성 도구 빌드**](../cli/README.ko.md#사전-준비-patch-생성-도구-빌드)를 참고하세요.

## 1. 내장 번들 export하기

binary patch는 새 업데이트와 앱 안에 이미 들어 있는 JS 번들의 차이를 비교해 만들어집니다. 따라서 스토어에 올린 빌드가 내장한 JS 번들 바이트코드를 그대로 보관해야 합니다.

라이브러리는 플랫폼별 export 훅을 제공합니다. 훅은 번들 빌드가 끝난 뒤 다음을 export합니다.

- Hermes 컴파일된 JS 번들 (바이트코드)
- 번들의 정보와 검증 값을 담은 `binary-patch-base.json`

### Android

앱 모듈의 `android/app/build.gradle`에 Gradle 스크립트를 적용합니다.

```gradle
apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

react {
    // ...
}

apply from: "../../node_modules/@bravemobile/react-native-code-push/android/codepush-export.gradle"
```

`apply from`은 파일 안 어디에 두어도 좋습니다.

앱 빌드 과정에서 JS 번들이 끝나면 다음 경로로 번들을 내보냅니다.

```text
android/app/build/codepush/embedded-bundle/<variant>/
```

만약 경로를 다른 위치로 설정하려면 다음 중 한 가지 방법을 사용하세요.

- Gradle 실행 시 `-PcodePushExportDir=<path>` 전달
- `ext.codePushExportDir` 설정

`ext.codePushExportDir`를 설정한다면 `apply from`보다 앞에 두어야 합니다. 어느 방법을 사용해도 마지막에 `<variant>` 디렉터리가 붙습니다.

### iOS

Xcode에서 앱 타깃의 **Build Phases** 탭을 열고 **Bundle React Native code and images** phase를 찾습니다. 기존 스크립트의 마지막에 아래 줄을 추가합니다.

```sh
/bin/sh -c "\"$WITH_ENVIRONMENT\" \"$REACT_NATIVE_XCODE\""

# 추가하세요
"$SRCROOT/../node_modules/@bravemobile/react-native-code-push/scripts/export-embedded-bundle.sh"
```

기본 export 경로는 다음과 같습니다.

```text
$BUILD_DIR/codepush/embedded-bundle/$CONFIGURATION-$PLATFORM_NAME/
```

만약 경로를 다른 위치로 설정하려면 `CODEPUSH_EXPORT_DIR` 환경 변수를 설정하세요. 이 경우에도 마지막에 `$CONFIGURATION-$PLATFORM_NAME` 디렉터리가 붙습니다.

> **참고:** Expo config plugin(`app.plugin.js`)으로 이 훅을 자동 적용하는 기능은 아직 제공하지 않습니다.

## 2. 바이너리 릴리스별 export 보관하기

스토어 바이너리를 빌드하는 CI 파이프라인은 export한 JS 번들을 바이너리 버전별로 구분해 보관해야 합니다.

나중에 OTA 릴리스를 배포할 때 대상 바이너리 버전의 JS 번들을 내려받아 binary patch의 base 번들로 사용합니다.

다음 내용은 예시일 뿐이며, 각자의 배포 파이프라인에 맞는 방식으로 번들을 보관하세요.

### Android 예시

`./gradlew :app:assembleRelease`가 끝난 뒤 export 결과를 업로드합니다.

```sh
aws s3 cp --recursive \
  android/app/build/codepush/embedded-bundle/release \
  "s3://your-bucket/binaries/android/$BINARY_VERSION/"
```

### iOS 예시

`$BUILD_DIR`는 빌드 안에서만 존재하므로, CI가 알고 있는 경로를 export 경로로 지정합니다.

```sh
export CODEPUSH_EXPORT_DIR="$PWD/codepush-export"

xcodebuild \
  -workspace ios/YourApp.xcworkspace \
  -scheme YourApp \
  -configuration Release \
  archive # ...

aws s3 cp --recursive \
  "$CODEPUSH_EXPORT_DIR/Release-iphoneos" \
  "s3://your-bucket/binaries/ios/$BINARY_VERSION/"
```

## 3. binary patch 릴리스 배포하기

배포 대상 바이너리 버전의 JS 번들을 보관해둔 곳에서 내려받고, 해당 JS 번들의 경로를 `--binary-bundle-path`에 전달합니다.

```sh
aws s3 cp --recursive \
  "s3://your-bucket/binaries/android/1.0.0/" \
  ./binary/

npx code-push release \
  -b 1.0.0 \
  -v 1.0.1 \
  -p android \
  --binary-bundle-path ./binary/index.android.bundle
```

`release` 명령은 JS 번들과 함께 보관했던 `binary-patch-base.json` 파일을 읽어 전달한 base 번들이 올바른지도 검증합니다. 자세한 내용은 [**base 번들 검증**](../cli/README.ko.md#base-번들-검증)을 참고하세요.

## 4. asset diff 아카이브 배포하기

binary patch를 배포할 때 이전 OTA 업데이트를 기준으로 한 asset diff 아카이브도 함께 배포할 수 있습니다. 최근 업데이트 N개에 대해 각각 asset diff 아카이브가 추가로 생성됩니다. (만약 asset diff 아카이브의 크기가 binary patch 아카이브보다 같거나 크면 배포되지는 않습니다.)

asset diff에는 다음만 포함됩니다.

- JS 번들 binary patch
- 기준 업데이트에 없던 새 asset 파일들
- 삭제할 asset 파일 목록 manifest 파일

앱은 업데이트 다운로드 후 기준 OTA 업데이트를 복사한 뒤 JS 번들을 패치하고 불필요한 asset 파일들을 삭제합니다. 그 결과 남는 내용은 full 아카이브 업데이트와 동일합니다.

### 배포 조건

asset diff는 아래 조건이 모두 충족될 때만 배포됩니다.

1. binary patch 릴리스여야 합니다. 즉, `release --binary-bundle-path`를 사용해야 합니다.
2. `code-push.config.ts`에 `bundleDownloader`가 구현되어 있어야 합니다.
3. `--diff-base-count` 옵션 값이 `0`보다 커야 합니다. 기본값은 `3`입니다.

`bundleDownloader`는 CLI가 asset diff의 기준이 될 이전 업데이트를 내려받을 때 사용합니다.

```ts
bundleDownloader: async (archive, platform, identifier = 'staging') => {
  const downloadedFilePath = path.join(os.tmpdir(), archive.packageHash);
  const storageKey =
    `bundles/${platform}/${identifier}/full-bundle/${archive.packageHash}`;

  // storageKey의 아카이브를 S3, Supabase 등의 저장소에서
  // downloadedFilePath로 내려받도록 구현하세요.

  // downloadedFilePath 경로를 반환하세요.
  return { downloadedFilePath };
},
```

실제로 어떤 asset diff 아카이브가 생성되고 배포되는지는 [**asset diff archive**](../cli/README.ko.md#asset-diff-archive)를 참고하세요.

## 업데이트 다운로드와 fallback 순서

업데이트를 다운로드할 때 작은 아카이브부터 시도합니다.

| 순서 | 아카이브 | 선택 조건 |
| --- | --- | --- |
| 1 | asset diff | 현재 실행 중인 OTA 업데이트를 기준으로 한 diff가 있는 경우 |
| 2 | binary patch | asset diff를 사용할 수 없거나, asset 차이점 적용에 실패한 경우 |
| 3 | full | binary patch를 사용할 수 없거나 패치 적용에 실패한 경우 |

### asset diff를 건너뛰는 경우

다음 경우에는 asset diff가 없으므로 binary patch부터 시도합니다.

- 앱 바이너리에 내장된 번들을 실행 중인 경우 (첫 번째 OTA 업데이트)
- 현재 OTA 업데이트를 기준으로 asset diff를 만들지 않은 경우

### asset diff 실패 시 다음 아카이브를 선택하는 기준

실패 원인에 따라 fallback 경로가 달라집니다.

| 실패 상황 | 다음 동작 | 이유 |
| --- | --- | --- |
| `asset_merge_failed` | binary patch 시도 | 설치된 업데이트에 asset 차이를 적용하지 못함. 모든 asset을 받아 교체하는 방식은 성공할 수 있음 |
| `package_verification_failed` | binary patch 시도 | asset diff로 병합한 결과의 최종 hash가 맞지 않음. 모든 asset을 받아 교체하는 방식은 성공할 수 있음 |
| asset diff 다운로드 URL이 HTTP `400` 이상 응답 | binary patch 시도 | asset diff와 binary patch의 다운로드 URL은 각각 별개이므로, 하나를 받지 못했다고 다른 하나도 받을 수 없는 것은 아님 |
| bundle patch 적용 실패 | full 아카이브 다운로드 | asset diff와 binary patch는 JS 번들에 동일한 patch를 수행하므로 binary patch로 fallback 해도 실패할 가능성이 높음 |
| 네트워크 연결 오류 | fallback하지 않고 오류 보고 | 다음 방식 역시 동일한 네트워크를 사용하고, full 아카이브는 사이즈도 더 크므로 이어서 시도해도 더 느리게 실패할 가능성이 큼 |

연결 오류와 서버 응답 오류는 다르게 처리합니다. 예를 들어 asset diff 다운로드 URL이 `404`를 반환한 경우에는 서버 연결은 성공한 상태이므로, 다음 수단인 binary patch나 full 아카이브를 건너뛸 이유가 없습니다.

## 결과 관찰

`onUpdateArchiveResult` 콜백은 앱이 시도한 모든 업데이트의 결과를 보고합니다. 실제로 어떤 아카이브가 선택되었는지, 어떤 이유로 fallback했는지 수집하려면 [**텔레메트리 콜백**](./telemetry-callbacks.ko.md#onupdatearchiveresult-이해하기)을 참고하세요.
