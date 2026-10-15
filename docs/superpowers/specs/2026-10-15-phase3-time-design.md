# Phase 3: 時間系 (繰り返し・リマインダー・通知・トレイ常駐)

作成日: 2026-10-15
前提: `2026-10-13-powertodo-overall-design.md` (§3 xlsx 形式の「繰り返し」「リマインダー」列、§5 繰り返し / リマインダー、§9 段階分け)、`2026-10-14-phase1-core-design.md` (command と保存)、`2026-10-14-phase2-views-design.md` (横断ビュー、イベント、外部変更の保留、終了の扱い)、main のコード (PR #21 まで)
状態: 会話で範囲合意済み。本ファイルのレビュー待ち。

## 1. 目的と範囲

タスクに「いつ繰り返すか」と「いつ知らせるか」を持たせ、アプリを閉じていても (トレイに残っている間は) 通知が届くようにする。

含むもの
- 繰り返し: RRULE で保持、完了すると同じ行の期限が次回に進む。自然言語 (日英) → RRULE の変換、D-07b のピッカーに入力欄とプレビュー、クイック追加の構文への追加
- リマインダー: 期限からの相対 (既存コード) と日時指定。期限時刻付きのタスクに既定リマインダーを自動付与、設定「日付と時刻」で既定を変更 / 無効化
- 発火: Rust のスケジューラが OS 通知を出す。発火済みの記録、停止中に過ぎた分の起動時まとめ
- アプリ内の「リマインダー」帯: 通知と同じ内容を一覧し、完了 / 後で / 開く
- トレイ常駐: ウィンドウを閉じても終了せずトレイに残る (設定で切替)。トレイメニューから 開く / クイック追加 / 終了
- 最初のタスクとして `Main.tsx` (約 780 行) をフックに分割する (振る舞いは変えない)

含まないもの
- モバイルのローカル通知 (Phase 6。OS に事前登録する方式はそのときに)
- OS 起動時の自動起動 (`tauri-plugin-autostart`。Phase 5 候補)
- 通知音、通知からの「後で」の時間選択 (通知のボタンは固定の 2 つ。選択は帯で)
- 繰り返しの例外日 (EXDATE)、終了条件 (COUNT / UNTIL) の UI (RRULE に書いてあれば尊重する)
- 完了履歴 (全体設計どおり、1 行が繰り返し続ける)

成功基準
- 「毎週月曜」のタスクを完了にすると、進捗 0 のまま期限が次の月曜になり、xlsx の「繰り返し」列に `FREQ=WEEKLY;BYDAY=MO` が残る。Excel で RRULE を直接書いても次回計算に使われる
- クイック追加で `ゴミ出し 毎週火曜 8:00` と打つと、期限 = 次の火曜 8:00、繰り返し = 毎週火曜、既定リマインダー (同時刻) が付く
- 期限時刻を 2 分後にしたタスクを作ると、その時刻に OS 通知が出て、アプリ内に帯が出る。帯の「完了」で完了し、「後で (10 分)」で 10 分後にもう一度出る
- ウィンドウを閉じてもトレイに残り、通知は届く。トレイの「終了」は Phase 2 の保留確認を通る
- アプリを止めている間に過ぎたリマインダーは、次の起動で 1 件の通知と帯にまとまる
- `cargo test` が通る (RRULE の次回計算、自然言語変換、リマインダーの発火時刻、スケジューラの判定)。Storybook の既存画面は変えない

## 2. 構成

```
src-tauri/src/
  domain/
    recurrence.rs        RRULE の解釈: 次回の期限、完了日基準の判定、表示用の要約 (純関数、rrule crate)
    recurrence_words.rs  自然言語 → RRULE (日英。純関数)
    reminders.rs         リマインダーのコードと期限から発火時刻を求める (純関数)
    quick_add.rs         繰り返し語の解釈を追加 (QuickAddResult.rrule、Span kind "recurrence")
  store/
    project_store.rs     complete_task の繰り返し処理、既定リマインダーの付与
    fired.rs             発火済みの記録 (app data dir の fired.json)
  scheduler/
    mod.rs               30 秒ごとの判定、通知の送信、イベント発行、起動時のまとめ
  tray.rs                トレイアイコンとメニュー、ウィンドウ閉じ → 隠す
  commands/mod.rs        snooze / dismiss / 設定 の command、通知権限の確認
src/
  app/
    useCrossViews.ts, useRowShortcuts.ts, useSearchDialog.ts, useBanners.ts   Main.tsx からの分割 (Task 0)
    useReminders.ts      reminder-fired イベントの購読と帯の状態
  views/
    RecurrencePicker.tsx 自然言語入力欄とプレビュー行を追加 (props は optional、Storybook は従来どおり)
    ReminderBanner.tsx   新規: アプリ内のリマインダー帯 (D-08b の内容をアプリ内に)
    SettingsPanes.tsx    「通知」「日付と時刻」ペインの中身
```

- `domain` は I/O なし。時刻は引数で受ける (`now`)
- `scheduler` は Tauri の非同期ランタイム (`tauri::async_runtime::spawn`) で動く 1 本のループ。`ProjectStore` のロックは判定のあいだだけ取り、通知の送信はロックの外で行う (Phase 2 のロック順序に従う: store → saver。scheduler は saver を触らない)
- 新しい依存: `rrule = "0.14"`、`tauri-plugin-notification = "2.6"` (npm 側 `@tauri-apps/plugin-notification` 2.6 は権限の確認に使う)、tauri の `tray-icon` feature。他は増やさない

## 3. 繰り返し

### 3.1 保持と次回計算

- 「繰り返し」列は RRULE の本体だけを持つ (`FREQ=WEEKLY;BYDAY=MO`)。`DTSTART` は書かない。計算時に `DTSTART` = 現在の期限 (期限なしなら今日) + 期限時刻 (なければ 00:00) をローカル時刻で付けて `rrule` crate に渡す
- 次回 = `DTSTART` より後 (当日は含まない) の最初の発生。`after(dtstart, inclusive=false)`。見つからなければ (COUNT / UNTIL で終わった) 繰り返しを外す
- 完了日基準: RRULE の末尾に `;X-FROM=COMPLETED` を付ける (非標準パラメータ。Excel で読んで意味が分かる)。計算時はこのパラメータを外し、`DTSTART` = 完了した日 (時刻は元の期限時刻) にする。付いていなければ期限基準
- `complete_task(done = true)` のとき繰り返しがあれば: 期限を次回に進め、進捗 0、完了日時は空のまま、サブタスクは触らない (全体設計 §5)。戻り値の `ProjectView` には進んだ期限が入る。UI はチェックの直後にその行を 400ms 残して (Phase 2 と同じ `useLeaving`) 新しい期限で表示し直す。`done = false` は通常の取り消し (期限は戻さない。直前の完了で進んだ期限は分からないため)
- RRULE が解釈できない (Excel で書き間違い) ときは、完了は通常どおり (進捗 100) にして、`invalid` ではなく UI へ `notice` で「繰り返しの指定が読めません: <RRULE>」を返す (`ProjectView` に `warnings: string[]` を足す。他の用途にも使える)
- 「日数」列は期限が進むたびに再計算 (Phase 1 の `recompute_days`)

### 3.2 自然言語 → RRULE (`recurrence_words.rs`)

| 入力 (日 / 英) | RRULE |
| --- | --- |
| 毎日 / every day / daily | `FREQ=DAILY` |
| 平日 / every weekday / weekdays | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| 毎週 / every week / weekly | `FREQ=WEEKLY` (曜日は期限の曜日) |
| 毎週月曜 / 毎週月 / every monday / every mon | `FREQ=WEEKLY;BYDAY=MO` |
| 毎週月水金 / every mon,wed,fri | `FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| 隔週 / every 2 weeks / every other week | `FREQ=WEEKLY;INTERVAL=2` |
| 毎月 / every month / monthly | `FREQ=MONTHLY` (日は期限の日) |
| 毎月1日 / 毎月 15 日 / every month on the 1st / monthly on 15 | `FREQ=MONTHLY;BYMONTHDAY=1` |
| 毎月末 / 月末 / every month end / last day of month | `FREQ=MONTHLY;BYMONTHDAY=-1` |
| 毎年 / every year / yearly | `FREQ=YEARLY` (月日は期限) |
| 毎年10月18日 / every oct 18 | `FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=18` |
| 3日ごと / every 3 days | `FREQ=DAILY;INTERVAL=3` |
| 毎3日! / 3日ごと! / every 3 days! | `FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED` (末尾の `!` が完了日基準。Todoist 互換) |

- 数字は全角半角どちらも。曜日は 月 火 水 木 金 土 日 / 月曜 / 月曜日 / mon / monday。英語は大文字小文字を無視
- 複数の繰り返し語があれば後ろが勝つ (クイック追加の他の要素と同じ)
- 変換できない語はタスク名に残す (期限語と同じ方針)
- 逆方向 (RRULE → 表示文言) は `recurrence.rs` の `summarize(rrule) -> String` で「毎週月曜」「毎月末」「3 日ごと (完了日から)」など。表に無い RRULE は RRULE 文字列をそのまま返す (D-07b の確認観点「RRULE はノイズか」への答え: 要約できるものは要約、できないものだけ生で)

### 3.3 UI

- D-07b (RecurrencePicker) にテキスト入力欄「毎週月曜 のように入力」を足し、入力が止まったら `parse_recurrence { text }` command で RRULE と要約を取ってプレビュー行に出す。Enter で確定。プリセットは従来どおり。`onChange(rrule)` の契約は変えない
- タスク詳細の「繰り返し」行は `summarize` の文言。Phase 0.5 の `recurrenceLabel` (TS 側の固定表) は `summarize` と同じ結果になるよう、プリセット分だけ残して他は command の値を使う (`Task` に `rruleLabel?: string` を Rust が付けて返す。TS は表を捨てる)
- クイック追加: `QuickAddResult` に `rrule: Option<String>` と Span kind `recurrence` を足す。トークンの色は期限と同じ系統 (Phase 0.5 の `QuickAddToken` に kind を追加)。繰り返し語だけで期限語が無いときは、期限を最初の発生 (今日を含む `first_on_or_after`) にする。`毎週火曜` を火曜に打てば今日、それ以外なら次の火曜
- 繰り返しがあるタスクの行に小さな繰り返しアイコン (lucide `Repeat` 12px) を期限チップの右に出す (TaskRow の `recurring?: boolean`。既存 Story は渡さないので不変)

## 4. リマインダー

### 4.1 データ

- 「リマインダー」列はカンマ区切り。相対: `-0m` `-10m` `-30m` `-60m` `-1d` `-1w` (Phase 0.5 の `ReminderPicker` のコードそのまま)。日時指定: `2026-10-20T09:00` (ローカル、分まで)
- 相対の基準は期限 + 期限時刻。期限時刻が無いときの相対は、`-1d` と `-1w` だけ有効で「前日 / 1 週間前の 9:00」、他は無効 (発火しない)。`-1d` は期限時刻があっても「前日の 9:00」(Phase 0.5 の表示文言どおり)。9:00 は設定「日付と時刻」の「時刻なしの通知時刻」(既定 09:00)
- 既定リマインダー: 期限時刻付きのタスクを作る / 期限時刻を付けるとき、リマインダーが空なら設定の既定 (初期値 `-0m`) を 1 つ付ける。既定が「なし」なら付けない。既に 1 つ以上あるときは触らない。Excel で作った行には付けない (読み込み時には触らない)
- 繰り返しで期限が進んだら、リマインダーの相対指定はそのまま次回に効く。日時指定は過去になるので外す

### 4.2 設定 (共通ファイルの設定シートに追加するキー)

| キー | 値 | 既定 |
| --- | --- | --- |
| 既定リマインダー | `-0m` などのコード、または `なし` | `-0m` |
| 時刻なしの通知時刻 | `HH:MM` | `09:00` |
| 閉じたときトレイに残す | `はい` / `いいえ` | `はい` |
| 通知 | `はい` / `いいえ` (アプリ全体の通知オン / オフ) | `はい` |

- 「日付と時刻」ペイン: 既定リマインダー (Segmented: なし / 同時刻 / 10 分前 / 30 分前 / 1 時間前 / 前日)、時刻なしの通知時刻 (時刻入力)、週の開始 (Phase 1 の値をここに移す。アカウントペインに重複して出さない)
- 「通知」ペイン: 通知オン / オフ、OS の権限状態 (「許可済み」「未許可 → 許可を求める」ボタン)、閉じたときトレイに残す

### 4.3 発火 (scheduler)

- 起動時と 30 秒ごとに: 読み込めた全プロジェクトの未完了タスクについて、各リマインダーの発火時刻を計算し、`fired.json` に無く、`now - 24h < 発火時刻 <= now` のものを発火する。24 時間より古いものは「停止中に過ぎた」としてまとめの対象 (§4.5)。発火したら `fired.json` に `project/no/コード/発火時刻` を記録
- `fired.json` は app data dir (`settings.json` の隣)。どのデータフォルダの記録かを `dataDir` に持ち、データフォルダを切り替えたら記録を捨てる (プロジェクト名は「受信トレイ」のようにフォルダをまたいで重なるため)。別のフォルダの記録を指す通知の操作は無視する。タスクの期限や時刻、リマインダーが変わると、そのタスクの記録を消す (再発火できる)。タスクが完了 / 削除されたら消す。起動時に、もう存在しないタスクの記録を掃除する
- OS 通知: `tauri-plugin-notification` の Rust API (`app.notification().builder().title(タスク名).body("<プロジェクト> · <期限 15:00>").show()`)。通知の権限は起動時に確認し、未許可なら設定ペインに表示するだけで勝手に要求しない (初回は「通知」ペインの「許可を求める」から)。macOS の開発ビルドでも bundle id があれば出る (Phase 1 の debug bundle で確認)
- 通知のボタン: `tauri-plugin-notification` 2.6 はデスクトップでも action type のボタンと `on_action` (クリック = `tap`、ボタン = action id) を受け取れる (docs.rs の 2.6.0 で確認。Web ガイドの「Actions はモバイル限定」は古い)。ボタンは 2 つで、順番は「後で (10 分)」「完了」。macOS は 2 つ以上のボタンが「オプション」メニューに畳まれ、メニューボタン自体のクリックは先頭のボタンとして届くため、押し間違えても害の少ない「後で」を先頭にした。Windows はトーストが画面にある間だけクリックが届く (アクションセンターに移ったら届かない)。届かなかった操作のための受け皿としてアプリ内の帯 (§4.4) を必ず出す。クリック (`tap`) はウィンドウを出して該当タスクの詳細を開く (`show_main_window` + イベント `open-task { project, no }`)。記録が無い、または発火時刻が合わない古い通知のボタンは、何も実行せずウィンドウを出すだけにする (繰り返しタスクで次回の発生を飛ばさないため)
- 発火と同時にイベント `reminder-fired { project, no, title, code, at }` を UI に送る。通知がオフでもイベントは送る (帯だけ出る)
- 同じタスクの複数リマインダーが同じ 30 秒に重なったら 1 通にまとめる (本文に件数)

### 4.4 アプリ内の帯 (ReminderBanner)

- AppShell の banner スロット (Phase 2 の帯と同じ場所)。1 件なら「<タスク名> · <プロジェクト> · 期限 15:00」とボタン 完了 / 後で / 開く / 閉じる。複数なら「N 件のリマインダー」+ 展開で一覧 (各行に同じボタン)
- 完了: `complete_task` (繰り返しなら次回へ)。後で: ポップオーバーで 10 分 / 1 時間 / 明日 9:00 → `snooze_reminder { project, no, until }` が `fired.json` に「until に再発火」を記録 (タスクのリマインダー列は変えない)。開く: そのプロジェクトへ移動して詳細を開く (Phase 2 の `openCross`)。閉じる: 帯から消すだけ (`fired.json` は発火済みのまま)
- 帯の内容はウィンドウを隠している間も UI 側の state に溜まり、表示したときに見える。起動直後は §4.5 のまとめが入る

### 4.5 起動時のまとめ

- 起動時の最初の判定で「停止中に過ぎた」(発火時刻 <= now - 24h、または前回終了時刻より後で now より前) リマインダーが 1 件以上あれば、OS 通知を 1 通「N 件のリマインダーがありました」(2 件以上のとき。1 件だけなら通常の通知) と、帯に一覧 (各行に 完了 / 開く / 閉じる。後で も可)。それぞれ `fired.json` に発火済みとして記録
- 前回終了時刻は `fired.json` の `lastSeen` (スケジューラが判定のたびに更新)。初回起動は 24 時間前を基準にする

## 5. トレイ常駐

- `tray-icon` feature。起動時にトレイアイコン (単色の `tray.png` を Phase 3 で追加。macOS はテンプレート画像として扱い、メニューバーの明暗に追従)。アプリのアイコンは Phase 0 のデザイン (`design/icons/icon-1024.png`) を `tauri icon` で全サイズに差し替える (足場のままだった)。ツールチップ「PowerToDo」
- メニュー: 「PowerToDo を開く」「タスクを追加…」(ウィンドウを出してクイック追加を開く: イベント `open-quick-add`)、区切り、「終了」(Phase 2 の held 確認を通す: macOS の独自 Quit 項目と同じ処理を関数にまとめる)
- ウィンドウを閉じる (`CloseRequested`): 設定「閉じたときトレイに残す」が はい なら `prevent_close` して隠す (macOS / Windows のみ。Linux は Phase 3 では隠さず、設定に関わらず終了する)。いいえ なら Phase 2 どおり終了 (held 確認あり)。macOS はウィンドウを閉じても Dock に残る (Tauri の既定)。Dock アイコンのクリックで再表示 (`RunEvent::Reopen`)
- トレイクリック (左): ウィンドウを出す (Linux はイベントが来ないのでメニューで)
- 隠れている間もスケジューラは動く。通知のクリック (`tap`) は `on_action` で受けてウィンドウを出す。macOS の Dock クリックは `RunEvent::Reopen` (macOS 限定の variant。tauri 2.12.3 の `app.rs` で確認) で受けてウィンドウを出す
- 単一インスタンス (`tauri-plugin-single-instance`) は入れない。2 つ目を起こしても Phase 2 の監視が同じフォルダを見て動くが、保存が競合しうるので README に注意書き (Phase 5 で検討)

## 6. Command API とイベント

| command | 引数 | 戻り値 | 内容 |
| --- | --- | --- | --- |
| `parse_recurrence` | `{ text }` | `{ rrule: string \| null, label: string \| null }` | 自然言語 → RRULE と要約 (ピッカーのプレビュー) |
| `summarize_recurrence` | `{ rrule }` | `{ label: string, valid: boolean }` | RRULE の要約 (Excel で書かれた値の表示) |
| `snooze_reminder` | `{ project, no, until }` | なし | `until` (ローカル `YYYY-MM-DDTHH:MM`) に再発火 |
| `dismiss_reminder` | `{ project, no, code }` | なし | 帯から消す (記録はそのまま。UI 側の整合のためだけ。UI だけで済むなら省く) |
| `pending_reminders` | なし | `{ items: ReminderItem[] }` | 起動直後の帯の初期値 (まとめと、UI が取り逃した発火) |
| `notification_permission` | なし | `"granted" \| "denied" \| "prompt"` | 設定ペインの表示 |
| `request_notification_permission` | なし | 同上 | 「許可を求める」 |
| `show_main_window` | なし | なし | トレイ / 通知からの復帰 (UI からも使える) |
| (Rust 内部) `on_action` | — | — | `tap` → ウィンドウを出し `open-task { project, no }` を emit。`done` → `complete_task`。`snooze` → 10 分後に再発火 (`snooze_reminder` と同じ処理) |
| `settings` / `update_settings` | 既存 | `SettingsDto` に `defaultReminder`, `notifyTime`, `keepInTray`, `notifications` を追加 | 共通ファイルの設定シート |

- `complete_task` の戻り値 `ProjectView` に `warnings: string[]` を追加 (RRULE が読めないときの文言)。`Task` に `rruleLabel?: string` を追加
- `QuickAddResult` に `rrule`、`Span.kind` に `"recurrence"`
- イベント: `reminder-fired { items: ReminderItem[] }`、`open-task { project, no }` (通知のクリック) (`ReminderItem = { project, no, title, code, at, due, dueTime }`)、`open-quick-add {}` (トレイ)、`window-shown {}` (隠れていたウィンドウが出た。UI は横断ビューを再取得)

## 7. エラー処理

- RRULE 不正: 完了は通常完了、`warnings` で通知 (§3.1)。ピッカーのプレビューは「解釈できません」
- 通知の権限なし / 送信失敗: ログに残し、帯は出す。設定ペインに状態を表示。失敗で発火済み記録は付ける (無限に再試行しない)
- `fired.json` が壊れている: 空として扱い、上書き。起動時のまとめは「24 時間以内」だけになる
- トレイが作れない (Linux の一部環境): ログに残し、「閉じたときトレイに残す」を無効扱い (閉じると終了)。設定ペインに注記
- スケジューラの判定中に store が無い (データフォルダ未設定): スキップ

## 8. テスト

- `domain::recurrence`: 次回計算 (週 / 月 / 月末 / 年 / INTERVAL / COUNT 終了)、完了日基準、`DTSTART` の付け方、不正 RRULE、`summarize` の表
- `domain::recurrence_words`: §3.2 の表の全行 (日英)、全角数字、複数語で後ろが勝つ、変換できない語は残る
- `domain::reminders`: 各コードの発火時刻、時刻なし期限での無効化、日時指定、前日 9:00 の設定値反映
- `store`: 完了で期限が進む / 進捗 0 / 日数再計算、不正 RRULE の `warnings`、既定リマインダーの付与条件、`fired.json` の読み書きと掃除
- `scheduler`: 判定を純関数 `due_reminders(tasks, fired, now, settings) -> (fire: Vec, missed: Vec)` に切り出してテスト (24 時間境界、スヌーズ、同一タスクのまとめ)。通知送信と Tauri は手動
- UI: 手動チェックリスト (PR 本文)。Storybook に `Views/ReminderBanner` (1 件 / 複数) と `D-07b 繰り返し (操作)` (入力欄とプレビュー) を追加。既存 40 画面は不変
- Windows / Ubuntu: CI の `cargo test` / `cargo build` (tray-icon feature を含む)。Ubuntu は `libayatana-appindicator3-dev` が Phase 2 の CI に既に入っている

## 9. 決定ログ

| 日付 | 決定 | 理由 |
| --- | --- | --- |
| 2026-10-15 | 完了日基準は RRULE に `;X-FROM=COMPLETED` を付けて表す | 列を増やさず、Excel で読んでも意味が分かる。`rrule` crate に渡す前に外す |
| 2026-10-15 | `DTSTART` は保存せず、計算時に現在の期限から組む | 1 行が繰り返し続ける設計では期限が常に基準。保存すると二重管理になる |
| 2026-10-15 | 繰り返しの取り消し (done = false) は期限を戻さない | 直前の完了で進んだ期限を区別できない。ユーザーが期限を直せば済む |
| 2026-10-15 | 不正な RRULE でも完了は通す。`warnings` で知らせる | Excel で書き間違えたとき、完了できないほうが困る |
| 2026-10-15 | 通知にボタン「完了」「後で (10 分)」を付け、クリックで該当タスクを開く。アプリ内の帯も同じ内容で出す | プラグイン 2.6 はデスクトップでも action と `on_action` を受けられる (docs.rs 2.6.0)。ただし macOS はボタンがメニューに畳まれ、Windows はアクションセンターに移ると届かないので、帯を受け皿にする |
| 2026-10-15 | 全体設計 §5 の「通知クリックで該当タスクを開く」はそのまま実現する (`tap` → `show_main_window` + `open-task`) | 同上 |
| 2026-10-15 | 発火済みの記録は app data dir の `fired.json` (共通ファイルではない) | 端末ごとの状態。xlsx に書くと Phase 4 の同期で他端末に伝わり、別の端末で鳴らなくなる。各端末で 1 回ずつ鳴るほうが安全で、Excel 側にも余計な列が増えない |
| 2026-10-15 | 時刻なしの期限に相対リマインダーは `-1d` / `-1w` だけ (9:00) | 「10 分前」は時刻が無いと意味が決まらない。前日 9:00 は Phase 0.5 の表示文言に合わせる |
| 2026-10-15 | 既定リマインダーはアプリで時刻付き期限を付けたときだけ付与。Excel で作った行には付けない | 読み込み時にデータを足すと、ユーザーが書いていないものがファイルに増える |
| 2026-10-15 | 設定キーは日本語 (`既定リマインダー` など) | 設定シートの既存キー (`表示名`, `週の開始`) に合わせる |
| 2026-10-15 | トレイ常駐は既定オン、設定で切替 | 常駐しないと通知が届かない。嫌う人のために切替を残す |
| 2026-10-15 | 単一インスタンスは入れない | 依存を増やさない。問題になれば Phase 5 |
| 2026-10-15 | Phase 3 の最初のタスクで `Main.tsx` を分割する | 780 行に Phase 3 の配線 (帯、トレイイベント、設定) を足す前に整える。振る舞いは変えない |
| 2026-10-15 | 繰り返し語だけのクイック追加 (`ゴミ出し 毎週火曜`) は、最初の発生を期限にする。今日が該当日なら今日 (`first_on_or_after`) | 計画の `next_due(今日 - 1)` は `DTSTART` が昨日になり、毎週では曜日がずれた。当日を含めないと火曜に打った `毎週火曜` が来週になる |
| 2026-10-15 | npm の `@tauri-apps/plugin-notification` は入れず、通知の権限確認と送信は Rust 側だけで行う (`notification:default` の capability も付けない) | JS から通知を直接出す場面が無い。必要になった時点で足す |
| 2026-10-15 | 通知のボタンの順は「後で (10 分)」→「完了」 | macOS は「オプション」メニュー自体のクリックが先頭のボタンとして届く。誤って届いても害が少ない「後で」を先頭にする (完了したいときは 1 回余分に押す) |
| 2026-10-15 | 古い通知の操作 (記録が無い、発火時刻が合わない) はウィンドウを出すだけで何もしない | アクションセンターに残った古い通知の「完了」で、繰り返しタスクの次回の発生を飛ばさないため |
| 2026-10-15 | `fired.json` に `dataDir` を持たせ、データフォルダの切り替えで記録を捨てる。別フォルダの記録を指す操作は無視 | 「受信トレイ」などのプロジェクト名とタスク番号はフォルダをまたいで重なる。切り替え直後は起動と同じ扱いで、1 通のまとめにする |
| 2026-10-15 | `fired.json` の更新ロックは store → fired の順で、fired は葉 (持ったまま store を取らない) | スケジューラと command の相互待ちを避ける |
| 2026-10-15 | 起動時のまとめは 2 件以上のときだけ。1 件なら通常の通知 | 「1 件のリマインダーがありました」より、タスク名が見える通常の通知のほうが役に立つ。基準は `lastSeen` (無ければ 24 時間前) |
| 2026-10-15 | `pending_reminders` は読み出すと空になる。UI は起動時と `reminder-fired` のたびに呼ぶ (イベントの中身は使わない) | ウィンドウを隠している間や UI の起動前に発火した分も、1 回ずつ確実に帯へ届く |
| 2026-10-15 | Linux では Phase 3 の間、ウィンドウを閉じても隠さず終了する (「閉じたときトレイに残す」は効かない) | GNOME は既定でトレイの受け側が無く、隠すとウィンドウに戻れない。Phase 5 で StatusNotifierWatcher の D-Bus 確認を入れて再検討。代償: Linux ではウィンドウを閉じるとバックグラウンド通知が止まる |
| 2026-10-15 | 足場のままだったアプリのアイコンを、Phase 0 のデザイン (アイコン案 B) に差し替え、単色の `tray.png` を追加 | 仕様 §5 の `tray.png` を作るタスクが無かった。アプリのアイコンは設計済みで未適用だった |
| 2026-10-15 | 繰り返しの完了後、行は残る (進捗 0、新しい期限)。ProjectView は 400ms チェックを見せてから新しい期限で表示し直す | §3.1 のとおり。追加の UI 作業はいらない (見た目だけの差) |
| 2026-10-15 | 繰り返しアイコンは実アプリ (`onToggleDone` が渡るとき) だけ出す | Storybook の既存画面を変えないため |
| 2026-10-15 | 繰り返し語は 2 語の組 (毎週 + 曜日、毎月 + N 日) を 1 語の語より先に判定する | 仕様 §3.2 の `毎週 月曜` のような書き方を取りこぼさない。テストがこの順を固定している |
| 2026-10-15 | `valid` (`summarize_recurrence`) は「次回の計算がエラーにならない」こと。COUNT / UNTIL を使い切った規則も valid | 書式として正しい規則を「読めません」と扱わない。読めないのは `Err` のときだけ |
| 2026-10-15 | `Main.tsx` は 578 行で止める (目標 300 行は計画の見積り)。Phase 3 の配線は `useReminders` などのフックに入れた | 残りはサイドバー / パネル / 本体 / オーバーレイの JSX で、分けても読みやすくならない |
