# E2E 테스트 실행 가이드

[iOS는 Maestro](https://github.com/mobile-dev-inc/Maestro), Android는 [maestro-runner](https://github.com/devicelab-dev/maestro-runner)를 사용하는 `react-native-code-push` E2E 테스트입니다.

## 사전 요구사항

- **Node.js** (v18 이상)
- **Maestro CLI (iOS)** — `curl -Ls "https://get.maestro.mobile.dev" | bash`
- **maestro-runner (Android)** — `curl -fsSL https://open.devicelab.dev/install/maestro-runner | bash`
- **iOS**: Xcode 및 부팅된 iOS 시뮬레이터
- **Android**: Android SDK 및 실행 중인 에뮬레이터
- `Examples/` 디렉토리에 설정된 예제 앱 (예: `RN0840`)

## 빠른 시작

```bash
# 전체 실행 (빌드 + 테스트)
npm run e2e -- --app RN0840 --platform ios

# 빌드 생략, 테스트 플로우만 실행
npm run e2e -- --app RN0840 --platform ios --maestro-only
```

### Expo 예제 앱

```bash
# Expo 예제 앱 전체 실행
npm run e2e -- --app Expo55 --framework expo --platform ios

# Expo 예제 앱 플로우만 실행
npm run e2e -- --app Expo55Beta --framework expo --platform ios --maestro-only
```

## CLI 옵션

| 옵션 | 필수 | 설명 |
|---|---|---|
| `--app <name>` | 예 | 예제 앱 디렉토리 이름 (예: `RN0840`) |
| `--platform <type>` | 예 | `ios` 또는 `android` |
| `--framework <type>` | 아니오 | Expo 예제 앱인 경우 `expo` 지정 |
| `--simulator <name>` | 아니오 | iOS 시뮬레이터 이름 (부팅된 시뮬레이터 자동 감지, 기본값 "iPhone 16") |
| `--maestro-only` | 아니오 | 빌드 단계 생략, 테스트 플로우만 실행 |
| `--exclude-timing-sensitive` | 아니오 | 타이밍 민감 optional 시나리오(`03`, `04`)를 제외합니다. 기본값: 비활성, 즉 로컬 실행에는 기본 포함 |

## 실행 과정

테스트 러너(`e2e/run.ts`)는 다음 단계를 순서대로 실행합니다:

### Phase 1 — 기본 플로우 (`flows/`)

1. **설정 준비** — `App.tsx`를 로컬 mock 서버를 가리키도록 패치하고, `code-push.config.local.ts`를 앱 디렉토리에 복사합니다.
2. **앱 빌드** — 예제 앱을 Release 모드로 빌드하여 시뮬레이터/에뮬레이터에 설치합니다. export 훅이 이 빌드 안에서 실행되므로, 훅이 내보낸 번들을 빌드된 앱 안의 번들과 비교하고 옆에 놓인 `binary-patch-base.json` 기록도 같은 해시와 바이너리 버전인지 확인합니다. 이 검사는 해당 플랫폼의 훅을 적용한 앱에서만 실행합니다(`android/app/build.gradle`의 `codepush-export.gradle`, Xcode 빌드 페이즈의 `export-embedded-bundle.sh`). 지금은 `RN0840`만 적용했고 나머지 앱은 로그를 남기고 건너뜁니다. 훅을 적용한 앱에서 export가 없거나 내용이 어긋나면 실행이 실패합니다. `--maestro-only` 실행은 빌드 산출물이 없으니 export를 찾지 못하면 마찬가지로 건너뜁니다.
3. **번들 준비** — `npx code-push release`로 릴리스 히스토리를 생성하고 v1.0.1을 번들링합니다.
4. **Mock 서버 시작** — 번들과 릴리스 히스토리 JSON을 서빙하는 로컬 HTTP 서버(포트 18081)를 시작합니다.
5. **테스트 플로우 실행** — iOS는 Maestro, Android는 maestro-runner 사용:
   - `01-app-launch` — 앱 실행 및 UI 요소 존재 확인
   - `02-restart-no-crash` — 재시작 탭 후 크래시 없음 확인
   - `03-update-flow` — 이전 업데이트 초기화, sync 트리거, 업데이트 설치 확인("UPDATED!" 표시) 및 메타데이터 `METADATA_V1.0.1` 확인

### Phase 2 — 바이너리로 롤백 (`flows-rollback/`)

6. **릴리스 비활성화** — `npx code-push update-history -e false`로 v1.0.1을 비활성화합니다.
7. **롤백 플로우 실행** — `01-rollback`: 업데이트가 설치된 상태에서 앱을 실행하고 sync를 트리거합니다. 라이브러리가 비활성화된 릴리스를 감지하여 자동으로 바이너리 버전으로 롤백합니다.

### Phase 3 — 부분 롤백 (`flows-partial-rollback/`)

8. **두 개의 릴리스 준비** — 릴리스 마커를 사용하여 서로 다른 해시를 가진 v1.0.1과 v1.0.2를 번들링합니다.
9. **최신 버전으로 업데이트** — `01-update-to-latest`: 바이너리에서 시작하여 v1.0.2로 sync, `METADATA_V1.0.2` 확인
10. **v1.0.2만 비활성화** — `npx code-push update-history`로 v1.0.2만 비활성화합니다.
11. **이전 업데이트로 롤백** — `02-rollback-to-previous`: v1.0.2에서 v1.0.1로 롤백되는 것을 확인합니다 (바이너리가 아닌 이전 업데이트로).

### Phase 4 — Optional Install Mode 검증 (`flows-optional/`)

12. **시나리오별 optional 릴리스 준비** — 각 시나리오마다 히스토리를 다시 만들고 `npx code-push release -m false`로 not mandatory 릴리스를 배포합니다.
13. **optional 업데이트 플로우 실행** — 아래 조건에서 업데이트가 적용되는지 확인합니다.
   - `01-optional-update-on-relaunch` — 앱을 종료 후 재실행할 때
   - `02-optional-update-on-restart-button` — 앱 내 "Restart app" 버튼을 누를 때
   - `03-optional-update-on-resume-after-20s` — 앱이 백그라운드에 20초 이상 머문 뒤 포그라운드로 돌아올 때 `ON_NEXT_RESUME`으로 업데이트가 적용되는지 확인합니다. `--exclude-timing-sensitive`를 주지 않으면 실행됩니다.
   - `04-optional-update-on-suspend-after-20s` — 앱이 백그라운드에 20초 이상 머무는 동안 `ON_NEXT_SUSPEND`로 업데이트가 적용되고, 다음 포그라운드 진입 시 반영된 번들이 보이는지 확인합니다. `--exclude-timing-sensitive`를 주지 않으면 실행됩니다.

### Phase 6 — 바이너리 패치 업데이트 (`flows-binary-patch/`)

14. **베이스 번들 추출** — 기기에 설치된 앱에서 JS 번들을 꺼냅니다(Android는 APK의 `assets/`, iOS는 `.app`). 바이너리 패치는 바이너리에 실린 바로 그 바이트에만 적용되므로 다른 것으로 대체할 수 없습니다.
15. **시나리오별 릴리스와 설치** — 각 시나리오는 `--binary-bundle-path`로 릴리스한 뒤 필요한 지점만 고장 내고, `01-install-update`로 업데이트를 설치해 `UPDATED!`와 `METADATA_V<version>`을 확인합니다.
   - `1.3.1` — 앱 바이너리 위에 patch 업데이트가 설치됩니다.
   - `1.3.2` — 이미지 asset을 포함한 patch 업데이트가 설치됩니다.
   - `1.3.3` — 낡은 베이스 번들로 만든 patch는 full 업데이트로 fallback합니다.
   - `1.3.4` — 압축 본문이 손상된 patch는 fallback합니다.
   - `1.3.9` — manifest가 설명하지 않는 번들을 복원하는 patch는 fallback합니다.
   - `1.3.5` — 헤더가 손상된 patch는 fallback합니다.
   - `1.3.6` — 다른 플랫폼용으로 만들어진 patch archive는 fallback합니다.
   - `1.3.7` — 한 번 만든 번들(`bundle` 1회 + `release --skip-bundle` 2회, 한쪽에만 베이스 번들 전달)이 patch URL이 실린 히스토리에서는 patch로, 실리지 않은 히스토리에서는 full로 설치됩니다.
   - `1.3.8` — `02-ui-responsive-during-install`: patch를 내려받아 적용하는 동안에도 앱이 탭에 반응합니다. `--exclude-timing-sensitive`를 주지 않으면 실행됩니다.

patch 설치와 full archive fallback은 같은 내용을 설치하므로 화면만으로는 구분되지 않습니다. 둘을 가르는 것은 앱이 서버에 요청한 archive의 순서이며, 모든 시나리오가 이를 검증합니다: patch 설치는 `[patch]`, fallback은 `[patch, full]`, patch 없이 배포된 릴리스는 `[full]`입니다.

## 아키텍처

```
e2e/
├── run.ts                  # 메인 오케스트레이션 스크립트
├── config.ts               # 경로, 포트, 호스트 설정
├── tsconfig.json
├── mock-server/
│   └── server.ts           # Express 정적 파일 서버 (포트 18081), 모든 요청 기록
├── templates/
│   └── code-push.config.local.ts  # 파일시스템 기반 CodePush 설정
├── helpers/
│   ├── prepare-config.ts   # App.tsx 패치(호스트 + 임시 E2E 버튼), 설정 복사
│   ├── prepare-bundle.ts   # code-push CLI로 번들 생성
│   ├── build-app.ts        # iOS/Android Release 빌드
│   ├── artifact-storage.ts # CLI가 번들과 릴리스 히스토리를 저장한 위치 검증
│   ├── download-order.ts   # 서버 요청 기록을 앱이 내려받은 archive 순서로 변환
│   ├── binary-patch-fixtures.ts  # 베이스 번들 추출과 손상된 patch archive
│   ├── binary-patch-phase.ts     # 바이너리 패치 시나리오 매트릭스
│   └── embedded-bundle-export.ts # export 훅이 바이너리에 담긴 번들을 내보냈는지 검증
├── flows/                  # Phase 1: 기본 플로우
├── flows-rollback/         # Phase 2: 바이너리로 롤백
├── flows-partial-rollback/ # Phase 3: 부분 롤백 (v1.0.2 → v1.0.1)
├── flows-optional/         # Phase 4: optional 설치 모드 검증
├── flows-binary-patch/     # Phase 6: 바이너리 패치 설치와 fallback
└── scripts/
    └── sleep.js            # Maestro runScript 대기 헬퍼
```

### Mock 서버

실제 CodePush 서버 대신, 로컬 Express 서버가 다음을 서빙합니다:
- **번들**: `mock-server/data/bundles/{platform}/{identifier}/full-bundle/{packageHash}`와 `mock-server/data/bundles/{platform}/{identifier}/{artifactType}/{targetBinaryVersion}/`
- **릴리스 히스토리**: `mock-server/data/histories/{platform}/{identifier}/{version}.json`

`code-push.config.local.ts` 템플릿은 모든 CLI 작업(업로드, 히스토리 읽기/쓰기)을 로컬 파일시스템으로 라우팅하며, 앱의 `CODEPUSH_HOST`는 mock 서버를 가리키도록 패치됩니다. 업로더가 전달한 artifact metadata로 스토리지 키를 만들므로 archive 파일명에 의존하지 않습니다.

서버는 응답한 모든 요청을 기록합니다. 러너는 이 기록을 되읽어, 화면으로는 구분할 수 없는 것 — 앱이 어떤 업데이트 archive를 어떤 순서로 내려받았는지 — 를 검증합니다.

`E2E_ARTIFACT_LOG_PATH`가 주어지면 템플릿은 저장한 모든 artifact도 (서빙 디렉터리 바깥에) 기록하며, 러너는 이를 되읽어 번들과 릴리스 히스토리가 metadata 기반 경로에 저장되는지 검증합니다.

### 릴리스 마커

동일한 소스 코드로 여러 릴리스(예: v1.0.1과 v1.0.2)를 생성하면 번들 JavaScript의 해시가 동일해져 CodePush가 같은 업데이트로 인식합니다. 이를 방지하기 위해 러너는 각 릴리스 전에 `App.tsx`에 `console.log("E2E_MARKER_{version}")`를 주입합니다. 이 코드는 미니피케이션 후에도 유지되어 고유한 번들 해시를 생성합니다.

## 문제 해결

- **iOS 빌드 시 서명 오류**: setup 스크립트가 `SUPPORTED_PLATFORMS = iphonesimulator`를 설정하고 코드 서명을 비활성화합니다. `scripts/setupExampleApp`으로 예제 앱이 설정되었는지 확인하세요.
- **Maestro/maestro-runner가 앱을 찾지 못함**: 실행 전에 시뮬레이터/에뮬레이터가 부팅되어 있는지 확인하세요. iOS의 경우 스크립트가 부팅된 시뮬레이터를 자동 감지합니다.
- **Android 네트워크 오류**: Android 에뮬레이터는 호스트 머신의 localhost에 접근하기 위해 `10.0.2.2`를 사용합니다. 설정에서 자동으로 처리됩니다. adb로 연결한 실기기에는 이 별칭이 없으므로, 러너가 mock 서버 포트를 기기로 포워딩(`adb reverse`)하고 앱이 기기 자신의 localhost를 보도록 합니다. 두 기본값 모두 `E2E_ANDROID_MOCK_SERVER_HOST`로 덮어쓸 수 있습니다.
- **업데이트가 적용되지 않음**: Mock 서버가 실행 중인지(포트 18081), `mock-server/data/`에 예상되는 번들과 히스토리 파일이 있는지 확인하세요.
