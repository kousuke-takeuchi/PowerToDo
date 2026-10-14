# Phase 2: ビュー (今日 / 近日 / ラベル)・検索・キーボード操作・外部変更の監視・CI

作成日: 2026-10-14
前提: `2026-10-13-powertodo-overall-design.md` (§5 ビュー、§9 段階分け)、`2026-10-14-phase1-core-design.md` (command API、`ProjectStore`、保存)、PR #16 のコード (Phase 1)、PR #17 (アニメーション)
状態: 実装済み (PR 参照)

## 1. 目的と範囲

Phase 1 で 1 プロジェクトずつ動いているアプリに、プロジェクトを横断するビューと操作を足す。Excel 側で直したファイルを起動し直さずに取り込む。

含むもの
- 今日ビュー (期限切れグループ + 一括再スケジュール)、近日ビュー (7 日ずつ延長、週ストリップ、月ジャンプ)、サイドバーの「今日」の件数
- ラベル: 一覧 (共通ファイルのラベル ∪ タスクで使われている名前)、追加 / 改名 / 削除 / 色、ラベル詳細 (横断)
- 検索ダイアログ (Cmd/Ctrl+K): 全プロジェクト、名前 + 備考 + ラベルの部分一致、かな・大文字小文字の同一視、完了を含めるトグル
- キーボード操作: `q`、`Cmd/Ctrl+K`、`g t` / `g u` / `g i`、`↑ ↓`、`Enter`、`e`、`Delete`、`1`〜`4`、`t` / `m`、`Esc`
- 外部変更の監視 (`notify`): 未保存の編集が無ければ自動再読込、あれば帯で「再読み込み」か「上書き保存」を選ばせる
- CI (GitHub Actions): Web のチェックと、ubuntu / windows / macos での `cargo test` と `cargo build`

含まないもの
- ボード、フィルタークエリ、繰り返し、リマインダー、同期、モバイル (各 Phase の計画どおり)
- UI の自動テスト (WebdriverIO + `@wdio/tauri-service`)。検討結果は §9。導入は Phase 5 以降
- フィルター一覧の中身 (D-06 の「フィルター」グループは見出しと「+」だけ出し、「+」は Phase 5 の案内を出す)

成功基準
- サイドバーの 今日 / 近日 / フィルターとラベル が実データで動き、どの画面からでも完了・優先度・期限の変更が元のプロジェクトファイルに保存される
- Excel で `受信トレイ.xlsx` を直して保存すると、アプリが 2 秒以内に画面を更新する。アプリ側に未保存の編集があるときは帯が出て、どちらを残すか選べる
- 検索で「ぎゅうにゅう」と打つと「牛乳」は見つからないが「ギュウニュウ」「ぎゅうにゅう」は見つかる (かなの同一視)。`Milk` と `milk` は同じ
- マウスを使わずに、タスクの追加・完了・優先度・期限・削除・詳細の表示ができる
- `main` への push と PR で GitHub Actions が走り、3 OS の `cargo build` が通る
- `cargo test` が通る (ビューの抽出、検索の正規化、監視のイベント判定)。Storybook の 40 画面は変えない

## 2. 構成

```
src-tauri/src/
  domain/
    views.rs             今日 / 近日 / ラベル詳細 の抽出と並び (純関数)
    search.rs            検索語の正規化と一致判定 (純関数)
  store/
    project_store.rs     all_tasks()、ラベルの追加 / 改名 / 削除、reschedule_overdue、外部変更の適用
    watcher.rs           notify の購読、イベントの判定 (自分の書き込みか、対象ファイルか)、デバウンス
  commands/
    mod.rs               追加 command (§4)。監視イベントの UI 通知
src/
  api/client.ts, events.ts   追加 command とイベントの型
  app/
    Main.tsx             nav に label を追加、横断ビューの表示、検索 / 外部変更の帯
    useCrossView.ts      横断ビュー (今日 / 近日 / ラベル詳細) の取得と再取得
    shortcuts.ts         キー列 (g t など) の解釈、入力中の判定、行フォーカスの移動
    useRowFocus.ts       リスト内のフォーカス行 (No. と project) と ↑↓ / Enter / e / Delete / 1-4 / t / m
  views/
    TodayView.tsx, UpcomingView.tsx, LabelsView.tsx, LabelDetailView.tsx   コールバック props を足す (Storybook の既定値は変えない)
    SearchDialog.tsx     新規 (QuickAddDialog と同じ外観)
    ExternalChangeBanner.tsx   新規 (FixBanner と同じ帯)
.github/workflows/ci.yml
```

