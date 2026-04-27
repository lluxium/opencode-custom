# OpenCode 커스터마이징 가이드

이 fork는 OpenCode 업스트림에 **사이드바 세션 태그 그룹핑** 기능을 추가한 개인용 빌드입니다.

---

## 1. 추가된 기능

### 사이드바 태그 그룹핑
- 세션 제목에 `[태그이름]` 접두어가 있으면 자동으로 해당 태그 그룹으로 묶임
  - 예: `[Setup] Outlook`, `[Research] 최신 기능` → 각각 `Setup`, `Research` 그룹
- 태그 없는 세션은 맨 아래 **기타** 그룹
- **드래그 앤 드롭**으로 그룹 순서 변경 가능 (폴더별 localStorage에 저장)
- **전체 펼치기 / 전체 접기** 버튼 (사이드바 상단)
- 초기 fetch 외에 **모든 세션 자동 로드**
- 폴더(worktree)별로 필터링되어 세션 섞임 방지

### 세션 언아카이브 (보관 해제)
- 사이드바 상단에 **상태 필터 드롭다운** (`전체` / `활성` / `보관` 순, 기본값 `활성`) 추가
  - `활성` (기본): 아카이브되지 않은 세션만 (기존 동작)
  - `보관`: 아카이브된 세션만 (lazy fetch, 별도 API 호출)
  - `전체`: 둘 다 표시. 아카이브된 세션은 opacity 60%로 dim 처리
- 선택 상태는 폴더(workspace)별 localStorage에 저장 (`opencode:archive-filter:<workspace key>`)
- 세션 호버 시 버튼이 **context-aware**로 전환:
  - 활성 세션: `archive` 아이콘 + "보관" 툴팁
  - 아카이브 세션: `reset` 아이콘 + "보관 해제" 툴팁 → 클릭 시 `time.archived = null` 패치
- **Optimistic update**: archive/unarchive 누르면 UI는 즉시 반영, 백엔드 호출은 비동기. 실패 시 롤백
- **중복 방지**: `sessions()` memo에서 active와 archived에 같은 id가 있으면 archived에서 제거 (id-based dedupe)
- 태그 그룹핑은 상태 무관하게 동일하게 동작 (아카이브된 세션도 `[태그]`로 묶임)

### 빌드/배포 관련
- **`tauri.local.conf.json`**: 서명/업데이터 없는 개인용 빌드 config
- **`OPENCODE_CHANNEL=latest`** 환경변수로 빌드 시 stable과 동일한 `opencode.db` 공유

---

## 2. 변경된 파일

| 파일 | 변경 종류 | 내용 |
|------|----------|------|
| `packages/app/src/pages/layout/helpers.ts` | 추가 | `groupSessionsByTag()` 함수 (+27줄) |
| `packages/app/src/pages/layout/sidebar-workspace.tsx` | 수정 | `LocalWorkspace` 컴포넌트 (~200줄 변경) — 태그 그룹핑 + 상태 필터 + archived lazy fetch |
| `packages/app/src/pages/layout/sidebar-items.tsx` | 수정 | `SessionItemProps`에 `unarchiveSession?`, `dim?` 추가 + 호버 버튼 context-aware |
| `packages/app/src/pages/layout.tsx` | 수정 | `unarchiveSession` 함수 + ctx/sessionProps에 연결 |
| `packages/opencode/src/session/session.ts` | 수정 | `Session.list`에 `archived?: boolean`, `onlyArchived?: boolean` 옵션 추가, `setArchived` 타입 `time?: number \| null` |
| `packages/opencode/src/server/routes/instance/session.ts` | 수정 | GET `/session` 쿼리에 `archived`/`onlyArchived` 파라미터, PATCH body `time.archived`를 `nullable` 로 변경 |
| `packages/sdk/js/src/v2/gen/*` | 재생성 | SDK OpenAPI에서 자동 생성 (`bun packages/sdk/js/script/build.ts`) |
| `packages/desktop/src-tauri/tauri.local.conf.json` | 신규 | 개인용 Tauri 빌드 config |

핵심 구현 포인트:

