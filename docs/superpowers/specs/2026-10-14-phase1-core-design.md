# Phase 1: 土台 (xlsx 読み書き・タスク CRUD・クイック追加)

作成日: 2026-10-14
前提: `2026-10-13-powertodo-overall-design.md` (全体設計。§3 xlsx 形式、§4 アプリ構成、§5 ドメイン)、`2026-10-13-phase0.5-storybook-design.md` (UI コンポーネント)、PR #12 のコード
状態: 会話で設計合意済み。本ファイルのレビュー待ち。

## 1. 目的と範囲

Phase 0.5 の React コンポーネントを Rust 側の実データにつなぎ、ローカルの xlsx だけでタスク管理が一通りできるアプリにする。

含むもの
- `_PowerToDo.xlsx` (共通) と `<プロジェクト名>.xlsx` の生成・読み込み・保存 (全体設計 §3 の列)
- プロジェクトの追加・改名・削除、セクションの追加・改名・並び替え
- タスクの追加・編集 (名前、説明、優先度、期限、期限時刻、セクション、ラベル文字列)・完了 / 取り消し・削除・並び順変更・プロジェクト間移動
- サブタスク (親No.) の表示、展開、追加、完了 (多段)
- クイック追加の構文解析 (§5)
- 初回起動ステップ 1 (データフォルダの選択) と設定画面の「データ」ペイン (フォルダ表示・変更)
- Phase 0.5 の全画面のうち、プロジェクト (D-01 系)、クイック追加 (D-02)、タスク詳細 (D-03)、日付ピッカー (D-07)、初回起動 (D-12)、設定のデータペイン、最小ウィンドウ (D-13)、空 / エラー / 要修正の状態 (D-11) を実データで動かす

含まないもの (Phase 2 以降)
- 今日 / 近日 / ラベル / フィルター / ボードのビュー (画面は Storybook のまま。アプリでは「Phase 2」のプレースホルダ)
- 繰り返し、リマインダー、通知、トレイ常駐
- Excel 側の外部変更の監視と再読込 (Phase 2 で `notify` を入れる。Phase 1 は起動時の読み込みだけ)
- Google Drive / NAS 同期 (設定画面の同期ペインは表示のみ)
- ダークテーマの切替 UI (CSS は入っているので OS 設定に追従させるだけ)
- モバイルビルド

成功基準
- `npm run tauri dev` で macOS 上にアプリが起動し、初回起動でデータフォルダを選ぶと `_PowerToDo.xlsx` と `受信トレイ.xlsx` が作られる
- タスクを追加・編集・完了・削除・並び替えすると、1 秒以内に xlsx に反映され、Excel / LibreOffice で開いて Qiita 形式で読める
- Excel で編集した値 (タスク名、優先度、期限、備考) が次回起動時に反映される。型が壊れた行は「要修正」として表示される
- `cargo test` が通る (往復テスト、構文解析、営業日数)
- Windows / Ubuntu でのビルド確認は Phase 1 の最終タスクで 1 回行う (動作の細部は Phase 2 以降)

## 2. 構成

```
src-tauri/src/
  main.rs / lib.rs       Tauri 起動、command 登録、AppState (ProjectStore) の保持
  domain/
    mod.rs               Task, Project, Section, Label, Priority, 型変換 (serde)
    quick_add.rs         クイック追加の構文解析 → QuickAddResult
    dates.rs             日付語の解析 (今日 / 明日 / 来週月曜 / 10/20 / 2026-10-20 15:00、英語も)、営業日数
    ids.rs               No. の採番 (ファイル内最大 + 1、欠番は再利用しない)
  store/
    paths.rs             データフォルダの決定と保存先 (settings.json)
    common_book.rs       _PowerToDo.xlsx の読み書き
    project_book.rs      <プロジェクト>.xlsx の読み書き (見出し名で列を特定、未知列保持、型不整合の検出)
    project_store.rs     全プロジェクトのメモリ保持、変更 API、デバウンス保存、保存エラーの保持
    style.rs             rust_xlsxwriter の書式 (見出し、日付、条件付き書式、列幅、ウィンドウ枠固定)
  commands/
    mod.rs               Tauri command の薄い関数 (JSON in / out、エラーは文字列に変換)
  platform/
    mod.rs               app data dir、フォルダ選択ダイアログ (tauri-plugin-dialog)
src/
  api/
    client.ts            invoke の薄いラッパー (型は src/types/model.ts と共有)
    events.ts            project-changed の購読
  app/
    App.tsx              起動時の分岐 (初回起動 / 通常)、画面の切替、データ取得
    useProject.ts        プロジェクト状態の取得と command 呼び出し
```

- `domain` は I/O なし。`store` はファイル全体を読む / 書く。`commands` はロジックを持たない (全体設計 §4 のレイヤ規則)
- UI は Phase 0.5 の view をそのまま使い、`App.tsx` が props に実データとハンドラを渡す。Storybook はモックのまま動く

