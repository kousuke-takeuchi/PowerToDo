# iOS のビルド

デスクトップと同じ Rust と React を、Tauri の iOS ターゲットでビルドする。所有者の iPhone に、Xcode から直接か、TestFlight (内部テスト) で入れる。

## 前提 (この Mac)

- Xcode (27 で確かめた)。シミュレーターのランタイム (iOS 26.5 で確かめた)。
- arm64 の `cargo tauri` (tauri-cli 2.12.2): `cargo install tauri-cli --version 2.12.2 --locked`。この Mac の Node は Rosetta (x86_64) で動くので、`npm run tauri ios ...` は使わない (x86_64 のシミュレーター向けを作ってしまう)。別の場所に入れたときは、環境変数 `CARGO_TAURI` にパスを入れる。
- Rust の iOS ターゲット: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`。
- Go (`/opt/homebrew/bin/go`)。Tailscale を iOS 用のライブラリ (`libtailnet.a`) にビルドする (`scripts/build-tailnet-ios.sh`。ビルドのスクリプトが自動で呼ぶ)。
- Xcode のプロジェクトは `src-tauri/gen/apple/project.yml` から作る。作り直すときは `cd src-tauri/gen/apple && xcodegen generate` (`brew install xcodegen`)。

## 署名 (Team ID)

```sh
cp src-tauri/gen/apple/Signing.example.xcconfig src-tauri/gen/apple/Signing.xcconfig
# Signing.xcconfig の DEVELOPMENT_TEAM に Team ID を書く (このファイルは git 管理外)
```

- Team ID は `Signing.xcconfig` にだけ書く。`APPLE_DEVELOPMENT_TEAM` や `tauri.conf.json` の `bundle.iOS.developmentTeam` は使わない。Tauri CLI が `project.pbxproj` に書き込み、コミットされてしまう。
- Xcode に Apple ID でサインインしておく (自動署名)。
- iPhone に入っている版と同じ Team ID で署名する。違う Team ID の版は、上書きの更新を iOS が断る (`MismatchedApplicationIdentifierEntitlement`)。そのときは Team ID を合わせるか、iPhone のアプリを消して入れ直す (iPhone にだけあるデータは消える)。

## ビルドと入れ方

**Xcode の Run (⌘R) だけではビルドできない。** Rust のビルドの段が、Tauri のコマンド (`tauri ios dev` か `tauri ios build`) が動いている間しか通らないためである。そのままだと `Command PhaseScriptExecution failed with a nonzero exit code` になり、ログに `failed to read .../.tauri/cli-options-server.json` と出る。次のスクリプトを使う。

| 先 | 手順 |
|---|---|
| シミュレーター | `scripts/ios-build.sh sim <シミュレーターの UDID>`。ビルドして入れて起動する。UDID は `xcrun simctl list devices available` で調べる |
| 実機 | `scripts/ios-build.sh device` のあと、`xcrun devicectl device install app --device <UDID> "$TMPDIR/powertodo-ios/dd-device/Build/Products/release-iphoneos/PowerToDo.app"`。UDID は `xcrun devicectl list devices` で調べる。iPhone の「デベロッパモード」を有効にしておく |
| TestFlight | 下の「TestFlight」 |

## TestFlight

1. `src-tauri/gen/apple/project.yml` の `CFBundleVersion` を上げる。アップロードのたびに増やす (同じ番号は受け付けられない)。`CFBundleShortVersionString` は見える版である。
2. `scripts/ios-build.sh archive` を実行する。`$TMPDIR/powertodo-ios/PowerToDo.xcarchive` と、App Store Connect 用の `.ipa` (`$TMPDIR/powertodo-ios/export/`) ができる。
3. アップロードする。Xcode の Organizer (Window → Organizer) で archive を選び、「Distribute App」→「App Store Connect」。または `xcrun altool --upload-app -f <ipa> -t ios --apiKey <キー ID> --apiIssuer <Issuer ID>`。API キーは App Store Connect の「ユーザとアクセス」→「キー」で作る。キーをリポジトリに置かない。
4. App Store Connect の TestFlight で、処理が終わったビルドを内部テスターに配る (外部テスターは審査が要るので使わない)。
5. 最初のアップロードで、暗号の輸出規制の質問に答える (WireGuard と TLS を使う)。

プライバシーマニフェスト (`src-tauri/gen/apple/powertodo_iOS/PrivacyInfo.xcprivacy`) を同梱している。申告の中身と理由は `docs/superpowers/specs/2026-10-20-phase6-ios-design.md` の §9 にある。

## Google ログイン

デスクトップとは別に、iOS 用の OAuth クライアントが要る。

1. Google Cloud の同じプロジェクトで、OAuth クライアントを作る。種類は「iOS」、Bundle ID は `app.powertodo`。
2. ダウンロードした plist を `src-tauri/google-oauth-ios.plist` に置く (git 管理外。雛形は `src-tauri/google-oauth-ios.example.plist`)。別の場所に置くときは、環境変数 `POWERTODO_GOOGLE_IOS_OAUTH_PLIST` にパスを入れる。
3. iOS のビルドは、この plist のクライアント ID だけを埋め込む (シークレットは無い)。デスクトップ用の `google-oauth.json` は読まない。plist が無いビルドでは「このビルドでは Google Drive を使えません」と出る。

ログインの画面は、アプリの中のシート (`ASWebAuthenticationSession`) で開く。Info.plist に URL スキームの登録は要らない。

## 所有者の作業

1. App Store Connect に PowerToDo を登録する (Bundle ID `app.powertodo`)。TestFlight の内部テスターに自分を入れる。
2. Google Cloud に iOS 用の OAuth クライアントを作り、plist を上の場所に置く。
3. 最初のアップロードで、暗号の輸出規制の質問に答える。