- `domain` は I/O なし。横断ビューの抽出は `Vec<&Task>` を受け取って並べるだけ
- `store` は全プロジェクトを持っているので、横断ビューは `ProjectStore::all_tasks()` (読み込めたプロジェクトのタスクの連結) を `domain::views` に渡す
- UI は Phase 0.5 の view に props を足す。Storybook は `useDone` の見た目だけの完了のまま動く (ProjectView と同じ方式: ハンドラが渡されたときだけ command を呼ぶ)
- `project_store.rs` は 1900 行を超えている。Phase 2 で足すラベル操作と外部変更の適用は `store/labels.rs` と `store/external.rs` に分け、`ProjectStore` の `impl` ブロックをファイル単位で分割する (振る舞いは変えない)

## 3. ビュー

### 3.1 今日

- 対象: 読み込めた全プロジェクトの、親の無い (サブタスクでない) 未完了タスクで、期限が今日以前
- 期限切れ (期限 < 今日) は「期限切れ」グループ。期限の昇順、同日なら優先度の昇順 (1 が先)、同じなら No.。今日のグループは優先度の昇順、No.
- 「再スケジュール」は日付ピッカー (D-07) を開き、選んだ日を期限切れ全件に設定する (`reschedule_overdue`)。時刻は保つ。ピッカーの「今日」は既定で選択
- 追加行: 受信トレイに期限 = 今日で追加 (`add_task { project: inbox, input: { title, due: today } }`)。クイック追加の構文は使わない (ProjectView の追加行と同じ)
- サイドバーの件数: 期限切れ + 今日の合計 (`counts` command)。親の無いタスクだけ数える
- サブタスクは今日ビューには出さない。期限付きのサブタスクを見るのはプロジェクト画面 (Todoist も同じ)

### 3.2 近日

- 対象: 親の無い未完了タスクで、期限が `from` 以降 `from + days - 1` 以内。日付ごとにグループ化。タスクの無い日も見出しと追加行を出す (pen のまま)
- 初期表示: `from = 今日`、`days = 7`。末尾の「さらに 7 日」で `days += 7` (上限 91)。週ストリップは `from` から 7 日、クリックでその日の見出しへスクロール (その日が範囲外なら `days` を伸ばす)
- 月セレクト: 今月から 12 か月のリスト。選ぶと `from` をその月の 1 日 (今月なら今日) にし `days = 7` に戻す。「今日」ボタンで `from = 今日`
- 期限切れは近日に出さない (今日ビューの役割)
- 各日の追加行: 受信トレイにその日を期限として追加
- 週の始まり (`settings.weekStart`) は週ストリップに影響しない (常に `from` から 7 日)。カレンダー表示は Phase 5

### 3.3 ラベル

- ラベルの正体は 2 つある: 共通ファイルのラベルシート (名前、色、並び) と、各タスクの「ラベル」列の文字列。一覧は両者の和集合。シートに無い名前は色を `ProjectStore` の既定色 (`var(--color-text-muted)`、プロジェクトと同じ)、並びは末尾 (名前順)
- 件数: そのラベルが付いた未完了タスク (サブタスク含む) の数
- 追加: 「+」で一覧の上に入力欄 (サイドバーのプロジェクト追加と同じ)。Enter で `add_label { name, color }` (色は既定色)。重複は `invalid`
- 行の右端にホバーで「その他」(HeaderActions の MoreMenu と同じ): 名前を変更 / 色 / 削除
  - 改名: 共通ファイルの行を直し、全プロジェクトのタスクの「ラベル」列を書き換える (`rename_label`)。既存名との衝突は `invalid`。シートに無い名前の改名は、シートに行を追加してから改名
  - 色: プロジェクト作成で順に使っている 4 つの CSS 変数 (`Main.tsx` の候補) から選ぶ。シートに無い名前なら行を追加
  - 削除: 確認ダイアログ (`ask`)。共通ファイルの行を消し、全プロジェクトのタスクからその名前を外す (`delete_label`)
- ラベル詳細 (D-06b): そのラベルが付いた未完了タスク (サブタスク含む、親は出さずフラットに)。期限の昇順 (期限なしは末尾)、優先度、No.。追加行: 受信トレイにそのラベルを付けて追加
- 改名・削除で複数のプロジェクトが変わる。command は変わったプロジェクト名の一覧を返し、UI はそれぞれに `project-changed` を受けて再取得する (§4)

### 3.4 検索

- 起点: `Cmd/Ctrl+K`、サイドバーの「検索」。クイック追加と同じモーダル (D-02 の外観、入力欄 + 結果リスト)
- 対象: 読み込めた全プロジェクトの全タスク (サブタスク含む)。既定は未完了のみ。入力欄の右に「完了を含む」トグル
- 一致: 名前・備考・ラベルのいずれかに、正規化した検索語が部分一致。空白区切りの複数語は AND。正規化 = Unicode NFKC → 小文字 → カタカナをひらがなに (U+30A1〜U+30F6 を −0x60)。全角英数は NFKC で半角になる。長音「ー」はそのまま
- 並び: 名前一致 > 備考一致 > ラベル一致、同じなら期限の昇順 (なしは末尾)、No.。最大 50 件。各行は TaskRow (プロジェクト名と期限のチップ付き)
- `↑↓` で選択、Enter でそのプロジェクトに移動して詳細パネルを開く。行のチェックで完了もできる (結果はその場で更新)
- 入力ごとに `search` command を呼ぶ (150ms デバウンス)。結果は Rust 側で絞って返す。UI 側では絞らない (一致判定を 1 か所に置く)

