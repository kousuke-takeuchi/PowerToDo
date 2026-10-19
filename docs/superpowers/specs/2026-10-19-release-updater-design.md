# Release: 配布 (リリース CI) と自動更新

作成日: 2026-10-19
前提: `2026-10-13-powertodo-overall-design.md`、`2026-10-16-phase4-sync-design.md` (§9 の OAuth の埋め込みと `-v` 禁止、サイドカー)、main のコード (PR #28 まで)
参考: MadakeCAD の `.github/workflows/release.yml` と updater (Tauri)、cocochan-pi-setup の更新ダイアログ (Electron、自作 updater) の画面の流れ
状態: 会話で設計合意済み。本ファイルのレビュー待ち。

## 1. 目的と範囲

GitHub で release を公開すると、CI が 3 OS のインストーラーを作って同じ release に添付する。入れたアプリは起動後に新しい版を見つけ、ダイアログから更新して再起動できる。

含むもの
- リリース CI: `release: published` と手動実行。macOS (Apple シリコン / Intel)、Windows、Linux の 4 ジョブ
- 配布物 7 種: macOS `.dmg` ×2、Windows NSIS `.exe` と `.msi`、Linux `.AppImage` `.deb` `.rpm`
- Tauri 公式 updater (`tauri-plugin-updater`) と minisign 署名の `latest.json`
- 更新の確認・ダウンロード・入れ替え・再起動を Rust 側で行う。始める前に同期の完了を待ち、サイドカーを止める
- 画面: 起動 5 秒後の自動確認、更新ダイアログ、設定「起動時に更新を確認する」と「更新を確認」ボタン
- 配布版にも Google OAuth を埋め込む (secret から)
- README: インストール、自動更新、リリース手順

含まないもの
- コード署名と公証 (macOS / Windows とも署名しない。§9)
- ベータ版のチャンネル (pre-release は配るが更新は届かない。§3.1)
- iOS (Phase 6。TestFlight で更新する)
- Linux の deb / rpm の自動更新 (手で入れ直す。案内だけ出す)

成功基準
- release `v0.1.0` を公開すると 30 分以内に 7 種のインストーラーと `latest.json` が添付される
- Mac で dmg を入れ、README の手順で初回起動できる。Drive にログインできる
- `v0.1.1` を公開すると、`v0.1.0` を起動して 5 秒後に更新ダイアログが出て、「今すぐ更新」で入れ替わり、`v0.1.1` で再起動する
- 同期の途中で「今すぐ更新」を押すと、同期が終わるまで待ってから更新する。Windows で更新後に `powertodo-tailnet` が残らない

## 2. リリース CI (`.github/workflows/release.yml`)

MadakeCAD の形をそのまま使い、PowerToDo の事情 (Go のサイドカー、OAuth の埋め込み) を足す。

### 2.1 起動と準備
- `on: release: types [published]` と `workflow_dispatch` (入力 `tag`: 既存の公開済み release を作り直す)
- `permissions: contents: write`、`concurrency: release-<tag>` (取り消さない)
- `prepare` ジョブ: タグが `v` + 数字だけの `X.Y.Z` か確かめる (`.msi` は数字以外の版を受け付けない)。手動実行なら `gh api repos/<repo>/releases/tags/<tag>` で release id を引く。出力 `tag` / `version` / `release_id`

### 2.2 ビルド (`bundle` ジョブ、`fail-fast: false`)

| 名前 | runner | target |
|---|---|---|
| macOS Apple silicon | `macos-latest` | `aarch64-apple-darwin` |
| macOS Intel | `macos-latest` | `x86_64-apple-darwin` |
| Linux | `ubuntu-22.04` (古い glibc で動く範囲を広げる) | `x86_64-unknown-linux-gnu` |
| Windows | `windows-latest` | `x86_64-pc-windows-msvc` |

手順
1. `actions/checkout@v4` (`ref: <tag>`)
2. `actions/setup-node@v4` (20、npm キャッシュ)、`actions/setup-go@v5` (`go-version-file: tailnet/go.mod`)、`dtolnay/rust-toolchain@stable` (`targets: <target>`)
3. Linux だけ: 既存 `ci.yml` と同じ `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` に、AppImage 用の `patchelf` を足す
4. `npm ci`、`cd tailnet && go test ./...`
5. 版の書き込み (runner の作業コピーだけ): `tauri.conf.json` の `version` = タグの数字。`TAURI_SIGNING_PRIVATE_KEY` があれば `bundle.createUpdaterArtifacts = true` (このとき `plugins.updater.pubkey` が空なら失敗させる)、無ければ警告を出して更新ファイルなしで作る
6. OAuth: secret `POWERTODO_GOOGLE_OAUTH_JSON_CONTENT` があれば `$RUNNER_TEMP` に権限 600 で書き出し、そのパスを `POWERTODO_GOOGLE_OAUTH_JSON` に入れる (中身は env にもログにも出さない。`echo` しない)。無ければ警告を出して Drive なしで作る
7. `tauri-apps/tauri-action@v0`: `releaseId`、`args: --target <target>` (全ジョブで渡す。`TAURI_ENV_TARGET_TRIPLE` でサイドカーも同じターゲットに作られる)、`retryAttempts: 1`、`includeUpdaterJson: <5 の結果>`、`updaterJsonPreferNsis: true`。env に `GITHUB_TOKEN`、`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

秘密を守るための決まり (Phase 4 §9 を引き継ぐ)
- `-v` / `-vv` を付けない (cargo が `rustc-env` の値を出す)
- release ジョブではキャッシュを保存しない (`Swatinem/rust-cache` を使わない。ビルドは遅くなるが、`target/` に埋め込み値が残るため)。`target/` をアップロードしない
- `ci.yml` (PR / main) には secret を渡さない。フォークからの PR は secret を読めないので、今のままで良い

### 2.3 添付されるもの
- tauri-action が release に付ける: `.dmg` ×2、`-setup.exe`、`.msi`、`.AppImage`、`.deb`、`.rpm`、更新用の `.app.tar.gz` / `.AppImage` / `-setup.exe` とその `.sig`、`latest.json`
- `latest.json` は全ジョブの分をまとめた 1 本 (tauri-action が release 上で更新する)

## 3. アプリの自動更新

### 3.1 構成
- `tauri-plugin-updater` 2.14 を `#[cfg(desktop)]` で登録 (iOS には入れない)。再起動は `AppHandle::restart` を使うので `tauri-plugin-process` は入れない (§9)
- `tauri.conf.json`: `plugins.updater.pubkey` (公開鍵、リポジトリに入れる)、`endpoints: ["https://github.com/kousuke-takeuchi/PowerToDo/releases/latest/download/latest.json"]`、`windows.installMode: "passive"`
- `releases/latest` は pre-release を飛ばすので、pre-release の版は更新として届かない (テスト用に配るだけ)
- 公開鍵が入っていないビルド (開発中) では updater を組み立てず、確認は「使えない」を返す
- 権限: Rust 側で呼ぶので JS 用の `updater:*` 権限は付けない (§9)

### 3.2 command (`src-tauri/src/commands/update.rs`)
- `update_status() -> UpdateStatusDto { currentVersion, support: "supported" | "dev" | "manual", autoCheck }`
  - `dev`: debug ビルド。確認しない
  - `manual`: Linux で AppImage から動いていない (`APPIMAGE` 環境変数が無い)。deb / rpm は release ページへ案内
  - `supported`: それ以外
- `update_check() -> UpdateCheckDto { available: bool, version?, notes?, date? }` — `app.updater()?.check()`。ネットワークの失敗は日本語の `UpdateError::Offline`、署名の検証失敗は `UpdateError::Invalid` (「更新ファイルを確かめられませんでした」)
- `update_install()` — 直前の `check` で得た `Update` を保持しておき、次の順で行う
  1. 状態イベント `update-progress { phase: "waitingSync" }`。同期エンジンに新しい実行をさせない印を立て、走っている同期の終了を待つ (最大 60 秒。過ぎたら `UpdateError::Busy` で中止し、印を外す)
  2. 書き込み待ちの保存が無いことを確かめる (Phase 1 / 2 の保存は command の中で終わる。外部変更の「保留」があれば中止して理由を返す)
  3. Tailscale のサイドカーを止める (`commands::sync::shutdown` と同じ処理)。Windows で実行中の exe が上書きを妨げないように
  4. `download_and_install(on_chunk, on_finish)`。`update-progress { phase: "downloading", received, total? }` を 250 ms 以上の間隔で送る。`phase: "installing"`
  5. macOS / Linux: `app.restart()`。Windows: インストーラーがアプリを終わらせる (プラグインが `on_before_exit` で `cleanup_before_exit` を呼ぶ)
  - 4 で失敗したら: 印を外し、サイドカーを元の条件で起動し直し、`UpdateError` を返す (データは何も変えていない)
- `set_update_auto_check { enabled }` — `settings.json` の `updates.autoCheck` (既定 `true`。古い設定ファイルに無ければ `true`)

### 3.3 同期エンジンとの境
- `SyncEngine` に `pause_for_update()` (新しい実行を始めない、要求は覚えておく) と `wait_idle(timeout)` を足す。`resume()` で戻す
- 更新のための停止中、サイドバーの状態は「更新の準備中」(`sync-status` の `paused: true`)

## 4. 画面

### 4.1 起動時の確認 (cocochan-pi-setup の流れ)
- 起動 5 秒後に 1 回、`support = supported` かつ `autoCheck` なら `update_check`
- 失敗 (オフライン等) は何も出さない。版が無ければ何も出さない
- 「あとで」を押した版は、そのプロセスの間はもう出さない (次の起動でまた確認する)

### 4.2 更新ダイアログ (`UpdateDialog`)
- 見出し「新しいバージョンがあります」、`v<current> → v<new>`、更新内容 (release の本文。Markdown はプレーンテキストで表示、長ければスクロール)
- ボタン「今すぐ更新」/「あとで」
- 進行中: 「同期の完了を待っています…」→「ダウンロード中 NN%」(総量が分からなければ「ダウンロード中 N MB」)→「入れ替えています…」。進行中は閉じられない
- 失敗: 日本語の理由と「閉じる」。データはそのまま、と一言添える
- Windows では「インストーラーが開き、終わるとアプリがもう一度起動します」と添える

### 4.3 設定
- 一般ペイン (実装では「アップデート」ペイン、§9) に「アップデート」欄: いまの版、「起動時に更新を確認する」スイッチ、「更新を確認」ボタン
- ボタンの結果: 「最新です (vX.Y.Z)」/ ダイアログ / エラー文
- `support = dev`: 「開発版のため更新を確認しません」。`manual`: 「この入れ方では自動更新できません。release ページから入れ直してください」とリンク (`opener`)

### 4.4 Storybook
- `Views/UpdateDialog`: 新しい版 / 同期待ち / ダウンロード中 / 失敗
- 設定の一般ペイン (実装では「アップデート」ペイン、§9): アップデート欄 (supported / dev / manual)
- 既存の Story の初回描画は変えない (新しい props は optional)

## 5. 事前準備 (所有者が 1 回だけ)

1. 署名鍵を作る: `npx tauri signer generate -w ~/.tauri/powertodo.key` (パスワードを付ける)
2. GitHub の Settings → Secrets and variables → Actions に登録
   - `TAURI_SIGNING_PRIVATE_KEY`: `~/.tauri/powertodo.key` の中身
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: 1 のパスワード
   - `POWERTODO_GOOGLE_OAUTH_JSON_CONTENT`: `src-tauri/google-oauth.json` の中身
3. 公開鍵 `~/.tauri/powertodo.key.pub` の中身を `plugins.updater.pubkey` に入れる (公開してよい値)
4. 秘密鍵をなくすと、入っているアプリに更新を届けられなくなる (新しい鍵の版は検証に通らない)。パスワード管理ツール等に控える

## 6. リリースの手順

1. main が CI 緑であること
2. GitHub → Releases → Draft a new release → タグ `vX.Y.Z` (新規、main から) → タイトルと更新内容 → Publish release (テスト用は「Set as a pre-release」)
3. Actions の Release が 4 ジョブとも緑になり、release に 7 種 + 更新ファイル + `latest.json` が付いたことを確かめる (20〜30 分)
4. 作り直し: Actions → Release → Run workflow → タグを入れる
- リポジトリの `tauri.conf.json` の `version` は開発用の値 (`0.1.0`) のまま。配布版の版はタグで決まる。アプリが表示する版も配布版ではタグの値になる

## 7. テスト

自動
- Rust: `support` の判定 (debug / `APPIMAGE` の有無を引数で渡す純関数)、`updates.autoCheck` の既定と往復、`pause_for_update` / `wait_idle` (実行中の同期を待つ、時間切れで `Busy` と印の解除、待つ間の要求を `resume` 後に実行)、更新失敗時の後始末 (印の解除、サイドカー再起動の要求)
- updater の HTTP は wiremock の `latest.json` を相手に `check` が版を返す / 署名不一致を `Invalid` にする (エンドポイントを差し替えられる作りにする)
- `actionlint` が入っていればワークフローを検査する

手動 (PR 本文のチェックリスト、すべて未確認から)
- `v0.1.0` で 7 種 + `latest.json` がそろう。4 ジョブが緑
- macOS (Apple シリコン): dmg から入れて README の手順で初回起動できる
- macOS (Intel): Intel Mac があれば同じ確認。無ければ未確認のまま残す
- Windows: SmartScreen の「詳細情報 → 実行」で入る。Drive にログインできる
- Linux: AppImage に `chmod +x` して起動。deb を入れると設定に「手動」の案内が出る
- `v0.1.1` を公開: `v0.1.0` を起動して 5 秒後にダイアログ、「今すぐ更新」で `v0.1.1` に再起動。macOS で更新後に Gatekeeper の警告が出ないか
- 同期の途中で更新 → 待ってから更新。Windows で更新後に `powertodo-tailnet` が残っていない
- 「起動時に更新を確認する」をオフにすると起動時に確認しない。「更新を確認」は動く

## 8. ドキュメント

README に章を足す
- 「インストール」: OS ごとの入れ方と警告の越え方 (macOS: 右クリック →「開く」または `xattr -d com.apple.quarantine /Applications/PowerToDo.app`、Windows: SmartScreen の「詳細情報 → 実行」、Linux: AppImage の `chmod +x`、deb / rpm)
- 「自動更新」: 起動時の確認、設定、deb / rpm は手動
- 「リリースの手順」: §5 と §6

## 9. 決定ログ

| 日付 | 決定 | 理由 |
|---|---|---|
| 2026-10-19 | リリース CI は MadakeCAD の `release.yml` の形 (`release: published` + 手動実行、タグから版、`tauri-action@v0`) | InfoDesk にはリリース CI が無かった。同じ Tauri で動いている形を使う |
| 2026-10-19 | 自動更新は Tauri 公式 updater。画面の流れは cocochan-pi-setup (5 秒後に確認、ダイアログ、進捗、再起動、作業中は更新しない) | 公開リポジトリなのでトークン不要。OS ごとの入れ替えを自作しなくてよい |
| 2026-10-19 | コード署名・公証はしない | 所有者の判断。代償: macOS の初回起動に右クリック →「開く」、Windows の SmartScreen 警告。README で案内 |
| 2026-10-19 | 配布物は 7 種 (dmg ×2、exe、msi、AppImage、deb、rpm) | MadakeCAD と同じ |
| 2026-10-19 | 配布版に Google OAuth を埋め込む。secret の中身を `$RUNNER_TEMP` に 600 で書き、パスを渡す。release ジョブはキャッシュを保存しない | Phase 4 §9 の「`-v` 禁止、`target/` を保存・アップロードしない」を守る |
| 2026-10-19 | 更新の確認と入れ替えは Rust の command で行う。JS の updater 権限は付けない | 同期の完了待ちとサイドカー停止を同じ場所で順番どおりにやるため。画面から直接入れ替えさせない |
| 2026-10-19 | `tauri-plugin-process` は使わず `AppHandle::restart` で再起動 | Rust 側で完結するので、プロセス操作の権限を画面に渡さない |
| 2026-10-19 | 「起動時に更新を確認する」(既定オン) と「更新を確認」ボタン。ベータのチャンネルは作らない | 所有者の選択 (B)。pre-release は `releases/latest` に載らないので更新は届かない |
| 2026-10-19 | Windows の更新は NSIS (`updaterJsonPreferNsis`)、`installMode: passive` | 管理者権限なしでユーザー単位の入れ替えができる |
| 2026-10-19 | 更新前にサイドカーを止める | Windows では実行中の exe があると入れ替えに失敗する。updater は Windows で `on_before_exit` (`cleanup_before_exit`) のあと `std::process::exit(0)` で終わる (`tauri-plugin-updater` 2.14.0 `updater.rs:1017-1050`) ので、アプリの `RunEvent::Exit` の終了処理は通らない |
| 2026-10-19 | 設定に「アップデート」ペインを新設する (§4.3 の「一般ペイン」は実装に存在しなかった)。左の一覧の項目は更新の仕組みを渡したときだけ出す | 一般ペインを足すより、更新の欄だけを持つペインの方が小さい。既存の Story の初回描画は変わらない |
| 2026-10-19 | `plugins.updater.requireSignedVersion: true`。署名にアプリの版を含め、検証側が版を確かめる | `latest.json` の版の数字だけを新しくして、古い版の署名つきファイルを新しい版として入れさせる差し替えを防ぐ (`tauri-plugin-updater` 2.14.0 `updater.rs:673-676`)。tauri-cli 2.12.2 は署名時に版を含める (`bundle.rs:312`)。`tauri-action@v0` は `npm run tauri` でプロジェクトの `@tauri-apps/cli` を使うので同じ署名になる |
| 2026-10-19 | 入れ替えの直前に、保存待ちの編集を書き出す (全 OS)。書き出せなければ更新を中止して元に戻す | Windows では入れ替えが成功するとプロセスが `RunEvent::Exit` を通らずに終わり、保存の仕組みが持つ編集が書かれない。macOS / Linux も同じ順にして、手順を OS で分けない。ダウンロードのあとに行い、待つあいだの編集も書く |
| 2026-10-19 | 更新の入れ替えは同時に 1 つだけ (Rust 側の排他)。実行中の `update_install` は拒否し、`update_check` は何も見つけなかったことにする。画面側も実行中は確認と「あとで」を受け付けない | 二重に押された入れ替えと、入れ替え中に確認が結果を書き戻すことを防ぐ。見つけた版の受け渡しと実行中の印は 1 つのロックで変える |
| 2026-10-19 | 自動 (起動時) で見つけた更新は、クイック追加 / 検索を開いているあいだと、文字を打てる欄にフォーカスがあるあいだ、出さずに待つ。閉じる / フォーカスが外れると 500 ms 置いて出す (待つあいだは 500 ms ごとにも見直す)。手動の確認はすぐ出す | 打っている最中にダイアログが割り込んで入力を奪うのを避ける。フォーカスごと欄が消えると `focusout` が来ないので、見直しも要る |
| 2026-10-19 | `update-progress` の購読が済むのを待ってから `update_install` を呼ぶ。待つ上限は 2 秒で、過ぎたら購読なしでも始める | 先に始めると最初の「同期の完了を待っています…」を取りこぼす。購読に失敗しても更新自体は止めない |
| 2026-10-19 | release の本文を `releaseBody` として `tauri-action` に渡す (`prepare` ジョブが API で読んで出力する) | `releaseId` だけを渡すと `latest.json` の `notes` が空になり、§4.2 の更新内容が出ない |
| 2026-10-19 | CI の Node は `ci.yml` に合わせて 26 (§2.2 の手順 2 の「20」は置き換え) | PR の CI で通っている版でリリースも作る |
| 2026-10-19 | `bundle` のあとに `verify` ジョブを足し、`latest.json` に 4 プラットフォームの url と署名がそろっているか確かめる。自動の再マージはしない | `tauri-action` は `latest.json` を読んで足して上げ直すだけで排他がなく、同時に終わった 2 つのジョブの片方の分が消えることがある。消えたら赤にして、足りないジョブの再実行を促す |
