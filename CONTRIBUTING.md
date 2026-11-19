# PowerToDo の開発に参加する

このリポジトリは非公開である。開発に加わる人のための、短い手引きを置く。

## 基本の決まり

- 仕様、画面デザイン、計画、実装の順に進める。仕様は `docs/superpowers/specs/`、計画は `docs/superpowers/plans/` に置く。
- 画面を持つ機能は、計画の前に OpenDesign で画面デザインを作り、承認を得る (`design/README.md`)。
- テストを先に書く。テストが失敗するのを見てから実装する。
- 振る舞いを変えたら、同じコミットで文書も直す。
- xlsx を正本に保つ。Excel で開いて直せる形を壊さない。

## 作業の流れ

1. 環境を作る。Node.js、Rust、Go (版は `tailnet/go.mod`)、各 OS の Tauri 2 の前提ツールが要る。

   ```bash
   npm install
   ```

2. ブランチを作る。
3. テストを書き、失敗を確かめ、実装する。
4. 全部のテストを通す。

   ```bash
   npx tsc --noEmit
   npm run test:web
   npm run test:docs
   (cd src-tauri && cargo test)
   npm run build-storybook && npm run check:stories
   ```

5. アプリで確かめる (`npm run tauri dev`)。インストール版の PowerToDo は先に終了する。
6. 文書を直す。図を変えたら draw.io から SVG を書き出し直し、画面を変えたら `npm run capture:docs` で画像を作り直す。
7. コミットする。メッセージは英語の Conventional Commits にする (例: `fix(dialog): close the task dialog when the task is completed`)。直しは 1 つずつコミットする。
8. PR を作る。CI が緑になってからマージする。

## もっと知る

- 構成とデータ: [docs/internal/README.md](docs/internal/README.md)
- リリース: [docs/internal/release.md](docs/internal/release.md)
- iPhone: [docs/internal/ios-build.md](docs/internal/ios-build.md)