### 3.5 サイドバーと nav

- `nav` の種類に `{ kind: "label", name }` を足す。ラベル詳細はサイドバーでは「フィルターとラベル」が選択状態
- サイドバーの件数は `counts` command で取る: `{ today, labels: { name: count } }`。`list_projects` の `taskCount` はそのまま
- 横断ビューのタスクを操作したら (完了・優先度など) そのタスクの `project` に対して Phase 1 の command を呼ぶ。戻り値の `ProjectView` は捨て、ビューを再取得する (§4 `useCrossView`)

## 4. Command API と UI の流れ

| command | 引数 | 戻り値 | 内容 |
| --- | --- | --- | --- |
| `today_view` | `{ today }` | `{ overdue: Task[], today: Task[] }` | §3.1 の抽出と並び |
| `upcoming_view` | `{ from, days }` | `{ days: { date, tasks: Task[] }[] }` | §3.2。`days` は 1〜91 |
| `label_view` | `{ label }` | `{ label: Label, tasks: Task[] }` | §3.3 の詳細。シートに無い名前は既定色で返す |
| `labels` | なし | `{ labels: Label[], counts: { [name]: number } }` | 一覧 (和集合) と件数 |
| `add_label` | `{ name, color }` | `Label` | 共通ファイルに追加 |
| `rename_label` | `{ name, newName }` | `{ label: Label, changedProjects: string[] }` | 共通ファイルと全タスクを書き換え |
| `update_label` | `{ name, color }` | `Label` | 色。シートに無い名前なら行を追加 |
| `delete_label` | `{ name }` | `{ changedProjects: string[] }` | 共通ファイルから消し、全タスクから外す |
| `reschedule_overdue` | `{ today, due }` | `{ changedProjects: string[] }` | 期限 < today の未完了 (親の無い) タスクの期限を due に |
| `search` | `{ query, includeDone, limit }` | `{ hits: { task: Task, matched: "title" \| "note" \| "label" }[] }` | §3.4 |
| `counts` | `{ today }` | `{ today: number, labels: { [name]: number } }` | サイドバー |
| `resolve_external_change` | `{ project, action: "reload" \| "overwrite" }` | `ProjectView` | §5 の帯の操作。`reload` は `reload_project { discard: true }`、`overwrite` はメモリの内容をすぐ書く |

- `today` を UI から渡すのは、Rust 側のクロック (`ProjectStore` の `clock`) とテストの都合を合わせるため。Phase 1 の `useToday` の値を渡す
- `Task` には `project` が入っているので、横断ビューの行はそのまま Phase 1 の `complete_task { project, no, done }` などを呼べる
- 複数プロジェクトが変わる command (`rename_label`、`delete_label`、`reschedule_overdue`) は、変わった各プロジェクトを dirty にして保存をスケジュールし、`changedProjects` を返す。Rust 側はさらに `project-changed { name, reason: "bulk" }` を各プロジェクトに emit する。UI は `useProject` と `useCrossView` がこのイベントで再取得する (Phase 1 では `project-changed` の購読はあるが emit がほぼ無かった。Phase 2 で本格的に使う)

イベント (追加)

| イベント | payload | いつ |
| --- | --- | --- |
| `project-changed` | `{ name, reason: "bulk" \| "external" \| "move" }` | 複数プロジェクト更新、外部変更の自動再読込、move_task |
| `projects-changed` | `{ commonReloaded: bool }` | 外部でファイルが増えた / 消えた、共通ファイルが変わった (サイドバーの一覧とラベルを取り直す)。`commonReloaded` はそのバッチで共通ファイルを読み直せたときだけ true |
| `external-change` | `{ project }` | 外部で変わったが未保存の編集があり自動再読込しなかった (帯を出す) |

`useCrossView(kind, params)`: command を呼んで state に持つ。再取得のきっかけは (a) params の変化、(b) どのプロジェクトの `project-changed` でも、(c) `projects-changed`、(d) 自分が呼んだ変更 command の完了。連続する再取得は 1 つにまとめる (直前の呼び出しが終わってから最新の 1 回だけ)。応答は古いものを捨てる (`useProject` の世代番号と同じ)

## 5. 外部変更の監視

### 5.1 仕組み