## 3. データの流れ

1. 起動: `settings.json` にデータフォルダがなければ初回起動画面 (ステップ 1)。あれば `_PowerToDo.xlsx` と全プロジェクトファイルを読み、`AppState` に保持
2. 読み込み失敗したプロジェクトは `LoadError` として保持し、UI では「読み込めません」(D-11b) を出す。他のプロジェクトは使える
3. UI の操作 → command → `ProjectStore` がメモリを更新 → 新しい `ProjectView` (JSON) を返す → 1 秒のデバウンス後にそのプロジェクトの xlsx を書き出す → 書き出し結果を `save-status` イベントで UI に通知
4. 書き込み失敗 (ロック等) は 3 回リトライ、失敗なら `save-status: error` をバナー表示。メモリの変更は保持し次の保存で再試行

## 4. Command API

JSON の型は `src/types/model.ts` の `Task` / `Project` / `Section` / `Label` と一致させる (serde の `rename_all = "camelCase"`)。

| command | 引数 | 戻り値 | 内容 |
| --- | --- | --- | --- |
| `app_state` | なし | `{ dataDir: string \| null, projects: ProjectSummary[], inbox: string }` | 起動時の状態 |
| `set_data_dir` | `{ path }` | `AppState` | フォルダを設定し、共通ファイルと受信トレイを作成 (既存なら読む) |
| `pick_folder` | なし | `string \| null` | OS のフォルダ選択ダイアログ |
| `list_projects` | なし | `ProjectSummary[]` (name, color, order, favorite, inbox, taskCount, loadError?) | サイドバー用 |
| `get_project` | `{ name }` | `ProjectView` (project, sections, tasks, invalidRows) | 画面用 |
| `create_project` | `{ name, color }` | `ProjectSummary` | ファイル作成 |
| `rename_project` | `{ name, newName }` | `ProjectSummary` | ファイル名も変更 |
| `delete_project` | `{ name }` | なし | ファイルを `archive/` に移動 (物理削除しない)。受信トレイは不可 |
| `add_section` / `rename_section` / `reorder_sections` | 各 | `ProjectView` | 設定シートのカテゴリ一覧を更新 |
| `add_task` | `{ project, input: TaskInput }` | `ProjectView` | `TaskInput` = title, section?, priority?, due?, dueTime?, note?, labels?, parentNo? |
| `update_task` | `{ project, no, patch: TaskPatch }` | `ProjectView` | 部分更新 |
| `complete_task` | `{ project, no, done }` | `ProjectView` | 進捗 100 / 0、完了日時 |
| `delete_task` | `{ project, no }` | `ProjectView` | サブタスクも削除 |
| `move_task` | `{ project, no, toProject, toSection? }` | `{ from: ProjectView, to: ProjectView }` | No. は移動先で採番、子も移す |
| `reorder_tasks` | `{ project, section, order: number[] }` | `ProjectView` | 並び順を書き換え |
| `quick_add` | `{ text, defaultProject }` | `{ parsed: QuickAddResult, view: ProjectView }` | 解析して追加 |
| `parse_quick_add` | `{ text }` | `QuickAddResult` | 入力中のプレビュー用 (追加しない) |
| `settings` / `update_settings` | 各 | `Settings` (displayName, weekStart, dataDir) | `_PowerToDo.xlsx` の設定シート + settings.json |

イベント: `project-changed { name }` (別経路で変わったとき。Phase 1 では move_task の from/to 以外ほぼ使わない)、`save-status { project, state: "saving" | "saved" | "error", message? }`。

エラー: command は `Result<T, AppError>`。`AppError` は `{ kind: "not_found" | "invalid" | "io" | "locked" | "corrupt", message }` を JSON で返す。UI は kind でバナー文言を変える。

## 5. クイック追加の構文

入力例: `買い物 明日 p1 #買い物 @急ぎ`

| 要素 | 形式 | 例 |
| --- | --- | --- |
| プロジェクト | `#名前` (空白を含むときは `#"名前 x"`) | `#買い物` |
| ラベル | `@名前` 複数可 | `@急ぎ @食品` |
| 優先度 | `p1`〜`p4` (大文字小文字不問) | `p1` |
| 日付 | 日本語: 今日 / 明日 / 明後日 / 来週 / 来週月曜 (〜日曜) / 今週末 / M/D / M月D日 / YYYY-MM-DD。英語: today / tomorrow / next mon (〜sun) / next week / M/D。時刻: `15:00` / `15時` / `3pm` を日付の後ろに置ける | `来週月曜 15:00` |
| タスク名 | 上記を取り除いた残り (前後の空白を除く) | `買い物` |