**태그 그룹핑**
- `sortedRootSessions`의 `store.path.directory` 대신 `props.project.worktree`로 필터링 (폴더별 구분)
- `<Show when={pinnedGroup()} keyed>`에 **`keyed` 필수** (프로젝트 전환 시 기타 그룹 업데이트)
- `createEffect`로 worktree 변경 시 강제 `loadMore()` 호출
- 태그 순서는 `opencode:tag-order:<workspace key>` 형식으로 localStorage 저장

**언아카이브 — 백엔드**
- PATCH `{ time: { archived: null } }` 로 처리 — zod 스키마 `nullable()`, 라우트에서 `"archived" in updates.time` 체크해야 null과 undefined 구분됨
- `Session.list`에 `archived`(active+archived 모두) / `onlyArchived`(archived만) 플래그 추가
- `projectors.ts`의 `toPartialRow`는 null은 유지(undefined만 필터링)하므로 `time_archived = NULL` UPDATE가 그대로 동작 — 별도 projector 수정 불필요

**언아카이브 — 프론트**
- 프론트는 `onlyArchived: true` + 큰 limit으로 아카이브 목록을 lazy fetch하여 별도 signal(`archivedSessions`)로 유지
- 상태 필터(`전체/활성/보관`)는 `opencode:archive-filter:<workspace key>` 로 localStorage 저장
- `dim` prop으로 "전체" 모드에서만 아카이브 세션 opacity 60%
- **`handleArchive` / `handleUnarchive` wrapper**가 `archivedSessions` signal을 optimistic하게 선업데이트 후 `ctx.archiveSession/unarchiveSession` 호출. 실패 시 snapshot으로 롤백. 이게 없으면 "다른 프로젝트 갔다와야 반영" 지연 발생
- **`sessions()` memo에서 id-based dedupe**: `store.session`에 활성으로 있는 id가 `archivedSessions` signal에도 있을 수 있으므로(언아카이브 직후), archived 쪽에서 제거해야 중복 렌더 방지

---

## 3. 빌드 & 설치

### 필수 사전 설치
- **Rust**: `winget install Rustlang.Rustup` (1.95+)
- **VS Build Tools**: `winget install Microsoft.VisualStudio.2022.BuildTools` (Desktop C++ 워크로드 포함)
- **Bun**: `^1.3.13` (`bun upgrade`로 최신화)
- **WebView2**: Windows 11 기본 포함

### 프로덕션 빌드 (인스톨러 생성)

**⚠️ 중요**: `tauri build`는 sidecar(opencode 바이너리)를 자동 재빌드 안 함. Sidecar가 오래됐거나 다른 채널로 빌드됐으면 수동으로 먼저 재빌드해야 함.

**Step 1: Sidecar 재빌드** (OPENCODE_CHANNEL 적용):
```bash
cd /c/Users/gwangjun/dev/opencode-custom/packages/desktop
export OPENCODE_CHANNEL=latest
export OPENCODE_VERSION=1.14.28  # 현재 빌드할 정확한 upstream 버전
export TAURI_ENV_TARGET_TRIPLE=x86_64-pc-windows-msvc  # Windows 기준
bun ./scripts/predev.ts
```

결과:
```
opencode script { "channel": "latest", "version": "1.x.x", ... }
Smoke test passed: 1.x.x
Copied ../opencode/dist/opencode-windows-x64-baseline/bin/opencode.exe to src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe
```

**Step 2: Tauri 인스톨러 빌드**:

PowerShell:
```powershell
cd C:\Users\gwangjun\dev\opencode-custom
$env:OPENCODE_CHANNEL="latest"
bun run --cwd packages/desktop tauri build --config src-tauri/tauri.local.conf.json
```

Git Bash:
```bash
cd /c/Users/gwangjun/dev/opencode-custom
export OPENCODE_CHANNEL=latest
bun run --cwd packages/desktop tauri build --config src-tauri/tauri.local.conf.json
```

**첫 빌드는 Rust release 컴파일 때문에 10~15분 소요.** 이후는 incremental이라 2분 정도.

### 채널 검증 (빌드한 sidecar가 맞는 DB 쓰는지 확인)