- `notify` 8.2 (`RecommendedWatcher`) でデータフォルダを非再帰で監視する。`archive/` は見ない。独自に 500ms のデバウンス (同じパスのイベントをまとめる)。`notify-debouncer-full` は使わない (依存を増やさず、判定を自前で持つ)
- 対象ファイル: `_PowerToDo.xlsx` と `<名前>.xlsx`。無視: `~$` で始まる Excel のロックファイル、`.~lock.` で始まる LibreOffice のロックファイル、`.tmp` / 一時ファイル (Phase 1 の書き込みは `<名前>.xlsx.tmp-XXXX` → rename)、拡張子が xlsx 以外
- 自分の書き込みの判定: `ProjectStore` が書き込み直後にそのファイルの `(len, mtime)` を `last_written` に記録する。イベントのパスの現在の `(len, mtime)` が記録と一致すれば自分の書き込みとして無視。一致しなければ外部変更。mtime の分解能が粗い FS (FAT の 2 秒、NAS の 1 秒) でも、len か内容が変われば検出できる。len も mtime も同じ外部変更は見逃す (稀。次回起動で読む)
- 書き込み中 (Saver が保存している間) に来たイベントは、保存完了後にまとめて判定する (保存中フラグ)。rename 直後の `Create` / `Modify` は上の `(len, mtime)` 判定で自分の書き込みと分かる

### 5.2 判定と動作

| 事象 | 状態 | 動作 |
| --- | --- | --- |
| プロジェクトファイルが変わった | dirty でない、保存待ちなし | `reload` して `project-changed { reason: "external" }`。画面はそのまま更新 (フラッシュで「Excel の変更を取り込みました」) |
| 同上 | dirty または保存待ちあり | その project の保存待ちをキャンセルし (こちらの編集で Excel 側を潰す前に選ばせる)、`external-change { project }` を emit。帯 (§5.3) の操作まで保存しない |
| プロジェクトファイルが消えた | 任意 | `LoadedProject::Failed("ファイルが見つかりません")` にし、`projects-changed`。開いていれば D-11b。`archive/` への移動も同じ扱い (自分の `delete_project` は監視より先にメモリから消しているので無視される) |
| 新しい xlsx が現れた | なし | 読み込んで一覧に足し、`projects-changed`。共通ファイルのプロジェクトシートにも行を足す (色は既定、末尾) |
| 共通ファイルが変わった | `common_dirty` でない | 共通を読み直し (`projects-changed`)。プロジェクトの色・並び・ラベル・祝日・設定が更新される。ファイル側に無いプロジェクトはファイルから補う (Phase 1 の起動時と同じ突き合わせ) |
| 同上 | `common_dirty` | `external-change { project: "_common" }`。帯は「共通設定」と表示 |
| 読み直しに失敗 (型不整合、ロック) | 任意 | `LoadedProject::Failed` にはしない。`project-changed` を出さず、`save-status: error` と同じ帯で「Excel の変更を読み込めません: <message>」(リトライなし。次のイベントで再試行) |

- dirty の判断は `ProjectStore::dirty_projects()` と Saver の保存待ち (スケジュール済み) の両方を見る。保存待ちがあるのに dirty でない状態は無い (dirty は保存成功で消える)
- 監視はデータフォルダ設定後に開始し、`set_data_dir` で付け替える。フォルダが消えた (`NotFound`) ときは監視を止め、`projects-changed` を出す (Phase 1 の `not_found` でオンボーディングに戻る流れに合流)
- macOS では FSEvents が rename を `Create` + `Remove` で届けることがある。パス単位の存在確認 (`metadata`) で最終状態を見て、イベント種別には依存しない

### 5.3 帯 (ExternalChangeBanner)

- 文言: 「「受信トレイ.xlsx」が Excel など別のアプリで変更されました。このアプリの未保存の変更があります。」
- ボタン: 「ファイルを読み込む」(secondary) = `resolve_external_change { action: "reload" }`。こちらの編集を捨てる。押す前に `ask` で「このアプリでの変更は失われます」を確認。「このアプリの内容で上書き」(primary) = `action: "overwrite"`。ファイル側の変更が失われる。同じく確認
- 帯は対象 project ごとに 1 本。別のプロジェクトを開いても出続ける (AppShell の banner スロット、FixBanner / SaveBanner と縦に並ぶ)。解決すると消える
- 帯が出ている間、その project への変更 command は通る (メモリは更新される) が、保存はキャンセルされたまま。`overwrite` で保存を再開する。アプリ終了時の `flush_all` は、帯が残っている project を**書かない** (ユーザーが選んでいないので、ファイル側を勝手に潰さない)。代わりに終了時に `ask` で「上書きして終了 / 終了しない」を 1 回聞く。`ask` のボタンは 2 つなので「捨てて終了」の選択肢は無い。捨てたいときは帯の「ファイルを読み込む」を押してから終了する。「上書きして終了」で 1 つでも上書きに失敗したら終了せず、エラーを出して帯の一覧を取り直す
- D-09b (競合バナー) は同期の競合用。文言と操作が違うので別コンポーネント

