# Diff 업데이트

[English](diff-updates.md)

릴리스는 업데이트 전체를 내려주는 대신, 업데이트와 클라이언트가 이미 가진 번들 사이의 차이만 제공할 수 있습니다. 차이는 두 종류이고, asset diff는 binary patch를 담은 릴리스에서만 배포됩니다.

- **binary patch**는 스토어에 올린 앱 바이너리가 내장한 JS 번들을 기준으로 계산합니다. 같은 바이너리 버전을 설치한 기기는 내장 번들이 모두 동일하므로, 그 버전을 쓰는 클라이언트는 전부 binary patch를 적용할 수 있습니다.
- **asset diff**는 최근에 배포한 OTA 업데이트를 기준으로 계산합니다. 기준이 된 업데이트를 실행 중인 클라이언트만 적용할 수 있습니다. binary patch가 모든 asset을 담는 것과 달리, 기준 업데이트에 없는 asset만 담습니다.

둘 다 쓸 수 없는 클라이언트는 full 아카이브를 내려받으므로 어느 경우에도 릴리스는 설치됩니다. 이 기능은 전부 선택 사항입니다. 아무것도 설정하지 않으면 `release`는 full 아카이브만 배포합니다.

patch를 배포하려면 두 가지가 필요합니다. binary patch에는 기준으로 삼는 바이너리 버전마다 내장 번들이 있어야 하고, 이 준비는 [내장 번들 export하기](#내장-번들-export하기)에서 설명합니다. asset diff에는 그에 더해 `code-push.config.ts`의 `bundleDownloader`가 필요하며 [asset diff 아카이브](#asset-diff-아카이브)에서 다룹니다. patch 생성 도구 자체는 첫 patch 릴리스 전에 한 번 빌드해야 합니다. [사전 준비: patch 생성 도구 빌드](../cli/README.ko.md#사전-준비-patch-생성-도구-빌드)를 참고하세요.

## 내장 번들 export하기

binary patch는 업데이트와 설치된 앱 안에 이미 들어 있는 JS 번들의 차이입니다. patch를 배포한다는 것은 그 번들, 즉 스토어에 올린 빌드가 내장한 바이트를 그대로 보관해 둔다는 뜻입니다.

라이브러리는 플랫폼마다 훅을 제공합니다. 이 훅은 방금 컴파일된 번들을 빌드에서 복사해 내보내고, 그 번들을 설명하는 `binary-patch-base.json` 기록을 함께 남깁니다.

**Android** - 앱 모듈의 `android/app/build.gradle`에 Gradle 스크립트를 적용합니다.

```groovy
apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

react {
    // ...
}

apply from: "../../node_modules/@bravemobile/react-native-code-push/android/codepush-export.gradle"
```

이 줄은 파일 안 어디에 두어도 됩니다. `ext.codePushExportDir`를 쓴다면 `apply from:` 줄보다 앞에서 설정해야 합니다. 그러면 JS를 번들링하는 variant마다 번들링을 마친 뒤 `android/app/build/codepush/embedded-bundle/<variant>/`로 export합니다. 다른 위치로 내보내려면 `-PcodePushExportDir=<path>`를 전달하거나 `ext.codePushExportDir`를 설정하세요. 어느 쪽이든 `<variant>` 디렉터리가 뒤에 붙습니다.

**iOS** - **"Bundle React Native code and images"** build phase의 마지막에서 export 스크립트를 호출합니다. Xcode에서 앱 타깃의 **Build Phases** 탭을 열어 그 phase를 찾고, 스크립트 끝에 아래 마지막 줄을 덧붙입니다.

```bash
/bin/sh -c "\"$WITH_ENVIRONMENT\" \"$REACT_NATIVE_XCODE\""

"$SRCROOT/../node_modules/@bravemobile/react-native-code-push/scripts/export-embedded-bundle.sh"
```

export 결과는 `$BUILD_DIR/codepush/embedded-bundle/$CONFIGURATION-$PLATFORM_NAME/`에 생깁니다. 다른 위치로 내보내려면 `CODEPUSH_EXPORT_DIR` 환경 변수를 설정하세요. 어느 쪽이든 `$CONFIGURATION-$PLATFORM_NAME` 디렉터리가 뒤에 붙습니다.

> [!NOTE]
> Expo config plugin(`app.plugin.js`)으로 이 훅을 자동 적용하는 기능은 아직 구현되지 않았습니다.

### 바이너리 릴리스별로 export 보관하기

스토어 바이너리를 빌드하는 파이프라인은 빌드마다 나온 export를 바이너리 버전별로 정리해 오래 남는 곳에 보관해야 합니다. 이후 릴리스가 대상 바이너리에 맞는 번들을 가져올 수 있어야 하기 때문입니다.

```bash
# Android, ./gradlew :app:assembleRelease 실행 후
aws s3 cp --recursive \
  android/app/build/codepush/embedded-bundle/release \
  "s3://your-bucket/binaries/android/$BINARY_VERSION/"

# iOS - $BUILD_DIR는 빌드 안에서만 존재하므로, 파이프라인이 아는 경로로 export 위치를 지정한다
export CODEPUSH_EXPORT_DIR="$PWD/codepush-export"
xcodebuild -workspace ios/YourApp.xcworkspace -scheme YourApp -configuration Release archive # ...
aws s3 cp --recursive \
  "$CODEPUSH_EXPORT_DIR/Release-iphoneos" \
  "s3://your-bucket/binaries/ios/$BINARY_VERSION/"
```

이후 patch를 배포할 때는 보관해 둔 export를 내려받아 번들 경로를 `--binary-bundle-path`에 전달합니다.

```bash
aws s3 cp --recursive "s3://your-bucket/binaries/android/1.0.0/" ./binary/
npx code-push release -b 1.0.0 -v 1.0.1 -p android \
                      --binary-bundle-path ./binary/index.android.bundle
```

`release`는 export에 함께 담긴 `binary-patch-base.json` 기록으로 전달받은 base 번들이 맞는지 검증하기도 합니다. 자세한 내용은 [base 번들 검증](../cli/README.ko.md#base-번들-검증)을 참고하세요.

## asset diff 아카이브

binary patch로 배포한 릴리스는 **asset diff 아카이브**도 함께 담을 수 있습니다. 최근에 배포한 버전마다 하나씩입니다. diff 아카이브는 JS 번들의 patch, 기준이 된 버전에 아직 없는 asset, 삭제해야 하는 파일 목록 manifest만 담습니다. 클라이언트는 이미 설치한 기준 업데이트를 복사한 뒤 patch와 manifest를 적용하고, 결과적으로 full 아카이브와 똑같은 내용을 갖게 됩니다.

클라이언트는 아래 순서로 아카이브를 시도하고, 설치할 수 있는 첫 번째 아카이브에서 멈춥니다.

| 순서 | 아카이브 | 사용 조건 |
|---|---|---|
| 1 | asset diff | 클라이언트가 실행 중인 업데이트를 기준으로 릴리스가 diff를 만들어 둔 경우입니다. |
| 2 | binary patch | 항상 쓸 수 있습니다. 모든 클라이언트가 가진 앱 바이너리의 번들을 기준으로 만들기 때문입니다. |
| 3 | full | 항상 쓸 수 있습니다. 설치된 업데이트가 없어도 됩니다. |

이 순서에는 예외가 세 가지 있습니다.

**모든 클라이언트가 셋을 다 시도하지는 않습니다.** 쓸 수 있는 asset diff가 없는 클라이언트는 binary patch에서 시작합니다. 앱 바이너리의 번들을 실행 중이거나, 새 릴리스가 diff를 만들지 않은 업데이트를 실행 중인 경우입니다.

**asset diff가 실패해도 항상 binary patch로 넘어가지는 않습니다.** diff가 asset 영역에서 실패했다면 넘어갑니다. 설치된 업데이트와 병합하지 못했거나(`asset_merge_failed`), 병합된 내용이 package hash 검증에 실패한 경우(`package_verification_failed`)입니다. 서버가 diff의 URL에 400 이상으로 응답했을 때도 넘어갑니다. 두 아카이브는 서로 다른 URL에 있으니, diff를 받지 못했다고 해서 binary patch도 받지 못하리라 단정할 수 없습니다. 그 밖의 실패는 두 아카이브가 byte 단위로 똑같이 담고 있는 bundle patch에서 일어납니다. binary patch도 같은 방식으로 실패하므로 곧바로 full 아카이브를 내려받습니다.

**연결이 실패하면 다운로드가 거기서 멈춥니다.** 다음 아카이브도 같은 네트워크 뒤에 있고 full 아카이브는 셋 중 가장 큽니다. 이어서 시도해 봐야 더 느리게 실패할 뿐이므로, 클라이언트는 연결 오류를 그대로 알립니다. 서버가 응답한 경우는 다릅니다. 한 아카이브의 404는 다음 아카이브를 건너뛸 이유가 되지 않습니다.

`onUpdateArchiveResult`는 시도한 아카이브를 모두 보고합니다. [텔레메트리 콜백](telemetry-callbacks.ko.md#onupdatearchiveresult가-보고하는-내용)을 참고하세요.

### 배포 조건

diff 아카이브는 아래 세 조건이 모두 성립할 때만 배포됩니다.

- binary patch 릴리스여야 합니다(`release --binary-bundle-path`).
- `code-push.config.ts`가 `bundleDownloader`를 구현해야 합니다. CLI가 diff의 기준이 될 이전 릴리스를 내려받는 데 사용합니다.
- `--diff-base-count`가 `0`보다 커야 합니다. 기본값은 `3`입니다.

```ts
bundleDownloader: async (archive, platform, identifier = 'staging') => {
    const downloadedFilePath = path.join(os.tmpdir(), archive.packageHash);
    const storageKey = `bundles/${platform}/${identifier}/full-bundle/${archive.packageHash}`;
    // storageKey를 스토리지(S3, Supabase, ...)에서 downloadedFilePath로 내려받는다
    return { downloadedFilePath };
},
```

릴리스가 실제로 무엇을 배포하는지는 [asset diff archive](../cli/README.ko.md#asset-diff-archive)를 참고하세요.
