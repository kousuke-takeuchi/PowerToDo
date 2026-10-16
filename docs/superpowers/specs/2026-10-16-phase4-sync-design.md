# Phase 4: 同期 (Synology NAS via Tailscale・Google Drive)

作成日: 2026-10-16
前提: `2026-10-13-powertodo-overall-design.md` (§6 同期の概要)、`2026-10-14-phase2-views-design.md` (外部変更の監視・保留・自分の書き込み判定)、`2026-10-15-phase3-time-design.md` (スケジューラ、`fired.json` のフォルダ単位)、main のコード (PR #25 まで)。参考実装: `~/Documents/InfoDesk` (NAS + Tailscale + Google の同期)
状態: 会話で範囲合意済み。本ファイルのレビュー待ち。

## 1. 目的と範囲

ローカルのデータフォルダ (正本) を、Synology NAS か Google Drive のどちらか 1 つに鏡として同期し、別の PC でも同じタスクを使えるようにする。NAS へは、アプリに同梱した Tailscale (tsnet) 経由で WebDAV でつなぐ。各 PC に Tailscale アプリは要らない。

含むもの
- 共通の同期コア: ファイル単位の差分判定、競合コピー、`sync.json`、実行の直列化、状態の通知
- NAS: Tailscale サイドカー `powertodo-tailnet` (Go + tsnet、cgo なし、Windows / macOS / Linux) と WebDAV クライアント、パスワードの OS キーチェーン保存、「確かめる」、NAS 側の手順ガイド
- Google Drive: OAuth (PKCE + ループバック)、`drive.file` スコープ、Drive 上の `PowerToDo/` フォルダ、トークンの OS キーチェーン保存
- UI: 設定「同期」ペイン (D-09 / D-09c / D-09e / D-09f) の実データ化、サイドバーの同期状態 (D-09d)、競合の帯 (D-09b)、初回起動のステップ 2 (同期先の選択)
- CI: Go のセットアップとサイドカーのビルド (3 OS)

含まないもの
- モバイル (Phase 6)。同時に複数の同期先。競合の自動統合 (手で直す)。NAS の HTTPS (WireGuard の中なので HTTP)。Google Picker (既存の Drive フォルダを選ぶ UI)

成功基準
- PC-A でタスクを追加すると、5 秒後に NAS (または Drive) の xlsx が更新され、PC-B は 5 分以内 (または「今すぐ同期」で即時) に取り込む
- 両方の PC で同じプロジェクトを編集してから同期すると、新しい方が残り、もう一方が `<名前> (競合 yyyy-mm-dd hhmm).xlsx` として残り、帯が出る
- Tailscale にログインしていない状態から、設定の「Tailscale にログイン」→ ブラウザでログイン → 接続済み になる。NAS の URL・ユーザー・パスワードを入れて「確かめる」が通る
- 「Google でログイン」→ ブラウザで許可 → 同期できる。ログアウトでトークンが消える
- ネットが無いときは「オフライン」と出て、つながったら次の同期で追いつく。データは失われない
- `cargo test` が通る (差分判定、競合、`sync.json`、WebDAV と Drive のクライアントをモックサーバーで)。3 OS の CI でサイドカーがビルドされる

## 2. 構成

```
tailnet/                       Go モジュール (サイドカー)。main.go 1 本 + go.mod
scripts/build-tailnet.mjs      ターゲットごとにサイドカーをビルドし src-tauri/binaries/powertodo-tailnet-<target-triple>[.exe] に置く
src-tauri/src/
  sync/
    mod.rs           同期エンジン (純関数の判定 plan() と、実行 run_once())
    state.rs         sync.json (データフォルダ単位、app data dir)
    backend.rs       StorageBackend trait (list / download / upload / delete / move_to_archive)、MemoryBackend (テスト用)
    webdav.rs        WebDAV 実装 (reqwest + SOCKS5)
    gdrive.rs        Google Drive 実装 (reqwest)
    oauth.rs         Google OAuth (PKCE、ループバック、トークン更新)
    secrets.rs       OS キーチェーン (keyring crate)
    tailnet.rs       サイドカーの起動・監視・コマンド (stdin / stdout の JSON 行)
  commands/sync.rs   sync 系 command (commands/mod.rs が大きいので分ける)
src/
  app/useSync.ts     同期状態の購読、command 呼び出し
  views/SettingsDialog.tsx / SyncFields.tsx   同期ペインを実データに
  views/Onboarding.tsx                        ステップ 2
```

- 新しい依存 (Rust): `keyring` (3 OS のネイティブ保存)、`reqwest` に `socks` feature (既存の reqwest が無ければ追加: rustls)、`quick-xml` (PROPFIND)、`sha2`、`base64`、`url`、`rand` (PKCE)。バージョンは計画で crates.io を確認して固定する
- 新しい依存 (Go): `tailscale.com` (tsnet)。Go は 1.25 系を CI とローカルで固定する
- Tauri: サイドカーは `bundle.externalBin` で同梱。起動は `std::process::Command` (shell プラグインは使わない)。開発時は `src-tauri/binaries/` のものを使う

## 3. 同期コア

### 3.1 `sync.json`

app data dir の `sync.json`。`fired.json` と同じく、どのデータフォルダと、どの同期先のものかを持ち、違えば作り直す。

```json
{
  "dataDir": "/Users/…/data",
  "backend": "nas" | "gdrive",
  "remoteRoot": "http://nas:5005/powertodo/" | "<Drive folder id>",
  "lastSync": "2026-10-16T09:30:00",
  "files": {
    "受信トレイ.xlsx": { "remoteId": "…", "remoteVersion": "<etag or md5>", "remoteModified": "…", "localHash": "<sha256>" }
  }
}
```

- `remoteVersion`: WebDAV は `getetag` (無ければ `getlastmodified` + `getcontentlength`)、Drive は `md5Checksum`
- `localHash`: 前回の同期でそろえたときのローカルファイルの SHA-256

### 3.2 判定 (純関数 `plan(local, remote, state) -> Vec<Action>`)

対象はデータフォルダ直下の `*.xlsx` (Phase 2 の `adoptable_stem` と同じ基準 + `_PowerToDo.xlsx`)。`archive/`、ロックファイル、一時ファイル、競合コピー (`(競合 ` を含む名前) は対象外。

| ローカル (前回比) | リモート (前回比) | 動作 |
| --- | --- | --- |
| 変更あり | 変更なし | アップロード |
| 変更なし | 変更あり | ダウンロード |
| 変更あり | 変更あり | 競合 (§3.3) |
| 新規 (記録なし) | なし | アップロード |
| なし | 新規 (記録なし) | ダウンロード (プロジェクトとして取り込み) |
| 新規 | 新規 | 中身が同じ (ハッシュ一致) なら記録だけ、違えば競合 |
| 削除 (記録ありでローカルに無い) | 変更なし | リモートを `archive/` に移す |
| 変更なし | 削除 (記録ありでリモートに無い) | ローカルを `archive/` に移す (アプリの `delete_project` と同じ扱い) |
| 削除 | 変更あり | ダウンロード (リモートの変更を優先して復活) |
| 変更あり | 削除 | アップロード (ローカルの変更を優先して復活) |

- 「変更あり」: ローカルは SHA-256 が `localHash` と違う。リモートは `remoteVersion` が違う
- 保留中 (外部変更の帯が出ている) または未保存 (dirty) のプロジェクト、保存中のキーは、その回は飛ばす (次の回で同期)

### 3.3 競合

- 新しい方を採用する: ローカルはファイルの更新時刻、リモートは `remoteModified`。同時刻はリモートを採用
- 負けた側の内容を、データフォルダに `<名前> (競合 yyyy-mm-dd hhmm).xlsx` として保存し、リモートにも同じ名前でアップロードする (どちらの PC からも見える)。競合コピーは同期対象外なので、以後は動かない
- UI にイベント `sync-conflict { file, conflictFile }` → D-09b の帯 (「競合ファイルを開く」= データフォルダを開いてファイルを選択)

### 3.4 実行

- タイミング: 起動時 (同期先が設定済みで接続できるとき)、保存成功の 5 秒後、5 分ごと、「今すぐ同期」、Tailscale が「接続済み」になったとき
- 同時に 1 つだけ実行。実行中の要求は 1 回の再実行にまとめる (InfoDesk の `sync_once` と同じ)
- ダウンロードは: 一時ファイルに書いて rename → Phase 2 の `record_written` で自分の書き込みとして記録 → `reload_external` で読み直し → `project-changed { reason: "sync" }`。新しいファイルは Phase 2 の `adopt_new_file`
- アップロードは: ローカルファイルを読む前に、そのプロジェクトの保存待ちが無いことを確かめる。読んだ内容のハッシュを `localHash` に記録
- 1 ファイルの失敗は他を止めない。失敗はファイルごとに次の回で再試行
- ストアのロックは判定材料を集める間と、ダウンロード後の読み直しの間だけ取る。ネットワーク I/O の間はロックを持たない (Phase 2/3 のロック順序: store → saver / fired に `sync_state` を葉として追加)

### 3.5 状態

イベント `sync-status { state: "off" | "syncing" | "synced" | "offline" | "error", lastSynced?, message?, pending: number }`。サイドバー最下部の SyncStatus (Phase 0.5 の 5 状態) に出す。`error` はクリックで「今すぐ同期」。

- `offline`: 接続できない (Tailscale 未接続、ネット不通、タイムアウト)。データは失われず、次の回で追いつく
- `error`: 認証の失敗 (NAS のパスワード違い、Google のトークン失効)、容量不足、権限不足。認証の失敗は、設定を直すか「確かめる」が通るまで再試行しない (InfoDesk の `nas_rejected`)

## 4. NAS (Synology WebDAV + Tailscale)

### 4.1 サイドカー `powertodo-tailnet`

- Go + `tailscale.com/tsnet`。cgo を使わず (`CGO_ENABLED=0`) 3 OS 向けにビルドする。ホスト名 `powertodo-<OS>` (`powertodo-mac` / `powertodo-win` / `powertodo-linux`)、状態は `--dir <app data>/tailscale` (0700)
- 親から環境変数 `TS_NO_LOGS_NO_SUPPORT=true` を渡し、Tailscale へのログ送信を止める (InfoDesk の再 exec は不要)
- 親とは stdin / stdout の JSON 行でやりとりする。stdin が閉じたら終了する (親が落ちても残らない)

| 方向 | メッセージ |
| --- | --- |
| 子 → 親 | `{"type":"ready","proxy":"socks5h://<user>:<pass>@127.0.0.1:<port>"}` (`tsnet.Server.Loopback` の SOCKS5) |
| 子 → 親 | `{"type":"status","state":"stopped|needs_login|needs_approval|starting|running|failed","name":"…","ip":"100.x","loginUrl":"…","error":"…"}` (状態が変わるたび + 2 秒ごとの確認で変化があれば) |
| 親 → 子 | `{"cmd":"login"}` (対話ログインを開始。URL は次の status で届く) / `{"cmd":"logout"}` / `{"cmd":"resolve","id":1,"host":"nas"}` |
| 子 → 親 | `{"type":"resolved","id":1,"ip":"100.x.y.z"}` / `{"type":"resolved","id":1,"error":"not_in_tailnet"}` (ピア一覧で MagicDNS 名・FQDN・ホスト名・100.x を照合) |

- 起動条件: 同期先が NAS で、状態フォルダに過去のログインがあるとき (無ければ設定で「Tailscale にログイン」を押したとき)。勝手にログインページを開かない
- 30 秒たっても「接続済み」にならなければ、UI に「再試行」「Tailscale の状態を消す (ログインし直し)」を出す (InfoDesk と同じ)
- サイドカーが異常終了したら、5 秒あけて 3 回まで再起動。それでも駄目なら `failed`

### 4.2 WebDAV

- URL `http://<NAS 名>:5005/<フォルダ>/`。`https` は拒否 (100.x の IP に書き換えるので証明書が合わない)。ホストはサイドカーの `resolve` で tailnet のピーと確かめ、100.x の IP に書き換える。ピーでなければ「NAS が tailnet にありません」で拒否 (SOCKS5 は tailnet 外の宛先を普通の回線に出してしまうため)
- reqwest + `Proxy::all(socks5h://…)`、リダイレクトしない、接続 10 秒 / 読み取り 60 秒のタイムアウト
- メソッド: PROPFIND (Depth 1) で一覧と `getetag` / `getlastmodified` / `getcontentlength`、GET、PUT、DELETE、MOVE (`archive/` への移動)、MKCOL (`archive/` が無ければ)
- ファイル名は日本語を含むので URL エンコードする
- エラー: 401 → 認証の失敗、507 / 413 → 容量不足、403 → 権限不足、408 / 429 / 5xx / 通信エラー → オフライン扱いで再試行
- 「確かめる」: `powertodo-check-<uuid>.txt` を書き込み → 読み戻し → 削除
- 資格情報: ユーザー名は `settings.json` (app data)、パスワードは OS のキーチェーン (サービス `app.powertodo.nas`)

### 4.3 NAS 側の手順 (設定画面のガイドと README)

1. DSM のパッケージセンターで「WebDAV Server」を入れ、HTTP (5005) を有効にする
2. 共有フォルダ `powertodo` を作る
3. 専用ユーザーを作り、`powertodo` だけ読み書き可、他は アクセスなし
4. パッケージセンターで「Tailscale」を入れてログインし、NAS の名前を控える
5. アプリで NAS を選び、同じアカウントで Tailscale にログインし、`http://<NAS 名>:5005/powertodo/` とユーザー・パスワードを入れて「確かめる」

- Tailscale の管理画面で端末の承認が有効なら `powertodo-<OS>` を承認する。キーの有効期限が切れたらログインし直し

## 5. Google Drive

- OAuth: PKCE (S256) + ループバック `http://127.0.0.1:<空きポート>`、5 分でタイムアウト。スコープは `https://www.googleapis.com/auth/drive.file` だけ (メールアドレスを表示するなら `openid email` を足す: 設定画面の「ログイン中: user@example.com」に必要なので足す)
- クライアント ID / シークレット: git 管理外の `src-tauri/google-oauth.json` (Google の `{"installed": {...}}` 形式) を `build.rs` が読み、`cargo:rustc-env` で埋め込む (InfoDesk と同じ)。環境変数 `POWERTODO_GOOGLE_OAUTH_JSON` でパスを指定できる (worktree や CI 用)。ファイルが無いビルドでは Drive を「このビルドでは使えません」と表示する。`.gitignore` に入れ、`google-oauth.example.json` を置く
- トークン: リフレッシュトークンは OS のキーチェーン (サービス `app.powertodo.google`)、アクセストークンはメモリ
- Drive 上: 初回に `PowerToDo` フォルダを作る (既に `drive.file` で作ったものがあれば `appProperties.powertodo=root` で探して再利用)。xlsx はその直下、`archive` サブフォルダ。`drive.file` はアプリが作ったファイルだけ見えるので、ブラウザで手で置いた xlsx は見えない (README に書く)
- API: files.list (`q='<folder>' in parents and trashed=false`、fields に id, name, md5Checksum, modifiedTime)、files.get (`alt=media`)、files.create / update (multipart upload)、files.update (parents を変えて archive へ)
- エラー: 401 → トークン更新 → 失敗なら「ログインし直してください」(error)。403 rateLimit / 5xx → 再試行

### Google Cloud の設定 (オーナーの作業、README に手順)

- OAuth クライアント: 種類「デスクトップ アプリ」(済み)
- 同意画面 (Google Auth Platform): 「データアクセス」で `.../auth/drive.file` (と `openid`, `email`) を追加。「対象」で公開ステータスを「本番環境」にする (「テスト」のままだとリフレッシュトークンが 7 日で切れる)。`drive.file` は非機密のスコープなので審査は不要 (未確認アプリの警告は出ない想定。出たら README に追記)

## 6. UI

- 設定「同期」ペイン: 同期先のセグメント (Google Drive | Synology NAS | 同期しない)。切り替えは確認ダイアログ (「次の同期で全ファイルを送り直します」)
  - Google: 未ログイン (D-09) は「Google でログイン」。ログイン済み (D-09c) はアカウント、ログアウト、今すぐ同期、最終同期時刻
  - NAS: 未接続 (D-09e) は Tailscale の状態 (経過秒数、ログイン / 承認待ち / 再試行 / 状態を消す)、URL・ユーザー・パスワード、「確かめる」、「接続」、手順ガイド。接続済み (D-09f) は状態、今すぐ同期、切断
- サイドバー最下部: `sync-status` (D-09d)。オフ / 同期中 / 同期済み (時刻) / オフライン / エラー
- 競合の帯 (D-09b): `sync-conflict` で出る。「競合ファイルを開く」「閉じる」
- 初回起動のステップ 2: 同期先の選択 (後で設定からも変えられる)。NAS / Google を選んだら設定ペインと同じ部品で接続まで進める
- Storybook: 既存の D-09 系は初回描画を変えない (新しい props は全部 optional)

## 7. エラー処理

- 認証の失敗は再試行しない (§3.5)。容量不足 / 権限不足は error 表示で次の回にまた試す
- キーチェーンが使えない (Linux で Secret Service が無いなど): パスワード / トークンを保存できない旨を出し、そのセッションの間だけメモリに持つ (再起動でログインし直し)
- サイドカーが起動しない (バイナリ欠落、権限): NAS を `failed` にして理由を出す。Drive は影響を受けない
- 同期中にアプリを終了: 実行中のアップロード / ダウンロードは中断してよい (次回の判定でやり直せる)。`sync.json` は 1 ファイル終わるごとに保存

## 8. テスト

- `sync::plan` の表 (§3.2) の全行、競合の勝敗と命名、対象外のファイル名
- `sync.json` の読み書き、データフォルダ / 同期先が変わったら作り直し
- WebDAV: `wiremock` で PROPFIND / GET / PUT / DELETE / MOVE / エラーコードの対応付け、URL エンコード。tailnet 外の拒否は `resolve` を差し替えて
- Google: `wiremock` で list / download / upload / トークン更新 / 401 からの回復。OAuth のループバックは、受けたコードの交換までを単体で
- エンジン: `MemoryBackend` で 2 台の PC を模した同期 (A で変更 → 同期 → B で同期、両方変更 → 競合)
- サイドカー: Go 側はメッセージの組み立てと `resolve` の照合を `go test`。実際の tailnet と NAS は手動 (チェックリスト)
- CI: `actions/setup-go` で Go を入れ、`scripts/build-tailnet.mjs` でサイドカーをビルドしてから `cargo build`

## 9. 決定ログ

| 日付 | 決定 | 理由 |
| --- | --- | --- |
| 2026-10-16 | Phase 4 で NAS と Google Drive の両方を作る。同期コアを共通にし、NAS → Drive の順に実装 | WebDAV は外部の準備なしで同期コアを確かめられる |
| 2026-10-16 | NAS へは InfoDesk と同じく、アプリ同梱の Tailscale (tsnet) 経由の WebDAV でつなぐ | 各 PC に Tailscale アプリを入れず、ルーターのポートも開けない |
| 2026-10-16 | tsnet はアプリ内 (libtailscale) ではなく、同梱の Go サイドカーで動かす | `libtailscale` は socketpair と Unix ソケットの fd 受け渡しを使い Windows でビルドできない。cgo なしの Go プログラムなら 3 OS で同じ経路にできる |
| 2026-10-16 | サイドカーとの通信は stdin / stdout の JSON 行。ピーの照合もサイドカーが行う | LocalAPI を Rust から叩くより単純。stdin が閉じたら終了するので取り残されない |
| 2026-10-16 | 同期はファイル単位 (InfoDesk の ops ログ方式は使わない) | xlsx が正本で Excel でも編集する。ファイル単位で競合コピーを残す全体設計 §6 のまま |
| 2026-10-16 | 同期先は同時に 1 つ | 状態を単純に保つ。切り替えたら全ファイルを送り直す |
| 2026-10-16 | Google のクライアント ID / シークレットはビルド時に git 管理外のファイルから埋め込む | リポジトリが公開。デスクトップ用シークレットは秘密扱いされないが、公開リポジトリには置かない |
| 2026-10-16 | Drive は見える `PowerToDo/` フォルダ (`drive.file`) を使い、InfoDesk の `appDataFolder` は使わない | xlsx を Drive 上でも開けるようにする |
| 2026-10-16 | 秘密情報は `keyring` crate で 3 OS のキーチェーンに置く | InfoDesk は macOS 専用の security-framework。PowerToDo は 3 OS |
| 2026-10-16 | `sync.json` は app data dir に置き、データフォルダと同期先を持つ | `fired.json` と同じ方針。データフォルダ (同期される側) に端末ごとの状態を置かない |
| 2026-10-16 | `list` は完全な一覧か `Err` を返す。読めなかったローカルファイルは `skip` に入れ、`local` から外さない。最後の砦として、リモート一覧が空で `sync.json` に記録があれば `ArchiveLocal` を、ローカル一覧が空で記録があれば `ArchiveRemote` を出さない | 欠けたファイルは「削除」と読まれる。一覧の取りこぼしで全ファイルが archive に行くのを防ぐ |
| 2026-10-16 | 名前は NFC + 小文字で畳んで突き合わせる。畳んだ名前が同じで綴りが違うもの (片側内、両側間) は `NameClash` にして何もしない。Drive の同名重複は、記録の `remoteId` に合う 1 つを使い (他は無視)、記録がなければ `NameClash` | macOS / Windows は大文字小文字・正規化違いを同じファイルとして扱う。サーバー側は別ファイルにできるので、勝手に選ぶとデータを失う |
| 2026-10-16 | `受信トレイ.xlsx` と `_PowerToDo.xlsx` は削除を追わない: リモート削除はアップロード、ローカル削除はダウンロードで戻す | アプリが必ず作り直すファイル。削除を追うと archive と再作成を繰り返す |
| 2026-10-16 | 記録なしで両側にあり中身が違う (初回同期) は、時刻に関係なくリモートを採用して競合 | 新しい PC が既存のリモートを上書きしない |
| 2026-10-16 | 競合の時刻比較は秒に丸める | バックエンドとファイルシステムで精度が違う |