## 6. キーボード操作

| キー | 動作 | 条件 |
| --- | --- | --- |
| `q` | クイック追加 | Phase 1 のまま |
| `Cmd/Ctrl+K`、`/` | 検索を開く | `/` は入力中以外 |
| `g` のあと 1 秒以内に `t` / `u` / `i` / `l` | 今日 / 近日 / 受信トレイ / フィルターとラベル | 入力中以外 |
| `↑` / `↓` | フォーカス行を上下 | リスト画面 (プロジェクト / 今日 / 近日 / ラベル詳細 / 検索結果)。折りたたまれた行は飛ばす |
| `Enter` | フォーカス行の詳細を開く (検索では移動して開く) | |
| `e` | フォーカス行を完了 / 取り消し | |
| `Delete` / `Backspace` | フォーカス行を削除 (確認あり) | |
| `1`〜`4` | 優先度 | |
| `t` / `m` | 期限を今日 / 明日 (時刻は保つ) | |
| `→` / `←` | サブタスクの展開 / 折りたたみ (プロジェクト画面) | |
| `Esc` | 最上位のレイヤーを閉じる。レイヤーが無ければ行フォーカスを外す | Phase 1 の `layers.ts` |

- 入力中 (`INPUT` / `TEXTAREA` / contentEditable、IME 変換中) はすべて無効 (Phase 1 の `q` と同じ判定を `shortcuts.ts` に移す)。修飾キー付きは `Cmd/Ctrl+K` だけ
- フォーカス行は画面ごとの state (`useRowFocus`)。見た目は TaskRow に `focused` prop を足して左に 2px の accent 枠 (`box-shadow: inset 2px 0 0 var(--color-accent)`) とホバー背景。マウスのホバーはフォーカスを動かさない。クリックで詳細を開くとその行がフォーカス
- ナビゲーションで画面が変わるとフォーカスは外れる。行が消えた (完了で非表示、削除) ときは次の行へ
- `Delete` の確認は Phase 1 と同じ `ask`
- ショートカットの一覧は設定ダイアログに「キーボード」ペインを足して表に出す (操作は無い。読むだけ)

## 7. エラー処理

- 横断ビューは読み込めなかったプロジェクトを黙って除く。ビューの上部に小さく「「仕事」は読み込めていません (サイドバーから開いて確認)」を出す (FixBanner の文言流用、1 行)
- 横断ビューからの操作が失敗したら Phase 1 と同じフラッシュ (`error`)。ビューは再取得する (部分的に成功している可能性があるため)
- `rename_label` / `delete_label` / `reschedule_overdue` が途中のプロジェクトで失敗 (読み込めていない) しても、他のプロジェクトは書き換え、`changedProjects` にはそれらを返す。エラーは返さず、読み込めていないプロジェクトはそもそも対象外 (§7 1 項目目と同じ)
- 監視の失敗 (`notify` が初期化できない、inotify の上限) は起動を止めない。ログに残し、フラッシュで「ファイルの変更監視を開始できません。Excel で直した内容は再読み込みで取り込めます」を 1 回出す。手動の `reload_project` は Phase 1 のまま使える

## 8. CI

`.github/workflows/ci.yml`。トリガー: `main` への push と、`main` 向けの pull request。

| job | runner | 内容 |
| --- | --- | --- |
| `web` | ubuntu-latest | `npm ci`、`npx tsc --noEmit`、`npm run build`、`npm run build-storybook`、`npm run check:stories` |
| `rust` | matrix: ubuntu-latest / windows-latest / macos-latest | `cargo test --manifest-path src-tauri/Cargo.toml`、`cargo build --manifest-path src-tauri/Cargo.toml`。ubuntu は先に Tauri 2 の前提パッケージ (`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`、公式 Prerequisites のまま) を apt で入れる |

- `cargo build` はフロントエンドの `dist/` を要求する (`tauri.conf.json` の `frontendDist`)。`rust` job の前に `npm ci && npm run build` を入れる (`beforeBuildCommand` を使わず明示する)
- キャッシュ: `actions/setup-node` の npm キャッシュと `Swatinem/rust-cache` (`workspaces: src-tauri`)
- アプリのバンドル (`tauri build`) は CI では作らない (Phase 4 以降で署名と一緒に考える)
- 失敗は PR のチェックに出る。ブランチ保護は設定しない (ユーザーがマージの速さを優先しているため)

## 9. テスト

