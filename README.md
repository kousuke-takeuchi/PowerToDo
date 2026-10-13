# PowerToDo

Excel (xlsx) をデータベースにした Todoist 風の ToDo アプリ。
Windows / macOS / Ubuntu のデスクトップと、iOS / Android のモバイルで同じデータを扱う。
データは Google Drive 経由で同期する。

- 1 プロジェクト = 1 xlsx ファイル (形式は [Qiita: エクセル七つ道具ではじめるシンプルなタスク管理](https://qiita.com/y-tetsu/items/c028737330fc47106fe8) 準拠 + 拡張列)
- 技術: Tauri 2 (Rust コア) + React / TypeScript / Tailwind
- 設計書: `docs/superpowers/specs/`
- 調査メモ: `docs/research/`
- デザイン: `design/` (pen.dev)

## UI の確認 (Storybook)

pen の画面を React コンポーネントで再現し、Storybook で実際に触って操作性を確認する。

1. `npm install`
2. `npm run storybook` を起動し、ブラウザで http://localhost:6006 を開く
3. 左のツリーの `Screens/` (Desktop / Dark / Mobile) を上から順に開く。Story 名は pen の画面名と同じ (例 `D-01 プロジェクト`、`M-01b サブタスク展開`)。`Components/` には部品ごとの状態一覧がある
4. 各画面で何を触り、何を見るか (操作項目と確認観点) は [`design/storyboard.md`](design/storyboard.md) の「画面ごとの操作項目と確認観点」に書いてある。画面間の遷移は同ファイルの遷移表を見て、Story を切り替えて確かめる
5. 指摘は「Story 名 + 内容」で返す (例: `D-03 タスク詳細: 優先度の行が目立ちすぎる`)。まとめて 1 PR で直し、pen にも同じ内容を反映する

動くのは開閉・選択・切替 (折りたたみ、サブタスク展開、ダイアログ / パネル / ポップオーバー、設定の同期先切替、タブバーなど) だけで、タスクの追加・保存・同期はしない。ツールバーでテーマ (ライト / ダーク) と幅 (1440 / 960 / 390) を切り替えられる。
幅のツールバーはフレームのサイズを変えるだけで画面は再配置されない。960 幅の見た目は D-13、モバイルは M-* の Story で確認する。

`npm run check:stories` は、`design/storyboard.md` の画面一覧がすべて Story になっているかを確認する (先に `npm run build-storybook`)。