```bash
# 빌드 후 sidecar 바이너리 버전/채널 체크
packages/desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe --version
# 출력: 1.x.x (latest 빌드면 정식 버전, dev면 0.0.0-dev-xxx 형태)
```

`1.x.x` 형태면 `opencode.db` 공유. `0.0.0-dev-xxx` 형태면 `opencode-dev.db` 별도 사용.

### 결과물 위치
- **인스톨러**: `packages/desktop/src-tauri/target/release/bundle/nsis/OpenCode Custom_X.X.X_x64-setup.exe`
- **단독 실행 파일**: `packages/desktop/src-tauri/target/release/OpenCode.exe`

### 설치
1. 인스톨러 실행 → `C:\Users\<user>\AppData\Local\OpenCode Custom\`에 설치됨
2. 기존 stable(`OpenCode`)과 별개로 공존
3. 만족하면 Windows 설정에서 기존 stable 언인스톨

### 중요 경로
- **Stable**: `C:\Users\gwangjun\AppData\Local\OpenCode\`
- **Custom**: `C:\Users\gwangjun\AppData\Local\OpenCode Custom\`
- **DB**: `C:\Users\gwangjun\.local\share\opencode\opencode.db` (둘이 공유, `OPENCODE_CHANNEL=latest`로 빌드했을 때)

---

## 4. 업스트림 릴리즈 반영 워크플로우

### 원격 저장소 구조
- `origin`: `https://github.com/lluxium/opencode-custom.git` (내 fork)
- `upstream`: `https://github.com/anomalyco/opencode.git` (원본)

### 새 릴리즈가 나왔을 때 (권장 1-2주마다)

```bash
cd C:\Users\gwangjun\dev\opencode-custom

# 1. 업스트림 최신 받기
git fetch upstream

# 2. 현재 커밋 확인 (백업용)
git log --oneline -3

# 3. 내 dev 브랜치를 upstream/dev 위에 rebase
git checkout dev
git rebase upstream/dev

# 4. 충돌이 있으면 수정 → git add → git rebase --continue
#    (충돌은 주로 sidebar-workspace.tsx에서 발생)

# 5. 정상 rebase 완료 후 force push (내 fork에 반영)
git push origin dev --force-with-lease

# 6. 심볼릭 링크 복구 (Windows 한정, 매번 필요)
python <<'PYEOF'
import os, shutil, subprocess
result = subprocess.run(["git", "ls-files", "--stage"], capture_output=True, text=True)
for line in result.stdout.splitlines():
    parts = line.split("\t", 1)
    if len(parts) != 2: continue
    meta, path = parts
    if not meta.startswith("120000"): continue
    if not os.path.exists(path): continue
    try:
        with open(path, "rb") as f: content = f.read()
        if len(content) > 500: continue
        target_rel = content.decode("utf-8", errors="strict").strip()
        if not target_rel or "\n" in target_rel: continue
        src_dir = os.path.dirname(path)
        target_abs = os.path.normpath(os.path.join(src_dir, target_rel))
        if not os.path.isfile(target_abs): continue
        shutil.copyfile(target_abs, path)
    except: continue
PYEOF

# 7. 의존성 재설치 (package.json 변경 있을 때)
bun install

# 8. Sidecar 재빌드 (중요! 안 하면 이전 채널의 sidecar 사용됨)
export OPENCODE_CHANNEL=latest
export OPENCODE_VERSION=1.14.28
export TAURI_ENV_TARGET_TRIPLE=x86_64-pc-windows-msvc
bun --cwd packages/desktop ./scripts/predev.ts

# 9. Tauri 인스톨러 빌드
bun run --cwd packages/desktop tauri build --config src-tauri/tauri.local.conf.json

# 10. 새 인스톨러 실행해서 업데이트
# 경로: packages/desktop/src-tauri/target/release/bundle/nsis/OpenCode Custom_X.X.X_x64-setup.exe
```

### Rebase 충돌 리스크 (파일별)

