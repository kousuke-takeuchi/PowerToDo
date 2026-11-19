# PowerToDo の内部資料

開発する人のための資料である。使い方は [概要](../01-overview.md) から読む。

## 目次

| 文書 | 内容 |
|---|---|
| [構成](architecture.md) | Rust と画面の分け方、保存と同期の流れ、よくある変更の手順 |
| [データ](data-model.md) | xlsx の列、共通ファイル、コメントと添付の記録、端末ごとのファイル |
| [技術](tech-stack.md) | 使うライブラリと、その役割 |
| [リリース](release.md) | 配布物の作り方、署名鍵、Google の OAuth クライアント、Tailscale のサイドカー |
| [iOS のビルド](ios-build.md) | iPhone への入れ方、署名、TestFlight、Google ログイン |
| [ライセンス](third-party-licenses.md) | 依存するものと、そのライセンス |
| [調査メモ](research/) | Excel の形、Todoist の見た目と操作、iOS と Tailscale の調査 |

設計仕様は `docs/superpowers/specs/`、実装計画は `docs/superpowers/plans/` にある。画面のデザインは `design/` にある ([design/README.md](../../design/README.md))。

## 文書の図と画像の作り方

図と画像は `docs/images/` に置く。元になるものと作り方を、ここにまとめる。

| ファイル | 元 | 道具 |
|---|---|---|
| `architecture.svg` | `docs/diagrams/architecture.drawio` | draw.io |
| `sync.svg` | `docs/diagrams/sync.drawio` | draw.io |
| `screen-*.png` (アプリの画面) | Storybook のストーリー | `scripts/capture-docs-screens.mjs` |

機械的に決まる図 (処理の流れ、順番) は、文書の中に mermaid で書く。

### draw.io の図を書き出す

```bash
/Applications/draw.io.app/Contents/MacOS/draw.io -x -f svg -o docs/images/architecture.svg docs/diagrams/architecture.drawio
```

図を直したら、SVG を書き出し直して一緒にコミットする。

### 画面の画像を作る

画像は Storybook のストーリーから撮る。ストーリーのデータだけが写り、本物のデータフォルダは写らない。Google Chrome が要る (別の場所なら環境変数 `CHROME` にパスを入れる)。

```bash
npm run build-storybook
npm run capture:docs
```

撮るストーリーと名前は、スクリプトの `SHOTS` にある。画面を変えたら、画像を作り直して一緒にコミットする。

## 画面の確認 (Storybook)

デザインの画面を React の部品で作り、Storybook で触って操作性を確かめる。

1. `npm run storybook` を起動し、http://localhost:6006 を開く。
2. 左の `Screens/` (Desktop、Dark、Mobile) を上から順に開く。ストーリーの名前は画面の名前と同じである (例: `D-01 プロジェクト`、`M-01b サブタスク展開`)。`Components/` には部品ごとの状態の一覧がある。
3. 画面ごとに何を触り、何を見るかは [design/storyboard.md](../../design/storyboard.md) の「画面ごとの操作項目と確認観点」にある。画面の移り方は、同じファイルの遷移表を見て、ストーリーを切り替えて確かめる。
4. 指摘は「ストーリー名 + 内容」で返す (例: `D-03 タスク詳細: 優先度の行が目立ちすぎる`)。まとめて 1 つの PR で直し、デザインにも同じ内容を入れる。

- 動くのは、開閉、選択、切り替え (折りたたみ、ダイアログ、ポップオーバー、タブなど) だけである。タスクの追加、保存、同期はしない。
- ツールバーで、テーマ (ライト、ダーク) と幅 (1440、960、390) を切り替えられる。幅はフレームの大きさを変えるだけで、画面は並べ直さない。960 幅の見た目は D-13、iPhone は M-* のストーリーで確かめる。
- `npm run check:stories` は、`design/storyboard.md` の画面一覧がすべてストーリーになっているかを確かめる (先に `npm run build-storybook`)。

## 文書の検査

`npm run test:docs` が、文書の中のリンクと画像の参照先があること、mermaid のノード ID に予約語が無いことを確かめる。CI の web のジョブでも動く。