- Rust 単体 (`cargo test`): `domain::views` (期限切れ / 今日の分け方と並び、近日のグループ化、タスクの無い日、ラベル詳細の並び)、`domain::search` (正規化: NFKC・カタカナ→ひらがな・小文字、AND、一致箇所の優先)、`store` (ラベルの改名 / 削除が全プロジェクトに及ぶ、`reschedule_overdue` が時刻を保つ、和集合のラベル一覧)、`watcher` (自分の書き込みの判定、無視するファイル名、デバウンスのまとめ。`notify` は使わず判定関数に `(path, len, mtime)` を渡す)
- 統合 (`cargo test`、`tempfile`): 実ファイルを別経路で書き換え、`notify` のイベントで `reload` が走ることを 1 本 (タイムアウト 5 秒。macOS だけで動かし、Ubuntu / Windows では `ignore` にする。理由は §10 の「監視の統合テスト」の行)
- UI: 手動 (Phase 1 と同じチェックリスト形式で PR に書く)。Storybook に `Screens/Desktop/D-04 今日 (操作)` を足し、再スケジュールと完了を触れるようにする。既存 40 画面の初回描画は変えない
- UI の自動テスト: Tauri 2 の公式案内は WebdriverIO + `@wdio/tauri-service` (埋め込み WebDriver サーバーで Windows / Linux / macOS に対応。`tauri-driver` 単体は Windows / Linux のみ)。Phase 2 では入れない (CI に 3 OS のビルドを足すのが先。アプリの画面は手動確認で足りる量)。Phase 5 で `@wdio/tauri-service` の browser mode (Vite dev server + `invoke` のモック) から試す

## 10. 決定ログ