- 解析は左から右。先に見つかったものが有効。二重指定は後勝ち
- 日付は「今日」を基準に解決 (タイムゾーンはローカル)。過去の M/D は来年扱いにしない (そのまま過去日)
- `parse_quick_add` はトークンの位置 (開始・終了) も返し、UI が D-02 のチップ表示に使う
- 単体テスト: 日本語 / 英語 / 混在 / 時刻付き / 二重指定 / 記号だけ の 20 ケース以上

## 6. xlsx の読み書き

- 読み: `calamine` で「タスク一覧」の 1 行目を見出しとして読み、見出し名 → 列番号の対応を作る。既知の列 (全体設計 §3 の A〜R) 以外は `extra: BTreeMap<String, String>` に保持して書き戻す。日付セルはシリアル値から `NaiveDate` / `NaiveDateTime` へ。型不整合の行 (日付欄が文字列など) は `InvalidRow { no, column, value, message }` として返し、その行は `Task` にしない (書き戻しは元の値のまま)
- 書き: `rust_xlsxwriter` でブック全体を生成。見出し行 (太字、背景色)、日付列は `yyyy-mm-dd` / `yyyy-mm-dd hh:mm` 書式、列幅、ウィンドウ枠固定 (見出し行)、オートフィルター、条件付き書式 (進捗 100 → 灰色 + 取り消し線、終了 < 今日 かつ 進捗 < 100 → 赤文字)、「設定」シート (見出し行 / 開始行 / 開始列 / 終了列、カテゴリ一覧、担当一覧、優先度)、入力規則 (カテゴリ・担当・優先度のプルダウン)
- 書き込みは一時ファイルに書いてから `rename` (途中で落ちても元ファイルを壊さない)
- 共通ファイル `_PowerToDo.xlsx` も同様 (プロジェクト / ラベル / フィルター (空) / 祝日 (空) / 設定)
- 往復テスト: domain → xlsx → domain で同値。Qiita 形式の手作りファイル (`src-tauri/tests/fixtures/qiita.xlsx`、Excel で作って保存したもの) を読めること

## 7. 初回起動と設定

- `settings.json` (app data dir): `{ dataDir, windowBounds? }`
- 初回起動 (D-12 ステップ 1): 既定値は app data dir の `data/`。「選択」で `pick_folder`。「次へ」で `set_data_dir` → 共通ファイルと `受信トレイ.xlsx` を作成 → 通常画面へ。ステップ 2 (同期先) と 3 (受信トレイ名) は Phase 1 では出さない (受信トレイ名は固定)
- 設定ダイアログの「データ」ペイン: 現在のフォルダ表示、「フォルダを開く」(OS のファイラ)、「変更」(pick_folder → set_data_dir。既存ファイルは移動しない。旧フォルダのファイルはそのまま)

## 8. エラー処理

- 読み込み失敗: `ProjectSummary.loadError` にメッセージ。UI は D-11b。再試行ボタンで `get_project` を再実行
- 型不整合: `ProjectView.invalidRows`。UI は D-11c (バナー + 行の強調)。その行は編集不可
- 保存失敗: `save-status: error`。バナー「保存できません (理由)」。再試行は次の変更時または「再試行」ボタン (`retry_save { project }` command を追加)
- 受信トレイの削除、空のタスク名、存在しない No. などは `invalid` で返し、UI はトースト表示 (簡易)

## 9. テスト

- `cargo test`: `domain::quick_add` (20+ ケース)、`domain::dates` (相対日付、営業日数、祝日)、`store::project_book` (往復、未知列、型不整合、Qiita fixture)、`store::common_book`、`store::project_store` (採番、削除時の子の扱い、移動時の採番、デバウンス保存は時間を注入してテスト)
- UI: Storybook はモックのまま。アプリは手動確認 (最終タスクでチェックリスト)
- CI は Phase 1 では置かない (Phase 2 で GitHub Actions に `cargo test` と `npm run build-storybook`)

## 10. 決定ログ

| 日付 | 決定 | 理由 |
| --- | --- | --- |
| 2026-10-14 | サブタスクを Phase 1 に前倒し | Storybook で UI が完成しており、親No. の扱いは CRUD と一体で作る方が二度手間がない |
| 2026-10-14 | 外部変更の監視 (`notify`) は Phase 2 | Phase 1 は起動時読み込みだけに絞り、保存の信頼性 (一時ファイル + rename、リトライ) を先に固める |
| 2026-10-14 | 保存はファイル全体の再生成 + 一時ファイル → rename | 部分更新より単純で壊れにくい。アプリが正本 |
| 2026-10-14 | 削除は `archive/` への移動 | ユーザーの誤操作で xlsx を失わない |
| 2026-10-14 | 初回起動は Phase 1 ではステップ 1 のみ | 同期は Phase 4、受信トレイ名は固定で十分 |
| 2026-10-14 | command の戻り値は常に最新の `ProjectView` 全体 | UI 側で差分適用のロジックを持たない (全体設計 §4) |
