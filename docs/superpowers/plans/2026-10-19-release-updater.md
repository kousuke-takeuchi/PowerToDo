# Release (配布と自動更新) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub で release を公開すると CI が 7 種のインストーラーと `latest.json` を添付し、入れたアプリが起動後に更新を見つけて入れ替え・再起動できるようにする。

**Architecture:** `.github/workflows/release.yml` (MadakeCAD の形) が `tauri-action@v0` で 4 ジョブを作る。アプリは `tauri-plugin-updater` を Rust の command (`commands/update.rs`) からだけ使い、入れ替えの前に同期エンジンを一時停止して走っている同期を待ち、Tailscale サイドカーを止める。画面は起動 5 秒後の確認、`UpdateDialog`、設定の「アップデート」ペイン。

**Tech Stack:** Tauri 2.12、`tauri-plugin-updater` 2.14 (minisign)、tokio、React 19 + TypeScript、Storybook 10、GitHub Actions (`tauri-apps/tauri-action@v0`、`actions/setup-go@v5`)。

**Spec:** `docs/superpowers/specs/2026-10-19-release-updater-design.md` (以下「仕様」。PR #29、先にマージ)。参考: `~/Documents/MadakeCAD/.github/workflows/release.yml`、`~/Documents/MadakeCAD/src-tauri/src/updates.rs`、`~/Documents/MadakeCAD/src/stores/updates.ts` (読んでよいがコピーせず、PowerToDo の構造に合わせる)。

## Global Constraints

- タグは `v` + 数字だけの `X.Y.Z` (仕様 §2.1)。リポジトリの `version` は `0.1.0` のまま、CI の作業コピーだけに書き込む
- 配布物 7 種: `.dmg` ×2 (aarch64 / x86_64)、NSIS `-setup.exe`、`.msi`、`.AppImage`、`.deb`、`.rpm`
- endpoint は `https://github.com/kousuke-takeuchi/PowerToDo/releases/latest/download/latest.json`、`windows.installMode: "passive"`、`updaterJsonPreferNsis: true`
- OAuth は secret `POWERTODO_GOOGLE_OAUTH_JSON_CONTENT` を `$RUNNER_TEMP` に 600 で書き、パスを `POWERTODO_GOOGLE_OAUTH_JSON` に渡す。中身を `echo` しない
- release ジョブでは `-v` / `-vv` を付けない、`Swatinem/rust-cache` を使わない、`target/` をアップロードしない。`ci.yml` に secret を渡さない
- コード署名・公証はしない。`tauri-plugin-process` は入れない (`AppHandle::restart`)。JS 用の `updater:*` 権限は付けない
- updater は `#[cfg(desktop)]` だけ。iOS には入れない
- 自動確認は起動 5 秒後に 1 回、`settings.json` の `updates.autoCheck` (既定 `true`)。「あとで」はそのプロセスの間だけ
- 更新前の同期待ちは最大 60 秒。過ぎたら中止して元に戻す
- 文言は日本語、です・ます。秘密 (鍵、パスワード、OAuth の中身) をログ・エラー・イベントに出さない。サンプルに実在の識別子を使わない
- コミットに `Co-Authored-By` などの AI 帰属を付けない。シェルの `go` は `git checkout` の別名なので `/opt/homebrew/bin/go` を使う

## Review Focus

- 更新の途中 (ダウンロード中) にネットワークが切れる: エラー文が出て、同期の一時停止とサイドカーが元に戻り、アプリはそのまま使える → Task 2 の `a_failed_install_restores_sync_and_sidecar`
- 同期が 60 秒を超えて終わらない (大きな xlsx、遅い NAS): `Busy` で中止、一時停止が外れ、待つ間に来た同期要求は再開後に走る → Task 1 の `a_request_while_paused_runs_after_resume` と Task 2 の `a_long_sync_aborts_the_update_and_resumes`
- 外部変更の保留 (Excel で直した変更の確認待ち) があるまま更新を押す: 中止して理由を出す (保留を黙って捨てない) → Task 2 の `a_held_project_blocks_the_update`
- 公開鍵が入っていない / `latest.json` の署名が合わない: `Invalid` を返し、何も入れ替えない → Task 2 の `a_bad_signature_is_invalid`
- 起動直後の自動確認がオフラインで失敗: 画面に何も出さない (エラーで邪魔しない)。手動の「更新を確認」では理由を出す → Task 3 の `useUpdates` の分岐 (`auto` のときは失敗を捨てる) と Story `Views/UpdatesPane/確認失敗`

---

### Task 0: 署名鍵 (所有者が行う。Task 2 の前)

所有者 (ユーザー) が手元の Mac で行う。コントローラーは値を見ない (公開鍵だけ読む)。

- [ ] `npx tauri signer generate -w ~/.tauri/powertodo.key` (パスワードを付ける)
- [ ] GitHub → Settings → Secrets and variables → Actions に `TAURI_SIGNING_PRIVATE_KEY` (`~/.tauri/powertodo.key` の中身)、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`、`POWERTODO_GOOGLE_OAUTH_JSON_CONTENT` (`src-tauri/google-oauth.json` の中身) を登録
- [ ] コントローラーが `~/.tauri/powertodo.key.pub` の中身 (公開してよい) を Task 2 の実装者に渡す

---

### Task 1: 同期エンジンの一時停止 (`pause_for_update` / `wait_idle` / `resume`)

**Files:**
- Modify: `src-tauri/src/sync/engine.rs` (`Inner`、`SyncStatusView`、`run_loop`、`run` の入口、tests)
- Modify: `src/types/model.ts` (`SyncStatusDto` に `paused?: true`)
- Modify: `src/app/syncText.ts` (サイドバー文言)

**Interfaces:**
- Produces:
  - `SyncEngine::pause_for_update(&self)` — 新しい実行を始めない印を立てる。走っている実行は止めない。状態に `paused: true`
  - `async fn SyncEngine::wait_idle(&self, timeout: Duration) -> bool` — 走っている実行が終われば `true`、時間切れなら `false`
  - `SyncEngine::resume(&self)` — 印を外し、止めている間に来た要求があれば `run_loop` を起こす
  - `SyncStatusView.paused: bool` (`#[serde(skip_serializing_if = "std::ops::Not::not")]`)
- Consumes: 既存の `Inner`、`Shared.running` (`tokio::sync::Mutex<()>`)、`Shared.wake`

- [ ] **Step 1: 失敗するテストを書く** (`engine.rs` の `mod tests`、既存の `MemoryBackend` / テスト用 host を使う。名前は既存のテストの補助関数に合わせる)

```rust
#[tokio::test(start_paused = true)]
async fn a_request_while_paused_runs_after_resume() {
    let (engine, host, _remote) = engine_with_memory_backend().await; // 既存の補助関数
    engine.pause_for_update();
    assert!(engine.status().paused);
    assert!(engine.request(SyncReason::Saved));
    let report = engine.run_once(&*host).await;
    assert!(matches!(report.outcome, RunOutcome::NotRun));
    engine.resume();
    assert!(!engine.status().paused);
    let report = engine.run_once(&*host).await;
    assert!(!matches!(report.outcome, RunOutcome::NotRun));
}

#[tokio::test(start_paused = true)]
async fn wait_idle_waits_for_a_running_run_and_times_out() {
    let (engine, _host, _remote) = engine_with_memory_backend().await;
    let guard = engine.shared.running.lock().await; // 実行中のふり
    let waiter = {
        let e = engine.clone();
        tokio::spawn(async move { e.wait_idle(Duration::from_secs(60)).await })
    };
    tokio::time::advance(Duration::from_secs(10)).await;
    drop(guard);
    assert!(waiter.await.unwrap());
    let _guard = engine.shared.running.lock().await;
    assert!(!engine.wait_idle(Duration::from_secs(60)).await);
}
```

- [ ] **Step 2: 失敗を確かめる** — `cargo test --manifest-path src-tauri/Cargo.toml sync::engine::tests::a_request_while_paused` → `pause_for_update` が無い
- [ ] **Step 3: 実装**

```rust
// Inner に
/// Set while an app update is being prepared: no new run starts (requests are kept).
paused: bool,

// SyncStatusView に (off() でも false)
/// An update is being prepared: syncs wait until it ends or fails.
#[serde(skip_serializing_if = "std::ops::Not::not")]
pub paused: bool,

pub fn pause_for_update(&self) {
    let status = {
        let mut inner = self.lock();
        inner.paused = true;
        inner.status.paused = true;
        inner.status.clone()
    };
    self.publish(status); // 既存の、ロックの外で host に状態を送る関数名に合わせる
}

pub async fn wait_idle(&self, timeout: Duration) -> bool {
    tokio::time::timeout(timeout, self.shared.running.lock()).await.is_ok()
}

pub fn resume(&self) {
    let status = {
        let mut inner = self.lock();
        inner.paused = false;
        inner.status.paused = false;
        inner.status.clone()
    };
    self.publish(status);
    self.shared.wake.notify_one();
}
```

  `run` の先頭 (実行ロックを取る前) で `if self.lock().paused { return SyncReport::default(); }` (`NotRun`)。`run_loop` では `paused` の間 `take_due_run` を呼ばない (要求を消費しない) で `wake` を待つ。`set_backend` / `reset_records` が状態を `off()` から作り直すときも `paused` を引き継ぐ
- [ ] **Step 4: 通ることを確かめる** — `cargo test --manifest-path src-tauri/Cargo.toml sync::engine` → PASS
- [ ] **Step 5: TS とサイドバー** — `SyncStatusDto` に `paused?: true`。`syncText.ts` の文言関数で `paused` のとき「更新の準備中」(クリック不可)。既存 Story の初回描画は変えない
- [ ] **Step 6: Commit** — `feat(sync): pause the engine for an app update`

---

### Task 2: 更新の command (`commands/update.rs`)、プラグインと設定

**Files:**
- Create: `src-tauri/src/commands/update.rs`
- Create: `src-tauri/tests/fixtures/updater/` (テスト用の鍵と署名、Step 1 で作る)
- Modify: `src-tauri/Cargo.toml` (`[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]` に `tauri-plugin-updater = "2.14"`。dev に `tauri = { version = "2", features = ["test"] }` が要るか確かめる)
- Modify: `src-tauri/tauri.conf.json` (`plugins.updater`)
- Modify: `src-tauri/src/store/paths.rs` (`AppSettings.updates`)
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod update;`)
- Modify: `src-tauri/src/lib.rs` (プラグイン登録と command 登録、`#[cfg(desktop)]`)
- Modify: `src-tauri/src/commands/sync.rs` (`pub fn stop_for_update(app)` と `pub fn restart_after_failed_update(app)`)

**Interfaces:**
- Consumes: Task 1 の `pause_for_update` / `wait_idle` / `resume`、既存 `commands::sync::shutdown` 相当の処理と `start_if_logged_in`、`ProjectStore::held_projects()`
- Produces (TS は Task 3 が使う):
  - `UpdateSupport` = `"supported" | "dev" | "manual"`; `pub fn support(debug: bool, linux: bool, appimage: Option<&OsStr>) -> UpdateSupport`
  - `#[tauri::command] update_status() -> UpdateStatusDto { currentVersion: String, support: UpdateSupport, autoCheck: bool }`
  - `#[tauri::command] async update_check() -> Result<UpdateCheckDto, AppError>`; `UpdateCheckDto { available: bool, version?: String, notes?: String, date?: String }`
  - `#[tauri::command] async update_install() -> Result<(), AppError>`
  - `#[tauri::command] set_update_auto_check(enabled: bool) -> Result<(), AppError>`
  - イベント `update-progress`: `{ phase: "waitingSync" | "downloading" | "installing", received?: u64, total?: u64 }`
  - エラー文 (AppError の `message`、日本語): Offline 「更新を確かめられませんでした (ネットワークを確かめてください)」、Invalid 「更新ファイルを確かめられませんでした」、Busy 「同期が終わらないため、更新を中止しました。しばらくしてからもう一度お試しください」、Held 「Excel などで直した変更の確認が残っています。確認してからもう一度お試しください」、Download 「更新のダウンロードに失敗しました。データはそのままです」
  - `AppSettings.updates: UpdateSettings { auto_check: bool }` (`#[serde(default)]`、`auto_check` の既定 `true`、JSON は `updates.autoCheck`)

- [ ] **Step 1: テスト用の鍵と署名を作る** (秘密ではない、テスト専用)

```bash
cd src-tauri/tests/fixtures/updater
npx tauri signer generate --ci -p "" -w test.key
printf 'not really an app' > app.tar.gz
npx tauri signer sign -k test.key -p "" app.tar.gz   # app.tar.gz.sig ができる
```

  ファイルの冒頭に `README.md` を置き「テスト専用の鍵。配布物の署名には使わない」と書く。CLI のオプション名は `npx tauri signer generate --help` / `sign --help` で確かめる

- [ ] **Step 2: 失敗するテストを書く** (`update.rs` の `mod tests`)

```rust
#[test]
fn support_depends_on_the_build_and_the_appimage() {
    assert_eq!(support(true, false, None), UpdateSupport::Dev);
    assert_eq!(support(false, true, None), UpdateSupport::Manual);
    assert_eq!(support(false, true, Some(OsStr::new("/home/u/PowerToDo.AppImage"))), UpdateSupport::Supported);
    assert_eq!(support(false, false, None), UpdateSupport::Supported);
}

#[test]
fn auto_check_defaults_to_on_and_round_trips() {
    let old: AppSettings = serde_json::from_str("{}").unwrap();
    assert!(old.updates.auto_check);
    let mut s = old.clone();
    s.updates.auto_check = false;
    let text = serde_json::to_string(&s).unwrap();
    assert!(text.contains("\"autoCheck\":false"));
    let back: AppSettings = serde_json::from_str(&text).unwrap();
    assert!(!back.updates.auto_check);
}
```

  入れ替えの順番は trait 越しにテストする:

```rust
/// What `update_install` does around the download, so the order can be tested without an app.
trait Prep {
    fn pause(&self);
    async fn wait_idle(&self, timeout: Duration) -> bool;
    fn held(&self) -> Vec<String>;
    fn stop_sidecar(&self);
    fn resume(&self);
    fn restart_sidecar(&self);
}

async fn prepare(prep: &impl Prep, timeout: Duration) -> Result<(), AppError>;  // 停止、待ち、保留確認、サイドカー停止
fn undo(prep: &impl Prep);                                                        // resume + restart_sidecar

#[tokio::test(start_paused = true)]
async fn a_long_sync_aborts_the_update_and_resumes() {
    let prep = FakePrep::busy_forever();
    let err = prepare(&prep, Duration::from_secs(60)).await.unwrap_err();
    assert!(err.to_string().contains("同期が終わらない"));
    assert_eq!(prep.calls(), ["pause", "wait_idle", "resume"]);
}

#[tokio::test]
async fn a_held_project_blocks_the_update() {
    let prep = FakePrep::idle_with_held(&["仕事"]);
    let err = prepare(&prep, Duration::from_secs(60)).await.unwrap_err();
    assert!(err.to_string().contains("確認が残っています"));
    assert_eq!(prep.calls(), ["pause", "wait_idle", "held", "resume"]);
}

#[tokio::test]
async fn a_ready_app_stops_the_sidecar_last() {
    let prep = FakePrep::idle();
    prepare(&prep, Duration::from_secs(60)).await.unwrap();
    assert_eq!(prep.calls(), ["pause", "wait_idle", "held", "stop_sidecar"]);
}

#[test]
fn a_failed_install_restores_sync_and_sidecar() {
    let prep = FakePrep::idle();
    undo(&prep);
    assert_eq!(prep.calls(), ["resume", "restart_sidecar"]);
}
```

  updater の HTTP (wiremock、`tests/fixtures/updater` の鍵):

```rust
#[tokio::test]
async fn a_bad_signature_is_invalid() {
    // wiremock が latest.json (version 9.9.9、url は wiremock の app.tar.gz、signature はわざと別のファイルの .sig) を返す
    // tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().pubkey(TEST_PUBKEY).build())
    // app.updater_builder().endpoints(vec![url]).build() → check() は Some(update) → download() が署名エラー
    // → map_err で AppError の message が「更新ファイルを確かめられませんでした」
}
```

  `tauri::test` を使うには dev-dependencies で `tauri` に `test` feature が要る (`tauri-2.12.3/Cargo.toml` の `test = []`)。http の endpoint には `UpdaterBuilder` の insecure 設定 (config の `dangerous_insecure_transport_protocol`) が要るか確かめ、テストでだけ使う。`check` が返す版の比較、`download` の署名検証の挙動は `tauri-plugin-updater-2.14.0/src/updater.rs` を読んで確かめる (推測しない)

- [ ] **Step 3: 失敗を確かめる** — `cargo test --manifest-path src-tauri/Cargo.toml commands::update` → 未定義
- [ ] **Step 4: 実装**
  - `paths.rs`: `UpdateSettings { #[serde(default = "yes")] pub auto_check: bool }`、`impl Default` で `true`、`AppSettings` に `#[serde(default)] pub updates: UpdateSettings` (既定値なら書かない: `skip_serializing_if = "UpdateSettings::is_default"`)
  - `tauri.conf.json`: `"plugins": { "updater": { "pubkey": "<Task 0 の公開鍵>", "endpoints": ["https://github.com/kousuke-takeuchi/PowerToDo/releases/latest/download/latest.json"], "windows": { "installMode": "passive" } } }`
  - `lib.rs`: `#[cfg(desktop)] let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());` と command 4 つの登録 (`#[cfg(desktop)]` で囲めない `generate_handler!` の書き方は既存の desktop 専用 command に合わせる。無ければ iOS 用には空の実装を `#[cfg(not(desktop))]` で用意して `Invalid` を返す)
  - `update.rs`:
    - `support()` は純関数。`update_status` は `support(cfg!(debug_assertions), cfg!(target_os = "linux"), std::env::var_os("APPIMAGE").as_deref())`
    - `update_check`: `support != Supported` なら `available: false`。`app.updater()?.check().await` → `Some(u)` なら `Update` を `AppState` 内の `Mutex<Option<Update>>` (新しいフィールド `pending_update`) に入れて DTO を返す。エラーは `tauri_plugin_updater::Error` の種類で Offline / Invalid に分ける (種類の名前は `error.rs` で確かめる)
    - `update_install`: 保持した `Update` が無ければ `Invalid`「先に更新を確認してください」。`emit("update-progress", waitingSync)` → `prepare(&AppPrep(app), 60s)` → `u.download_and_install(on_chunk, on_finish)` (on_chunk は受信量を足し、250 ms 以上空けて `downloading` を送る。on_finish で `installing`) → 失敗なら `undo` して `Download` (署名エラーなら `Invalid`) → 成功なら macOS / Linux は `app.restart()`、Windows はプラグインが終わらせる
    - `AppPrep` は `Prep` の本物: `pause` / `wait_idle` / `resume` は `state.sync`、`held` は `state.store` の `held_projects()` (store が無ければ空)、`stop_sidecar` は `commands::sync::stop_for_update`、`restart_sidecar` は `commands::sync::restart_after_failed_update` (`start_if_logged_in` を `spawn_blocking` で)
    - `set_update_auto_check`: `settings_write` の順番で `AppSettings` を書く (`update_sync_settings` と同じ型の関数を `paths` 側か `mod.rs` に用意)
  - キーチェーン・秘密は扱わない。ログに URL や鍵を出さない
- [ ] **Step 5: 通ることを確かめる** — `cargo test --manifest-path src-tauri/Cargo.toml`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- [ ] **Step 6: Commit** — `feat(update): check and install app updates from Rust, pausing sync first`

---

### Task 3: 画面 (更新ダイアログ、設定「アップデート」ペイン、起動時の確認)

**Files:**
- Create: `src/views/UpdateDialog.tsx`、`src/views/UpdateDialog.stories.tsx`
- Create: `src/views/UpdatesPane.tsx`、`src/views/UpdatesPane.stories.tsx`
- Create: `src/app/useUpdates.ts`
- Modify: `src/api/client.ts` (`updateStatus`、`updateCheck`、`updateInstall`、`setUpdateAutoCheck`)、`src/api/events.ts` (`onUpdateProgress`)、`src/types/model.ts` (DTO)
- Modify: `src/views/SettingsDialog.tsx` (`SettingsPane` に `"updates"`、nav に「アップデート」)、`src/app/Main.tsx` (ダイアログと 5 秒後の確認)

**Interfaces:**
- Consumes: Task 2 の command / イベント / DTO (名前・camelCase はそのまま)
- Produces: `useUpdates(): { status, check(manual: boolean), install(), later(), offer, progress, error, setAutoCheck(b) }`

- [ ] **Step 1: 型と API** — `UpdateStatusDto { currentVersion: string; support: "supported" | "dev" | "manual"; autoCheck: boolean }`、`UpdateCheckDto { available: boolean; version?: string; notes?: string; date?: string }`、`UpdateProgress { phase: "waitingSync" | "downloading" | "installing"; received?: number; total?: number }`。client と events は既存の書き方 (invoke の名前、`listen` の解除) に合わせる
- [ ] **Step 2: `useUpdates`**
  - 起動時: `updateStatus()`。`support === "supported" && autoCheck` なら 5000 ms 後に `check(false)`
  - `check(manual)`: `updateCheck()`。`available` なら `offer` に入れる (同じ版を「あとで」にしていたら、`manual` のときだけ出す)。失敗は `manual` のときだけ `error` に入れる (自動のときは捨てる)
  - `install()`: busy の間は二重に押せない。`onUpdateProgress` を購読して `progress` を更新。失敗で `error`、`offer` は残す (もう一度押せる)
  - `later()`: `offer.version` を覚えて閉じる (state だけ。保存しない)
  - アンマウントでタイマーと購読を解除
- [ ] **Step 3: `UpdateDialog`** (既存のダイアログ部品とフォーカスの扱いに合わせる)
  - 見出し「新しいバージョンがあります」、`v{current} → v{new}`、更新内容 (`white-space: pre-wrap`、最大高さでスクロール)
  - 「今すぐ更新」/「あとで」。進行中: `waitingSync`「同期の完了を待っています…」、`downloading`「ダウンロード中 {pct}%」(`total` が無ければ「ダウンロード中 {MB} MB」)、`installing`「入れ替えています…」。進行中は Esc とボタンで閉じない
  - 失敗: エラー文と「データはそのままです」、「閉じる」
  - Windows (`navigator.userAgent` に `Windows`) では「インストーラーが開き、終わるとアプリがもう一度起動します」
  - 状態の文は `aria-live="polite"` (Task 7 of Phase 4 のやり方に合わせ、要素はマウントしたまま文だけ変える)
- [ ] **Step 4: `UpdatesPane`** — 「いまのバージョン v{currentVersion}」、スイッチ「起動時に更新を確認する」、ボタン「更新を確認」(busy 中は無効)。結果「最新です (v{current})」/ ダイアログ / エラー文。`dev`:「開発版のため更新を確認しません」(ボタン無効)。`manual`:「この入れ方では自動更新できません。release ページから入れ直してください」とリンク (`https://github.com/kousuke-takeuchi/PowerToDo/releases/latest` を opener で開く)
- [ ] **Step 5: Stories** — `Views/UpdateDialog`: `新しい版`、`同期待ち`、`ダウンロード中`、`失敗`。`Views/UpdatesPane`: `自動更新できる`、`最新です`、`確認失敗`、`開発版`、`手動`。props だけで描く (既存 Story と同じ `fn()` の書き方)。既存 Story の初回描画は変えない
- [ ] **Step 6: 確かめる** — `npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories`
- [ ] **Step 7: Commit** — `feat(ui): update dialog, updates settings pane and a check after launch`

---

### Task 4: リリース CI と README

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `README.md` (章「インストール」「自動更新」「リリースの手順」)
- Modify: `docs/superpowers/specs/2026-10-19-release-updater-design.md` (§9 に実装で決めたこと)

**Interfaces:**
- Consumes: Task 2 の `plugins.updater` (pubkey が入っていること)、`scripts/build-tailnet.mjs` (`TAURI_ENV_TARGET_TRIPLE` を読む)
- Produces: release に添付される 7 種 + 更新ファイル + `latest.json`

- [ ] **Step 1: `release.yml`** (MadakeCAD の形に、仕様 §2 の差分を入れる)

```yaml
name: Release
on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag of an existing published release to rebuild, e.g. v0.2.0"
        required: true
permissions:
  contents: write
concurrency:
  group: release-${{ github.event.release.tag_name || inputs.tag }}
  cancel-in-progress: false
jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.release.outputs.tag }}
      version: ${{ steps.release.outputs.version }}
      release_id: ${{ steps.release.outputs.release_id }}
    steps:
      - id: release
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.event.release.tag_name || inputs.tag }}
          RELEASE_ID: ${{ github.event.release.id }}
        run: |
          version="${TAG#v}"
          if ! [[ "$TAG" == v* && "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "::error::Release tag '$TAG' must look like v1.2.3 (numbers only). Use 'Set as a pre-release' for test builds."
            exit 1
          fi
          if [ -z "$RELEASE_ID" ]; then
            RELEASE_ID=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$TAG" --jq .id)
          fi
          { echo "tag=$TAG"; echo "version=$version"; echo "release_id=$RELEASE_ID"; } >> "$GITHUB_OUTPUT"
  bundle:
    name: Installers (${{ matrix.name }})
    needs: prepare
    strategy:
      fail-fast: false
      matrix:
        include:
          - { name: macOS Apple silicon, platform: macos-latest, target: aarch64-apple-darwin }
          - { name: macOS Intel, platform: macos-latest, target: x86_64-apple-darwin }
          - { name: Linux, platform: ubuntu-22.04, target: x86_64-unknown-linux-gnu }
          - { name: Windows, platform: windows-latest, target: x86_64-pc-windows-msvc }
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.prepare.outputs.tag }}
      - uses: actions/setup-node@v4
        with: { node-version: 26, cache: npm }
      - uses: actions/setup-go@v5
        with: { go-version-file: tailnet/go.mod, cache-dependency-path: tailnet/go.sum }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: "${{ matrix.target }}" }
      - name: Linux build dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
      - run: npm ci
      - run: go test ./...
        working-directory: tailnet
      # No Swatinem/rust-cache here: target/ holds the embedded OAuth values (spec section 2.2).
      - name: Stamp the version and updater artifacts (runner copy only)
        id: stamp
        shell: bash
        env:
          VERSION: ${{ needs.prepare.outputs.version }}
          HAS_SIGNING_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY != '' }}
        run: |
          node -e '
            const fs = require("fs");
            const path = "src-tauri/tauri.conf.json";
            const conf = JSON.parse(fs.readFileSync(path, "utf8"));
            conf.version = process.env.VERSION;
            const signing = process.env.HAS_SIGNING_KEY === "true";
            if (signing && !conf.plugins?.updater?.pubkey) {
              console.error("::error::plugins.updater.pubkey is empty"); process.exit(1);
            }
            if (!signing) console.log("::warning::TAURI_SIGNING_PRIVATE_KEY is not set: no update files");
            conf.bundle.createUpdaterArtifacts = signing;
            fs.writeFileSync(path, JSON.stringify(conf, null, 2) + "\n");
            fs.appendFileSync(process.env.GITHUB_OUTPUT, `updater=${signing}\n`);
          '
      - name: Google OAuth client (from a secret, never printed)
        shell: bash
        env:
          OAUTH_JSON: ${{ secrets.POWERTODO_GOOGLE_OAUTH_JSON_CONTENT }}
        run: |
          if [ -z "$OAUTH_JSON" ]; then
            echo "::warning::POWERTODO_GOOGLE_OAUTH_JSON_CONTENT is not set: building without Google Drive"
            exit 0
          fi
          f="$RUNNER_TEMP/google-oauth.json"
          umask 077
          printf '%s' "$OAUTH_JSON" > "$f"
          echo "POWERTODO_GOOGLE_OAUTH_JSON=$f" >> "$GITHUB_ENV"
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          releaseId: ${{ needs.prepare.outputs.release_id }}
          args: --target ${{ matrix.target }}
          retryAttempts: 1
          includeUpdaterJson: ${{ steps.stamp.outputs.updater == 'true' }}
          updaterJsonPreferNsis: true
```

  `tauri-action@v0` の入力名 (`releaseId`、`args`、`retryAttempts`、`includeUpdaterJson`、`updaterJsonPreferNsis`) は action の `action.yml` で確かめる (MadakeCAD で使えていることは確認済み)。`$RUNNER_TEMP` のパスを `GITHUB_ENV` に入れるのは値ではなくパスなので可。Windows でも `shell: bash` (Git Bash) で動くことを確かめる

- [ ] **Step 2: 検査** — `actionlint` があれば `actionlint .github/workflows/release.yml` (無ければ `npx --yes action-validator` などは使わず、報告に「未検査」と書く)
- [ ] **Step 3: README** — 仕様 §8 の 3 章。macOS: 「右クリック →「開く」」または `xattr -d com.apple.quarantine /Applications/PowerToDo.app`。Windows: SmartScreen の「詳細情報」→「実行」。Linux: `chmod +x PowerToDo_*.AppImage`、deb / rpm は自動更新なし。リリースの手順は仕様 §5 / §6 のとおり (秘密鍵をなくすと更新を届けられなくなる、も書く)
- [ ] **Step 4: 仕様 §9** — 設定に「一般」ペインが無いので「アップデート」ペインを新設した、など実装で決めたことを足す
- [ ] **Step 5: 最終確認** — `cd tailnet && /opt/homebrew/bin/go test ./...`、`npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories`、`cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings` (src-tauri)。`npm run tauri build -- --debug --bundles app` が通ること (OAuth の json なし、`-v` なし)
- [ ] **Step 6: Commit** — `ci: build installers and update files when a release is published`、`docs: install, updates and release steps`

---

## 手動チェックリスト (PR 本文。すべて未確認から)

- [ ] `v0.1.0` を公開: 4 ジョブが緑、7 種 + 更新ファイル + `latest.json` が添付される
- [ ] macOS (Apple シリコン): dmg から入れて README の手順で初回起動。Drive にログインできる
- [ ] macOS (Intel): Intel Mac があれば同じ確認
- [ ] Windows: SmartScreen を越えて入る。Drive にログインできる
- [ ] Linux: AppImage が起動する。deb で入れると設定に「手動」の案内
- [ ] `v0.1.1` を公開: `v0.1.0` を起動して 5 秒後にダイアログ、「今すぐ更新」で `v0.1.1` に再起動。macOS で更新後に警告が出ない
- [ ] 同期の途中で更新 → 「同期の完了を待っています…」のあと更新。Windows で更新後に `powertodo-tailnet` が残っていない
- [ ] 「起動時に更新を確認する」をオフ → 起動時に確認しない。「更新を確認」は動く

## Self-Review

- 仕様 §2 → Task 4。§3.1 / §3.2 → Task 2。§3.3 → Task 1 (+ Task 2 の `Prep`)。§4 → Task 3 (+ Task 1 のサイドバー)。§5 → Task 0。§6 / §8 → Task 4。§7 → 各 Task のテストと手動チェックリスト
- 仕様との差: 「一般ペイン」は存在しないので「アップデート」ペインを新設 (Task 4 Step 4 で §9 に記録)
- 名前の一貫性: `pause_for_update` / `wait_idle` / `resume`、`UpdateSupport`、`update_status` / `update_check` / `update_install` / `set_update_auto_check`、イベント `update-progress`、`updates.autoCheck`、`useUpdates`、`UpdateDialog`、`UpdatesPane`
