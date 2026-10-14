# PowerToDo

Excel (xlsx) をデータベースにした Todoist 風の ToDo アプリ。
Windows / macOS / Ubuntu のデスクトップと、iOS / Android のモバイルで同じデータを扱う。
データは Google Drive 経由で同期する。

- 1 プロジェクト = 1 xlsx ファイル (形式は [Qiita: エクセル七つ道具ではじめるシンプルなタスク管理](https://qiita.com/y-tetsu/items/c028737330fc47106fe8) 準拠 + 拡張列)
- 技術: Tauri 2 (Rust コア) + React / TypeScript / Tailwind
- 設計書: `docs/superpowers/specs/`
- 調査メモ: `docs/research/`
- デザイン: `design/` (pen.dev)

## アプリの起動 (Phase 1)

前提: Node.js、Rust (stable)、各 OS の Tauri 2 の前提ツール。

1. `npm install`
2. `npm run tauri dev`
3. 初回起動でデータフォルダを選ぶ (既定は app data dir の `data/`。「選択」でフォルダ選択ダイアログ)。「次へ」で共通ファイルと受信トレイが作られる

データの場所 (どちらも選んだフォルダの直下)
- `<選んだフォルダ>/_PowerToDo.xlsx`: 共通ファイル (プロジェクト一覧、ラベル、祝日、設定)
- `<選んだフォルダ>/<プロジェクト名>.xlsx`: 1 プロジェクト 1 ファイル (受信トレイは `受信トレイ.xlsx`)
- `<選んだフォルダ>/archive/`: 削除したプロジェクトの xlsx の移動先 (物理削除はしない)

設定ダイアログの「データ」ペインで、現在のフォルダの確認・ファイラで開く・変更ができる。変更しても既存のファイルは移動しない。

Phase 1 でできること
- プロジェクトの追加・改名・削除、セクションの追加・改名・並び替え
- タスクの追加・編集・完了 / 取り消し・削除・並び替え・プロジェクト間の移動、サブタスク (多段)
- クイック追加 (例: `牛乳 明日 p1 @食品`、`#プロジェクト`、時刻付き)
- 変更は 1 秒後に xlsx へ保存される。Excel / LibreOffice で開ける。Excel 側で壊れた行は「要修正」として表示され、直したあとに再読み込みできる

Phase 2 以降 (アプリでは「Phase 2 で実装」のプレースホルダ)
- 今日 / 近日 / ラベル / フィルター / ボードのビュー、繰り返し、リマインダー、通知
- Excel 側の変更の自動検知 (Phase 1 は起動時と手動の再読み込みのみ)
- Google Drive / NAS 同期 (設定の同期ペインは表示のみ)
- モバイルビルド

Phase 1 の動作確認は macOS のみ。Windows / Ubuntu は `npm run tauri build` を未確認。

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
