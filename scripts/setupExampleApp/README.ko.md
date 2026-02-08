# Setup Example App — 자동화 스크립트

`@bravemobile/react-native-code-push`가 사전 구성된 React Native 예제 앱을 자동으로 생성합니다.

## 디렉토리 구조

```
scripts/setupExampleApp/
├── runSetupExampleApp.ts      # 메인 진입점 (CLI)
├── syncLocalLibrary.ts        # 로컬 code-push 빌드를 node_modules에 동기화
├── templates/
│   └── App.tsx.txt            # CodePush 테스트 UI가 포함된 App.tsx 템플릿
├── tsconfig.json              # 이 스크립트 디렉토리용 TypeScript 설정
└── README.ko.md               # 이 파일
```

## 사전 요구 사항

- Node.js (>= 18)
- npm
- Ruby + Bundler (iOS pod install용)
- Xcode (iOS용)

## 사용법

레포지토리 루트에서 실행합니다:

```bash
npm run setup-example-app -- -v <react-native-버전>
```

### CLI 옵션

| 플래그 | 설명 | 기본값 |
|---|---|---|
| `-v, --rn-version <version>` | React Native 버전 (예: `0.83.1`, `0.84.0-rc.5`) | **필수** |
| `-w, --working-dir <path>` | 앱이 생성될 디렉토리 | `./Examples` |
| `--skip-pod-install` | `bundle install`과 `pod install`을 건너뜀 | `false` |

### 실행 예시

```bash
# RN 0.83.1 예제 앱 생성
npm run setup-example-app -- -v 0.83.1

# pod install 없이 생성 (macOS가 아니거나 CI 환경에서 유용)
npm run setup-example-app -- -v 0.84.0-rc.5 --skip-pod-install
```

생성된 프로젝트는 `Examples/RN<버전>/` 경로에 위치합니다 (예: `Examples/RN0831/`).

## 파이프라인 단계

아래 단계가 **순서대로** 실행됩니다. 하나라도 실패하면 이후 단계는 실행되지 않습니다.

### 1. create-react-native-template

`npx @react-native-community/cli init`으로 지정된 RN 버전의 빈 템플릿 앱을 생성합니다. 의존성 설치와 pod install은 이후 단계에서 수행하므로 여기서는 건너뜁니다 (`--skip-install`, `--install-pods false`).

### 2. configure-ios-versioning

`ios/<프로젝트명>.xcodeproj/project.pbxproj`와 `ios/Podfile`을 수정합니다:
- 모든 빌드 구성에서 `MARKETING_VERSION`을 `1.0.0`으로 통일합니다.
- `IPHONEOS_DEPLOYMENT_TARGET`을 `16.0`으로 설정합니다.
- Podfile의 `platform :ios`를 `'16.0'`으로 맞춥니다.

### 3. configure-android-versioning

`android/app/build.gradle`을 수정합니다:
- `versionName`을 `"1.0.0"`으로 통일합니다.
- 릴리스 빌드에서 ProGuard를 활성화합니다 (`enableProguardInReleaseBuilds = true`).

### 4. configure-local-code-link

`package.json`을 수정하여 로컬 라이브러리를 연결합니다:
- `@bravemobile/react-native-code-push`를 dependency로 추가합니다.
- `syncLocalLibrary.ts`를 가리키는 `sync-local-library` npm 스크립트를 추가합니다.
- `setup:pods` 편의 스크립트를 추가합니다 (`bundle install && cd ios && bundle exec pod install`).
- `postinstall` 훅에 `sync-local-library`를 등록하여, `npm install` 시마다 로컬 빌드가 자동 동기화되도록 합니다.
- 누락된 필수 dev dependencies를 설치합니다: `ts-node`, `axios`, `@types/node`, `@supabase/supabase-js`.

### 5. create-code-push-config

`Examples/CodePushDemoApp/code-push.config.example.supabase.ts` 템플릿 파일을 프로젝트 루트에 `code-push.config.ts`로 복사합니다.

### 6. configure-ts-node

`tsconfig.json`을 수정합니다:
- `include`에 `**/*.ts`, `**/*.tsx`, `code-push.config.ts`를 추가합니다.
- `ts-node` 섹션에 `module: "CommonJS"`, `types: ["node"]`를 설정하여 npm 스크립트에서 ts-node로 TypeScript 파일을 직접 실행할 수 있게 합니다.

### 7. apply-app-template

`templates/App.tsx.txt`를 읽어 `__IDENTIFIER__` 플레이스홀더를 프로젝트 이름(예: `RN0831`)으로 치환한 뒤, 프로젝트 루트에 `App.tsx`로 저장합니다. 이 템플릿에는 동기화, 메타데이터 확인, 앱 재시작 등의 CodePush 테스트 UI가 포함되어 있습니다.

### 8. install-dependencies

생성된 프로젝트에서 `npm install`을 실행합니다. 4단계에서 설정한 `postinstall` 훅에 의해 `sync-local-library`도 함께 실행되며, 이 과정에서 로컬 code-push 라이브러리가 패킹되어 `node_modules`에 복사됩니다.

### 9. install-ios-pods

`ios/` 디렉토리에서 `bundle install` 후 `bundle exec pod install`을 실행합니다. `--skip-pod-install` 옵션이 지정된 경우 이 단계는 건너뜁니다.

### 10. initialize-code-push

프로젝트 내에서 `npx code-push init`을 실행하여 iOS 및 Android 네이티브 프로젝트에 CodePush 설정을 자동으로 주입합니다.

## 헬퍼 스크립트: syncLocalLibrary.ts

이 스크립트는 생성된 앱의 `sync-local-library` npm 스크립트로 등록됩니다. `npm install` 시 `postinstall`을 통해 자동 실행되며, 수동으로도 실행할 수 있습니다:

```bash
npm run sync-local-library
```

**동작 순서:**
1. 레포지토리 루트에서 `npm pack`을 실행하여 로컬 라이브러리의 `.tgz` tarball을 생성합니다.
2. tarball을 임시 디렉토리에 압축 해제합니다.
3. `node_modules/@bravemobile/react-native-code-push`의 내용을 추출된 패키지로 교체합니다.
4. 임시 파일과 로컬 npm 캐시를 정리합니다.
