# PC の常駐と自動での同期 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC のアプリをログイン時に自動で起動して常駐させ、相手側 (NAS / Google Drive) の変化を 30 秒ごとに確かめて、iPhone などでの変更を 1 分以内に取り込む。

**Architecture:** 同期の仕組み (`SyncEngine::run_loop`) に「相手側の確認」を足す。30 秒ごとにバックエンドの `list()` だけを呼び、同期の対象のファイル名と版から作った指紋が前回と違えば同期を 1 回要求する。自動起動は `tauri-plugin-autostart` を Rust から操作し、`settings.json` の `autostart` と OS の登録をそろえる。トレイのメニューに「今すぐ同期」を足す。

**Tech Stack:** Rust 2024 (Tauri 2.12.3、`tauri-plugin-autostart` 2.7.0)、React 19 + TypeScript、Storybook 10。

**Spec:** `docs/superpowers/specs/2026-10-25-desktop-resident-sync-design.md` (以下「仕様」、PR #37)

## Global Constraints

- 実装ブランチ `feature/resident-sync` を、#37 (仕様) と この計画の PR がマージされた後の `origin/main` から `--no-track` で切る。worktree `.worktrees/resident`。push は `git push origin feature/resident-sync:refs/heads/feature/resident-sync`。PR の base は `main`
- コミットに `Co-Authored-By` などの AI 帰属を付けない。PR 本文の末尾は `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- Go は `/opt/homebrew/bin/go` (このシェルでは `go` が `git checkout` の別名)。サイドカーが無いと `cargo build` が通らないので、新しい worktree では先に `npm run build:tailnet`
- 依存の追加は `tauri-plugin-autostart = "2.7"` だけ、デスクトップの target 依存 (`[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]`) に入れる。iOS には入れない。npm の依存は増やさない
- API は推測しない。プラグインは `~/.cargo/registry/src/*/tauri-plugin-autostart-2.7.0/src/lib.rs` (`ManagerExt::autolaunch()` → `AutoLaunchManager::{enable, disable, is_enabled}`、`Builder::new().build()`) を読んで使う
- 相手側の確認の間隔は **30 秒** (`REMOTE_CHECK_INTERVAL`)。5 分ごとの通常の同期 (`INTERVAL`) と保存の 5 秒後 (`AFTER_SAVE_DELAY`) は変えない
- 確認は `list()` だけ。手元のファイルを読まない、ハッシュを取らない
- 自動起動は既定オン (`settings.json` に項目が無い初めての起動で登録)。2 回目以降は OS の登録に設定を合わせる。開発ビルド (`debug_assertions`) では OS に登録しない
- 文言は日本語。新しい props は optional で、既存の Storybook の初回描画を変えない (`check:stories` missing: none)
- Linux はウィンドウを閉じると終了する (Phase 3 の決定、`tray::close_policy`) のを変えない。Linux の常駐はウィンドウが開いている間だけ (仕様には書いていない。仕様 §7 に記録する)
- 各タスクの終わりに `cargo test --manifest-path src-tauri/Cargo.toml`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios --lib`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、画面を触ったら `npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories && npm run test:web`

## Review Focus

1. **自分のアップロードのすぐ後の確認**: 同期で送った分を「相手側の変化」と取り違えて、30 秒ごとに空の同期を繰り返さない — Task 1 `own_upload_is_not_a_remote_change`
2. **確認中の認証の失敗 (NAS のパスワード変更)**: 確認も止まり、30 秒ごとに失敗を重ねない (NAS がアカウントをロックしない) — Task 1 `auth_failure_on_check_stops_checking`
3. **確認の途中で同期先を切り替えた**: 古い先の一覧の結果で新しい先の同期を要求したり、指紋を残したりしない — Task 1 `check_result_of_an_old_target_is_dropped`
4. **開発中 (`tauri dev`) のビルド**: 開発用の実行ファイルを OS の自動起動に登録しない — Task 2 `dev_builds_never_register`
5. **利用者が OS の設定で自動起動を外した**: 次の起動でアプリが勝手に登録し直さない — Task 2 `os_choice_wins_after_the_first_launch`

---

### Task 0: worktree

- [ ] `git fetch origin`。#37 とこの計画の PR がマージされたか確かめる (`gh pr view 37 --json state`)。まだなら止めて所有者に聞く
- [ ] `git worktree add --no-track -b feature/resident-sync .worktrees/resident origin/main`、`npm ci`、`npm run build:tailnet`、`cargo test --manifest-path src-tauri/Cargo.toml` (ベースラインの件数を控える)

---

### Task 1: 相手側の変化の確認 (同期の仕組み)

**Files:** Modify `src-tauri/src/sync/engine.rs`

**Interfaces:**
- Produces:

```rust
/// Spec 4.1: how often the target's listing is compared with the last one.
pub const REMOTE_CHECK_INTERVAL: Duration = Duration::from_secs(30);

/// The target's state as far as the sync cares: the sync targets' names and versions, in name
/// order, hashed. Files that are not sync targets (conflict copies, temporaries) are left out.
pub fn remote_fingerprint(files: &[RemoteFile]) -> String;

pub enum SyncReason { /* … */ RemoteChanged }   // 遅延なし (delay() は ZERO)