| 日付 | 決定 | 理由 |
| --- | --- | --- |
| 2026-10-14 | 横断ビューの抽出は Rust 側で行い、UI は結果を表示するだけ | 一致判定・並びを 1 か所に置き、テストを `cargo test` に寄せる。全タスクを UI に送る方式は、プロジェクトが増えると毎回の転送が重い |
| 2026-10-14 | 横断ビューからの操作は Phase 1 の command をそのまま使い、ビューを再取得する | command の数を増やさない。`Task.project` があるので宛先は分かる |
| 2026-10-14 | 複数プロジェクトを変える command は `changedProjects` を返し、`project-changed` も emit する | 開いている `useProject` と横断ビューの両方を 1 つの仕組みで更新するため |
| 2026-10-14 | 検索の正規化は NFKC + 小文字 + カタカナ→ひらがな。ローマ字入力の途中 (`gyuunyuu`) は対応しない | 日本語の揺れで最も多いのはかなと全角半角。ローマ字変換は辞書が要る |
| 2026-10-14 | 外部変更の判定は `(len, mtime)` の記録との比較 | ハッシュを取ると書き込みのたびに読み直すことになる。粗い mtime でも len で大半は拾える |
| 2026-10-14 | `notify-debouncer-full` は入れない | デバウンスと無視判定を自前に持つ方がテストしやすく、依存が 1 つ減る |
| 2026-10-14 | 未保存の編集があるときの外部変更は、保存をキャンセルして帯で選ばせる | 1 秒のデバウンスで自動保存すると、ユーザーが気づく前に Excel 側の変更を潰す |
| 2026-10-14 | 帯が残ったまま終了するときは 1 回だけ確認する | 黙って上書きも黙って捨てるもしない |
| 2026-10-14 | ラベル一覧はシート ∪ タスクの名前 | Excel で「ラベル」列に直接書いた名前も見えるようにする。シートだけだと Excel 側の入力が隠れる |
| 2026-10-14 | UI の自動テストは Phase 2 では入れない。候補は WebdriverIO + `@wdio/tauri-service` (macOS 対応) | 公式ドキュメントで確認 (2026-10-14)。`tauri-driver` 単体は macOS 非対応だが、`@wdio/tauri-service` の埋め込みドライバーで対応できる。Phase 2 では CI のビルド確認を優先 |
| 2026-10-14 | 近日の週ストリップは `from` から 7 日で、週の始まりの設定を見ない | pen のデザインがその形。カレンダー表示 (Phase 5) で週の始まりを使う |
| 2026-10-14 | `project_store.rs` を `labels.rs` / `external.rs` に分ける (振る舞いは変えない) | 1900 行を超えて読みづらい。Phase 2 で触る部分を切り出す |
| 2026-10-14 | 終了時の確認は「上書きして終了 / 終了しない」の 2 択。上書きに 1 つでも失敗したら終了しない | `ask` のボタンは 2 つ。捨てたい人は帯の「ファイルを読み込む」を押してから終了する。失敗したまま終了すると編集が消える |
| 2026-10-14 | 検索の複数語の AND は、語ごとにタイトル・備考・ラベルのどれに当たってもよい (フィールドをまたぐ)。`matched` は全語が当たる最初のフィールド (タイトル > 備考 > ラベル)、無ければ 1 語でも当たる最初のフィールド | 「牛乳 食品」のように、タイトルの語とラベルの語を混ぜて探せる。Todoist も同じ動き。ヒットはやや広くなる |
| 2026-10-14 | ラベルの改名は、改名するラベル自身を重複チェックから外す (大文字小文字だけの変更を許す) | 衝突を見るのは他のラベル名との間だけ |
| 2026-10-14 | ラベル名に `@` `,` `、` は使えない | クイック追加の `@ラベル` と、xlsx の「ラベル」列の区切り (`,` `、`) に混ざると別のラベルに割れてしまう |
| 2026-10-14 | 横断ビューの「完了にした直後の行」(`useLeaving`) は、ビューから消えなくても最長 3 秒で退場させる | 保存の失敗などで消えないまま完了表示を残し続けないため。通常は保存と再取得が終わるまで完了表示のまま待つので、チェックは戻らない |
| 2026-10-14 | 横断ビューで行を開くとき、ナビゲーションで行のフォーカスは外れる。遷移先のプロジェクトの行はフォーカスしない | 「クリックでフォーカス」と「画面が変わるとフォーカスは外れる」(§6) のうち後者を優先 |
| 2026-10-14 | 横断ビューの共通部品 (退場する行、追加行、読み込めないプロジェクトの注記) は `src/views/crossList.tsx` に置く | 今日 / 近日 / ラベル詳細で同じコードが 3 つになるのを避ける |
| 2026-10-14 | 近日の月ジャンプは `onJumpTo(from)` で受ける | 月セレクタでも「今日」でも、行き先の開始日を渡すだけで済む |
| 2026-10-14 | 行のキー (`Enter` `Backspace` など) は、行にフォーカスがあるときだけ受ける (`RowHandlers.hasFocus`) | Tab でフォーカスしたボタンの Enter / Space / Backspace を奪わないため。`q` `/` `g` と `↑` `↓` は行が無くても効く |
| 2026-10-14 | 共通ファイル (`_common`) も、未保存の編集があるときにディスク側が変わったら保留 (`held`) にする。帯と終了確認には「共通設定」と出す | プロジェクトと同じく、黙って上書きすると Excel 側の変更が消える |
| 2026-10-14 | 最後のウィンドウの `CloseRequested` も止めて `exit-blocked` を出す | `ExitRequested` だけだと Webview が先に破棄され、確認を出せない |
| 2026-10-14 | 保留中のプロジェクトがあるあいだ `switch_data_dir` は `Unsaved` を返して切り替えない | 保留中の編集は flush で書かれない。切り替えると黙って捨てることになる。先に帯を解決してもらう |
| 2026-10-14 | データフォルダ自体が消えたら、監視を止めて全プロジェクトを「見つかりません」にし `projects-changed` を出す。オンボーディングへ戻すのは Phase 4 (Drive のアンマウント) で扱う | 消えた原因が Drive のアンマウントなら、戻し方はそこで決める。当面はアプリの再起動 |
| 2026-10-14 | 終了時の `flush_all` は、前回の書き込みの記録から外部で変わっていたプロジェクトを書かない (ログに残し、アプリの内容は下の行の回復コピーに書く) | 終了時は帯を出す画面が無い。ユーザーが選んでいないので Excel 側を潰さない |
| 2026-10-14 | 保存の直前にも `changed_on_disk` で現在の `(len, mtime)` を記録と比べ (`TauriSink::save`)、違えば書かずに保留して帯を出す。終了時の `flush` も同じ確認をする | 外部の保存が監視のイベントより先に着くことがある。監視だけに頼ると、デバウンスの隙間で Excel 側の変更を上書きする |
| 2026-10-14 | `reload_external` で読み直しに失敗したときは、メモリ上の元のブックを残す (`Failed` にしない) | Excel が保存の途中で壊れた状態を見せることがある。次のイベントで再試行すれば足りる。画面からタスクを消さない |
| 2026-10-14 | CI の Node は 26 (ローカルの v26.5.0 とロックファイルの作成環境に合わせる)。setup-node が解決できなければ 22 に下げる | ロックファイルの再現性を優先。未確認のため PR の CI 結果で確かめる |
| 2026-10-14 | D-05 `(操作)` の Story は、読み込めないプロジェクトの注記 (`hiddenProjects`) を出さない | モックに「読書」のタスクがあり、注記と矛盾するため。見た目だけの違い |
| 2026-10-14 | macOS ではアプリメニューの「終了」を自前の項目 (「PowerToDo を終了」、`CmdOrCtrl+Q`) に差し替え、`on_menu_event` で保留が無ければ `exit(0)`、あれば `exit-blocked` を出す。他のメニュー (編集のコピー / ペーストなど) は Tauri の既定のまま。それでも確認を出せない終了 (Dock の「終了」、ログアウト) に備え、`RunEvent::Exit` で保留中のキーと「dirty かつディスク側が変わった」キーのメモリ上のブックを `archive/<名前> (未保存 YYYYMMDD-HHMM).xlsx` (共通は `archive/_PowerToDo (未保存 …).xlsx`) に書き出す (`ProjectStore::write_recovery_copy`)。Windows / Linux は既定のメニューが無く、ウィンドウを閉じる操作は `CloseRequested` で止まるので変えない | 既定の「終了」は `terminate:` を送り、tao は `applicationWillTerminate` しか実装していないので `ExitRequested` が来ず `RunEvent::Exit` だけになる。そのままでは保留中の編集が黙って消える。Dock の「終了」は自前のメニューでは拾えないので、ファイルは Excel 側のまま残し、編集は別ファイルに逃がす |
| 2026-10-14 | 外部変更の読み直しの失敗は `save-status: error` ではなく `external-read-failed { project, message }` で送る。UI は閉じるボタンだけの帯「「<名前>」の Excel の変更を読み込めません: <message>」を出し、同じ名前の `project-changed` (`external`) か、共通は `commonReloaded` が true の `projects-changed` で消す (§5.2 の表の動作は同じ) | 保存の失敗の帯だと「保存できません」と「再試行」が出るが、再試行しても読み直しにはならず、帯も消えない。読み直しは次の変更イベントで行う |
| 2026-10-14 | 監視を始められなかった理由は `AppState` に持ち、`app_state` / `set_data_dir` の `AppStateDto.watchError` と `watch_status` で返す。メイン画面は表示時に `watchError` でフラッシュを出し、設定からのフォルダ変更のあとは `watch_status` で聞き直す。`watch-failed` イベントも残す | 監視の開始は `app_state` の中 (メイン画面がイベントを聞く前) なので、イベントだけだと §7 のフラッシュが出ない |
| 2026-10-14 | プロジェクトの作成 / 改名 / 削除のときの共通ファイルの即時書き込みも、書く直前に `changed_on_disk` を見る。変わっていれば書かずに `_common` を保留し、command が `external-change { project: "_common" }` を出す | 自動保存 (`TauriSink::save`) と同じ確認。監視のイベントより先に作成などが来ると、Excel で直した共通ファイルを上書きしてしまう |
| 2026-10-14 | 監視の統合テスト (`store::watcher` の `batches_are_delivered_after_quiet_period`、実ファイル + `notify`) は macOS だけで動かし、Ubuntu / Windows では `ignore` にする (`#[cfg_attr(not(target_os = "macos"), ignore = "timing depends on the OS watcher")]`)。判定の単体テスト (`store::external` の分類と `(len, mtime)` の比較) と `apply_fs_batch` のシナリオは 3 OS で動く | イベントの届き方と時期が OS の監視機構 (FSEvents / inotify / ReadDirectoryChangesW) で違い、5 秒のタイムアウトが CI の共有ランナーで安定する保証が無い (確認できているのは macOS で 4 回中 4 回の通過)。§9 の「不安定なら macOS だけに絞る」を先に当てた。アプリ本体の確認も macOS だけ |
| 2026-10-15 | `projects-changed` の payload に `commonReloaded` を足し、そのバッチで共通ファイルを読み直せたとき (`reload_common` の成功、`resolve_external_change` の「ファイルを読み込む」) だけ true にする。UI は `_common` の読み込み失敗の帯を `commonReloaded` が true のときだけ消す | 同じバッチで新しいファイルを取り込むと共通を読めていなくても `projects-changed` が出て、共通の読み込み失敗の帯が消えていた |
| 2026-10-15 | 終了時の回復コピーは、`archive/` に書けない (フォルダを作れない、ドライブが外れている) ときは `<アプリのデータフォルダ>/recovery/` に同じファイル名で書く (`write_recovery_copy` の `fallback_dir`)。どちらに書いたかはログに出す。回復コピーを書けたキーは、`flush` の「他のアプリで変更されているため書き込みませんでした」の失敗としては重ねて報告しない | Drive のアンマウントなどで `archive/` が使えないと編集が消える。同じ編集についてログが 2 つ出る重複も避ける |
| 2026-10-15 | `delete_project` は、保留中、または未保存の編集があってディスク側が変わっている (`changed_on_disk`) プロジェクトを、保存もアーカイブもせずに `Unsaved`「「<名前>」は Excel で変更されています。帯の操作で解決してから削除してください」で断る。成功後は画面が保留の一覧を取り直す | 削除の前の保存は Excel 側の変更を上書きし、アーカイブはその変更をユーザーが選ぶ前に持ち去る。帯の選択が先。編集の無いプロジェクトは対象外 (読み込めなかったファイルは記録が無く常に「変わった」に見えるので、対象にすると壊れたファイルを消せなくなる) |
| 2026-10-15 | ラベルの「色」メニューの先頭に既定色 (`var(--color-text-muted)`) を足す (新しいプロジェクトの `PALETTE` は変えない) | 一度色を付けたラベルを既定に戻せなかった |
