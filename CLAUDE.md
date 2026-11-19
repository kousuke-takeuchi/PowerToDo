# PowerToDo

Excel (xlsx) のファイルをデータにした、Todoist 風の ToDo アプリ (Tauri 2、Rust、React、TypeScript)。デスクトップ (macOS、Windows、Linux) と iPhone で同じデータを扱い、Synology NAS (Tailscale 経由) か Google Drive で同期する。

## 必読ドキュメント

- 設計仕様: `docs/superpowers/specs/` (日付順。機能ごとに 1 つ)
- 実装計画: `docs/superpowers/plans/` (日付順)
- 内部資料の索引: `docs/internal/README.md` (構成、データ、リリース、iOS のビルド)
- 公開用の文書: `docs/01-overview.md` から番号順。目次は `README.md`
- 画面の一覧と確かめる点: `design/storyboard.md`

## 絶対原則

- **xlsx が正本である**: データはデータフォルダの xlsx にある。アプリのほかにデータベースを持たない。Excel や LibreOffice で開いて直せる形を保つ。知らない列、シート、設定の行は書き戻しで残す (`store/project_book.rs`、`store/common_book.rs`)。
- **消さずに移す**: 削除したプロジェクト、競合で負けた側、終了時に退避した内容は `archive/` へ移す。ファイルを物理的に消さない。
- **共有するものと端末ごとのものを分ける**: ほかの端末と共有するものはデータフォルダ (xlsx、`_comments/`、`_attachments/`) に置く。端末ごとのもの (データフォルダの場所、同期先、起動時の画面、同期の記録、届けた通知) はアプリのデータの場所 (`settings.json` など) に置く。
- **秘密をリポジトリに入れない**: `src-tauri/google-oauth.json`、`src-tauri/google-oauth-ios.plist`、`src-tauri/gen/apple/Signing.xcconfig`、署名鍵、App Store Connect の API キー。NAS のパスワードと Google のトークンは OS のキーチェーンに置く。OAuth の JSON を置いたビルドで `-v` を付けず、`target/` を外に上げない。
- **Team ID は `Signing.xcconfig` にだけ書く**: `project.pbxproj`、`project.yml`、`tauri.conf.json` に書かない。
- **古い版と混ざっても壊さない**: 同期すると、古い版の端末が同じファイルを読み書きする。記録を足すときは、古い版がそれをどう扱うかを確かめる (例: コメントの記録は、知らない行を残す)。
- **利用者に見せる文は日本語**: 画面の文、エラー、通知。識別子、コメント、コミットメッセージは英語。
- **デスクトップ 3 OS と iOS で動くように書く**: OS ごとの違いは `src-tauri/src/platform/` などに分け、`cfg` で切り替える。動作を確かめているのは macOS と iPhone だけで、Windows と Linux は CI のテストとビルドで確かめる。
- **画面の純粋な処理は `.ts` に分ける**: 並べ方、日付、ジェスチャーの判定などは React と DOM に依存しない `.ts` に置き、`node --test` でテストする。

## 構成

```
src/                画面 (React、TypeScript)
  api/              Rust のコマンドと event の型つきの入口
  app/              画面全体の状態とつなぎ (Main.tsx、MobileMain.tsx)、フック、純粋な処理
  views/            画面。views/mobile/ は iPhone
  components/       部品
  stories/          Storybook の画面一覧
src-tauri/          Rust と Tauri の設定
  src/domain/       型、ビュー、繰り返し、クイック追加の解釈 (入出力なし)
  src/store/        xlsx、コメント、添付の読み書き、見張り
  src/commands/     画面から呼ぶコマンド、保存の予約
  src/sync/         同期 (WebDAV、Google Drive、合わせ、Tailscale)
  src/scheduler/    リマインダーと通知
  plugins/ios/      iOS の Swift のプラグイン
  gen/apple/        Xcode のプロジェクト (project.yml から作る)
tailnet/            Tailscale のサイドカー (Go)
scripts/            ビルド、iOS のビルド、Storybook の確かめ、文書の画像と検査
design/             画面のデザイン (OpenDesign) と storyboard
docs/               文書 (下の「文書のルール」)
```

## コマンド

