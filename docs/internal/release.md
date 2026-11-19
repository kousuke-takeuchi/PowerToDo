# リリース

GitHub で release を公開すると、Actions の Release (`.github/workflows/release.yml`) が配布物を作り、その release に付ける。

| ジョブ | 作るもの |
|---|---|
| 準備 | 版の確かめ |
| Installers (macOS Apple シリコン) | `.dmg`、更新ファイルと署名 |
| Installers (macOS Intel) | `.dmg`、更新ファイルと署名 |
| Installers (Windows) | `-setup.exe`、`.msi`、更新ファイルと署名 |
| Installers (Linux) | `.AppImage`、`.deb`、`.rpm`、更新ファイルと署名 |
| Check latest.json | `latest.json` に 4 つのプラットフォームがそろっているかを確かめる |

## 事前の準備 (所有者が 1 回だけ)

1. 署名鍵を作る: `npx tauri signer generate -w ~/.tauri/powertodo.key` (パスワードを付ける)。
2. GitHub の Settings → Secrets and variables → Actions に登録する。
   - `TAURI_SIGNING_PRIVATE_KEY`: 鍵ファイルの中身
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: 1 のパスワード
   - `POWERTODO_GOOGLE_OAUTH_JSON_CONTENT`: `src-tauri/google-oauth.json` の中身 (下の「Google Drive の OAuth クライアント」)
3. 公開鍵 (`~/.tauri/powertodo.key.pub` の中身) を `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に入れる。公開してよい値である。
4. 秘密鍵とパスワードを、パスワード管理ツールなどに控える。**秘密鍵をなくすと、入っているアプリに更新を届けられなくなる** (別の鍵で署名した版は、アプリの検証に通らない)。そのときは、新しい鍵で作った版を手で入れ直してもらう。

## リリースする

1. main の CI が緑であることを確かめる。
2. GitHub → Releases → Draft a new release で、タグ `vX.Y.Z` を main から新しく作る。版は数字だけの `X.Y.Z` にする (`v1.2.3-rc1` のような版は CI が断る)。タイトルと更新内容を書き、Publish release を押す。更新内容は、アプリの更新のダイアログにそのまま出る。テスト用は「Set as a pre-release」にする。
   - コマンドなら: `gh release create vX.Y.Z --target main --title vX.Y.Z --notes-file <更新内容>`
3. Actions の Release の 6 つのジョブが緑になるのを待つ (20 分から 30 分)。release に、インストーラー 7 種、更新ファイル、`latest.json` が付いたことを確かめる。
   - 「Check latest.json」が赤のとき: tauri-action は `latest.json` を排他なしで書き直すので、2 つのジョブが同時に書くと片方のプラットフォームが消えることがある。Actions → その実行 → 足りないプラットフォームの「Installers」を「Re-run jobs」する。確かめも自動でやり直される。
   - それでも直らなければ、作り直す: Actions → Release → Run workflow → 公開済みのタグを入れる。

## 決まりごと

- `tauri.conf.json` の `version` は開発用の値 (`0.1.0`) のままにする。配布版の版は、CI がタグの数字で書き換える。
- secret が無くても CI は止まらず、警告を出して作る。`TAURI_SIGNING_PRIVATE_KEY` が無ければ更新ファイル無し、`POWERTODO_GOOGLE_OAUTH_JSON_CONTENT` が無ければ Drive 無しのビルドになる。公開の前に、Actions のログに警告が無いことを見る。
- release のワークフローは `-v` / `-vv` を付けず、`target/` をキャッシュにもアーティファクトにも上げない。OAuth のクライアントの値が残るためである。この決まりを変えない。

## Google Drive の OAuth クライアント

配布版には Google Drive 用の OAuth クライアントが入る。自分でビルドするときは、次の準備が要る。

1. Google Cloud でプロジェクトを作り、Google Auth Platform で OAuth クライアントを作る。種類は「デスクトップ アプリ」。
2. 「データアクセス」で、スコープ `https://www.googleapis.com/auth/drive.file`、`openid`、`email` を足す。
3. 「対象」で公開ステータスを「本番環境」にする。「テスト」のままだと、リフレッシュトークンが 7 日で切れる。`drive.file` は機密でないスコープなので、審査は要らない。
4. クライアントの JSON (`{"installed": {...}}` の形) をダウンロードし、`src-tauri/google-oauth.json` に置く。git 管理外である。雛形は `src-tauri/google-oauth.example.json`。別の場所に置くときは、環境変数 `POWERTODO_GOOGLE_OAUTH_JSON` にパスを入れる。

`build.rs` がこの JSON を読み、クライアントの ID とシークレットをビルドに埋め込む。JSON が無いビルドでも動くが、Drive は「このビルドでは使えません」と出る (NAS には影響しない)。

- JSON を置いたビルドでは、`-v` / `-vv` を付けない (`cargo build -v` など)。ビルドスクリプトの出力に ID とシークレットが出る。
- JSON を置いたビルドの `target/` を、キャッシュにもアーティファクトにも上げない。値が `target/*/build/powertodo-*/output` と、できたバイナリに残る。
- JSON をコミットしない。ログや Issue に貼らない。

iOS の OAuth クライアントは [iOS のビルド](ios-build.md#google-ログイン) にある。

## Tailscale のサイドカー

`tauri dev` と `tauri build` は、`beforeDevCommand` と `beforeBuildCommand` で `npm run build:tailnet` を実行する。Go のサイドカーを `src-tauri/binaries/powertodo-tailnet-<ターゲット>` (Windows は `.exe`、git 管理外) にビルドし、Tauri が `bundle.externalBin` として同梱する。

- Go は `tailnet/go.mod` の `go` 行の版以上が要る。探す順は、環境変数 `GO`、`/opt/homebrew/bin/go`、`PATH` の `go` である。
- 単体でビルドするときは `npm run build:tailnet`。`--target <triple>` で別のターゲットになる。`universal-apple-darwin` は扱わない。`aarch64-apple-darwin` と `x86_64-apple-darwin` を別々に作る。
- Go のテストは `cd tailnet && go test ./...`。
- `cargo build` の前にサイドカーが要る (`tauri-build` が有ることを確かめる)。CI も同じ順に実行する。
- テストのためだけに `cargo test` を動かすときは、空のファイルを `src-tauri/binaries/powertodo-tailnet-<ターゲット>` に置けば足りる。ただしそのビルドでは Tailscale が動かない。
