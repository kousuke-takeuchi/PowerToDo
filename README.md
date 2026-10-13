# PowerToDo

Excel (xlsx) をデータベースにした Todoist 風の ToDo アプリ。
Windows / macOS / Ubuntu のデスクトップと、iOS / Android のモバイルで同じデータを扱う。
データは Google Drive 経由で同期する。

- 1 プロジェクト = 1 xlsx ファイル (形式は [Qiita: エクセル七つ道具ではじめるシンプルなタスク管理](https://qiita.com/y-tetsu/items/c028737330fc47106fe8) 準拠 + 拡張列)
- 技術: Tauri 2 (Rust コア) + React / TypeScript / Tailwind
- 設計書: `docs/superpowers/specs/`
- 調査メモ: `docs/research/`
- デザイン: `design/` (pen.dev)
