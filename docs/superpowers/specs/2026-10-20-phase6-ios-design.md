# Phase 6: iPhone 版 (Tauri iOS、アプリ内 Tailscale、モバイル画面、ローカル通知、Google)

作成日: 2026-10-20
前提: `2026-10-13-powertodo-overall-design.md` (§9 Phase 6)、`2026-10-13-phase0-pen-design.md` (モバイル M-01〜M-07)、`2026-10-13-phase0.5-storybook-design.md` (モバイル部品)、`2026-10-15-phase3-time-design.md` (リマインダー)、`2026-10-16-phase4-sync-design.md` (同期、Tailscale、OAuth)、`2026-10-19-release-updater-design.md` (デスクトップ専用の updater)、main のコード (PR #31 まで)
調査: `docs/research/2026-10-19-ios-tailscale-research.md`、`docs/research/2026-10-19-ios-tailnet-spike.md` (試作。ブランチ `spike/ios-tailnet` は手元だけに残す)
参考: InfoDesk の iOS 版 (`~/Documents/InfoDesk/mobile`、Flutter) の運用の決まり (状態フォルダの扱い、ログインの開き方、同期のタイミング)
状態: 会話で設計合意済み。本ファイルのレビュー待ち。

## 1. 目的と範囲

所有者の iPhone (iOS) で PowerToDo を使えるようにする。デスクトップと同じ Rust の中身と React の画面部品を使い、NAS (アプリ内 Tailscale 経由の WebDAV) または Google Drive で同期する。TestFlight (内部テスト) で入れる。

含むもの
- Tauri 2 の iOS ターゲット (`src-tauri/gen/apple`)、デスクトップ専用機能の切り分け
- `tailnet/` の Go を iOS 用ライブラリ (c-archive) にしてアプリ内で動かす。回線切り替えと受け口の対策
- iOS 用キーチェーン (`keyring-core` + `apple-native-keyring-store`)
- データフォルダを Documents に固定し、「ファイル」アプリから見える
- 外部の変更 (iPhone の Excel など) を、前面に戻ったときと同期の前に検出
- モバイル画面: Phase 0 の M-01〜M-07 に合わせ、Phase 0.5 のモバイル部品を実データにつなぐ。スワイプで完了・日付、長押しメニュー、下部シート、引っ張って更新
- リマインダーのローカル通知 (近い順に 64 件を OS に予約)
- iPhone での Google ログイン (iOS 用 OAuth クライアント、`ASWebAuthenticationSession`)
- TestFlight へのアップロード手順、プライバシーマニフェスト
- CI に iOS 向けのコンパイル確認

含まないもの
- iPad 用の画面 (iPhone の画面がそのまま拡大されて動く)
- Android (後のフェーズ)
- 背面での同期 (BGTaskScheduler)
- iOS ビルドの CI での署名・アーカイブ・アップロード
- ダークモード (Phase 5)
- 外付けキーボードのショートカット

成功基準
- TestFlight から入れた PowerToDo で、NAS 同期 (Tailscale ログイン → NAS の「確かめる」→ 同期) ができ、デスクトップで追加したタスクが iPhone に、iPhone で追加したタスクがデスクトップに届く
- Wi-Fi ↔ モバイル回線の切り替えのあと、利用者が何もしなくても 1 分以内に同期が成功する。コントロールセンターを出して閉じたあとも同期できる
- 期限時刻付きのタスクのリマインダーが、アプリを閉じていても時刻に届く
- 「ファイル」アプリの「このiPhone内 → PowerToDo」に xlsx が見え、Excel で直した変更が前面に戻ると反映される
- Google でログインして Drive 同期ができる
- デスクトップの動作、テスト、CI は変わらない

## 2. iOS のビルドと骨組み

### 2.1 Tauri の iOS ターゲット
- `npx tauri ios init` 相当で `src-tauri/gen/apple` を作り、リポジトリに入れる (Xcode プロジェクト、`project.yml`、Info.plist、`Assets.xcassets`)
- iOS だけの設定は `src-tauri/tauri.ios.conf.json` (Tauri のプラットフォーム設定の上書き): `bundle.externalBin: []`、`bundle.iOS.minimumSystemVersion`、`bundle.iOS.frameworks` (必要なら)
- 最小 iOS バージョンは 16.0 (所有者の iPhone 13 mini で動く範囲で、`NWPathMonitor` と `ASWebAuthenticationSession` が使える)
- Bundle ID は `app.powertodo` (試作の自動署名で App ID は作成済み)

### 2.2 デスクトップ専用の切り分け
`#[cfg(desktop)]` (Tauri の cfg) で iOS ではビルドしない
- トレイ、単一インスタンス、終了メニュー、`unminimize`、自動更新 (updater)、Go サイドカーの起動・監視、フォルダ選択ダイアログ (`tauri-plugin-dialog` の folder picker)、`notify` のファイル監視
- TS 側は `isMobile` (iOS で真) で同じものを隠す。判定は Tauri の `platform()` (`@tauri-apps/plugin-os` は入れず、Rust の command `platform_info()` で返す)
- URL を開くのは `app.opener()` (プラグイン経由) に統一する。自由関数 `open_url` は iOS で失敗する (試作で確認)

### 2.3 Go の Tailscale ライブラリ
- `tailnet/mobile/` に c-archive 用の Go パッケージ (C API) を置く。`tailnet/protocol.go` などデスクトップのサイドカーと共有できる部分は共有し、サイドカー (`tailnet/main.go`) の動作は変えない
- C API (試作の形): `tn_start(state_dir, hostname)`、`tn_command(json)`、`tn_next_event()`、`tn_proxy_open()` → port、`tn_proxy_close()`、`tn_rebind()` (§3.3)、`tn_stop()`、`tn_free(ptr)`
- SOCKS5 は tsnet の `Loopback()` ではなく、自前の `socks5.Server` (tailscale.com の `net/socks5`) を `srv.Dial` につないで開閉する (tsnet の受け口は作り直せない。tailscale/tailscale#20060)
- `scripts/build-tailnet-ios.mjs` (または `tailnet/mobile/build-ios.sh`): `GOOS=ios GOARCH=arm64 CGO_ENABLED=1 -buildmode=c-archive`、clang のラッパーで `iphoneos` / `iphonesimulator` の SDK を切り替える。出力は `src-tauri/binaries/ios/<target>/libtailnet.a` (git 管理外)
- `build.rs` が `target_os = "ios"` のときだけ `libtailnet.a` をリンクする (シミュレーターは `target_abi = "sim"`)
- 状態フォルダは `Application Support/tailnet` (「ファイル」アプリからは見えない)、iCloud バックアップから外す (`isExcludedFromBackup`)。`TS_NO_LOGS_NO_SUPPORT` に相当する設定で Tailscale へのログ送信をしない
- ホスト名は `powertodo-ios`

### 2.4 署名とビルド
- Team ID は git 管理外の `src-tauri/gen/apple/Signing.xcconfig` (例は `Signing.example.xcconfig` をコミット)。`APPLE_DEVELOPMENT_TEAM` や `bundle.iOS.developmentTeam` は使わない (Tauri CLI が `project.pbxproj` に書き込み、コミットされる)
- この Mac では Node が Rosetta (x86_64) で動くため、iOS のビルドは arm64 の `cargo tauri` (tauri-cli 2.12.2) を使うスクリプト `scripts/ios-build.sh` 経由にする。シミュレーターのランタイムの版の不一致も同じスクリプトで回避する (試作の `scripts/ios-sim-build.sh` / `scripts/ios-device-build.sh` を整理して使う)
- README に「iPhone でビルドして入れる」手順 (シミュレーター、実機、TestFlight) を書く

### 2.5 TestFlight
- 手元で `xcodebuild archive` → `-exportArchive` (method `app-store-connect`) → `xcrun altool` または Xcode Organizer でアップロード。手順を README に書く
- `PrivacyInfo.xcprivacy` を同梱する。Go のランタイムと Rust が使う「理由の申告が必要な API」(ファイルの時刻 `stat` 系、`mach_absolute_time` 系の起動からの時間、`UserDefaults` を使うなら それも) を申告する。データ収集は「なし」
- `ITSAppUsesNonExemptEncryption` は Info.plist に書かない。最初のアップロードで App Store Connect の質問に所有者が答える (WireGuard と TLS を使う。判断は所有者)
- 内部テスターだけに配る (外部テスターは審査が要るので使わない)

### 2.6 CI
- `ci.yml` の macOS の Rust ジョブに、`rustup target add aarch64-apple-ios` と `cargo check --target aarch64-apple-ios --lib` を足す (Go の c-archive は作らない。`build.rs` は `libtailnet.a` が無ければリンクを省き、FFI は `cfg(tailnet_ffi)` で切る)
- 署名・アーカイブ・TestFlight は CI でやらない

## 3. iPhone での Tailscale と同期

### 3.1 Tailscale の切り替え
- `sync::tailnet` に iOS 用の実装を足す。デスクトップはサイドカーの `Tailnet`、iOS は `InProcTailnet` (FFI)。両方を `TailnetHandle` (状態、ログイン、ログアウト、状態を消す、`resolve`、`proxy_url`、`shutdown`) として扱い、`commands::sync` とエンジンは違いを知らない
- `TailnetStatusView` と `tailnet-status` イベントはデスクトップと同じ形。ログインの URL は、利用者がボタンを押したときだけ開く (InfoDesk と同じ)
- iOS ではサイドカーの再起動の方針 (3 回で `Failed`) の代わりに、`tn_start` の失敗を `Failed` にし、「再試行」で `tn_stop` → `tn_start`

### 3.2 SOCKS の受け口
- 背面に回っても自分から閉じない (試作では `Suspended` で閉じ、コントロールセンターの開閉で `Resumed` が来ずに閉じたままになった)
- 同期の実行の直前 (`run` の入口) に、受け口が生きているか確かめる (127.0.0.1 の受け口に接続できるか)。死んでいれば `tn_proxy_close` → `tn_proxy_open` で開き直し、ポートが変わったら WebDAV のバックエンドを作り直す (`attach_if_current` の流れ)
- iOS が受け口を取り上げても、次の同期で自然に直る

### 3.3 回線の切り替え
- 小さな Swift の Tauri プラグイン `tauri-plugin-powertodo-ios` (リポジトリ内、`src-tauri/plugins/ios/`) に `NWPathMonitor` を置き、回線の変化 (利用できる回線の種類と `status` の変化) を Rust へイベントで送る
- 変化を受けたら Go に知らせる (`tn_rebind`)。tsnet に回線の変化を通知する手段 (`netmon` へのイベントの注入など) があるかは実装で確かめる。無ければ `tn_rebind` は node を作り直す (`tn_stop` → `tn_start`。ログイン状態は状態フォルダに残る)
- 同期の自動再試行: 回線の変化か前面への復帰から 30 秒以内に `Offline` で失敗した同期は、5 秒後と 15 秒後にもう一度要求する (`SyncReason::Retry` とは別の理由 `SyncReason::Network`)。それでも失敗すれば通常の「オフライン」表示
- 長い背面のあとに Tailscale が一時的に `failed` になる (試作で見た制御サーバーへの接続のタイムアウト) のも、`running` に戻るのを 10 秒待ってから表示を変える

### 3.4 同期のタイミング
- 起動時、前面に戻ったとき (`RunEvent::Resumed`)、引っ張って更新、保存の 5 秒後、前面にいる間の 5 分ごと (デスクトップと同じ)
- 背面での同期はしない。背面に回るとき (`RunEvent::Suspended` 相当) に保存待ちがあれば書き出す (`flush_all`)
- 同期の実行中に背面に回ったら、iOS の短い猶予の間に終わる前提で止めない (ファイル単位の書き込みは原子的)

### 3.5 キーチェーン
- `sync::secrets` の `SecretStore` はそのまま。iOS では `KeyringStore` の中身を `keyring-core` + `apple-native-keyring-store` (`protected` 機能) に切り替える。デスクトップは `keyring` 4.2 `v1` のまま
- 項目は端末の中だけ (iCloud キーチェーンに同期しない、`ThisDeviceOnly` 相当)。使えないときは今と同じくメモリに置き、`passwordPersistent: false`
- crate の版と API は実装で確かめる (調査では `keyring` 4.2 `v1` は iOS でコンパイルできない)

### 3.6 データフォルダ
- iOS では `Documents/` をデータフォルダに固定する。`settings.json` に `dataDir` が無ければ自動で設定する (試作と同じ流れ)。データフォルダの切り替えと初回起動の「保存先」ステップは iOS では出さない
- Info.plist に `UIFileSharingEnabled = YES`、`LSSupportsOpeningDocumentsInPlace = YES`。「ファイル」アプリの「このiPhone内 → PowerToDo」に見える
- アプリの内部データ (`settings.json`、`sync.json`、`fired.json`、tailnet の状態、復旧用コピー) は `Application Support` (見えない場所) に置く。`archive/` はデータフォルダの中 (デスクトップと同じ)

### 3.7 外部の変更
- iOS ではファイルの監視 (`notify`) を使わない
- 前面に戻ったときと同期の前に、データフォルダの xlsx の (大きさ、更新時刻) を Phase 2 の記録と比べ、変わったものを `reload_external` の流れで取り込む (保留・未保存の扱いはデスクトップと同じ)

## 4. iPhone の画面

### 4.1 土台
- iOS では `MobileShell` を出す (デスクトップの `AppShell` は今のまま)。Phase 0.5 のモバイル部品 (`src/views/mobile/` の `MobileShell` / `Drawer` / `MobileProjectView` / `MobileToday` / `MobileUpcoming` / `MobileTaskDetail` / `MobileQuickAddSheet` / `MobileSettings`、`src/components/TabBar` / `MobileHeader`) を、デスクトップと同じフック (`useAppState`、`useProject`、`useProjectActions`、`useCrossViews`、`useQuickAdd`、`useSync`、`useReminders`、`useSearch` など) につなぐ
- 新しい props は optional にし、既存の M-01〜M-07 の Story の初回描画は変えない

### 4.2 画面 (Phase 0 の M-01〜M-07)
- 下部タブ: 今日 / 近日 / 検索 / 一覧。一覧はドロワー (M-06) を開く
- M-01 プロジェクト: 一覧、セクション、サブタスク。右下の追加ボタン。行を右にスワイプで完了、左にスワイプで日付の下部シート。長押しでメニュー (日付・優先度・移動・削除)
- M-02 クイック追加 (下部シート): キーボードの上にツールバー (日付 / 優先度 / ラベル / リマインダー)。構文はデスクトップのクイック追加と同じ (`useQuickAdd`)
- M-03 タスク詳細 (全画面): 戻る、各項目はタップで下部シート
- M-04 今日、M-05 近日 (週カレンダーの帯は横スクロール)
- M-06 ドロワー: 受信トレイ / 今日 / 近日 / ラベル / プロジェクト一覧 / 設定
- M-07 設定: 同期 (NAS / Google / 同期しない、Tailscale、確かめる、切断)、通知、表示名、「『ファイル』アプリで見る」の案内。デスクトップの同期ペインの中身 (`SyncPane` の部品) を縦長の幅で使う
- 同期の状態: ヘッダーに出し、タップで今すぐ同期。一覧を引っ張って更新でも同期。競合・エラー・片側が空に見えるときの帯は、デスクトップと同じ文言をモバイルの幅で出す

### 4.3 ジェスチャーと表示
- スワイプは pointer イベントで実装する (横方向の移動が一定以上で発動、縦スクロールと競合しないよう、最初の移動の向きで決める)。発動は指を離したとき。motion で戻す
- 長押しは 500 ms。iOS の文字選択と被らないよう、行では `user-select: none` と `-webkit-touch-callout: none`
- セーフエリア (`env(safe-area-inset-*)`) を守る。`viewport-fit=cover`
- 入力欄は 16px 以上 (iOS が拡大しないように)

### 4.4 Storybook
- `Screens/Mobile` に、データ入り、スワイプ中、長押しメニュー、下部シートを開いた状態の Story を足す。既存の M-01〜M-07 の初回描画は変えない

## 5. リマインダーの通知 (iOS)
- デスクトップは Rust のスケジューラが時刻に通知を出す。iOS ではスケジューラの代わりに、未来の発火予定のうち近い順に 64 件を `tauri-plugin-notification` の予約通知 (`Schedule::At`) で OS に登録する
- 登録し直すきっかけ: タスクの編集、同期で取り込んだ変更、起動、前面への復帰、通知の許可が変わったとき。前回登録した分を消してから登録する (id はタスクとリマインダーから決まる数値)
- 通知のタップでそのタスクを開く。「完了」「後で (10 分)」の操作ボタンは、プラグインが iOS で対応していれば付ける (デスクトップと同じ action type)。対応していなければタップで開くだけ。実装で確かめる
- アプリを閉じている間に OS が出した通知は発火済みとして扱い、起動時の「まとめ」で重ねて出さない (`fired.json` に予約した時刻が過ぎたものを発火済みとして記録)
- 通知の許可は、初めてリマインダーが登録されるときに求める。拒否されていれば設定に案内を出す
- アプリ内の「リマインダー」帯 (Phase 3) は iOS でも前面にいる間は出す

## 6. iPhone での Google ログイン
- iOS 用の OAuth クライアント (Google Cloud の同じプロジェクト、種類 iOS、Bundle ID `app.powertodo`)。クライアントシークレットは無い
- リダイレクトは `com.googleusercontent.apps.<クライアント ID の数字部分>:/oauthredirect`。Info.plist の URL スキームへの登録は要らない (`callbackURLScheme` で足りる。§9 の決定ログ)
- ログイン画面は `ASWebAuthenticationSession` で開く (§3.3 の Swift プラグインに入れる)。戻ってきた URL を Rust に渡し、PKCE と `state` の確認、コードの交換、トークンの扱いは Phase 4 の `oauth.rs` を使う (ループバックの受け口の代わりにこの URL を受け取る経路を足す。秘密が無いときはトークン交換で送らない)
- クライアント ID は、デスクトップと同じく git 管理外のファイルからビルド時に埋め込む (`POWERTODO_GOOGLE_IOS_OAUTH_PLIST` = Google からダウンロードした plist のパス、無ければ `src-tauri/google-oauth-ios.plist`)。リダイレクトの URL もこの値から作る (値はコミットしない)
- 無ければ「このビルドでは Google Drive を使えません」(デスクトップと同じ)
- Drive の同期 (`gdrive.rs`) はデスクトップと同じ

## 7. テスト

自動
- Rust: 通知の 64 件の選び方 (近い順、過去は除く、同時刻の順序が決まる)、`SyncReason::Network` の再試行の時刻、受け口の生存確認と開き直し (偽の受け口で)、iOS でデータフォルダが Documents に決まること (パスの関数)、キーチェーンの切り替え (`MemoryStore` で)、外部変更の比較 (既存の Phase 2 のテストに iOS の経路を足す)、OAuth のリダイレクト URL の受け取り (state の不一致を拒否)
- デスクトップの既存テストはすべて通る。`cargo check --target aarch64-apple-ios --lib` が通る
- Storybook: 新しいモバイル Story、`check:stories`
- シミュレーター: 起動して、データ入りのモバイル画面が出る (スクリーンショット)

手動 (PR 本文のチェックリスト、すべて未確認から)
- TestFlight から入る。初回起動で保存先を聞かれず、空の受信トレイが出る
- Tailscale ログイン → NAS「確かめる」→ 同期。デスクトップとの往復
- Wi-Fi → モバイル回線 → Wi-Fi で、何もしなくても 1 分以内に同期が成功する
- コントロールセンターを出して閉じたあとの同期
- 背面 10 分、60 分のあとの同期
- アプリを閉じた状態でリマインダーが時刻に届く。タップでタスクが開く
- 「ファイル」アプリで xlsx が見え、iPhone の Excel で直した変更が前面に戻ると反映される
- Google ログイン → Drive 同期 → ログアウト
- スワイプで完了・日付、長押しメニュー、クイック追加のシート、タスク詳細
- 通知を拒否したときの案内、キーチェーンが使えないときの表示

## 8. 所有者の作業
1. App Store Connect に PowerToDo を登録する (Bundle ID `app.powertodo`)。TestFlight の内部テスターに自分を入れる
2. Google Cloud の同じプロジェクトに iOS 用の OAuth クライアント (Bundle ID `app.powertodo`) を作り、plist をダウンロードして、案内する git 管理外の場所に置く
3. 最初のアップロードで、暗号の輸出規制の質問に答える

## 9. 決定ログ

| 日付 | 決定 | 理由 |
|---|---|---|
| 2026-10-19 | iOS を先に、所有者の iPhone だけ。Android は後 | 所有者の選択 |
| 2026-10-19 | 配布は Apple Developer Program (有料) と TestFlight の内部テスト | 所有者の選択。署名の期限が 1 年、ケーブル不要 |
| 2026-10-19 | NAS へは、アプリの中に Tailscale を組み込む (公式アプリや Network Extension は使わない) | 所有者の選択。公式の Tailscale アプリを併用する案は退けられた |
| 2026-10-19 | Tauri の iOS ビルドに InfoDesk のやり方を取り入れる (Flutter の別アプリにはしない) | Rust の中身と React の部品をそのまま使える。InfoDesk の iOS 版は Flutter で、Tailscale は Dart パッケージ (fd を使う HTTP クライアント) |
| 2026-10-19 | Tailscale は自前の `tailnet/` Go を iOS 用 c-archive にする (libtailscale は使わない) | 受け口を自分で開閉でき、iOS が受け口を取り上げる問題 (tailscale/tailscale#20060) を避けられる。Go の c-archive は 1 つのアプリに 2 つ入れられない (重複シンボル) ので、どちらか一方 |
| 2026-10-19 | 試作で確認: シミュレーターと実機で、ログイン、起動し直しでのログイン維持、WebDAV の読み書き (約 0.4 秒)、背面 1 分・10 分からの復帰は成功。Wi-Fi → モバイル回線は失敗、コントロールセンターの開閉で受け口が閉じたまま | `docs/research/2026-10-19-ios-tailnet-spike.md` |
| 2026-10-19 | Google Drive も Phase 6 に入れる | 所有者の選択 |
| 2026-10-20 | 画面は Phase 0 のモバイル設計に合わせて組み直す (M-01〜M-07、スワイプ、長押し) | 所有者の選択。デスクトップの画面を縮めたものはスマホで使いにくい |
| 2026-10-20 | リマインダーはローカル通知で近い順に 64 件を予約 | 所有者の選択。iOS の予約通知の上限は 64 |
| 2026-10-20 | データフォルダは Documents に固定し「ファイル」アプリから見える | 所有者の選択。iOS にはフォルダ選択が無い (試作で初回設定から進めなかった) |
| 2026-10-20 | iPhone だけ。iPad 用の画面は作らない | 所有者の選択 |
| 2026-10-20 | Phase 6 は分けずに 1 フェーズで進める | 所有者の選択 (6a / 6b に分ける案は退けられた) |
| 2026-10-20 | 受け口は背面で閉じず、同期の直前に生存を確かめて開き直す | 試作で `Suspended` と `Resumed` が対にならず閉じたままになった |
| 2026-10-20 | 回線の変化は `NWPathMonitor` で検知して tailnet に知らせ、30 秒以内の `Offline` は 5 秒後・15 秒後に再試行 | 試作で Wi-Fi → モバイル回線のあと失敗。原因 (つなぎ直しの遅れか、変化に気づかないか) は未確定なので、どちらにも効く形にする |
| 2026-10-20 | 背面での同期 (BGTask) はしない | InfoDesk と同じ。iOS の制約と電池 |
| 2026-10-20 | 署名の Team ID は git 管理外の `Signing.xcconfig`。環境変数や `bundle.iOS.developmentTeam` は使わない | Tauri CLI が `project.pbxproj` に書き込みコミットされる (試作で Tauri のソースから確認) |
| 2026-10-20 | iOS のビルドは arm64 の `cargo tauri` を使うスクリプト経由 | この Mac の Node が Rosetta で、Tauri CLI が x86_64 のシミュレーター向けを作る (試作で確認) |
| 2026-10-20 | iOS では URL を `app.opener()` で開く | 自由関数 `open_url` が iOS で `os error 2` (試作で確認) |
| 2026-10-20 | iOS の CI はコンパイル確認だけ。署名・アップロードは手元 | 署名の秘密を CI に置かない。所有者 1 人の内部テスト |
| 2026-10-20 | Google ログインは `ASWebAuthenticationSession` (Safari + ディープリンクではなく) | アプリ内で完結し、戻りの URL を確実に受け取れる。回線監視と同じ Swift プラグインに入れる |
| 2026-10-20 | iOS の Tailscale の状態フォルダは `<アプリのデータ>/tailscale` (デスクトップと同じ `tailnet::state_dir`)。試作の `Library/Application Support/tailnet` とは別で、試作でログインした状態は引き継がない。作成時にバックアップから除外する | `has_tailnet_login` (起動時にログイン済みかの判定) を共有するため。復元した別の端末にノード鍵が複製されないようにする |
| 2026-10-20 | iOS のデータフォルダ (`Documents`) の絶対パスがアプリの更新・再インストールで変わったら (保存した `dataDir` も今のも `…/Containers/Data/Application/<id>/Documents`)、`sync.json` と `fired.json` の `dataDir` を新しいパスに書き換えて引き継ぐ。それ以外のフォルダの組み合わせは今までどおり新規 | iOS はコンテナの UUID を保証しない。引き継がないと更新のたびに同期の基準の記録が消え、競合コピーや全件アップロードになり、通知も再発火する。iOS にフォルダ選択はないので、パスの変化は利用者の選択ではない |
| 2026-10-20 | iOS の Info.plist に URL スキーム (`CFBundleURLTypes`) は登録しない。`GoogleOAuth.xcconfig` も作らない。§6 の「URL スキームに登録する」「`Info.plist` へはビルド時に書く」は取り下げ | `ASWebAuthenticationSession` の `callbackURLScheme` は Info.plist への登録が要らない (Xcode 27 SDK の `ASWebAuthenticationSession.h:47-48` で確認)。アプリが受けるのはシートが返す URL だけ |
| 2026-10-21 | Go の iOS 用ライブラリは `tailnet/mobile/` の別パッケージではなく、同じ `package main` をビルドタグ (`//go:build ios` / `!ios`) で分ける。共有する処理は `send` を引数に取る形で `shared.go` に置く | シンボリックリンクを避け、デスクトップのサイドカーと処理を共有する。サイドカーの出力は変えない |
| 2026-10-21 | `tn_rebind` は tsnet の `Sys().NetMon.GetOK()` で取った netmon の `InjectEvent()` (ノードは作り直さない)。受け口は前と同じポートで開き直すのを先に試す | tailscale.com v1.104.1 `tsnet/tsnet.go:2285`、`net/netmon/netmon.go:544`。同じポートなら WebDAV のバックエンドを作り直さずに済む |
| 2026-10-21 | iOS の前面・背面は `RunEvent::WindowEvent { Resumed / Suspended }` で受ける。起動直後の 1 回目の `Resumed` は無視する | `RunEvent::Resumed` はイベントループの再開で前面とは別 (tauri-runtime-wry)。tao は起動直後にも `Resumed` を出す |
| 2026-10-21 | 前面に戻ったときと回線の変化でも 30 秒の再試行の窓を開く (5 秒後・15 秒後の 2 回) | 仕様 §3.3 のとおり。長い背面のあとの一時的な失敗もここで拾う |
| 2026-10-21 | 通知の extra はすべての OS で文字列にそろえる。操作ボタンの `no` は文字列でも数値でも読む | tauri-plugin-notification 2.7.0 の iOS 側は `extra: [String: String]` (`NotificationPlugin.swift:69`)。数値だと予約そのものが失敗する。デスクトップの通知センターに残る古い通知のため数値も読む |
| 2026-10-21 | iOS ではアプリから通知を出さない (OS の予約に任せる)。アプリ内の帯は前面の確認 (30 秒ごと) で出す | 予約と二重にしないため |
| 2026-10-21 | 予約の登録し直しは、30 秒ごとの確認で予約の中身 (id・時刻・タイトルと本文の指紋) を比べ、違えば消して登録し直す。背面に回るときにも 1 回確認する | 仕様 §5 の個々のきっかけ (編集・同期・起動・復帰・許可の変化) をまとめて満たす。タイトルの編集も指紋で拾う |
| 2026-10-21 | 「アプリが離れていた」は、前回の確認から 2 周期 (60 秒) 以上空いたかで決め、そのときに予約済みで時刻を過ぎたものを発火済みにする | 背面からの復帰の合図と 30 秒の確認の順番に頼らない。OS が出した通知を帯で二重に出さない |
| 2026-10-21 | クイック追加のツールバーの「リマインダー」は `!` を足さず、リマインダーのシートで選んで、追加の直後に `updateTask` で付ける。`quick_add` の結果に新しいタスクの `no` を足す | クイック追加の構文にリマインダーは無い (`domain/quick_add.rs`)。`no` は追加のたびに既存の最大より大きい (`next_no_for` と `high_water`) |
| 2026-10-21 | 日付のシートでは、カレンダーの時刻・繰り返しの行と早見の行を出さない (早見の 5 行はシート側に 1 回だけ)。繰り返しはタスク詳細で編集する | シートにはタスクの繰り返しが渡らず、既定の表示が誤解を招く。早見の計算は `src/views/quickDates.ts` で共有 |
| 2026-10-21 | 帯はヘッダーと一覧の間に流して置く (重ねない)。帯の領域は画面の 40% まで、超えたらスクロール | 重ねると一覧の先頭の行が帯の下に隠れて触れなくなる |
| 2026-10-21 | 引っ張って更新は touch イベント (passive) で測る。`touchcancel` はそこまでの引きで離したものとして扱う | iOS の touch はネイティブのスクロールが始まると `pointercancel` になり、pointer イベントでは引きが離すところまで届かない |
| 2026-10-21 | プライバシーマニフェストの申告: ファイルの時刻 (C617.1: `stat` / `fstat` / `fstatat` / `lstat`、`NSFileModificationDate`)、起動からの時間 (35F9.1: `mach_absolute_time`)、ディスクの空き (E174.1: `fstatfs` / `fstatvfs`)。`UserDefaults` は使っていない。データ収集・トラッキングはなし | シミュレーター用のデバッグビルドの未解決シンボル (`nm -u PowerToDo.debug.dylib`) から。理由コードは Apple の "Describing use of required reason API" の分類。最初のアップロードで App Store Connect の検査に通るかを確かめる |
| 2026-10-21 | Xcode のプロジェクトは `xcodegen generate` で `project.yml` から作り直す。Info.plist の 3 つの鍵 (ローカルネットワークの説明、`UIFileSharingEnabled`、`LSSupportsOpeningDocumentsInPlace`) は `Info.ios.plist` と `project.yml` の両方に書く | `Info.ios.plist` はビルド時に Tauri CLI が混ぜるが、xcodegen で作り直すと `Info.plist` から消える |
| 2026-10-21 | TestFlight 用の書き出しは `scripts/ios-build.sh archive` (署名つきの archive と `app-store-connect` の .ipa)。アップロードは手で行う (README) | Apple ID や API キーをスクリプトに置かない |