impl SyncEngine {
    /// One look at the target (spec 4.1, 4.2): lists it and asks for a run when the fingerprint
    /// differs from the last one. Does nothing (returns `CheckOutcome::Skipped`) without a
    /// target, while the credentials are refused, while paused, while a run is going or wanted.
    pub async fn check_remote(&self) -> CheckOutcome;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckOutcome { Skipped, Unchanged, Changed, Failed }
```

- `Inner` に `remote_seen: Option<String>` (最後に見た指紋)。`set_backend` と `reset_records` で `None` に戻す
- `check_remote` の流れ: (1) ロックの中で、対象・`generation`・`auth_rejected`・`paused`・`due` を見て、確かめてよいか決め、`Arc<dyn StorageBackend>` と `generation` を写す。走っている run は `self.shared.running.try_lock()` が取れないことで判断する (取れたらすぐ放す) (2) ロックを放して `backend.list().await` (3) ロックを取り直し、`generation` が変わっていれば結果を捨てて `Skipped` (4) 成功: 指紋を作り、`remote_seen` が `Some` で違えば `remote_seen` を更新して `request(SyncReason::RemoteChanged)` → `Changed`。`None` (起動直後でまだ同期していない) なら記録だけして `Unchanged`。同じなら `Unchanged` (5) 失敗: `BackendError::Auth` は run と同じ扱い (`backend_failed` を呼んで `auth_rejected` と状態の表示)。それ以外 (`Offline` など) は状態を変えずに `Failed`
- run の側: (3) の一覧を取ったところで `remote_seen` を更新する。run の終わり (`RunOutcome::Done`) で、相手側を変える操作 (アップロード、相手側の archive 移動、競合コピーの送信) を 1 つ以上したときは、`list()` をもう 1 回呼んで指紋を更新する (失敗しても run の結果は変えない)。こうすると自分のアップロードを次の確認で変化と取り違えない
- `run_loop`: `next_check = Instant::now() + REMOTE_CHECK_INTERVAL` を持ち、待ち時間を `min(next_due, next_interval, next_check)` にする。`now >= next_check` で `check_remote().await` を呼び、`next_check = now + REMOTE_CHECK_INTERVAL`。`paused` の間は確認しない

- [ ] **Step 1: 失敗するテスト** (`engine.rs` の tests、既存の `Pc` / `backend()` / `MemoryBackend` / `Flaky` の書き方に合わせる):

```rust
#[test]
fn remote_fingerprint_depends_on_names_and_versions_only() {
    let f = |name: &str, version: &str| RemoteFile {
        id: format!("id-{name}"),
        name: name.into(),
        version: version.into(),
        modified: dt("2026-10-25T09:00"),
        size: 1,
    };
    let a = vec![f("仕事.xlsx", "v1"), f("_PowerToDo.xlsx", "v1")];
    let b = vec![f("_PowerToDo.xlsx", "v1"), f("仕事.xlsx", "v1")];
    assert_eq!(remote_fingerprint(&a), remote_fingerprint(&b), "order does not matter");
    let c = vec![f("仕事.xlsx", "v2"), f("_PowerToDo.xlsx", "v1")];
    assert_ne!(remote_fingerprint(&a), remote_fingerprint(&c));
    let d = vec![f("仕事.xlsx", "v1"), f("_PowerToDo.xlsx", "v1"), f("仕事 (競合 2026-10-25 0900).xlsx", "x")];
    assert_eq!(remote_fingerprint(&a), remote_fingerprint(&d), "conflict copies are not targets");
}
```

  加えて (`#[tokio::test(start_paused = true)]` と `MemoryBackend` で):
  - `unchanged_remote_does_not_ask_for_a_run`: 同期のあと `check_remote()` が `Unchanged`、要求なし (`next_due()` が `None`)
  - `remote_change_asks_for_one_run`: 別の `Pc` (同じ `MemoryBackend`) が保存して同期 → こちらの `check_remote()` が `Changed`、要求が 1 回
  - `own_upload_is_not_a_remote_change`: こちらで保存して同期 (アップロード) → 直後の `check_remote()` が `Unchanged`
  - `auth_failure_on_check_stops_checking`: `list()` が `Auth` を返すバックエンド → `check_remote()` の後 `auth_rejected()` が true、次の `check_remote()` は `Skipped`
  - `check_result_of_an_old_target_is_dropped`: `list()` の途中で `set_backend` を呼ぶ (遅いバックエンドで `list()` を止めておき、その間に切り替える) → `Skipped`、新しい先の `remote_seen` は `None` のまま、要求なし
  - `no_check_while_paused_or_running_or_due`: `pause_for_update()` 中、`request(...)` 済み、run 中の 3 つでそれぞれ `Skipped`
  - `two_pcs_see_each_other_within_30_seconds`: 2 台の `run_loop` を走らせ、片方で保存 → もう片方のファイルに 40 秒以内 (時間を進めて) に入る
- [ ] **Step 2:** `cargo test --manifest-path src-tauri/Cargo.toml remote_` などで FAIL を確かめる (RED の出力を残す)
- [ ] **Step 3: 実装** (上の流れ)
- [ ] **Step 4:** 全テスト、clippy、iOS の `cargo check`、fmt
- [ ] **Step 5: Commit** — `feat(sync): check the target's listing every 30 s and sync when it changed`

---

### Task 2: ログイン時の自動起動

**Files:** Modify `src-tauri/Cargo.toml`、`src-tauri/src/store/paths.rs` (`AppSettings`)、`src-tauri/src/lib.rs` (プラグインの登録、起動時の調整、command の登録); Create `src-tauri/src/commands/autostart.rs`; Modify `src-tauri/src/commands/mod.rs` (mod 宣言)、`src-tauri/capabilities/default.json` (変えない: ページには権限を渡さない。Rust から呼ぶ)

**Interfaces:**
- Produces:

```rust
// store/paths.rs — AppSettings に追加
/// Start at login (spec 2). `None` until the app decided once (the first launch with this
/// feature registers it and writes `Some(true)`). Per device.
#[serde(default, skip_serializing_if = "Option::is_none")]
pub autostart: Option<bool>,

// commands/autostart.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutostartAction {
    /// Register with the OS and save `Some(true)`.
    Register,
    /// Save the OS's state as the setting (the user may have changed it in the OS).
    Adopt(bool),
    /// Nothing to do.
    Keep,
}
/// What start-up does with the saved setting and the OS's registration (spec 2).
pub fn autostart_decision(saved: Option<bool>, os_enabled: bool, dev_build: bool) -> AutostartAction;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartDto { pub supported: bool, pub enabled: bool, pub error: Option<String> }

#[tauri::command] pub async fn autostart_status(app: AppHandle) -> AppResult<AutostartDto>;
#[tauri::command] pub async fn set_autostart(app: AppHandle, enabled: bool) -> AppResult<AutostartDto>;
/// Called once from `setup` (off the main thread).
pub fn reconcile_at_startup(app: &AppHandle);
```

- `autostart_decision` の表: `dev_build` → `Keep` (OS に触らない)。`saved == None` → `Register`。`Some(s)` で `s != os_enabled` → `Adopt(os_enabled)`。それ以外 → `Keep`
- `reconcile_at_startup`: `spawn_blocking` で `is_enabled()` を読み、決定に従う。`Register` の失敗は `eprintln!` して設定は書かない (次の起動でまたやる)
- `set_autostart`: 開発ビルドでは `AppError::Invalid { message: "開発中のビルドではログイン時の起動を設定しません" }`。それ以外は `enable()` / `disable()`、成功したら設定を保存し、OS の状態を返す。失敗は `AppError::Io { message: format!("ログイン時に起動を設定できませんでした: {e}") }` で、設定は変えない
- iOS: `commands::autostart` は `#[cfg(desktop)]`。`generate_handler!` の並びを全 OS で同じにするため、mobile には同じ名前の command を置き、`autostart_status` は `supported: false`、`set_autostart` は `AppError::Invalid { message: "iPhone では使えません" }` (`commands::update` の mobile 用の command と同じ書き方)
- プラグインの登録: `#[cfg(desktop)] let builder = builder.plugin(tauri_plugin_autostart::Builder::new().build());` (引数なし。Mac は既定の LaunchAgent)
- 設定の書き込みは `update_update_settings` と同じ形 (`sync_rt.lock_settings_write()` を持って `AppSettings::save`)。同じ形の小さな関数 `update_app_settings(state, f)` に切り出してよい (`commands/update.rs` の動きは変えない)

- [ ] **Step 1: 失敗するテスト**:

```rust
#[test]
fn dev_builds_never_register() {
    for saved in [None, Some(true), Some(false)] {
        for os in [true, false] {
            assert_eq!(autostart_decision(saved, os, true), AutostartAction::Keep);
        }
    }
}

#[test]
fn first_launch_registers() {
    assert_eq!(autostart_decision(None, false, false), AutostartAction::Register);
    assert_eq!(autostart_decision(None, true, false), AutostartAction::Register);
}

#[test]
fn os_choice_wins_after_the_first_launch() {
    assert_eq!(autostart_decision(Some(true), false, false), AutostartAction::Adopt(false));
    assert_eq!(autostart_decision(Some(false), true, false), AutostartAction::Adopt(true));
    assert_eq!(autostart_decision(Some(true), true, false), AutostartAction::Keep);
    assert_eq!(autostart_decision(Some(false), false, false), AutostartAction::Keep);
}
```