| 리스크 | 파일 | 이유 |
|---|---|---|
| 🟢 낮음 | `packages/app/src/pages/layout/helpers.ts` | `groupSessionsByTag()` 함수 추가만 (독립) |
| 🟢 낮음 | `packages/app/src/pages/layout.tsx` | `unarchiveSession` 함수 새로 추가 + ctx/sessionProps에 prop 2줄 (독립) |
| 🟢 낮음 | `packages/opencode/src/server/routes/instance/session.ts` | 스키마에 필드 추가 형태. 기존 필드와 공존 |
| 🟢 낮음 | `packages/sdk/js/src/v2/gen/*`, `packages/sdk/js/src/gen/*` | 자동 생성 — rebase 충돌 무시하고 `bun packages/sdk/js/script/build.ts` 재실행 |
| 🟡 중간 | `packages/opencode/src/session/session.ts` | `Session.list` / `setArchived` 시그니처 확장. 업스트림이 해당 함수 리팩토링하면 3~4줄 재삽입 |
| 🟡 중간 | `packages/app/src/pages/layout/sidebar-items.tsx` | 호버 버튼을 `<Show fallback>` 구조로 wrap. 이 영역 UI 변경 시 재적용 |
| 🔴 높음 | `packages/app/src/pages/layout/sidebar-workspace.tsx` | `LocalWorkspace` 컴포넌트 내부에 **태그 그룹핑 + 상태 필터 + lazy fetch + optimistic handlers + DnD** 모두 집중. 업스트림이 이 컴포넌트 구조를 건드리면 재이식 필요 |

### 예상 rebase 시간

| 시나리오 | 시간 |
|---|---|
| 업스트림이 위 파일들을 안 건드림 | 15~20분 (rebase 5분 + SDK regen 2분 + 빌드 10분) |
| `sidebar-workspace.tsx`에 UI 수정 추가 | 30분~1시간 |
| `LocalWorkspace` 내부 구조 대수술 | 1~2시간 (재포팅) |
| `Session.list` / schema 대수술 | +30분 (백엔드 재정렬) |

### Rebase 충돌 대응 팁

1. **SDK 디렉토리 충돌은 수작업 merge 금지**. `git checkout --theirs packages/sdk/js/src/v2/gen/` 로 업스트림 버전 채택 후 rebase 끝나면 `bun packages/sdk/js/script/build.ts` 재실행 — 우리 스키마 변경이 다시 생성됨.
2. **언아카이브 커밋을 태그 그룹핑(`c0dbc0d71`)과 분리**해 두면 cherry-pick 유연성 확보. 업스트림이 언아카이브 공식 지원하면 그 커밋만 drop 가능.
3. 충돌 해결 시 `<<<<<<<`, `=======`, `>>>>>>>` 마커 찾아서 수정 후 `git add → git rebase --continue`
4. **`sidebar-workspace.tsx` 충돌 체크리스트** (위 "핵심 구현 포인트" 참고):
   - 태그 그룹핑: `groupSessionsByTag()` 호출 + `draggableGroups()` / `pinnedGroup()` 렌더링
   - 상태 필터: `archiveFilter` signal + localStorage + lazy fetch `createEffect`
   - 중복 방지: `sessions()` memo의 id-based dedupe
   - Optimistic: `handleArchive` / `handleUnarchive` wrapper

### Upstream이 구조를 크게 바꾼 경우

- 파일 이름이 바뀌거나 `LocalWorkspace`가 분리/통합된 경우 재포팅
- 참고 커밋: `c0dbc0d71` (태그 그룹핑), 언아카이브는 §8 커밋 참고
- 주요 원리만 유지: "태그 파싱 → 그룹핑 → worktree 필터 → 드래그 저장 + archive 필터 → lazy fetch → optimistic"

---

## 5. 개발 모드 (빌드 없이 코드 수정 반영)

코드 수정 테스트할 때:

```bash
cd /c/Users/gwangjun/dev/opencode-custom
export PATH="$USERPROFILE/.cargo/bin:$PATH"
bun run --cwd packages/desktop tauri dev
```

- **OpenCode Dev** 창이 열림 (stable과 별개)
- HMR 작동: 소스 파일 저장하면 자동 리로드
- 종료: 앱 창 X 버튼
- Rust 부분 수정 시 재빌드 필요

---

