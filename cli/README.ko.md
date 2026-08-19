# npx code-push

[`@bravemobile/react-native-code-push`](../README.md)를 위한 CLI 도구입니다. AppCenter 등 API 서버 없이 OTA 업데이트를 번들링, 배포, 관리할 수 있습니다.

## 사전 요구 사항

- **Node.js** >= 18
- React Native 프로젝트에서 **Hermes** 엔진 활성화
- **ts-node** (선택 사항, 설정 파일이 `.ts`인 경우 필요)

## 빠른 시작

```bash
# 1. 네이티브 프로젝트에 CodePush 설정 적용
npx code-push init

# 2. 설정 파일 작성 (아래 설정 섹션 참고)

# 3. 바이너리 버전에 대한 릴리스 히스토리 생성
npx code-push create-history -b 1.0.0 -p ios

# 4. OTA 업데이트 번들링, 업로드, 릴리스를 한 번에 실행
npx code-push release -b 1.0.0 -v 1.0.1 -p ios
```

## 설정

CLI는 프로젝트 루트에 `code-push.config.ts` (또는 `.js`) 파일이 필요합니다. 이 파일은 `CliConfigInterface`를 구현하는 객체를 export하며, `bundleUploader`, `getReleaseHistory`, `setReleaseHistory` 세 가지 함수를 정의합니다. 이 함수들을 통해 CLI가 스토리지 백엔드(예: Firebase, Supabase, S3)와 연동됩니다.

> 전체 구현 예시를 참고하세요:
> - [AWS S3 + CloudFront 예시](../Examples/CodePushDemoApp/code-push.config.ts)
> - [Supabase Storage 예시](../Examples/CodePushDemoApp/code-push.config.example.supabase.ts)
> - [Firebase Storage 예시](../Examples/CodePushDemoApp/code-push.config.example.firebase.ts)

## 명령어

### `init`

iOS 및 Android 네이티브 프로젝트에 CodePush 설정을 자동으로 적용합니다.

```bash
npx code-push init
```

- Android: `MainApplication.kt`에 `CodePush.getJSBundleFile()` 추가
- iOS: `AppDelegate`에 `CodePush.bundleURL()` 추가 및 브릿징 헤더 설정 (Swift 프로젝트)

실행 후 `cd ios && pod install`로 iOS 설정을 완료하세요.

---

### `bundle`

CodePush 번들 파일을 생성합니다. JS 번들러를 실행하고 Hermes로 컴파일합니다.

```bash
npx code-push bundle [options]
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-f, --framework <type>` | 프레임워크 타입 (`expo`) | — |
| `-p, --platform <type>` | `ios` 또는 `android` | `ios` |
| `-o, --output-path <string>` | 출력 루트 디렉토리 | `build` |
| `-e, --entry-file <string>` | JS/TS 엔트리 파일 경로 | `index.ts` |
| `-b, --bundle-name <string>` | 번들 파일 이름 | `main.jsbundle` (iOS) / `index.android.bundle` (Android) |
| `--output-bundle-dir <string>` | 번들 출력 디렉토리 이름 | `bundleOutput` |
| `--output-metro-dir <string>` | Hermes 컴파일 전 Metro JS 번들과 소스맵을 복사할 디렉토리 | — |
| `--binary-bundle-path <string>` | 대상 바이너리에 포함된 JS 번들 경로. Hermes 컴파일을 이 번들에 정렬하고, binary patch base로 기록합니다 | — |

**예시:**

```bash
# Android용 번들 생성 (커스텀 엔트리 파일)
npx code-push bundle -p android -e index.js

# 바이너리에 포함된 JS 번들에 정렬하여 번들 생성
npx code-push bundle -p android --binary-bundle-path ./binary/index.android.bundle
```

---

### `release`

주요 배포 명령어입니다. 코드 번들링, 스토리지 업로드, 릴리스 히스토리 업데이트를 한 번에 수행합니다.