```bash
npm install                     # 環境を作る
npm run tauri dev               # デスクトップのアプリを起動する (サイドカーも作る)
npm run test:web                # 画面の純粋な処理のテスト
npm run test:docs               # 文書のリンクと mermaid の検査
npx tsc --noEmit                # 型の検査
cd src-tauri && cargo test      # Rust のテスト (先にサイドカーが要る)
cd tailnet && go test ./...     # サイドカーのテスト
npm run storybook               # 画面一覧 (http://localhost:6006)
npm run build-storybook && npm run check:stories   # storyboard の画面がすべてストーリーにあるか
scripts/ios-build.sh device     # iPhone 向けのビルド (docs/internal/ios-build.md)
```

- `npm run tauri dev` の前に、インストール版の PowerToDo を終了する (アプリは 1 つだけ動く)。
- `cargo test` だけなら、空のファイルを `src-tauri/binaries/powertodo-tailnet-<ターゲット>` に置けば足りる。
- iPhone は Xcode の Run だけではビルドできない。`scripts/ios-build.sh` を使う。

## 文書のルール

- 文書は日本語で書く。短く書き、図と画面の画像を多く使う。文で説明する前に、図で示せないかを考える。
- 公開用の文書は `docs/` の直下に、読む順の番号を付けて置く (`01-overview.md` など)。目次は `README.md`。開発用の内部資料は `docs/internal/` に置く。調査メモは `docs/internal/research/` に置く。
- 図は draw.io で作る。元のファイルを `docs/diagrams/*.drawio` に、書き出した SVG を `docs/images/` に置く。図を直したら、SVG を書き出し直して一緒にコミットする。
- 処理の流れのように、コードから機械的に決まる図は、文書の中の mermaid でもよい。
- アプリの画面の画像 (`docs/images/screen-*.png`) は、Storybook から `npm run capture:docs` で作る (作り方は `docs/internal/README.md`)。画面を変えたら、画像を作り直して一緒にコミットする。本物のデータを写さない。
- `npm run test:docs` が、文書の中のリンクと画像の参照先があること、mermaid のノード ID に予約語が無いことを確かめる。
- `docs/superpowers/` の仕様と計画は、その日の記録である。後から書き直さない (リンクの付け替えは除く)。

## 画面デザインのワークフロー

- デザインの正は OpenDesign のプロジェクト `powertodo` と、リポジトリの `design/opendesign/` (中身は同じ)。画面ごとの HTML が `screens/`、トークンが `tokens.css`、画面一覧が `index.html`。
- `design.pen` は移行元の pen.dev のファイルで、保存用である。開かない、編集しない、pen.dev の MCP ツールも使わない。
- 画面を足す、直すときは、OpenDesign (MCP の `open-design`、プロジェクト `powertodo`) か `design/opendesign/` を直接編集する。
- 片方を変えたら、もう片方へ同期してからコミットする。OpenDesign のフォルダは `~/Library/Application Support/Open Design/namespaces/release-stable/data/projects/powertodo/` (OpenDesign の `get_project` が返す `resolvedDir` で確かめる)。
  - OpenDesign からリポジトリへ: `rsync -a "<resolvedDir>/" design/opendesign/`
  - リポジトリから OpenDesign へ: `rsync -a design/opendesign/ "<resolvedDir>/"`
- 画面の一覧と確かめる点は `design/storyboard.md`。画面を足したら、ストーリーも足す (`npm run check:stories`)。
- 詳しくは `design/README.md`。

## 開発プロセス

設計仕様、画面デザイン (画面がある場合)、実装計画、実装の順に進める。実装はテストを先に書く。振る舞いを変えたら、同じコミットで文書も直す。直しは 1 つずつコミットする。

## 注意

- コミットメッセージは英語の Conventional Commits (`fix: ...`、`feat: ...`、`docs: ...`)。AI の関与を示す行 (`Co-Authored-By` など) を付けない。
- push とマージは利用者が求めたときだけ行う。main へは PR で入れ、CI が緑になってからマージする。
- リリースの手順は `docs/internal/release.md`。秘密鍵をなくすと、入っているアプリに更新を届けられない。
- 実データ (利用者のデータフォルダ) をテスト、文書、コミットに入れない。