## 6. DB 구조 및 채널

OpenCode는 빌드 시 `OPENCODE_CHANNEL`에 따라 DB 파일을 분리:

| 채널 | DB 파일 |
|------|--------|
| `latest`, `beta`, `prod` | `opencode.db` (공유) |
| `local` (기본) | `opencode-local.db` |
| `dev` (git 브랜치명) | `opencode-dev.db` |
| `<기타 브랜치>` | `opencode-<branch>.db` |

**우리는 `OPENCODE_CHANNEL=latest`로 빌드해서 stable과 같은 `opencode.db`를 사용.**

DB 위치: `C:\Users\gwangjun\.local\share\opencode\`

### 주의
- 같은 DB를 여러 opencode 프로세스가 동시에 쓰면 SQLite 락 문제 발생 가능
- Custom 앱 실행 중엔 stable 실행 최소화 (혹은 한 번에 하나만)

---

## 7. 트러블슈팅

### 빌드 시 `error TS1128: Declaration or statement expected`
→ Windows에서 git이 symlink를 텍스트 파일로 저장한 문제. 위의 **심볼릭 링크 복구** 스크립트 실행.

### 빌드 시 `Warning Waiting for your frontend dev server...` 무한 대기
→ `bun` 버전 확인 (`^1.3.13` 이상 필요). `bun upgrade`.

### `tauri dev`로 앱은 뜨는데 세션이 안 보임
→ Sidecar 초기화 시간 필요 (10-30초). 그래도 안 되면 콘솔 열어서 에러 확인.

### 기타 그룹이 프로젝트 전환 시 stale하게 고정
→ `<Show when={...} keyed>` 빠졌는지 확인. `keyed` 필수.

### 프로젝트 전환 시 다른 폴더 세션 섞임
→ `sessions` memo에서 `props.project.worktree`로 필터링 되는지 확인 (`store.path.directory`로 하면 안 됨).

### DB 스냅샷 동기화 (이전 방식, 참고만)
채널이 달라서 DB 분리됐을 때 수동 복사:
```python
import sqlite3
src = sqlite3.connect(r'C:\Users\gwangjun\.local\share\opencode\opencode.db')
dst = sqlite3.connect(r'C:\Users\gwangjun\.local\share\opencode\opencode-dev.db')
with dst: src.backup(dst)
```
단, **`OPENCODE_CHANNEL=latest`로 빌드하면 이 단계 불필요** (DB 공유).

### dev 모드 콘솔에 `Cannot remove ... nonexistent ...` 경고 다수

**dev 모드 한정 진단 noise**. prod 빌드(인스톨러)에선 안 나타남. 기능 영향 없음.

**원인**: `@thisbeyond/solid-dnd@0.7.5`의 `dev.js`에만 `console.warn`이 있음. `package.json` exports의 `development` 조건에서만 dev.js 사용, prod 빌드는 `index.js` 사용 (warning 0줄).

**3개 `DragDropProvider` 인스턴스**가 동시 떠 있음:
- `sidebar-shell.tsx` rail (프로젝트 아이콘) — upstream
- `layout.tsx` workspaces popover — upstream
- `sidebar-workspace.tsx` 태그 그룹 — **우리 fork**

**트리거**: 프로젝트 이동 시 `navigateWithSidebarReset`이 `setHoverProject(undefined)` + `navigate(href)` 를 같은 reactive update에서 발생 → solid-dnd cleanup이 race condition으로 `state[type][id]` 이미 사라진 상태에서 `removeTransformer` 호출 → `console.warn`.

**식별 방법**:
1. **prod 빌드 산출물에서 warning 코드 검증**:
   ```bash
   grep -c "Cannot remove" packages/desktop/dist/assets/*.js
   ```
   모두 `0`이면 prod엔 없음 (검증 완료된 사실)
2. solid-dnd 라이브러리에서:
   ```bash
   grep -c "nonexistent" node_modules/.bun/@thisbeyond+solid-dnd@0.7.5+*/node_modules/@thisbeyond/solid-dnd/dist/index.js
   ```
   `0`이면 prod build에 warning 없음

**무시해도 되는 조건**:
- 기능 정상 동작 (DnD 자체는 작동)
- prod 빌드에 warning 없음 확인
- 같은 패턴이 upstream의 shell/workspace DnD에서도 발생

**진짜 문제로 봐야 할 조건**:
- prod 빌드에서도 warning 출력 (DevTools 못 켜면 빌드 산출물 grep으로 확인)
- DnD 동작 자체가 깨짐 (드래그 불가, 순서 안 바뀜)
- 메모리 누수 발생

**근본 수정하려면** (현재 우선순위 낮음):
- 우리 `sidebar-workspace.tsx`의 `<SortableProvider ids={draggableGroups().map((g) => g.tag)}>`에서 `ids`가 매번 새 배열이라 race 유발 가능 → stable reference로 보장하거나 `<Index>` 사용
- 다만 같은 패턴이 upstream의 두 DnD에도 있으므로 단독 수정은 효과 제한적

---

## 8. State 폴더 구조 (XDG_STATE_HOME)

### XDG 기본

opencode는 XDG Base Directory 관례를 따름. 환경변수로 경로 커스터마이징 가능:

| 환경변수 | 용도 | Windows 기본 경로 |
|---------|------|------------------|
| `XDG_CONFIG_HOME` | 설정 | `%USERPROFILE%\.config\` |
| `XDG_DATA_HOME` | 중요 데이터 (DB 등) | `%USERPROFILE%\.local\share\` |
| `XDG_STATE_HOME` | 상태 (favorites/history) | `%USERPROFILE%\.local\state\` |
| `XDG_CACHE_HOME` | 캐시 | `%USERPROFILE%\.cache\` |

### State 폴더에 들어가는 것

`$XDG_STATE_HOME/opencode/` 아래:
- `model.json` — AI 모델 favorites
- `frecency.jsonl` — 최근 사용 이력
- `prompt-history.jsonl` — 프롬프트 히스토리
- `kv.json` — 기타 상태값
- `locks/` — 동시 실행 방지 락

### Tauri 데스크톱의 XDG_STATE_HOME 덮어쓰기

**모든 Tauri로 빌드된 opencode 데스크톱 앱** (공식 포함)은 sidecar 실행 시 `XDG_STATE_HOME`을 강제로 override.

코드 위치: `packages/desktop/src-tauri/src/cli.rs:371~389`

```rust
let state_dir = app.path().resolve("", BaseDirectory::AppLocalData);
envs.push(("XDG_STATE_HOME", state_dir.to_string()));
```

`BaseDirectory::AppLocalData`는 **앱 identifier 기반 자동 경로**:

| Identifier | State 경로 |
|-----------|----------|
| `ai.opencode.desktop` (공식) | `%LOCALAPPDATA%\ai.opencode.desktop\opencode\` |
| `ai.opencode.desktop.beta` | `%LOCALAPPDATA%\ai.opencode.desktop.beta\opencode\` |
| `ai.opencode.desktop.dev` | `%LOCALAPPDATA%\ai.opencode.desktop.dev\opencode\` |
| `ai.opencode.desktop.local` (Custom) | `%LOCALAPPDATA%\ai.opencode.desktop.local\opencode\` |

**설계 의도:** 버전별 state 완전 격리. Beta가 state 파일 포맷 바꿔도 prod 영향 없음.

### 결과: CLI와 Desktop의 state 분리

- **CLI** (터미널에서 `opencode`): XDG_STATE_HOME 덮어쓰기 안 됨 → 기본 경로 (`%USERPROFILE%\.local\state\opencode\`) 사용
- **모든 Desktop 변종**: 각자 identifier 폴더 사용

즉 CLI로 설정한 favorites는 데스크톱 앱에서 안 보이고, 반대도 마찬가지.

### Env 상속 규칙

자식 프로세스 (MCP 서버 등)는 **spawn 시점 부모의 env 그대로 상속**:

- CLI가 spawn한 MCP 자식 → XDG_STATE_HOME 미설정 → CLI state 공유
- Desktop이 spawn한 MCP 자식 → Desktop state 경로 사용

**이미 실행 중인 자식은 부모가 나중에 뭐 하든 영향 없음** (env는 태어날 때 한 번만 받음).

### "CLI 우선 실행" 패턴

MCP 기반 외부 도구(텔레그램 봇 등)가 CLI state와 favorites 공유를 필요로 하면:

1. 터미널에서 `opencode` 실행 → MCP 자식 spawn (CLI env 상속)
2. 이후 Desktop 앱 실행 → 자기 sidecar 별도 관리, 기존 MCP 자식 영향 X
3. Desktop 종료해도 MCP 자식은 CLI 프로세스 밑이라 계속 실행
4. CLI 종료 시 MCP 자식도 같이 종료

Desktop에서 favorites를 안 쓰면 state 분리가 문제 되지 않음.

### 완전 통합하려면 (참고)

CLI/Desktop state를 통합하고 싶으면 `cli.rs`에서 XDG_STATE_HOME 엔트리 4줄 삭제:

```rust
// 삭제
(
    "XDG_STATE_HOME".to_string(),
    state_dir.to_string_lossy().to_string(),
),
```

→ sidecar가 기본 경로 사용 → CLI와 공유. 단 버전별 격리 특성은 잃음.

---

## 9. 참고 커밋

- `ace23e97e` - feat: tag-based session grouping with drag-drop ordering (rebase 후, 원본 `c0dbc0d71`)
- `4a2a39e4d` - feat: session unarchive UI with status filter and optimistic update
- 이후 커밋들도 여기에 기록해 두면 편함

### 언아카이브 테스트 방법

1. `bun run --cwd packages/desktop tauri dev`로 dev 모드 실행 (HMR 반영됨), 또는 프로덕션 빌드한 `OpenCode Custom` 앱 실행
2. 사이드바 상단 슬라이더 아이콘("활성") 클릭 → "보관" 선택
3. 아카이브된 세션 목록 표시되는지 확인 (없으면 테스트용으로 활성 세션 몇 개 호버 → 보관 버튼)
4. 아카이브된 세션 호버 → reset 아이콘(보관 해제) 클릭 → **즉시** 리스트에서 제거되어야 함 (optimistic)
5. 드롭다운 "활성"으로 복귀 → 방금 복원한 세션이 활성 리스트에 나타나야 함
6. 드롭다운 "전체"로 → 활성+보관 동시 표시, 보관된 세션은 60% opacity로 dim 처리
7. "전체" 상태에서 보관 버튼 눌러도 리스트에 남아있어야 함 (dim 처리된 채로), 중복 렌더 없어야 함
8. 다른 폴더로 전환 → 상태 필터가 폴더별로 독립되는지 확인

### 빌드 결과 확인 (최근 빌드 기록)

- 2026-04-24: `OpenCode Custom_1.14.21_x64-setup.exe` 빌드 성공, sidecar 버전 `1.14.23` (`channel=latest`)
- **2026-04-25**: `OpenCode Custom_1.14.24_x64-setup.exe` 빌드 성공, sidecar 버전 `1.14.25` (`channel=latest`)
  - upstream/dev rebase 무충돌 (5개 우리 커밋 깔끔히 적용됨)
  - typecheck 13/13 통과
  - 폴더 rename `opencode-tag` → `opencode-custom` 완료
  - prod 빌드 산출물에 solid-dnd warning 코드 0건 검증 완료
- **2026-04-27**: `OpenCode Custom_1.14.28_x64-setup.exe` 빌드 성공, sidecar 버전 `1.14.28` (`channel=latest`, `OPENCODE_VERSION=1.14.28`)
  - upstream `v1.14.28` rebase 무충돌 (6개 우리 커밋 적용)
  - dev 모드 검증 후 release 인스톨러 빌드
  - `latest` 채널만 지정하면 npm latest 기준 다음 패치(`1.14.29`)로 계산되므로 `OPENCODE_VERSION=1.14.28`을 명시
- 인스톨러 경로: `packages/desktop/src-tauri/target/release/bundle/nsis/OpenCode Custom_X.X.X_x64-setup.exe`

---

_최종 업데이트: 2026-04-27 (v1.14.28 rebase + dev 검증 + installer build 기록 추가)_