```bash
npx code-push release [options]
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-b, --binary-version <string>` | **(필수)** 대상 바이너리 앱 버전 | — |
| `-v, --app-version <string>` | **(필수)** 릴리스할 앱 버전 (바이너리 버전보다 커야 함) | — |
| `-f, --framework <type>` | 프레임워크 타입 (`expo`) | — |
| `-p, --platform <type>` | `ios` 또는 `android` | `ios` |
| `-i, --identifier <string>` | 릴리스를 구분하기 위한 식별자 (예: `staging`, `production`) | — |
| `-c, --config <path>` | 설정 파일 이름 | `code-push.config.ts` |
| `-o, --output-path <string>` | 출력 루트 디렉토리 | `build` |
| `-e, --entry-file <string>` | JS/TS 엔트리 파일 경로 | `index.ts` |
| `-j, --js-bundle-name <string>` | JS 번들 파일 이름 | `main.jsbundle` (iOS) / `index.android.bundle` (Android) |
| `-m, --mandatory <bool>` | 필수 업데이트로 설정 | `false` |
| `--enable <bool>` | 릴리스 활성화 여부 | `true` |
| `--rollout <number>` | 롤아웃 비율 (0–100) | — |
| `--skip-bundle <bool>` | 번들 단계 건너뛰기 (기존 번들 사용) | `false` |
| `--hash-calc <bool>` | 기존 번들에서 해시 계산 (`--skip-bundle true` 필요) | — |
| `--skip-cleanup <bool>` | 출력 디렉토리 정리 건너뛰기 | `false` |
| `--output-bundle-dir <string>` | 번들 출력 디렉토리 이름 | `bundleOutput` |
| `--output-metro-dir <string>` | Hermes 컴파일 전 Metro JS 번들과 소스맵을 복사할 디렉토리 | — |
| `--binary-bundle-path <string>` | 대상 바이너리에 포함된 JS 번들 경로. 이 번들에 대한 binary patch 번들을 함께 배포하고, Hermes 컴파일을 이 번들에 정렬합니다 | — |
| `--on-oversized-patch <policy>` | patch 번들이 full 번들보다 작지 않을 때의 동작: `skip`은 full 번들만 배포하고, `fail`은 업로드 전에 릴리스를 중단합니다 | `skip` |

`--binary-bundle-path`를 사용하면 플랫폼별로 두 개의 artifact를 업로드합니다. `packageHash`
이름의 full 번들과, 바이너리에 포함된 번들과의 차이만 담은 `<packageHash>-patch.zip` patch
번들입니다. patch 번들에는 업데이트 복원 방법을 담은 `codepush-binary-patch.json` manifest가
포함되어, patch를 적용하면 full 번들과 동일한 `packageHash`가 됩니다. 두 artifact의 크기와
절감량은 업로드 전에 출력됩니다.

#### 사전 준비: patch 생성 도구 빌드

patch 생성에는 HDiffPatch의 `hdiffz`가 필요합니다. 패키지 의존성으로 설치되지
않으므로, 이 패키지가 함께 배포하는 스크립트로 머신마다 한 번 빌드합니다.

```bash
./node_modules/@bravemobile/react-native-code-push/scripts/binary-patch/build-hdiffpatch.sh
```

스크립트는 고정된 upstream 소스를 clone해서 컴파일하므로 `git`, C/C++ 툴체인(`make`, `cc`,
`c++`), 네트워크 연결이 필요합니다. 이미 빌드되어 있으면 아무 일도 하지 않고, `--force`를
주면 다시 빌드합니다. `hdiffz`와 `hpatchz`는 스크립트가 속한 패키지 루트의
`.hdiffpatch-tools/` 디렉토리에 설치되며, CLI는 작업 디렉토리와 그 상위 디렉토리들에서
`.hdiffpatch-tools/` 디렉토리를 찾습니다. `node_modules` 안의 설치 위치는 프로젝트보다 상위가
아니라 하위이므로, 두 실행 파일이 있는 디렉토리를 `HDIFFPATCH_TOOLS_DIR`로 지정하세요. 미리
빌드해 둔 CI 이미지나 프로젝트 밖의 공용 설치를 사용할 때도 같은 방법을 씁니다.

```bash
export HDIFFPATCH_TOOLS_DIR="$PWD/node_modules/@bravemobile/react-native-code-push/.hdiffpatch-tools"
```

도구가 필요한 것은 `--binary-bundle-path`를 사용하는 릴리스뿐이며, 도구를 찾지 못하면
업로드를 시작하기 전에 빌드 명령을 안내하는 메시지와 함께 실패합니다.

#### patch가 full 번들보다 작지 않을 때

patch는 대체하려는 archive보다 작을 때만 배포할 가치가 있습니다. CLI는 사용자에게 묻지
않으므로, patch 크기가 full 이상일 때의 동작을 `--on-oversized-patch`로 미리 정합니다.
기본값 `skip`은 경고를 남기고 요약에 skip 사실을 명시한 뒤 full 번들만 배포하며, `fail`은
어떤 업로드도 시작하기 전에 릴리스를 실패시키고 릴리스 히스토리를 변경하지 않습니다.

**예시:**

