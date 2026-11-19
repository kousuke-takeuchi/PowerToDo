# iOS スパイク: Tauri iOS ビルドとアプリ内 tailnet (2026-10-19)

PowerToDo (Tauri 2.12, Rust 2024, React 19) を iOS で動かせるか、また desktop の Go sidecar
(`tailnet/`) をアプリ内の c-archive として動かせるかを、シミュレーターで確かめた記録。
コードは捨てる前提のスパイクで、ブランチ `spike/ios-tailnet` (origin/main 1e3e1b0 から) にある。
事前調査は [2026-10-19-ios-tailscale-research.md](2026-10-19-ios-tailscale-research.md)。

環境: Xcode 27.0 (27A266a, SDK iPhoneSimulator27.0 / iPhoneOS27.0)、シミュレーターのランタイムは
iOS 26.5 まで (27 は未インストール)、rustc 1.97.1、Go 1.27.2、Node 26.5.0 (x86_64、Rosetta で動作)、
npm の `@tauri-apps/cli` 2.12.2、tauri 2.12.3、tauri-build 2.7.2、tauri-utils 2.10.1、
tailscale.com v1.104.1。シミュレーターは iPhone 17 Pro (iOS 26.5)。

## 結果の要約

| 段階 | 結果 | 証拠 |
| --- | --- | --- |
| 1. 素の Tauri iOS アプリがシミュレーターで動く | 合格 (回避策つき) | `2026-10-19-ios-spike/step1-blank-app.png` |
| 2. アプリ内 tailnet (シミュレーター) | 合格 | `2026-10-19-ios-spike/step2-autotest.txt`、`step2-*.png` |
| 3, 4. 実機でのログイン、WebDAV、サスペンド | 未実施 (手順を用意) | 下の「実機テストの手順」 |

段階 2 で確かめたこと (ログは `step2-autotest.txt`):

- `tn_start` は 85 ms で 0 を返した (2 回目以降の起動では 23 ms)。
- ログインのコマンドから約 4 秒で `needs_login` になり、ログイン URL のホストは `login.tailscale.com`
  (ログには URL のホストだけを書いている)。
- `tn_proxy_open` は `127.0.0.1` のポートを返した (例: 63401)。
- reqwest で `socks5h://` 経由の `http://example.com/` は、5 秒後に
  `SOCKS error: general server failure` できれいに失敗した。未ログインなので想定どおり。
- `tn_proxy_close` 後に古いポートへ接続すると `Connection refused (os error 61)`。
  `tn_proxy_open` で別のポートが開き (63402 から 63417)、そこからの SOCKS も同じ形で失敗した。
- UI の「Tailscale にログイン」で Safari にログインページが開いた (`step2-login-page-in-safari.png`)。
  アプリが背面に回ると `tn_proxy_close`、前面に戻ると新しいポートで `tn_proxy_open` が走った
  (`step2-panel-after-resume.png`)。
- 状態フォルダは `Library/Application Support/tailnet` にでき、拡張属性
  `com.apple.metadata:com_apple_backup_excludeItem: com.apple.MobileBackup` が付いた
  (`NSURLIsExcludedFromBackupKey` の効果)。
- デバッグビルドのアプリのプロセスの RSS は約 117 MB (シミュレーター、ログイン前、WebView は別プロセス)。

## 段階 1: 素の Tauri iOS アプリ

`npx tauri ios init` で `src-tauri/gen/apple/` を作り (コミット 2380a38)、次の詰まりどころを直した
(コミット 5a09f48)。

### 詰まりどころと対処

1. **`bundle.externalBin` が iOS でも sidecar を探す。** `src-tauri/tauri.ios.conf.json` で
   `"externalBin": []` にし、`beforeDevCommand` / `beforeBuildCommand` から `npm run build:tailnet` を外した。
   Tauri は `tauri.ios.conf.json` を JSON Merge Patch (RFC 7396) で重ねるので、配列は丸ごと置き換わる。
2. **keyring 4.2 の `v1` が iOS でコンパイルできない。** 実際のエラー:
   `error: The `protected` feature is required on iOS`
   (apple-native-keyring-store-1.0.2 src/lib.rs:50)。`keyring` を desktop 向けの target 依存に移し、
   `KeyringStore` を `#[cfg(desktop)]` にして、iOS では `SyncRuntime::new` が `MemoryStore` を使う。
