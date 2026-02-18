# Setup Expo Example App — 자동화 스크립트

`@bravemobile/react-native-code-push`가 적용된 Expo 예제 앱을 자동으로 생성합니다.

## 디렉토리 구조

```text
scripts/setupExpoExampleApp/
├── runSetupExpoExampleApp.ts  # 메인 진입점 (CLI)
├── tsconfig.json              # 이 스크립트 디렉토리용 TypeScript 설정
└── README.ko.md               # 이 파일
```

## 사전 요구사항

- Node.js (>= 18)
- npm
- `npx create-expo-app@latest`, `npm install` 실행을 위한 네트워크 접근

## 사용법

레포지토리 루트에서 실행:

```bash
npm run setup-expo-example-app -- --sdk <sdk-version>
```

### CLI 옵션

| 플래그 | 설명 | 기본값 |
|---|---|---|
| `--sdk <version>` | Expo SDK 메이저 버전 (예: `54`, `55`) | **필수** |
| `--beta` | 생성되는 앱 이름에 `Beta` 접미사 추가 | `false` |
| `--project-name <name>` | 앱 이름 직접 지정 | 자동 생성 |
| `-w, --working-dir <path>` | 앱 생성 디렉토리 | `./Examples` |
| `--ios-min-version <version>` | iOS 최소 배포 버전 | `16.0` |

### 앱 이름 규칙

- `--sdk 54` -> `Expo54`
- `--sdk 55 --beta` -> `Expo55Beta`

생성 경로:
- `Examples/Expo54/`
- `Examples/Expo55Beta/`

### 실행 예시

```bash
# Expo SDK 55 앱 생성
npm run setup-expo-example-app -- --sdk 55

# Expo SDK 55 beta 앱 생성
npm run setup-expo-example-app -- --sdk 55 --beta

# 커스텀 디렉토리에 생성
npm run setup-expo-example-app -- --sdk 54 -w /tmp/examples
```

## 스크립트가 수행하는 설정

아래 단계를 순서대로 실행합니다.

1. `default@sdk-<sdk>` 템플릿으로 Expo 앱 생성
2. `app.json` 수정:
   - `@bravemobile/react-native-code-push` plugin 추가
   - iOS bundle identifier / deployment target 설정
   - Android package / `usesCleartextTraffic` 설정
3. `package.json` 로컬 라이브러리 연동:
   - `@bravemobile/react-native-code-push` dependency 추가
   - `sync-local-library` 및 로컬 release 스크립트 추가
   - `postinstall`에 `sync-local-library` 등록/연결
4. 로컬 실행에 필요한 dev dependency 보강
5. `code-push.config.ts` 템플릿 복사
6. `ts-node` 실행을 위한 `tsconfig.json` 업데이트
7. CodePush 테스트용 `App.tsx` 템플릿 적용
8. Expo Router 홈 라우트가 `App.tsx`를 렌더하도록 연결
9. `npm install` 실행
10. `npx expo prebuild --platform all --clean --no-install` 실행
11. 생성된 네이티브 프로젝트의 iOS 최소 배포 버전 상향

## E2E 실행 (별도 명령)

이 setup 스크립트는 앱 생성/설정까지만 담당합니다.
E2E는 `e2e/run.ts`로 별도 실행하세요:

```bash
npm run e2e -- --app Expo55 --framework expo --platform ios
```