```bash
# 기본 iOS 릴리스
npx code-push release -b 1.0.0 -v 1.0.1 -p ios

# 필수 Android 릴리스 + 롤아웃 50%
npx code-push release -b 2.0.0 -v 2.0.1 -p android -m true --rollout 50

# Expo 프로젝트 릴리스
npx code-push release -b 1.0.0 -v 1.0.1 -f expo -p ios

# staging 식별자로 릴리스
npx code-push release -b 1.0.0 -v 1.0.1 -i staging

# 번들링 건너뛰기 (기존 번들 재사용)
npx code-push release -b 1.0.0 -v 1.0.2 --skip-bundle true --hash-calc true

# full 번들과 바이너리 번들에 대한 binary patch를 함께 배포
npx code-push release -b 1.0.0 -v 1.0.1 -p ios --binary-bundle-path ./binary/main.jsbundle

# 동일하지만, patch가 더 작지 않으면 릴리스를 실패시킴
npx code-push release -b 1.0.0 -v 1.0.1 -p ios --binary-bundle-path ./binary/main.jsbundle --on-oversized-patch fail
```

---

### `create-history`

바이너리 버전에 대한 새 릴리스 히스토리 항목을 생성합니다. 앱스토어에 새 바이너리를 출시할 때마다 한 번씩 실행하세요.

```bash
npx code-push create-history [options]
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-b, --binary-version <string>` | **(필수)** 대상 바이너리 버전 | — |
| `-p, --platform <type>` | `ios` 또는 `android` | `ios` |
| `-i, --identifier <string>` | 릴리스를 구분하기 위한 식별자 | — |
| `-c, --config <path>` | 설정 파일 이름 | `code-push.config.ts` |

**예시:**

```bash
npx code-push create-history -b 1.0.0 -p ios -i production
```

---

### `update-history`

기존 릴리스를 수정합니다 (활성화/필수 토글, 롤아웃 변경).

```bash
npx code-push update-history [options]
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-v, --app-version <string>` | **(필수)** 수정할 앱 버전 | — |
| `-b, --binary-version <string>` | **(필수)** 대상 바이너리 버전 | — |
| `-p, --platform <type>` | `ios` 또는 `android` | `ios` |
| `-i, --identifier <string>` | 릴리스를 구분하기 위한 식별자 | — |
| `-c, --config <path>` | 설정 파일 이름 | `code-push.config.ts` |
| `-m, --mandatory <bool>` | 필수 업데이트 플래그 설정 | — |
| `-e, --enable <bool>` | 릴리스 활성화 또는 비활성화 | — |
| `--rollout <number>` | 롤아웃 비율 (0–100) | — |

`--mandatory`, `--enable`, `--rollout` 중 하나 이상을 반드시 지정해야 합니다.

**예시:**

```bash
# 릴리스 비활성화
npx code-push update-history -b 1.0.0 -v 1.0.1 -e false

# 롤아웃을 100%로 확대
npx code-push update-history -b 1.0.0 -v 1.0.1 --rollout 100
```

---

### `show-history`

바이너리 버전의 릴리스 히스토리를 조회합니다.

```bash
npx code-push show-history [options]
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-b, --binary-version <string>` | **(필수)** 대상 바이너리 버전 | — |
| `-p, --platform <type>` | `ios` 또는 `android` | `ios` |
| `-i, --identifier <string>` | 릴리스를 구분하기 위한 식별자 | — |
| `-c, --config <path>` | 설정 파일 이름 | `code-push.config.ts` |

**예시:**

```bash
npx code-push show-history -b 1.0.0 -p ios
```

## 릴리스 히스토리 구조

릴리스 히스토리는 앱 버전을 키로 하는 JSON 객체입니다. 예를 들어, 바이너리 버전 `1.0.0`의 히스토리:

```json
{
  "1.0.0": {
    "enabled": true,
    "mandatory": false,
    "downloadUrl": "",
    "packageHash": ""
  },
  "1.0.1": {
    "enabled": true,
    "mandatory": false,
    "downloadUrl": "https://storage.example.com/bundles/ios/staging/a1b2c3...",
    "packageHash": "a1b2c3...",
    "rollout": 100
  },
  "1.0.2": {
    "enabled": true,
    "mandatory": true,
    "downloadUrl": "https://storage.example.com/bundles/ios/staging/d4e5f6...",
    "packageHash": "d4e5f6..."
  }
}
```

## 일반적인 워크플로우

```
1. npx code-push init              # 네이티브 프로젝트 초기 설정 (1회)
2. code-push.config.ts 작성         # 설정 파일 작성 (1회)
3. npx code-push create-history    # 바이너리 버전별 1회
4. npx code-push release           # OTA 업데이트마다 실행
5. npx code-push update-history    # 필요시 롤아웃/플래그 조정
6. npx code-push show-history      # 필요시 릴리스 내역 조회
```
