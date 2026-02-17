# E2E 테스트 실행 가이드

[Maestro](https://maestro.mobile.dev/)를 사용한 `react-native-code-push` E2E 테스트입니다.

## 사전 요구사항

- **Node.js** (v18 이상)
- **Maestro CLI** — [설치 가이드](https://maestro.mobile.dev/getting-started/installing-maestro)
- **iOS**: Xcode 및 부팅된 iOS 시뮬레이터
- **Android**: Android SDK 및 실행 중인 에뮬레이터
- `Examples/` 디렉토리에 설정된 예제 앱 (예: `RN0840`)

## 빠른 시작

```bash
# 전체 실행 (빌드 + 테스트)
npm run e2e -- --app RN0840 --platform ios

# 빌드 생략, Maestro 플로우만 실행
npm run e2e -- --app RN0840 --platform ios --maestro-only
```

## CLI 옵션

| 옵션 | 필수 | 설명 |
|---|---|---|
| `--app <name>` | 예 | 예제 앱 디렉토리 이름 (예: `RN0840`) |
| `--platform <type>` | 예 | `ios` 또는 `android` |
| `--simulator <name>` | 아니오 | iOS 시뮬레이터 이름 (부팅된 시뮬레이터 자동 감지, 기본값 "iPhone 16") |
| `--maestro-only` | 아니오 | 빌드 단계 생략, Maestro 플로우만 실행 |

## 실행 과정

테스트 러너(`e2e/run.ts`)는 다음 단계를 순서대로 실행합니다:

### Phase 1 — 기본 플로우 (`flows/`)

1. **설정 준비** — `App.tsx`를 로컬 mock 서버를 가리키도록 패치하고, `code-push.config.local.ts`를 앱 디렉토리에 복사합니다.
2. **앱 빌드** — 예제 앱을 Release 모드로 빌드하여 시뮬레이터/에뮬레이터에 설치합니다.
3. **번들 준비** — `npx code-push release`로 릴리스 히스토리를 생성하고 v1.0.1을 번들링합니다.
4. **Mock 서버 시작** — 번들과 릴리스 히스토리 JSON을 서빙하는 로컬 HTTP 서버(포트 18081)를 시작합니다.
5. **Maestro 플로우 실행**:
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

## 아키텍처

```
e2e/
├── run.ts                  # 메인 오케스트레이션 스크립트
├── config.ts               # 경로, 포트, 호스트 설정
├── tsconfig.json
├── mock-server/
│   └── server.ts           # Express 정적 파일 서버 (포트 18081)
├── templates/
│   └── code-push.config.local.ts  # 파일시스템 기반 CodePush 설정
├── helpers/
│   ├── prepare-config.ts   # App.tsx 패치, 설정 복사
│   ├── prepare-bundle.ts   # code-push CLI로 번들 생성
│   └── build-app.ts        # iOS/Android Release 빌드
├── flows/                  # Phase 1: 기본 플로우
├── flows-rollback/         # Phase 2: 바이너리로 롤백
└── flows-partial-rollback/ # Phase 3: 부분 롤백 (v1.0.2 → v1.0.1)
```

### Mock 서버

실제 CodePush 서버 대신, 로컬 Express 서버가 다음을 서빙합니다:
- **번들**: `mock-server/data/bundles/{platform}/{identifier}/`
- **릴리스 히스토리**: `mock-server/data/histories/{platform}/{identifier}/{version}.json`

`code-push.config.local.ts` 템플릿은 모든 CLI 작업(업로드, 히스토리 읽기/쓰기)을 로컬 파일시스템으로 라우팅하며, 앱의 `CODEPUSH_HOST`는 mock 서버를 가리키도록 패치됩니다.

### 릴리스 마커

동일한 소스 코드로 여러 릴리스(예: v1.0.1과 v1.0.2)를 생성하면 번들 JavaScript의 해시가 동일해져 CodePush가 같은 업데이트로 인식합니다. 이를 방지하기 위해 러너는 각 릴리스 전에 `App.tsx`에 `console.log("E2E_MARKER_{version}")`를 주입합니다. 이 코드는 미니피케이션 후에도 유지되어 고유한 번들 해시를 생성합니다.

## 문제 해결

- **iOS 빌드 시 서명 오류**: setup 스크립트가 `SUPPORTED_PLATFORMS = iphonesimulator`를 설정하고 코드 서명을 비활성화합니다. `scripts/setupExampleApp`으로 예제 앱이 설정되었는지 확인하세요.
- **Maestro가 앱을 찾지 못함**: 실행 전에 시뮬레이터/에뮬레이터가 부팅되어 있는지 확인하세요. iOS의 경우 스크립트가 부팅된 시뮬레이터를 자동 감지합니다.
- **Android 네트워크 오류**: Android 에뮬레이터는 호스트 머신의 localhost에 접근하기 위해 `10.0.2.2`를 사용합니다. 설정에서 자동으로 처리됩니다.
- **업데이트가 적용되지 않음**: Mock 서버가 실행 중인지(포트 18081), `mock-server/data/`에 예상되는 번들과 히스토리 파일이 있는지 확인하세요.