  加えて `paths.rs`: `autostart` が無い `settings.json` が読める (`None`)、`Some(true)` / `Some(false)` の往復、`None` のときは書き出さない
- [ ] **Step 2:** FAIL を確かめる
- [ ] **Step 3: 実装**。プラグインのソース (`tauri-plugin-autostart-2.7.0/src/lib.rs:73-117, 119-128, 219-275`) を読んで呼び方を確かめ、報告に行番号を書く
- [ ] **Step 4:** 全テスト、clippy、iOS の `cargo check`、fmt。手元で `npm run tauri build -- --debug` ではなくリリースのビルドが要るので、自動起動の実機の確認は Task 5 の手動チェックに回す
- [ ] **Step 5: Commit** — `feat(app): start at login (on by default, follows the OS setting afterwards)`

---

### Task 3: トレイの「今すぐ同期」

**Files:** Modify `src-tauri/src/tray.rs`、`src-tauri/src/commands/sync.rs` (`sync_now` の中身を関数に切り出す)

**Interfaces:**
- Produces: `commands::sync::sync_now_from(app: &AppHandle) -> SyncStatusView` (async。今の `sync_now` command の中身。command はこれを呼ぶだけにする)。トレイの `SYNC_ID: &str = "tray-sync"`、メニューは「PowerToDo を開く」「タスクを追加…」「今すぐ同期」、区切り、「終了」
- 「今すぐ同期」は、同期先が無いとき (`state.sync.has_target()` が false で、設定の同期先も「同期しない」) は押せない。`MenuItem` を `AppState` (または `tray` の `OnceLock`) に持ち、`sync-status` を出すところ (`TauriSyncHost::status_changed`) で `set_enabled(has_target)` を呼ぶ。メニューの更新はメインスレッドでなくてよいかを tauri-2.12.3 の `menu` のソースで確かめる (必要なら `app.run_on_main_thread`)
- 押したら `tauri::async_runtime::spawn(async move { sync_now_from(&app).await; })`。ウィンドウは開かない

- [ ] **Step 1: テスト** — `tray.rs` の純関数として `fn sync_item_enabled(has_target: bool, backend: SyncBackend) -> bool` を作り、`None` の同期先では false、NAS / Drive で `has_target` が true のときだけ true (接続前の NAS は false)
- [ ] **Step 2: 実装**
- [ ] **Step 3:** 全テスト、clippy、iOS の `cargo check` (tray は desktop だけ)、fmt
- [ ] **Step 4: Commit** — `feat(tray): sync now from the tray menu`

---

### Task 4: 設定の「ログイン時に起動」

**Files:** Modify `src/api/client.ts` (`autostartStatus`、`setAutostart`)、`src/types/model.ts` (`AutostartDto`)、`src/views/SettingsPanes.tsx` (`NotificationsPane`)、`src/app/useSettingsPanes.ts`、`src/views/SettingsPanes.stories.tsx` (または該当の stories)

**Interfaces:**
- `NotificationsPane` に optional `autostart?: { enabled: boolean; supported: boolean; error?: string | null; busy?: boolean }` と `onToggleAutostart?: (v: boolean) => void`。`autostart` が無いときは今の見た目のまま (Storybook の初回描画を変えない)
- 「閉じたときトレイに残す」の下に Section「ログイン時に起動」: オン / オフ。説明「PC にログインすると PowerToDo が起動します (ウィンドウも開きます)。閉じるとトレイに残り、同期を続けます。」。`supported: false` (iPhone) のときは Section ごと出さない。エラーはその下に出す
- 置き場所は仕様 §2 の「設定の『一般』」ではなく、トレイの設定と同じ「通知」ペイン (今の設定に「一般」は無い。トレイと常駐の設定を 1 か所にまとめる)。仕様 §7 に記録する
- `useSettingsPanes`: 設定を開いたときに `api.autostartStatus()`、切り替えで `api.setAutostart(v)` (返った DTO で表示を更新、失敗は error)

- [ ] **Step 1: 実装**
- [ ] **Step 2: Storybook** — `Views/SettingsPanes` (または今の通知ペインの Story) に「ログイン時に起動 (オン)」「ログイン時に起動の設定に失敗」を足す
- [ ] **Step 3:** `npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories && npm run test:web`
- [ ] **Step 4: Commit** — `feat(settings): start at login switch`

---

### Task 5: ドキュメントと最終確認

**Files:** `README.md` (「トレイ」の章に自動起動と「今すぐ同期」、「同期」の章に 30 秒ごとの確認と届くまでの時間)、仕様 §7 (実装中の決定: Linux の常駐、設定の置き場所、run の終わりの一覧の取り直し)

- [ ] 最終確認: `cd tailnet && /opt/homebrew/bin/go test ./...`、`npm run build:tailnet`、`npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories && npm run test:web`、`cargo fmt --check && cargo test && cargo build && cargo clippy --all-targets`、`cargo check --target aarch64-apple-ios --lib`
- [ ] 手動チェックリスト (PR 本文、すべて未確認): 仕様 §6 の手動の項目 + iPhone で前面にいる間、PC での変更が 1 分以内に出る
- [ ] Commit `docs: resident sync (autostart, tray sync now, 30 s remote check)` → push → PR (base main)

---

## Self-Review (作成時に実施)

- 仕様 §2 → Task 2 (+ Task 4 の画面)。§3 → Task 3。§4.1 / §4.2 / §4.4 → Task 1。§4.3 → Task 1 の `two_pcs_see_each_other_within_30_seconds` と Task 5 の手動。§5 → Task 1 (確認の失敗、認証、切り替え) + Task 2 (登録の失敗)。§6 → 各タスクのテスト + Task 5
- iPhone (仕様 §1「前面にいる間は同じ確認」): `run_loop` は iOS でも同じものが動き、背面ではプロセスが止まるので、追加の作業は要らない (Task 1 の変更がそのまま効く)
- 名前の一貫性: `REMOTE_CHECK_INTERVAL`、`remote_fingerprint`、`SyncReason::RemoteChanged`、`check_remote`、`CheckOutcome`、`remote_seen`、`AutostartAction`、`autostart_decision`、`AutostartDto`、`autostart_status`、`set_autostart`、`reconcile_at_startup`、`sync_now_from`、`SYNC_ID`、`sync_item_enabled`
- 仕様との差 (実装で仕様 §7 に記録): 「ログイン時に起動」の置き場所を「通知」ペインに (§2 は「一般」)。Linux はウィンドウを閉じると終了するまま。自分のアップロードのあとに一覧を取り直す (§4.1 の「その同期で見た一覧から指紋を更新」をアップロードの分まで正確にするため)