3. **トレイ。** `pub mod tray`、`tray::setup`、`CloseRequested` の分岐を `#[cfg(desktop)]` にした。
4. **`WebviewWindow::unminimize` が desktop 専用。** `error[E0599]: no method named `unminimize``。
   `#[cfg(desktop)]` にした。
5. **フォルダ選択 `blocking_pick_folder` が desktop 専用。** `error[E0599]: no method named
   `blocking_pick_folder``。iOS ではキャンセル扱い (`Ok(None)`) にした。単一インスタンスの plugin と
   Quit メニューは、もともと target / `cfg(target_os = "macos")` で外れていた。
6. **Node が x86_64 (Rosetta) だと、Tauri CLI もシミュレーター用に x86_64 を作る。** npm の CLI は Node と
   同じ x86_64 の napi バイナリで、`tauri ios xcode-script` はシミュレーターの arch を CLI 自身の
   `target_arch` で決める。結果は `Externals/x86_64/debug/libapp.a` だけができ、arm64 のリンクが
   `ld: library 'app' not found` で失敗した。スパイクでは `cargo install tauri-cli --version 2.12.2 --locked`
   で arm64 の CLI を作業用フォルダに入れ、`project.yml` の Build Rust Code を
   `${TAURI_XCODE_CLI:-npm run -- tauri} ios xcode-script ...` に変えて `TAURI_XCODE_CLI="cargo tauri"` で
   呼んだ。本番では arm64 の Node を使えば、この書き換えはいらない。
7. **`tauri ios init` が `libimobiledevice` を brew で入れようとして失敗する。**
   `Error: Cannot install under Rosetta 2 in ARM default prefix (/opt/homebrew)!`。cargo-mobile2 は
   `idevicesyslog` が PATH にあるかで判断するので、スパイクでは何もしない `idevicesyslog` を PATH に置いた。
   本番は `arch -arm64 brew install libimobiledevice` で入れる。なお最初の init は CLI が x86_64 と思い込んで
   `x86_64-apple-ios` の Rust target を自動で入れた (`rustup target remove x86_64-apple-ios` で消せる)。
8. **Xcode 27 の SDK に対応するシミュレーターのランタイムがないと、Tauri CLI がシミュレーター用の
   build / archive を拒む。** `failed to archive iOS app: Xcode Simulator SDK 27.0 is not installed, please open Xcode`。
   cargo-mobile2 の `validate_sdk` が、SDK の版 (27.0) 以上のランタイムを要求している。iOS 27 の
   ランタイム (数 GB) は入れず、`scripts/ios-sim-build.sh` で回避した: CLI を `--open` で起こし
   (Xcode へのオプション配布サーバーを立てて待つだけで、`validate_sdk` を通らない)、`open` を差し替えて
   Xcode を開かせず、`xcodebuild` を特定のシミュレーターの UDID に向けて走らせる。CLI が動いていないと
   Xcode の Build Rust Code は `failed to read .../.tauri/cli-options-server.json; the `tauri ios dev` or
   `tauri ios build` command must be running while Xcode builds the app` で止まる。

### Xcode 27 の `lipo -verify_arch` 問題

InfoDesk (Flutter) で踏んだ問題は Tauri では起きなかった。tauri-cli 2.12.2 と cargo-mobile2 0.22.5 の
iOS ビルド経路に `lipo` の呼び出しはなく、ビルドログにも `lipo` は出ない。ただし生成された
`project.yml` は `ARCHS: [arm64, x86_64]` で、汎用のシミュレーター (`generic/platform=iOS Simulator`)
向けに作ると x86_64 側の `libapp.a` がなくリンクに失敗するはず (未確認)。特定のシミュレーターを
`-destination` で指定すれば arm64 だけになる (確認済み)。

### 起動の確認

`scripts/ios-sim-build.sh <UDID> <cargo-tauri の bin>` で、ビルド、インストール、起動まで 1 分 21 秒。
アプリの実行ファイルは arm64 で、React の UI (初回設定の画面) が表示された (`step1-blank-app.png`)。
デスクトップ側は `cargo check --all-targets` と `cargo test` (555 件) が通る。

