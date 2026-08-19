# npm 배포

> This document is intended for the maintainers.

GitHub Actions와 npm Trusted Publishing(OIDC)으로 배포합니다. 장기 npm 토큰은 사용하지 않습니다.

## 배포 방법

1. GitHub의 `Actions` → `Release` → `Run workflow`로 이동합니다.
2. 실행 브랜치로 `master`를 선택합니다.
3. `version_type`에서 `patch`, `minor`, `major` 중 하나를 선택합니다.
4. beta 버전을 배포하려면 `beta`를 선택한 뒤 워크플로를 실행합니다.
5. 생성된 `release/v<version>` PR을 검토합니다. `Unit Test`가 통과하면 PR을 병합합니다.
6. PR을 병합하면 Release 워크플로가 태그와 Draft GitHub Release를 만들고 패키지를 검증합니다.
7. Draft GitHub Release에 작성된 릴리즈 노트를 확인합니다.
8. 문제가 없다면 Release 워크플로에서 `npm-release` 배포를 승인합니다.
9. npm 배포가 끝나면 워크플로가 Draft GitHub Release를 공개합니다.

정식 버전은 npm의 `latest` dist-tag로 배포합니다. beta 버전은 `beta` dist-tag와 GitHub prerelease로 배포합니다.
선택한 버전이 현재 `beta` dist-tag보다 낮으면 워크플로가 배포를 중단합니다. `beta` dist-tag가 이전 버전으로 돌아가는 상황을 막기 위한 검사입니다.

현재 npm `latest`가 `13.0.0`일 때의 예시는 다음과 같습니다.

- `minor`, beta 선택: `13.1.0-beta.0`
- 다시 `minor`, beta 선택: `13.1.0-beta.1`
- `minor`, beta 미선택: `13.1.0`
- `patch`, beta 미선택: `13.0.1`

## 실패 시 대응

- 릴리즈 PR을 만들다가 실패하면 Release 워크플로를 다시 실행합니다. 같은 버전의 `release/v<version>` 브랜치나 열린 PR이 있으면 이를 재사용하고 `Unit Test`도 다시 실행합니다.
- PR을 병합한 뒤 npm 배포 전에 실패하면 해당 Release 워크플로를 다시 실행합니다. 기존 태그와 Draft GitHub Release가 현재 배포 커밋을 가리키는지 확인한 뒤 재사용합니다.
- npm 배포는 성공했지만 GitHub Release를 공개하지 못했다면 Release 워크플로를 다시 실행합니다. 워크플로가 npm 게시 상태를 확인하고 남아 있는 Draft를 공개합니다.
- npm에서 버전을 삭제해도 같은 버전으로 다시 배포할 수 없습니다. 새 버전을 만들기 전에 npm과 GitHub의 현재 상태부터 확인합니다.

## 참고

Release 워크플로는 npm에 바로 배포하지 않고 먼저 버전 변경 PR을 만듭니다. `master` 브랜치가 보호되어 있어 워크플로가 버전 커밋을 직접 푸시할 수 없기 때문입니다.

PR을 병합한 커밋을 기준으로 태그, npm 패키지, GitHub Release를 만들기 때문에 저장소에 기록된 버전과 실제 배포 결과도 일치합니다.
