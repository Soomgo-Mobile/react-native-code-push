# E2E 매트릭스 실행 스크립트

이 디렉토리에는 여러 앱 변형을 대상으로 E2E 테스트를 실행하는 래퍼 스크립트가 있습니다.

## 스크립트

- `scripts/e2e/run-rn-cli-matrix.sh`
- `scripts/e2e/run-expo-matrix.sh`

---

## 1) `run-rn-cli-matrix.sh`

React Native CLI 예제 앱(`RN0747` ~ `RN0840`)을 버전 매트릭스로 E2E 실행합니다.

### 동작

1. `npm run setup-example-app`으로 앱 생성 (`--skip-setup`이면 생략)
2. 설정된 RN 버전 각각에 대해 E2E 실행
3. 일부 타겟이 실패해도 다음 타겟 계속 실행
4. 마지막에 성공/실패 개수와 실패 타겟 목록 출력

### 사용법

```bash
bash scripts/e2e/run-rn-cli-matrix.sh [옵션]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `--force-recreate` | 앱 디렉토리가 있어도 삭제 후 재생성 | `false` |
| `--skip-setup` | 앱 생성 단계를 건너뛰고 E2E만 실행 | `false` |
| `--only android\|ios` | 한 플랫폼만 실행 | 둘 다 |
| `--legacy-arch-max-version <minor(두 자리)>` | RN **minor**가 이 값 이하인 버전을 legacy architecture로 셋업 | `76` |

### `--legacy-arch-max-version` 입력 형식

- 정확히 **두 자리 숫자**만 지원합니다.
- `76` 입력 시 `0.76.x` 이하를 legacy architecture로 셋업합니다.
- `81` 입력 시 `0.81.x` 이하를 legacy architecture로 셋업합니다.
- patch 버전은 의도적으로 무시합니다.

예시:

```bash
# 기본 임계값(76): 0.76.x 이하 legacy
bash scripts/e2e/run-rn-cli-matrix.sh

# android만 실행
bash scripts/e2e/run-rn-cli-matrix.sh --only android

# 0.81.x 이하를 legacy로 셋업
bash scripts/e2e/run-rn-cli-matrix.sh --legacy-arch-max-version 81

# setup 생략 + iOS만 실행
bash scripts/e2e/run-rn-cli-matrix.sh --skip-setup --only ios
```

### 종료 코드

- `0`: 모든 타겟 성공
- `1`: 하나 이상 실패

---

## 2) `run-expo-matrix.sh`

Expo 예제 앱(`Expo54`, `Expo55Beta`)을 매트릭스로 E2E 실행합니다.

### 동작

1. `npm run setup-expo-example-app`으로 앱 생성 (`--skip-setup`이면 생략)
2. Expo 앱/플랫폼별로 E2E 실행
3. 일부 타겟이 실패해도 다음 타겟 계속 실행
4. 마지막에 성공/실패 개수와 실패 타겟 목록 출력

### 사용법

```bash
bash scripts/e2e/run-expo-matrix.sh [옵션]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `--force-recreate` | 앱 디렉토리가 있어도 삭제 후 재생성 | `false` |
| `--skip-setup` | 앱 생성 단계를 건너뛰고 E2E만 실행 | `false` |
| `--only android\|ios` | 한 플랫폼만 실행 | 둘 다 |

예시:

```bash
# 전체 Expo 매트릭스 (setup + android + ios)
bash scripts/e2e/run-expo-matrix.sh

# android만 실행
bash scripts/e2e/run-expo-matrix.sh --only android

# 앱 재생성 후 iOS만 실행
bash scripts/e2e/run-expo-matrix.sh --force-recreate --only ios
```

### 종료 코드

- `0`: 모든 타겟 성공
- `1`: 하나 이상 실패

---

## 참고

- 경로 해석 문제를 줄이기 위해 저장소 루트에서 실행하는 것을 권장합니다.
- 두 스크립트 모두 타겟 단위 실패 시 즉시 중단하지 않고, 마지막에 전체 실패 목록을 출력하도록 설계되어 있습니다.