## 段階 2: アプリ内 tailnet

### Go 側 (`tailnet/mobile/`、コミット 24897b8)

- `package main` の c-archive。`protocol.go` は `../protocol.go` へのシンボリックリンクで共有し
  (go build はそのまま通った)、desktop の sidecar (`tailnet/main.go`) は変えていない。
- C API: `tn_start(state_dir, hostname)`、`tn_command(json)`、`tn_next_event(timeout_ms)`
  (JSON か NULL)、`tn_proxy_open()` (`socks5h://` の URL か NULL)、`tn_proxy_close()`、`tn_stop()`、`tn_free()`。
  メッセージと命令は desktop の JSON-lines と同じ形。返した文字列は `tn_free` で解放する。
- SOCKS5 は自前: `tailscale.com/net/socks5` の `Server{Dialer: srv.Dial, Username, Password}` を
  `net.Listen("tcp", "127.0.0.1:0")` に載せる。`tsnet.Server.Loopback()` はリスナーを一度だけ作って
  使い回すので、サスペンドで OS に回収されると戻らない (tailscale/tailscale#20060)。自前なら
  閉じて開き直せる。`tn_proxy_open` は新しいポートの `ready` イベントも出す。
- `tailnet/mobile/build-ios.sh <rust target>` が clang ラッパーを作って
  `CGO_ENABLED=1 GOOS=ios GOARCH=arm64 go build -trimpath -ldflags=-w -buildmode=c-archive` を走らせ、
  `src-tauri/binaries/ios/<target>/libtailnet.a` に出す (git 管理外)。シミュレーター用は 6 秒、26.0 MB。

### Rust 側 (コミット 5332ef8)

- `build.rs`: `CARGO_CFG_TARGET_OS == "ios"` のときだけ、`CARGO_CFG_TARGET_ABI == "sim"` で
  シミュレーター / 実機の archive を選び、`cargo:rustc-link-lib=static=tailnet` と `cfg(tailnet_ffi)` を出す。
  `POWERTODO_IOS_NO_TAILNET=1` で外せる (サイズ比較用)。archive は `libapp.a` に取り込まれる
  (`ar t libapp.a` に `go.o` がある)。
- CoreFoundation: `bundle.iOS.frameworks` もリンクフラグも足さずにリンクが通った。`libapp.a` の中の
  Swift のオブジェクト (`SwiftRs.o`、`Tauri.o`、`tauri-plugin-dialog.o` など 5 個) が
  `LC_LINKER_OPTION` で CoreFoundation を自動リンクしているため。`go.o` 自体にはリンクの指示はない。
  Security は Tauri のテンプレートが最初から入れている。なので今の構成では追加は不要。
  `frameworks` の設定は `ios init` で project を作り直したときにしか効かない (tauri-utils の説明どおり)。
- `src-tauri/src/sync/tailnet_ios.rs`: 状態フォルダ `<Application Support>/tailnet` をバックアップ対象外にして
  `tn_start`、読み取りスレッドが `tn_next_event` を回して desktop と同じ `Message` で解釈し、
  `spike-tailnet-status` を UI に送る。ログは stderr と `<Application Support>/tailnet-spike.log`。
  シミュレーターでは `simctl launch` の `--stderr` / `--console` で何も取れなかったので、ファイルにした。
- ライフサイクル: `WindowEvent::Suspended` で `tn_proxy_close`、`WindowEvent::Resumed` で `tn_proxy_open`。
- 一時的なコマンドと UI: `spike_tailnet_status`、`spike_tailnet_login`、`spike_socks_probe`、
  `spike_webdav_test`。画面左下の「spike: <状態>」ボタンでパネルが開く (`src/spike/IosSpikePanel.tsx`)。
  `SIMCTL_CHILD_POWERTODO_SPIKE_AUTOTEST=1` で起動すると、ログイン URL、SOCKS、閉じて開き直す、を
  自動で試してログに書く。
- `src-tauri/Info.ios.plist` に `NSLocalNetworkUsageDescription`。Tauri がビルド時に Info.plist へ
  マージした (アプリの Info.plist で確認)。

### 段階 2 で見つかった詰まりどころ

9. **`tauri_plugin_opener::open_url` (自由関数) は iOS で失敗する。** UI に
   `ログイン 失敗: No such file or directory (os error 2)`。自由関数は desktop 用の起動処理で、
   iOS では plugin の `app.opener().open_url(...)` を使う必要がある。直した。既存の
   `platform::reveal_path` も自由関数 `open_path` を使っているので、iOS では同じく失敗するはず。
10. **起動直後にも `Resumed` が来る。** 起動時に `tn_proxy_open` が 2 回走った (ログ参照)。害はない。

### バイナリのサイズ (実機用 release、署名なし)

`scripts/ios-device-build.sh --unsigned` (release、LTO、`aarch64-apple-ios`) で比べた。

| | 実行ファイル | .app | .app の zip |
| --- | --- | --- | --- |
| archive あり | 35,126,216 B (33.5 MiB) | 34,596 KiB | 13,155,256 B |
| archive なし (`POWERTODO_IOS_NO_TAILNET=1`) | 13,618,656 B (13.0 MiB) | 13,592 KiB | 5,266,077 B |
| 差 | +21.5 MB | +21.0 MB | +7.9 MB |

zip は App Store の圧縮後サイズの目安。Go は `-ldflags=-w` (DWARF なし) で、`-s` は試していない。
Xcode の archive ではさらに strip が入る可能性がある。

## 確認した事実と出典

- Tauri の platform 設定: `tauri.ios.conf.json` を読み (tauri-utils-2.10.1 src/config/parse.rs:58)、
  `json_patch::merge` で重ねる (同 :185)。
- tauri-build 2.7.2: `desktop` / `mobile` の cfg を出す (src/lib.rs:659-660)、`bundle.externalBin` を
  対象を問わずコピーする (:736-743)、iOS では `IPHONEOS_DEPLOYMENT_TARGET` を
  `bundle.iOS.minimumSystemVersion` (既定 15.0) から出す (:787-791)。
- `IosConfig` (tauri-utils-2.10.1 src/config.rs:3596-3627): `frameworks` (project を作り直したときに反映)、
  `developmentTeam` (`APPLE_DEVELOPMENT_TEAM` で上書き)、`minimumSystemVersion`、`infoPlist`。
  `Info.ios.plist` も探される。
- keyring: keyring-4.2.0 の `v1` は `apple-native-keyring-store/keychain` を有効にし、
  apple-native-keyring-store-1.0.2 は iOS で `protected` がないと `compile_error!` (src/lib.rs:49-50)。
  本当の対処は iOS で `keyring-core = "1"` と `apple-native-keyring-store = { version = "1", features = ["protected"] }`
  を使い、`keyring_core::set_default_store(apple_native_keyring_store::protected::Store::new()?)`
  (keyring-core-1.0.1 src/lib.rs:65、apple-native-keyring-store src/protected.rs:371) のあと
  `keyring_core::Entry::new(service, user)` (keyring-core src/lib.rs:130)。どちらの crate も実在し、
  すでに Cargo.lock にある (keyring-core 1.0.1、apple-native-keyring-store 1.0.2)。protected store は
  署名とプロビジョニングのあるアプリでしか使えない (protected.rs の冒頭の説明)。
- desktop 専用の API: `blocking_pick_folder` (tauri-plugin-dialog-2.8.2 src/lib.rs:737-738)、
  `WebviewWindow` の desktop 用 impl (tauri-2.12.3 src/webview/webview_window.rs:2030-2031、`unminimize` は :2103)、
  `tauri::tray` (desktop かつ `tray-icon`)。opener: plugin の `open_url` は desktop (:73-74) と mobile (:99-100)
  に分かれ、自由関数は src/open.rs:33。
- モバイルのライフサイクル: `WindowEvent::Suspended` は iOS の `applicationWillResignActive`、
  `Resumed` は `applicationWillEnterForeground` (tauri-2.12.3 src/app.rs:152-169)。
- パス: `PathResolver::data_dir()` は `dirs::data_dir()` (tauri-2.12.3 src/path/desktop.rs:75-77)。
  シミュレーターで `Library/Application Support` になることを確認した。
- tsnet / socks5 (tailscale.com v1.104.1): `socks5.Server` のフィールド (net/socks5/socks5.go:95-107)、
  `Serve(ln)` (:127)、TCP の dial は 5 秒の timeout (:228)。`tsnet.Server.Dial` は `Start` と `awaitRunning` の
  あと `UserDial` (tsnet/tsnet.go:373-381)。`awaitRunning` は NeedsLogin / Starting の間は待ち続ける (:387-410)
  ので、未ログインの SOCKS は 5 秒で失敗する。Loopback の SOCKS も同じ `UserDial` (:521-526)。
- NSURL: `fileURLWithPath`、`setResourceValue_forKey_error`、`NSURLIsExcludedFromBackupKey`
  (objc2-foundation-0.3.2 src/generated/NSURL.rs:1136、:1407、:242)。objc2-foundation は Tauri 経由で
  iOS のツリーにすでにある。
- Tauri CLI 2.12.2 (GitHub の `tauri-cli-v2.12.2` タグ):
  - シミュレーターの arch は CLI 自身の `target_arch` で決まる (crates/tauri-cli/src/mobile/ios/xcode_script.rs:201-213)。
  - Xcode へのオプションは `.tauri/cli-options-server.json` と WebSocket の JSON-RPC で渡る
    (src/mobile/mod.rs:495 `write_options`、:551 `fetch_options`)。`--open` では build せずに返り
    (src/mobile/ios/build.rs:409)、Xcode を開いて寝て待つ (src/mobile/ios/mod.rs:456-464 `open_and_wait`)。
  - 開発チーム: `APPLE_DEVELOPMENT_TEAM`、なければ `bundle.iOS.developmentTeam` (src/mobile/ios/mod.rs:212)。
    テンプレートの `project.yml` に `DEVELOPMENT_TEAM` として書かれ (templates/mobile/ios/project.yml:15-16)、
    さらに `tauri ios build` / `dev` のたびに `synchronize_project_config` が `project.pbxproj` に書き込む
    (src/mobile/ios/mod.rs:577-580、build.rs:305、dev.rs:254)。`gen/apple` はコミットされるので、
    この経路でチーム ID を渡すとリポジトリに入る。
  - Build Rust Code のコマンドは、init を起動したパッケージマネージャーから決まる (src/mobile/init.rs:95-135)。
- cargo-mobile2 0.22.5: `validate_sdk` (src/apple/target.rs:466-521) がシミュレーター用の build / archive で
  SDK の版以上のランタイムを要求。依存の自動インストール `install_all` (src/apple/deps/mod.rs:204) の
  対象に `libimobiledevice` (`idevicesyslog` で検出、:25-27)。
- `XCODE_XCCONFIG_FILE`: この環境変数で渡した xcconfig の値が `xcodebuild -showBuildSettings` に出る
  ことを、仮の値 (`DEVELOPMENT_TEAM = PLACEHOLD1`) で確認した。変数がなければ `DEVELOPMENT_TEAM` は出ない。

## 残るリスク

- **Tauri CLI とこの Mac の組み合わせ。** x86_64 の Node、iOS 27 のシミュレーターランタイムがないこと、
  `libimobiledevice` がないことで、標準の `tauri ios dev` / `tauri ios build --target aarch64-sim` は動かない。
  本番の前に arm64 の Node と libimobiledevice を入れ、iOS 27 ランタイムを入れるか回避スクリプトを残すかを決める。
- **実機でしか分からない tsnet の挙動。** netmon の `AF_ROUTE` がサンドボックスで動くか、Wi-Fi と
  モバイル回線の切り替え、ローカルネットワークの許可を拒んだときの経路、DERP、長いサスペンド後の再接続時間、
  メモリと電池。
- **`Suspended` と `Resumed` が対になっていない。** `Suspended` は willResignActive、`Resumed` は
  willEnterForeground。コントロールセンターや通知センターを引き出しただけなら、resign active は来ても
  enter foreground は来ないはずで (UIKit の仕様からの推測、未確認)、そのとき SOCKS は閉じたままになる。
  本番では同期の直前に「閉じていれば開く」か、didEnterBackground / didBecomeActive に合わせる。
- **iOS ではデータフォルダを選べない。** フォルダ選択は iOS でキャンセル扱いにしただけで、初回設定は
  保存先がないと進めない。iOS ではアプリの Documents などを固定で使う設計が要る。UI もデスクトップの
  レイアウトのまま (`minWidth: 960` の前提) でスマホ幅に合っていない。`reveal_path` も iOS では使えない。
- **秘密情報。** iOS は今 `MemoryStore` なので NAS のパスワードは再起動で消える。protected store への
  切り替えは署名済みアプリでの確認が要る (未署名だと -34018 になると README にある)。
- **tsnet の状態ファイルは平文。** `tailscaled.state` は iOS のデータ保護 (既定のクラス) に頼る。
  InfoDesk が使う Flutter の package は鍵で暗号化した `tailscaled.state.enc` を持つ。
- **バンドル ID `app.powertodo`。** 実機の自動署名では App ID が登録できる必要があり、他の開発者が
  使っていれば変える必要がある (未確認)。
- **サイズ。** archive で実行ファイルが +21.5 MB、zip で +7.9 MB。
- **Go ランタイムは 1 バイナリに 1 つ。** 他の Go 製ライブラリ (libtailscale など) とは同居できない (事前調査)。
- **App Store / TestFlight。** プライバシーマニフェスト (Go ランタイムの stat 系と mach_absolute_time)、
  暗号の輸出規制の回答は事前調査のとおり未対応。
- **スパイクの手抜き。** `protocol.go` はシンボリックリンク共有 (本番は内部パッケージに分ける)、
  イベントキューが満杯なら捨てる、Go 側のノードは 1 つだけ、desktop の `Tailnet` / 同期の仕組みとは
  つないでいない (`commands::start_sync` は iOS でも sidecar を起動しようとする)。

## 実機テストの手順 (段階 3, 4)

### 準備 (一度だけ)

1. arm64 の Tauri CLI を用意する。どちらか:
   - arm64 の Node を入れて `npm ci` (npm が `@tauri-apps/cli-darwin-arm64` を入れる)。
   - `cargo install tauri-cli --version 2.12.2 --locked` (`cargo tauri` が使える)。スクリプトは
     `cargo tauri` を呼ぶので、`~/.cargo/bin` 以外に入れたときはその bin を第 2 引数で渡す。
2. iPhone で「デベロッパモード」を有効にし、この Mac を信頼する。Xcode に Apple ID でサインインしておく
   (自動署名と `-allowProvisioningUpdates` のため)。
3. チーム ID を git 管理外のファイルに書く:

   ```sh
   cp src-tauri/gen/apple/Signing.example.xcconfig src-tauri/gen/apple/Signing.xcconfig
   # Signing.xcconfig の DEVELOPMENT_TEAM = <チーム ID> を書き換える
   ```

   `Signing.xcconfig` は `src-tauri/gen/apple/.gitignore` に入っている。`APPLE_DEVELOPMENT_TEAM` や
   `bundle.iOS.developmentTeam` は使わない (Tauri CLI が `project.pbxproj` に書き込み、コミットされる)。

### ビルド、インストール、起動

```sh
tailnet/mobile/build-ios.sh aarch64-apple-ios
XCODE_XCCONFIG_FILE=$PWD/src-tauri/gen/apple/Signing.xcconfig scripts/ios-device-build.sh
xcrun devicectl list devices
xcrun devicectl device install app --device <UDID> "$TMPDIR/powertodo-ios-spike/dd-device/Build/Products/release-iphoneos/PowerToDo.app"
xcrun devicectl device process launch --device <UDID> app.powertodo
```

ログの取り出し (ログイン URL はホストしか書かれていない):

```sh
xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer \
  --domain-identifier app.powertodo --source "Library/Application Support/tailnet-spike.log" \
  --destination ./tailnet-spike.log
```

### 段階 3: ログインと WebDAV

1. アプリの左下の「spike: <状態>」を押してパネルを開く。
2. 「Tailscale にログイン」を押す。Safari で `login.tailscale.com` が開くので、tailnet のアカウントで
   ログインし、左上の「◀ PowerToDo」で戻る。状態が `running` になり、名前 (`powertodo-ios...`) と IP が出る。
   ローカルネットワークの許可を聞かれたら、まず「許可」で進める。
3. Tailscale の管理画面に `powertodo-ios` が出ていることを確認する。
4. パネルに NAS の URL (`http://<NAS 名>:5005/<フォルダ>/`、desktop の設定と同じ形)、ユーザー、
   パスワードを入れて「WebDAV テスト」を押す。名前解決、check、list、put (`ios-spike-test.xlsx`)、get、
   `archive/` への移動が順に表示され、各段の時間が出る。ファイルは消さずに `archive/` に移すだけ。
5. アプリを上にスワイプして終了し、起動し直す。ログインし直さずに `running` に戻ることを確認する。
6. 余裕があれば、ローカルネットワークを「設定」で拒否してから 4 をやり直し、時間を比べる
   (直接つながるか DERP 経由かの違いが出るはず)。

### 段階 4: サスペンドと再開

ログ (`tailnet-spike.log`) で、背面に回ると `tn_proxy_close`、戻ると新しいポートの `tn_proxy_open` が
出ていることを毎回確かめる。

1. `running` の状態で「WebDAV テスト」を 1 回通す (基準)。
2. ホーム画面に戻り、1 分待って戻り、すぐ「WebDAV テスト」を押す。成功するまでの時間と、失敗したら
   その文言を記録する。
3. 同じことを 10 分と 60 分で行う (60 分ならアプリが終了されていることもある。そのときは
   起動し直しで `running` に戻るまでの時間を記録)。
4. 背面にいる間に Wi-Fi を切ってモバイル回線にし、戻って「WebDAV テスト」。逆 (モバイル回線から Wi-Fi) も。
5. コントロールセンターを引き出して戻すだけの操作のあと、パネルの proxy の表示と「SOCKS 確認」を見る
   (上の「`Suspended` と `Resumed` が対になっていない」の確認。proxy が「閉」のままなら再現)。
6. 結果 (各待ち時間での成否と所要時間、ログ) をこの文書に追記する。

## 作業用の補助物

- `scripts/ios-sim-build.sh <UDID> [<cargo-tauri の bin>]`: シミュレーター用のビルド、インストール、起動。
- `scripts/ios-device-build.sh [--unsigned] [<cargo-tauri の bin>]`: 実機用 release ビルド。
- `tailnet/mobile/build-ios.sh <aarch64-apple-ios-sim|aarch64-apple-ios>`: Go の c-archive。

## 段階 3 の結果 (iPhone 13 mini 実機、2026-10-19)

- Tailscale のログイン: 「Tailscale にログイン」→ Safari でログイン →「◀ PowerToDo」で戻って、約 14 秒後に `running`。tailnet に `powertodo-ios` として参加した。
- 背面に回ると `tn_proxy_close`、戻ると新しいポートで `tn_proxy_open` (ログで確認)。
- アプリを終了して起動し直しても、ログインし直さずに起動直後に `running` (`tn_start` 94 ms)。
- 初回設定で止まる問題: iOS ではフォルダ選択がキャンセル扱いのため、データフォルダを選ぶ画面から進めなかった。試作では、iOS ならアプリ内の固定フォルダ (`Application Support/PowerToDo`) を自動で使うようにした。本番の設計でも同じ方針にする。
- WebDAV テスト (ローカルネットワークは「許可」): 名前解決 3 ms → check 256 ms → list 4 件 33 ms → put 61 ms → get 28 ms (内容一致) → `archive/` への移動。合計 443 ms。
- 気づいた点: 起動直後に `tn_proxy_open` が 2 回出ている (起動時の open と、前面に来たときの open が重なる)。害は無いが、本番では片方にまとめる。

## 段階 4 の結果 (iPhone 13 mini 実機、2026-10-19)

| 確認 | 結果 |
|---|---|
| 75 分背面のあと | 戻った直後に一度 `status: failed` (制御サーバーへの接続がタイムアウト)。すぐ `running` に戻り、WebDAV は成功 (1.0 s) |
| 1 分背面 | 成功 (0.34〜0.50 s、5 回) |
| 10 分背面 | 成功 (0.42 s) |
| Wi-Fi → モバイル回線 (背面で切り替え) | 失敗。戻って 15 秒後に `check: 接続できません: NAS に接続できません`。モバイル回線では一度も成功しなかった (このあとすぐ Wi-Fi に戻した) |
| モバイル回線 → Wi-Fi | 成功 (0.42 s) |
| コントロールセンターを出して閉じる | 13:41:08 の `tn_proxy_close` のあと、`tn_proxy_open` が出ない。受け口が閉じたままになった可能性が高い (懸念どおり) |
| 60 分背面 | 実施しない (所有者の判断) |

試作は WebDAV の失敗をログに書かず、画面にだけ出していた (本番では失敗も記録する)。

### 本番の設計で入れること
- 回線の変化: 原因が「つなぎ直しに時間がかかる」か「tsnet が回線の変化に気づかない」かは未確定。どちらでも効くように、iOS の回線監視 (`NWPathMonitor`) で変化を検知したら tailnet に知らせる (または node を作り直す)。そのうえで同期は少し待ってから再試行する。
- 受け口: 背面に回ったとき (`Suspended`) ではなく、実際に一時停止するときだけ閉じる。通信の直前に受け口が閉じていれば開き直す。
- 長い背面のあとの一時的な `failed`: 少し待って自動で再試行し、すぐにエラー表示にしない。

## 本番 (Phase 6) で試作から変えた点 (2026-10-21)

- Go: `tailnet/mobile/` の別パッケージとシンボリックリンクをやめ、同じ `package main` をビルドタグ (`mobile_ios.go` / `main.go`) で分けた。SOCKS5 は `proxy.go` の `proxyServer` にまとめ、閉じたあと前と同じポートで開き直すのを先に試す。`tn_rebind` (netmon の `InjectEvent`) を足した
- Rust: 試作の `tailnet_ios.rs` (グローバルの 1 ノード、`tlog!`) の代わりに `sync/tailnet_inproc.rs` の `InProcTailnet`。C API を `TnApi` の裏に置き、デスクトップのテストで偽物に差し替えて確かめる。起動・停止・受け口の操作は 1 つのロックで順番に行う (Go 側の停止と再起動が重なる問題を避ける)。`tn_start` に失敗したときに残る `failed` を、次の起動の前に捨てる
- 受け口は背面に回っても閉じない。同期の直前 (`SyncHost::before_run`) に 127.0.0.1 への接続で生存を確かめ、死んでいれば開き直し、URL が変われば WebDAV のバックエンドを作り直す (コントロールセンターの問題への対策)
- 前面・背面は `RunEvent::WindowEvent { Resumed / Suspended }` で受ける。起動直後の `Resumed` は 1 回無視する (試作で 2 回の open になった原因)
- 回線の変化は Swift プラグイン (`src-tauri/plugins/ios`) の `NWPathMonitor` で受け、`tn_rebind` と 30 秒の再試行の窓 (5 秒後・15 秒後) につなぐ。シミュレーターで Mac の Wi-Fi を切って戻すと `pathChanged` が届くことを確かめた (実機の Wi-Fi → モバイル回線は未確認)
- 状態フォルダは `<アプリのデータ>/tailscale` (デスクトップと同じ判定を使う)。試作の `Library/Application Support/tailnet` のログインは引き継がない
- データフォルダは `Documents` に固定 (試作は `Application Support/PowerToDo`)。「ファイル」アプリから見える
- 試作用の画面とコマンド (`src/spike/`、`commands/spike.rs`、`POWERTODO_SPIKE_AUTOTEST`、`POWERTODO_IOS_NO_TAILNET`) は入れていない

### シミュレーターでの注意
通知の許可を求める画面に答えないまま確かめを終えると、そのシミュレーターはアプリを消して入れ直しても (`simctl privacy reset all` のあとも)、起動のたびに同じ画面を出し続けた。リマインダーが無いのに許可を求められたら、まず使ったことのないシミュレーターで確かめる (Phase 6 の実装中に、これを不具合と取り違えかけた)
