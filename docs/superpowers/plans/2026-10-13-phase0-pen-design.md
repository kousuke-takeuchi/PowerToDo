# Phase 0: pen デザイン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PowerToDo の全画面 (デスクトップ 13 + ダーク 3 + モバイル 7) を `design/powertodo.pen` に起こし、`design/storyboard.md` を書いて、ユーザーが pen.dev の storyboard で操作性を確認できる状態にする。

**Architecture:** pen.dev の MCP (`mcp__pencil__execute`) で変数 → component → 画面の順に作る。画面は document 直下の frame。繰り返す UI は reusable component にして `ref` で配置する。各タスクの終わりに `Get` でクリップ問題を機械的に確認し、`TakeScreenshot` で視覚確認する。コードは書かない。

**Tech Stack:** pen.dev (MCP: `mcp__pencil__execute`, `mcp__pencil__get_app_state`, `mcp__pencil__read_skill`)、Markdown。

**Spec:** `docs/superpowers/specs/2026-10-13-phase0-pen-design.md` (全体設計は `docs/superpowers/specs/2026-10-13-powertodo-overall-design.md`)

## Global Constraints

- 対象ファイルは `design/powertodo.pen` のみ。InfoDesk の `design.pen` には触れない。作業前に必ず `get_app_state` で active editor のパスが `.../PowerToDo/design/powertodo.pen` であることを確認する
- デスクトップ画面は 1440×900、最小ウィンドウ版は 960×600、モバイル画面は 390×844
- サイドバー幅 280、中央リスト最大幅 800 で中央寄せ、詳細パネル幅 400
- フォントは全テキスト `Noto Sans JP` (変数 `$font-body`)。英数だけ Inter に分けると component が倍になるため、Phase 0 では Noto Sans JP の Latin グリフで統一する (spec §2 からの軽微な簡略化)
- 色・寸法はすべて変数参照 (`$bg` 等)。ベタ書きの色は使わない
- 画面 frame は `clip: true`。作業中は `placeholder: true`、完成したタスク内で `false` に戻す
- document 直下に置けるのは画面 frame と component frame のみ
- 各 `execute` の先頭で下記の共通ヘルパーを宣言する (`execute` ごとにスコープが切れるため毎回貼る)
- pen の API に画面間リンクはない。遷移は `design/storyboard.md` に表で書き、リンクはユーザーが張る
- コミットは `git add design/powertodo.pen design/storyboard.md` のように対象を明示する。`Co-Authored-By` などの attribution trailer は付けない
- ブランチは `feature/phase0-pen-design` (origin/main から作成)。PR の base は main

## 共通ヘルパー (各 execute の先頭に貼る)

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
```

`problems(screenId)` が何も Print しなければクリップ問題なし。

## Review Focus

spec が暗黙に要求するが、各タスクの確認手順に入っていない観点。各行の確認は所有タスクに足してある。

1. 長いタスク名 (全角 60 文字) がタスク行で折り返され、チェックボックスと操作アイコンの位置がずれない → Task 3 の確認に含む
2. セクションが 0 個のプロジェクト (カテゴリなし行だけ) でも D-01 のリストが崩れない → Task 3 の確認に含む
3. 期限切れが 0 件の「今日」画面で「期限切れ」グループを出さない状態が表現できる → Task 6 に「期限切れなし」バリアントを含む
4. ラベル 5 個以上のタスク行でチップが行幅を超えない (末尾に `+N`) → Task 2 の TaskRow に `+N` チップを含む
5. モバイルで下部シート (クイック追加) が開いているときキーボード領域を考慮した高さになっている → Task 11 にキーボード領域の矩形を含む

---

### Task 0: 前提確認 (pen ファイル作成はユーザー作業)

**Files:**
- Create (ユーザーが pen.dev で作成): `design/powertodo.pen`

**Interfaces:**
- Produces: active editor = `design/powertodo.pen`。以降の全タスクはこれを前提にする

- [ ] **Step 1: ユーザーに依頼する**

pen.dev アプリで新規ファイルを `~/Documents/PowerToDo/design/powertodo.pen` として保存し、そのタブを前面にしてもらう。MCP にはファイルを新規作成・切替する機能がない。

- [ ] **Step 2: active editor を確認する**

`mcp__pencil__get_app_state` を呼ぶ。
Expected: `Currently active canvas editor: /Users/ktakeuchi/Documents/PowerToDo/design/powertodo.pen`、Top-level nodes なし。違うパスなら作業を止めてユーザーに切替を依頼する。

- [ ] **Step 3: ブランチを作る**

```bash
cd /Users/ktakeuchi/Documents/PowerToDo
git fetch origin
git checkout -b feature/phase0-pen-design origin/main
```

---

### Task 1: 変数とテーマ

**Files:**
- Modify: `design/powertodo.pen` (variables)

**Interfaces:**
- Produces: 変数名 `bg`, `bg-sidebar`, `bg-hover`, `text-primary`, `text-secondary`, `text-muted`, `border`, `accent`, `accent-soft`, `priority-1`〜`priority-4`, `success`, `danger`, `font-body`, `space-1`(4), `space-2`(8), `space-3`(12), `space-4`(16), `space-6`(24), `radius`(8)。theme 軸 `mode: light | dark`

- [ ] **Step 1: 変数を定義する**

```js
SetVariables({
  "bg":{type:"color",value:[{value:"#FFFFFF",theme:{mode:"light"}},{value:"#1E1E1E",theme:{mode:"dark"}}]},
  "bg-sidebar":{type:"color",value:[{value:"#FCFAF8",theme:{mode:"light"}},{value:"#282828",theme:{mode:"dark"}}]},
  "bg-hover":{type:"color",value:[{value:"#F2EFED",theme:{mode:"light"}},{value:"#333333",theme:{mode:"dark"}}]},
  "text-primary":{type:"color",value:[{value:"#202020",theme:{mode:"light"}},{value:"#FFFFFF",theme:{mode:"dark"}}]},
  "text-secondary":{type:"color",value:[{value:"#666666",theme:{mode:"light"}},{value:"#A6A6A6",theme:{mode:"dark"}}]},
  "text-muted":{type:"color",value:[{value:"#A0A0A0",theme:{mode:"light"}},{value:"#6E6E6E",theme:{mode:"dark"}}]},
  "border":{type:"color",value:[{value:"#EEEEEE",theme:{mode:"light"}},{value:"#3A3A3A",theme:{mode:"dark"}}]},
  "accent":{type:"color",value:"#DC4C3E"},
  "accent-soft":{type:"color",value:[{value:"#FDEDEB",theme:{mode:"light"}},{value:"#3A2321",theme:{mode:"dark"}}]},
  "priority-1":{type:"color",value:"#D1453B"},
  "priority-2":{type:"color",value:"#EB8909"},
  "priority-3":{type:"color",value:"#246FE0"},
  "priority-4":{type:"color",value:[{value:"#808080",theme:{mode:"light"}},{value:"#9A9A9A",theme:{mode:"dark"}}]},
  "success":{type:"color",value:"#058527"},
  "danger":{type:"color",value:"#D1453B"},
  "font-body":{type:"string",value:"Noto Sans JP"},
  "space-1":{type:"number",value:4},
  "space-2":{type:"number",value:8},
  "space-3":{type:"number",value:12},
  "space-4":{type:"number",value:16},
  "space-6":{type:"number",value:24},
  "radius":{type:"number",value:8}
})
Print(GetVariables())
```

- [ ] **Step 2: 確認する**

Expected: Print に上記 21 変数と `themes: {mode: ["light","dark"]}` が出る。

- [ ] **Step 3: コミット**

```bash
git add design/powertodo.pen
git commit -m "design: define color, spacing, and font variables with light/dark theme"
```

---

### Task 2: component 群

**Files:**
- Modify: `design/powertodo.pen` (document 直下、y=0 付近に横並び)

**Interfaces:**
- Produces: reusable frame。名前と主な子ノード名:
  - `Checkbox` (子 `Ring`)、`PriorityChip` (子 `Dot`, `Label`)、`LabelChip` (子 `Label`)、`DateChip` (子 `Icon`, `Label`)、`MoreChip` (子 `Label`)
  - `TaskRow` (子 `Checkbox`, `Body`/`Title`, `Body`/`Description`, `Body`/`Meta`, `Actions`)
  - `SidebarItem` (子 `Icon`, `Label`, `Count`)
  - `ProjectItem` (子 `Dot`, `Label`, `Count`)
  - `SectionHeader` (子 `Chevron`, `Title`, `Count`)
  - `Button` (子 `Label`)、`ButtonSecondary` (子 `Label`)、`IconButton` (子 `Icon`)
  - `AddTaskRow` (子 `Plus`, `Label`)
  - `TextField` (子 `Placeholder`)
- 以降のタスクは `Get(n=>n.reusable&&Print(n.id,n.name))` で id を取り、`Copy(id, parent, {descendants:{"Title":{content:"..."}}})` で配置する

- [ ] **Step 1: 小さい component を作る (Checkbox, chips, buttons)**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
x=0
place=(w)=>{const p={x,y:0};x+=w+40;return p}
checkboxId=Insert(document,F("Checkbox",{...place(24),reusable:true,width:20,height:20,layout:"vertical",justifyContent:"center",alignItems:"center",cornerRadius:10,stroke:"$priority-4",strokeWidth:1.5}))
Insert(checkboxId,{type:"ellipse",name:"Ring",width:10,height:10,fill:"$priority-4",opacity:0})
priorityId=Insert(document,F("PriorityChip",{...place(60),reusable:true,gap:"$space-1",alignItems:"center",padding:[2,6],cornerRadius:4}))
Insert(priorityId,I("Dot","flag",12,"$priority-1"))
Insert(priorityId,T("Label","P1",12,"$text-secondary"))
labelId=Insert(document,F("LabelChip",{...place(80),reusable:true,gap:"$space-1",alignItems:"center",padding:[2,6],cornerRadius:4}))
Insert(labelId,I("Tag","tag",12,"$text-muted"))
Insert(labelId,T("Label","@買い物",12,"$text-secondary"))
dateId=Insert(document,F("DateChip",{...place(80),reusable:true,gap:"$space-1",alignItems:"center"}))
Insert(dateId,I("Icon","calendar",12,"$success"))
Insert(dateId,T("Label","明日",12,"$success"))
moreId=Insert(document,F("MoreChip",{...place(40),reusable:true,padding:[2,6],cornerRadius:4,fill:"$bg-hover"}))
Insert(moreId,T("Label","+2",12,"$text-secondary"))
btnId=Insert(document,F("Button",{...place(100),reusable:true,padding:[8,16],cornerRadius:"$radius",fill:"$accent",alignItems:"center"}))
Insert(btnId,T("Label","タスクを追加",14,"#FFFFFF",{fontWeight:"600"}))
btn2Id=Insert(document,F("ButtonSecondary",{...place(100),reusable:true,padding:[8,16],cornerRadius:"$radius",fill:"$bg-hover",alignItems:"center"}))
Insert(btn2Id,T("Label","キャンセル",14,"$text-primary"))
iconBtnId=Insert(document,F("IconButton",{...place(32),reusable:true,width:32,height:32,layout:"vertical",justifyContent:"center",alignItems:"center",cornerRadius:6}))
Insert(iconBtnId,I("Icon","more-horizontal",18,"$text-secondary"))
Get(n=>n.reusable&&Print(n.id,n.name))
```

- [ ] **Step 2: TaskRow, SidebarItem, ProjectItem, SectionHeader, AddTaskRow, TextField を作る**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
y=80
rowId=Insert(document,F("TaskRow",{x:0,y,reusable:true,width:800,gap:"$space-3",alignItems:"start",padding:[10,0],stroke:"$border",strokeWidth:{bottom:1}}))
Insert(rowId,{type:"ref",ref:ids.Checkbox,name:"Checkbox"})
bodyId=Insert(rowId,F("Body",{layout:"vertical",gap:"$space-1",width:"fill_container"}))
Insert(bodyId,T("Title","牛乳と卵を買う",14,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}))
Insert(bodyId,T("Description","近所のスーパーで。卵は 10 個入り",12,"$text-secondary",{textGrowth:"fixed-width",width:"fill_container"}))
metaId=Insert(bodyId,F("Meta",{gap:"$space-2",alignItems:"center"}))
Insert(metaId,{type:"ref",ref:ids.DateChip,name:"Date"})
Insert(metaId,{type:"ref",ref:ids.LabelChip,name:"Label1"})
Insert(metaId,{type:"ref",ref:ids.MoreChip,name:"More"})
Insert(metaId,T("Project","受信トレイ",12,"$text-muted"))
actId=Insert(rowId,F("Actions",{gap:"$space-1",alignItems:"center"}))
for (const ic of ["pencil","calendar","message-square","more-horizontal"]) Insert(actId,{type:"ref",ref:ids.IconButton,name:"Act-"+ic,descendants:{"Icon":{icon:ic}}})
sbId=Insert(document,F("SidebarItem",{x:0,y:y+100,reusable:true,width:248,gap:"$space-2",alignItems:"center",padding:[6,10],cornerRadius:6}))
Insert(sbId,I("Icon","inbox",18,"$text-secondary"))
Insert(sbId,T("Label","受信トレイ",14,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}))
Insert(sbId,T("Count","12",12,"$text-muted"))
pjId=Insert(document,F("ProjectItem",{x:0,y:y+150,reusable:true,width:248,gap:"$space-2",alignItems:"center",padding:[6,10],cornerRadius:6}))
Insert(pjId,{type:"ellipse",name:"Dot",width:10,height:10,fill:"$priority-3"})
Insert(pjId,T("Label","仕事",14,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}))
Insert(pjId,T("Count","8",12,"$text-muted"))
secId=Insert(document,F("SectionHeader",{x:0,y:y+200,reusable:true,width:800,gap:"$space-2",alignItems:"center",padding:[12,0,8,0],stroke:"$border",strokeWidth:{bottom:1}}))
Insert(secId,I("Chevron","chevron-down",16,"$text-secondary"))
Insert(secId,T("Title","今週",14,"$text-primary",{fontWeight:"700"}))
Insert(secId,T("Count","3",12,"$text-muted"))
addId=Insert(document,F("AddTaskRow",{x:0,y:y+260,reusable:true,width:800,gap:"$space-3",alignItems:"center",padding:[10,0]}))
Insert(addId,I("Plus","plus",18,"$accent"))
Insert(addId,T("Label","タスクを追加",14,"$text-secondary"))
tfId=Insert(document,F("TextField",{x:0,y:y+310,reusable:true,width:400,padding:[8,12],cornerRadius:"$radius",stroke:"$border",strokeWidth:1,alignItems:"center"}))
Insert(tfId,T("Placeholder","タスク名",14,"$text-muted",{textGrowth:"fixed-width",width:"fill_container"}))
Get(n=>n.reusable&&Print(n.id,n.name))
TakeScreenshot([rowId,sbId,secId])
```

- [ ] **Step 3: 確認する**

Expected: Print に 15 個の reusable 名。スクリーンショットで TaskRow のチェックボックス、本文、右端の 4 アイコンが 1 行に収まる。崩れがあれば `Update` で直す (作り直さない)。

- [ ] **Step 4: コミット**

```bash
git add design/powertodo.pen
git commit -m "design: add reusable components (task row, sidebar items, chips, buttons)"
```

---

### Task 3: D-01 プロジェクト (リスト表示)

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Produces: 画面 frame `D-01 プロジェクト` (子 `Sidebar`, `Main`)。以降の画面はこれを `Copy` して差分を作る。`Sidebar` の子: `Account`, `Nav` (SidebarItem ×3: 受信トレイ / 今日 / 近日), `NavSecondary` (フィルターとラベル), `Favorites`, `Projects` (ProjectItem ×4)。`Main` の子: `Header` (タイトル、表示切替 / 並び替え / その他ボタン), `List` (SectionHeader と TaskRow の列、AddTaskRow)

- [ ] **Step 1: 画面の骨格 (Sidebar + Main) を作る**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120})
d01=Insert(document,F("D-01 プロジェクト",{x:pos.x,y:pos.y,width:1440,height:900,clip:true,placeholder:true,fill:"$bg"}))
sb=Insert(d01,F("Sidebar",{layout:"vertical",width:280,height:"fill_container",fill:"$bg-sidebar",padding:[12,16],gap:"$space-4"}))
acc=Insert(sb,F("Account",{gap:"$space-2",alignItems:"center",width:"fill_container"}))
Insert(acc,{type:"ellipse",name:"Avatar",width:28,height:28,fill:"$accent"})
Insert(acc,T("Name","ktakeuchi",14,"$text-primary",{fontWeight:"600",textGrowth:"fixed-width",width:"fill_container"}))
Insert(acc,{type:"ref",ref:ids.IconButton,name:"Notifications",descendants:{"Icon":{icon:"bell"}}})
Insert(acc,{type:"ref",ref:ids.IconButton,name:"Collapse",descendants:{"Icon":{icon:"panel-left-close"}}})
addBtn=Insert(sb,F("AddTaskNav",{gap:"$space-2",alignItems:"center",padding:[6,10],width:"fill_container"}))
Insert(addBtn,I("Plus","plus-circle",20,"$accent"))
Insert(addBtn,T("Label","タスクを追加",14,"$accent",{fontWeight:"600"}))
nav=Insert(sb,F("Nav",{layout:"vertical",width:"fill_container",gap:2}))
for (const [ic,l,c] of [["search","検索",""],["inbox","受信トレイ","12"],["calendar-check","今日","5"],["calendar-days","近日",""],["layout-grid","フィルターとラベル",""]]) Insert(nav,{type:"ref",ref:ids.SidebarItem,name:"Nav-"+l,width:"fill_container",descendants:{"Icon":{icon:ic},"Label":{content:l},"Count":{content:c}}})
fav=Insert(sb,F("Favorites",{layout:"vertical",width:"fill_container",gap:2}))
Insert(fav,T("Heading","お気に入り",12,"$text-secondary",{fontWeight:"700"}))
Insert(fav,{type:"ref",ref:ids.ProjectItem,name:"Fav-買い物",width:"fill_container",descendants:{"Label":{content:"買い物"},"Count":{content:"4"},"Dot":{fill:"$priority-2"}}})
pj=Insert(sb,F("Projects",{layout:"vertical",width:"fill_container",gap:2}))
pjh=Insert(pj,F("ProjectsHeading",{width:"fill_container",alignItems:"center",justifyContent:"space_between"}))
Insert(pjh,T("Heading","マイプロジェクト",12,"$text-secondary",{fontWeight:"700"}))
Insert(pjh,{type:"ref",ref:ids.IconButton,name:"AddProject",descendants:{"Icon":{icon:"plus"}}})
for (const [l,c,col] of [["仕事","8","$priority-3"],["買い物","4","$priority-2"],["家のこと","3","$success"],["読書","2","$priority-4"]]) Insert(pj,{type:"ref",ref:ids.ProjectItem,name:"Pj-"+l,width:"fill_container",descendants:{"Label":{content:l},"Count":{content:c},"Dot":{fill:col}}})
main=Insert(d01,F("Main",{layout:"vertical",width:"fill_container",height:"fill_container",alignItems:"center",padding:[0,0,0,0]}))
Print(d01,sb,main)
```

- [ ] **Step 2: Main のヘッダとリストを作る**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
main=Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0];main=Get(main,{depth:1}).children.find(c=>c.name==="Main").id
col=Insert(main,F("Column",{layout:"vertical",width:800,gap:"$space-4",padding:[40,0]}))
hd=Insert(col,F("Header",{width:"fill_container",alignItems:"center",justifyContent:"space_between"}))
Insert(hd,T("Title","買い物",24,"$text-primary",{fontWeight:"700"}))
ha=Insert(hd,F("HeaderActions",{gap:"$space-1"}))
for (const [ic,l] of [["layout-list","表示"],["arrow-up-down","並び替え"],["more-horizontal",""]]) {const b=Insert(ha,F("HA-"+ic,{gap:"$space-1",alignItems:"center",padding:[4,8],cornerRadius:6}));Insert(b,I("Icon",ic,16,"$text-secondary"));if(l)Insert(b,T("Label",l,13,"$text-secondary"))}
list=Insert(col,F("List",{layout:"vertical",width:"fill_container"}))
rows={"今週":[["牛乳と卵を買う","近所のスーパーで。卵は 10 個入り","明日","@食品","P1","$priority-1"],["洗剤の詰め替え","","今週末","@日用品","P3","$priority-3"]],"いつか":[["新しいフライパン","28cm、IH 対応","","@キッチン","P4","$priority-4"]]}
for (const [sec,tasks] of Object.entries(rows)) {
  Insert(list,{type:"ref",ref:ids.SectionHeader,name:"Sec-"+sec,width:"fill_container",descendants:{"Title":{content:sec},"Count":{content:String(tasks.length)}}})
  for (const [t,d,dt,lb,p,pc] of tasks) Insert(list,{type:"ref",ref:ids.TaskRow,name:"Row-"+t,width:"fill_container",descendants:{"Title":{content:t},"Description":{content:d,enabled:!!d},"Date":{enabled:!!dt},"Label1":{enabled:true},"More":{enabled:false},"Project":{enabled:false},"Checkbox":{stroke:pc}}})
  Insert(list,{type:"ref",ref:ids.AddTaskRow,name:"Add-"+sec,width:"fill_container"})
}
Insert(list,T("CompletedToggle","完了したタスクを表示",13,"$text-secondary"))
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
d01=Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0]
problems(d01)
TakeScreenshot([d01])
```

- [ ] **Step 3: Review Focus 1, 2 の確認用バリアント行を足す**

全角 60 文字のタイトル行をリスト末尾に追加し、折り返し後もチェックボックスと Actions が上端に揃うことをスクリーンショットで確認する。カテゴリなしの行がセクション見出しの外にあっても崩れないことを確認する。

```js
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
list=Get(n=>n.name==="List"?n.id:undefined)[0]
long="あ".repeat(60)
Insert(list,{type:"ref",ref:ids.TaskRow,name:"Row-長文",width:"fill_container",descendants:{"Title":{content:long},"Description":{enabled:false},"Meta":{enabled:false}}})
Move(Get(n=>n.name==="Row-長文"?n.id:undefined)[0],list,0)
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
d01=Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0]
problems(d01);TakeScreenshot([list])
```

Expected: problems の Print なし。長文行が 2 行に折り返し、Checkbox と Actions は 1 行目の高さに揃う。崩れがあれば TaskRow component の `alignItems` を `start` に、Body の幅を `fill_container` に `Update` して直す。

- [ ] **Step 4: placeholder を外してコミット**

```js
d01=Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0];Update(d01,{placeholder:false})
```

```bash
git add design/powertodo.pen
git commit -m "design: add D-01 project list screen"
```

---

### Task 4: D-03 タスク詳細パネル

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Consumes: `D-01 プロジェクト`、component `Checkbox`, `PriorityChip`, `LabelChip`, `DateChip`, `TaskRow`, `TextField`, `Button`, `IconButton`
- Produces: 画面 `D-03 タスク詳細` = D-01 のコピー + 右側 `DetailPanel` (幅 400)。`DetailPanel` の子: `PanelHeader` (パンくず、閉じる), `TaskHead` (Checkbox + タイトル), `Description`, `Subtasks` (TaskRow ×2 + AddTaskRow), `Comments`, `Sidebar` (プロジェクト / 期限 / 優先度 / ラベル / リマインダー / 繰り返し の各行)

- [ ] **Step 1: D-01 をコピーして Main を縮め、DetailPanel を足す**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
src=Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"right",padding:120,nodeId:src})
d03=Copy(src,document,{name:"D-03 タスク詳細",x:pos.x,y:pos.y,placeholder:true})
panel=Insert(d03,F("DetailPanel",{layout:"vertical",width:400,height:"fill_container",fill:"$bg",stroke:"$border",strokeWidth:{left:1},padding:[16,20],gap:"$space-4"}))
ph=Insert(panel,F("PanelHeader",{width:"fill_container",alignItems:"center",justifyContent:"space_between"}))
bc=Insert(ph,F("Breadcrumb",{gap:"$space-1",alignItems:"center"}))
Insert(bc,{type:"ellipse",name:"Dot",width:10,height:10,fill:"$priority-2"})
Insert(bc,T("Project","買い物",13,"$text-secondary"))
Insert(bc,I("Sep","chevron-right",12,"$text-muted"))
Insert(bc,T("Section","今週",13,"$text-secondary"))
pha=Insert(ph,F("PanelActions",{gap:2}))
for (const ic of ["chevron-up","chevron-down","more-horizontal","x"]) Insert(pha,{type:"ref",ref:ids.IconButton,name:"PA-"+ic,descendants:{"Icon":{icon:ic}}})
th=Insert(panel,F("TaskHead",{gap:"$space-3",alignItems:"start",width:"fill_container"}))
Insert(th,{type:"ref",ref:ids.Checkbox,name:"Checkbox",descendants:{}})
Insert(th,T("Title","牛乳と卵を買う",18,"$text-primary",{fontWeight:"600",textGrowth:"fixed-width",width:"fill_container"}))
Insert(panel,T("Description","近所のスーパーで。卵は 10 個入り。ポイントカードを忘れない。",14,"$text-secondary",{textGrowth:"fixed-width",width:"fill_container"}))
props=Insert(panel,F("Properties",{layout:"vertical",width:"fill_container",stroke:"$border",strokeWidth:{top:1,bottom:1}}))
for (const [ic,k,v,col] of [["folder","プロジェクト","買い物 / 今週","$text-primary"],["calendar","期限","明日 15:00","$success"],["flag","優先度","P1","$priority-1"],["tag","ラベル","@食品 @急ぎ","$text-primary"],["bell","リマインダー","期限の 30 分前","$text-primary"],["repeat","繰り返し","毎週土曜","$text-primary"]]) {
  const r=Insert(props,F("Prop-"+k,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[10,0],stroke:"$border",strokeWidth:{bottom:1}}))
  Insert(r,I("Icon",ic,16,"$text-secondary"))
  Insert(r,T("Key",k,13,"$text-secondary",{width:100,textGrowth:"fixed-width"}))
  Insert(r,T("Value",v,13,col,{textGrowth:"fixed-width",width:"fill_container"}))
  Insert(r,I("Edit","chevron-right",14,"$text-muted"))
}
sub=Insert(panel,F("Subtasks",{layout:"vertical",width:"fill_container",gap:0}))
Insert(sub,T("Heading","サブタスク 1/3",13,"$text-primary",{fontWeight:"700"}))
for (const [t,done] of [["牛乳 1L",true],["卵 10 個入り",false],["食パン",false]]) Insert(sub,{type:"ref",ref:ids.TaskRow,name:"Sub-"+t,width:"fill_container",descendants:{"Title":{content:t,strikethrough:done,fill:done?"$text-muted":"$text-primary"},"Description":{enabled:false},"Meta":{enabled:false},"Actions":{enabled:false}}})
Insert(sub,{type:"ref",ref:ids.AddTaskRow,name:"AddSub",width:"fill_container",descendants:{"Label":{content:"サブタスクを追加"}}})
cm=Insert(panel,F("Comments",{layout:"vertical",width:"fill_container",gap:"$space-2"}))
Insert(cm,T("Heading","コメント",13,"$text-primary",{fontWeight:"700"}))
c1=Insert(cm,F("Comment",{gap:"$space-2",alignItems:"start",width:"fill_container"}))
Insert(c1,{type:"ellipse",name:"Avatar",width:24,height:24,fill:"$accent"})
cb=Insert(c1,F("CommentBody",{layout:"vertical",gap:2,width:"fill_container"}))
Insert(cb,T("Author","ktakeuchi  10/12 21:30",12,"$text-muted"))
Insert(cb,T("Text","先週は売り切れだった。開店直後に行く。",13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}))
Insert(cm,{type:"ref",ref:ids.TextField,name:"CommentInput",width:"fill_container",descendants:{"Placeholder":{content:"コメント"}}})
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d03);TakeScreenshot([panel])
```

- [ ] **Step 2: 確認する**

Expected: problems の Print なし。パネルがサイドバーと Main の右に 400 幅で並び、Main の Column (800) が残り幅 760 に収まらない場合は Column の width を `fill_container` と `padding:[40,24]` に `Update` する。

- [ ] **Step 3: placeholder を外してコミット**

```js
d03=Get(n=>n.name==="D-03 タスク詳細"?n.id:undefined)[0];Update(d03,{placeholder:false})
```

```bash
git add design/powertodo.pen
git commit -m "design: add D-03 task detail panel"
```

---

### Task 5: D-02 クイック追加

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Consumes: `D-01 プロジェクト`、component `Button`, `ButtonSecondary`, `PriorityChip`, `LabelChip`, `DateChip`
- Produces: 画面 `D-02 クイック追加` = D-01 のコピー + 半透明の `Overlay` (layoutPosition absolute) + 中央の `QuickAdd` ダイアログ (幅 560)。`QuickAdd` の子: `Input` (構文ハイライト済みテキストをチップで表現), `DescriptionInput`, `Toolbar` (期限 / 優先度 / リマインダー / ラベル / その他), `Footer` (プロジェクト選択、キャンセル、追加)

- [ ] **Step 1: コピーしてオーバーレイとダイアログを置く**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
src=Get(n=>n.name==="D-03 タスク詳細"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"right",padding:120,nodeId:src})
d01=Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0]
d02=Copy(d01,document,{name:"D-02 クイック追加",x:pos.x,y:pos.y,placeholder:true})
ov=Insert(d02,F("Overlay",{layoutPosition:"absolute",x:0,y:0,width:1440,height:900,fill:"#00000055",layout:"vertical",alignItems:"center",padding:[160,0,0,0]}))
dlg=Insert(ov,F("QuickAdd",{layout:"vertical",width:560,fill:"$bg",cornerRadius:12,padding:"$space-4",gap:"$space-3",effect:{type:"shadow",offset:{x:0,y:8},blur:32,color:"#00000033"}}))
inp=Insert(dlg,F("Input",{gap:"$space-1",alignItems:"center",width:"fill_container"}))
Insert(inp,T("Text1","牛乳と卵を買う ",16,"$text-primary"))
for (const [t,col,bg] of [["明日","$success","$bg-hover"],["p1","$priority-1","$accent-soft"],["#買い物","$priority-3","$bg-hover"],["@食品","$text-secondary","$bg-hover"]]) {const c=Insert(inp,F("Tok-"+t,{padding:[1,4],cornerRadius:4,fill:bg}));Insert(c,T("Label",t,16,col))}
Insert(inp,{type:"rectangle",name:"Caret",width:1.5,height:20,fill:"$text-primary"})
Insert(dlg,T("DescriptionInput","説明",14,"$text-muted",{textGrowth:"fixed-width",width:"fill_container"}))
tb=Insert(dlg,F("Toolbar",{gap:"$space-2",width:"fill_container"}))
for (const [ic,l,col] of [["calendar","明日","$success"],["flag","P1","$priority-1"],["bell","リマインダー","$text-secondary"],["tag","@食品","$text-secondary"],["more-horizontal","","$text-secondary"]]) {const b=Insert(tb,F("TB-"+ic,{gap:"$space-1",alignItems:"center",padding:[4,8],cornerRadius:6,stroke:"$border",strokeWidth:1}));Insert(b,I("Icon",ic,14,col));if(l)Insert(b,T("Label",l,13,col))}
Insert(dlg,{type:"rectangle",name:"Divider",width:"fill_container",height:1,fill:"$border"})
ft=Insert(dlg,F("Footer",{width:"fill_container",alignItems:"center",justifyContent:"space_between"}))
sel=Insert(ft,F("ProjectSelect",{gap:"$space-1",alignItems:"center",padding:[4,8],cornerRadius:6}))
Insert(sel,{type:"ellipse",name:"Dot",width:10,height:10,fill:"$priority-2"})
Insert(sel,T("Label","買い物 / 今週",13,"$text-primary"))
Insert(sel,I("Chevron","chevron-down",14,"$text-secondary"))
fb=Insert(ft,F("FooterButtons",{gap:"$space-2"}))
Insert(fb,{type:"ref",ref:ids.ButtonSecondary,name:"Cancel"})
Insert(fb,{type:"ref",ref:ids.Button,name:"Submit"})
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d02);TakeScreenshot([dlg])
```

- [ ] **Step 2: 確認する**

Expected: problems の Print なし。ダイアログ内のトークンが色分けされ、Footer の左にプロジェクト選択、右にキャンセル / 追加。

- [ ] **Step 3: placeholder を外してコミット**

```js
d02=Get(n=>n.name==="D-02 クイック追加"?n.id:undefined)[0];Update(d02,{placeholder:false})
```

```bash
git add design/powertodo.pen
git commit -m "design: add D-02 quick add dialog"
```

---

### Task 6: D-04 今日 / D-05 近日

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Consumes: `D-01 プロジェクト`、component `SectionHeader`, `TaskRow`, `AddTaskRow`, `Button`
- Produces: 画面 `D-04 今日`、`D-04 今日 (期限切れなし)`、`D-05 近日`。D-04 の List: `Sec-期限切れ` (右端に「再スケジュール」ボタン) + 期限切れ行 ×2 (DateChip 赤) + `Sec-今日` + 行 ×3。D-05 の Column: `WeekStrip` (7 日分の日付セル、今日を accent) + 日付ごとの SectionHeader と行

- [ ] **Step 1: D-04 今日を作る**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d01=Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0]
last=Get(n=>n.name==="D-02 クイック追加"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:d01})
d04=Copy(d01,document,{name:"D-04 今日",x:pos.x,y:pos.y,placeholder:true})
col=Get(d04,n=>n.name==="Column"?n.id:undefined)[0]
Get(col,n=>n.name==="Title"&&Update(n.id,{content:"今日"}))
hd=Get(col,n=>n.name==="Header"?n.id:undefined)[0]
Insert(hd,T("Subtitle","10月13日 月曜日 · 5 件",13,"$text-secondary"))
Move(Get(hd,n=>n.name==="Subtitle"?n.id:undefined)[0],hd,1)
list=Get(col,n=>n.name==="List"?n.id:undefined)[0]
Replace(list,F("List",{layout:"vertical",width:"fill_container"}))
list=Get(col,n=>n.name==="List"?n.id:undefined)[0]
ov=Insert(list,{type:"ref",ref:ids.SectionHeader,name:"Sec-期限切れ",width:"fill_container",descendants:{"Title":{content:"期限切れ"},"Count":{content:"2"}}})
rs=Insert(list,F("RescheduleRow",{width:"fill_container",justifyContent:"end",padding:[4,0]}))
Insert(rs,T("Reschedule","再スケジュール",13,"$accent",{fontWeight:"600"}))
for (const [t,dt,pj] of [["請求書を送る","10月10日","仕事"],["歯医者の予約","昨日","家のこと"]]) Insert(list,{type:"ref",ref:ids.TaskRow,name:"Row-"+t,width:"fill_container",descendants:{"Title":{content:t},"Description":{enabled:false},"Date":{descendants:{"Icon":{fill:"$danger"},"Label":{content:dt,fill:"$danger"}}},"Label1":{enabled:false},"More":{enabled:false},"Project":{content:pj}}})
Insert(list,{type:"ref",ref:ids.SectionHeader,name:"Sec-今日",width:"fill_container",descendants:{"Title":{content:"今日 · 10月13日"},"Count":{content:"3"},"Chevron":{enabled:false}}})
for (const [t,pj] of [["牛乳と卵を買う","買い物"],["週報を書く","仕事"],["ゴミ出し (燃えるごみ)","家のこと"]]) Insert(list,{type:"ref",ref:ids.TaskRow,name:"Row-"+t,width:"fill_container",descendants:{"Title":{content:t},"Description":{enabled:false},"Label1":{enabled:false},"More":{enabled:false},"Project":{content:pj}}})
Insert(list,{type:"ref",ref:ids.AddTaskRow,name:"Add-今日",width:"fill_container"})
Get(d04,n=>n.name==="Date"&&n.type==="ref"&&Print(n.id))
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d04);TakeScreenshot([col])
```

期限切れ 2 行の DateChip は `descendants` のネスト (`"Date":{descendants:{"Label":{...}}}`) で赤にしている。ネストした ref の子の上書きが効かない場合は `Get(rowId,{resolveInstances:true})` で実パス (`<rowRef>/<dateRef>/<labelId>`) を調べ、`Update` で上書きする。

- [ ] **Step 2: Review Focus 3 のバリアント「期限切れなし」を作る**

```js
d04=Get(n=>n.name==="D-04 今日"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"right",padding:120,nodeId:d04})
d04b=Copy(d04,document,{name:"D-04 今日 (期限切れなし)",x:pos.x,y:pos.y,placeholder:true})
for (const nm of ["Sec-期限切れ","RescheduleRow","Row-請求書を送る","Row-歯医者の予約"]) Get(d04b,n=>n.name===nm&&Delete(n.id))
Get(d04b,n=>n.name==="Sec-今日"&&Update(n.id,{enabled:false}))
Get(d04b,n=>n.name==="Subtitle"&&Update(n.id,{content:"10月13日 月曜日 · 3 件"}))
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d04b);Update(d04b,{placeholder:false});Update(d04,{placeholder:false})
```

Expected: 期限切れグループなし、「今日」見出しも出ない (Todoist は今日だけのとき見出しを出さない)。

- [ ] **Step 3: D-05 近日を作る**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d04=Get(n=>n.name==="D-04 今日"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:d04})
d05=Copy(Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0],document,{name:"D-05 近日",x:pos.x,y:pos.y,placeholder:true})
col=Get(d05,n=>n.name==="Column"?n.id:undefined)[0]
Get(col,n=>n.name==="Title"&&Update(n.id,{content:"近日"}))
hd=Get(col,n=>n.name==="Header"?n.id:undefined)[0]
ms=Insert(hd,F("MonthSelect",{gap:"$space-1",alignItems:"center"}))
Insert(ms,T("Month","2026年10月",14,"$text-primary",{fontWeight:"600"}))
Insert(ms,I("Chevron","chevron-down",14,"$text-secondary"))
Move(ms,hd,1)
strip=Insert(col,F("WeekStrip",{width:"fill_container",gap:"$space-1",justifyContent:"space_between",stroke:"$border",strokeWidth:{bottom:1},padding:[0,0,8,0]}))
for (const [d,w,today] of [["13","月",true],["14","火",false],["15","水",false],["16","木",false],["17","金",false],["18","土",false],["19","日",false]]) {const c=Insert(strip,F("Day-"+d,{layout:"vertical",alignItems:"center",gap:2,padding:[6,0],width:"fill_container",cornerRadius:6,fill:today?"$accent-soft":undefined}));Insert(c,T("W",w,11,"$text-secondary"));Insert(c,T("D",d,16,today?"$accent":"$text-primary",{fontWeight:today?"700":"400"}))}
Move(strip,col,1)
list=Get(col,n=>n.name==="List"?n.id:undefined)[0]
Replace(list,F("List",{layout:"vertical",width:"fill_container"}))
list=Get(col,n=>n.name==="List"?n.id:undefined)[0]
days={"10月13日 · 今日 · 月曜日":[["牛乳と卵を買う","買い物"],["週報を書く","仕事"]],"10月14日 · 明日 · 火曜日":[["粗大ごみの申し込み","家のこと"]],"10月15日 · 水曜日":[],"10月16日 · 木曜日":[["読書会の課題本を読み終える","読書"]]}
for (const [d,tasks] of Object.entries(days)) {
  Insert(list,{type:"ref",ref:ids.SectionHeader,name:"Day-"+d,width:"fill_container",descendants:{"Title":{content:d},"Count":{enabled:false},"Chevron":{enabled:false}}})
  for (const [t,pj] of tasks) Insert(list,{type:"ref",ref:ids.TaskRow,name:"Row-"+t,width:"fill_container",descendants:{"Title":{content:t},"Description":{enabled:false},"Date":{enabled:false},"Label1":{enabled:false},"More":{enabled:false},"Project":{content:pj}}})
  Insert(list,{type:"ref",ref:ids.AddTaskRow,name:"Add-"+d,width:"fill_container"})
}
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d05);TakeScreenshot([col])
Update(d05,{placeholder:false})
```

- [ ] **Step 4: コミット**

```bash
git add design/powertodo.pen
git commit -m "design: add D-04 today (with and without overdue) and D-05 upcoming"
```

---

### Task 7: D-06 ラベル / D-07 日付ピッカー + 繰り返し / D-08 リマインダー + OS 通知

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Consumes: `D-01 プロジェクト`, `D-03 タスク詳細`、component `LabelChip`, `TaskRow`, `TextField`, `Button`, `ButtonSecondary`
- Produces: 画面 `D-06 フィルターとラベル` (Column に `Filters` 一覧と `Labels` 一覧、右に `LabelDetail` は別画面 `D-06b ラベル詳細`)、`D-07 日付ピッカー` (D-03 のコピー + Prop-期限 の下に `DatePopover` 幅 320: 自然言語入力、クイック選択 4 つ、月カレンダー 6 週、時刻、`RecurrenceRow`)、`D-07b 繰り返し設定` (`RecurrencePopover`: プリセット 6 つ + 自由入力 + RRULE プレビュー)、`D-08 リマインダー` (D-03 のコピー + `ReminderPopover`: 相対 / 絶対の切替、候補 4 つ、追加済み 2 件) と `D-08b OS 通知` (1440×900 の黒背景に macOS 風バナー 360×80 を右上に 1 枚)

- [ ] **Step 1: D-06 フィルターとラベル、D-06b ラベル詳細**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d05=Get(n=>n.name==="D-05 近日"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:d05})
d06=Copy(Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0],document,{name:"D-06 フィルターとラベル",x:pos.x,y:pos.y,placeholder:true})
col=Get(d06,n=>n.name==="Column"?n.id:undefined)[0]
Get(col,n=>n.name==="Title"&&Update(n.id,{content:"フィルターとラベル"}))
list=Get(col,n=>n.name==="List"?n.id:undefined)[0]
Replace(list,F("List",{layout:"vertical",width:"fill_container",gap:"$space-4"}))
list=Get(col,n=>n.name==="List"?n.id:undefined)[0]
mk=(heading,items,icon)=>{const g=Insert(list,F(heading,{layout:"vertical",width:"fill_container"}));const h=Insert(g,F("Heading",{width:"fill_container",justifyContent:"space_between",alignItems:"center",padding:[0,0,8,0]}));Insert(h,T("Text",heading,14,"$text-primary",{fontWeight:"700"}));Insert(h,{type:"ref",ref:ids.IconButton,name:"Add",descendants:{"Icon":{icon:"plus"}}});for(const [l,c,col] of items){const r=Insert(g,F("Item-"+l,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[10,8],cornerRadius:6}));Insert(r,I("Icon",icon,16,col));Insert(r,T("Label",l,14,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}));Insert(r,T("Count",c,12,"$text-muted"))}}
mk("フィルター",[["今日 + 優先度高","3","$accent"],["買い物 (今週)","4","$priority-2"]],"filter")
mk("ラベル",[["食品","6","$success"],["日用品","3","$priority-3"],["急ぎ","2","$priority-1"],["キッチン","1","$priority-2"]],"tag")
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d06);Update(d06,{placeholder:false})
pos2=FindEmptySpace({width:1440,height:900,direction:"right",padding:120,nodeId:d06})
d06b=Copy(Get(n=>n.name==="D-04 今日"?n.id:undefined)[0],document,{name:"D-06b ラベル詳細",x:pos2.x,y:pos2.y,placeholder:true})
Get(d06b,n=>n.name==="Title"&&n.fontSize===24&&Update(n.id,{content:"@食品"}))
Get(d06b,n=>n.name==="Subtitle"&&Update(n.id,{content:"6 件 · 全プロジェクト"}))
for (const nm of ["Sec-期限切れ","RescheduleRow","Row-請求書を送る","Row-歯医者の予約","Sec-今日"]) Get(d06b,n=>n.name===nm&&Delete(n.id))
problems(d06b);Update(d06b,{placeholder:false})
TakeScreenshot([d06])
```

- [ ] **Step 2: D-07 日付ピッカーと D-07b 繰り返し**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d06=Get(n=>n.name==="D-06 フィルターとラベル"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:d06})
d07=Copy(Get(n=>n.name==="D-03 タスク詳細"?n.id:undefined)[0],document,{name:"D-07 日付ピッカー",x:pos.x,y:pos.y,placeholder:true})
pop=Insert(d07,F("DatePopover",{layoutPosition:"absolute",x:1040,y:300,layout:"vertical",width:320,fill:"$bg",cornerRadius:12,padding:"$space-3",gap:"$space-3",stroke:"$border",strokeWidth:1,effect:{type:"shadow",offset:{x:0,y:8},blur:24,color:"#00000022"}}))
Insert(pop,{type:"ref",ref:ids.TextField,name:"NaturalInput",width:"fill_container",descendants:{"Placeholder":{content:"来週月曜 15:00",fill:"$text-primary"}}})
q=Insert(pop,F("QuickPicks",{layout:"vertical",width:"fill_container"}))
for (const [ic,l,v,col] of [["calendar","今日","月",  "$success"],["sun","明日","火","$priority-2"],["sofa","今週末","土","$priority-3"],["calendar-plus","来週","月 10/20","$priority-3"],["circle-slash","日付なし","","$text-secondary"]]) {const r=Insert(q,F("QP-"+l,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[6,4]}));Insert(r,I("Icon",ic,16,col));Insert(r,T("Label",l,13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}));Insert(r,T("Value",v,12,"$text-muted"))}
cal=Insert(pop,F("Calendar",{layout:"vertical",width:"fill_container",gap:"$space-1"}))
ch=Insert(cal,F("CalHeader",{width:"fill_container",justifyContent:"space_between",alignItems:"center"}))
Insert(ch,T("Month","2026年10月",13,"$text-primary",{fontWeight:"600"}))
na=Insert(ch,F("Nav",{gap:2}));for (const ic of ["chevron-left","circle","chevron-right"]) Insert(na,I(ic,ic,14,"$text-secondary"))
wk=Insert(cal,F("Weekdays",{width:"fill_container",justifyContent:"space_between"}));for (const w of ["月","火","水","木","金","土","日"]) Insert(wk,T("W-"+w,w,11,"$text-muted",{textGrowth:"fixed-width",width:40,textAlign:"center"}))
days=[["28","29","30","1","2","3","4"],["5","6","7","8","9","10","11"],["12","13","14","15","16","17","18"],["19","20","21","22","23","24","25"],["26","27","28","29","30","31","1"]]
days.forEach((row,ri)=>{const r=Insert(cal,F("Week-"+ri,{width:"fill_container",justifyContent:"space_between"}));row.forEach((d,ci)=>{const out=(ri===0&&ci<3)||(ri===4&&ci===6);const sel=ri===2&&ci===1;const c=Insert(r,F("Day-"+ri+"-"+d,{width:40,height:32,layout:"vertical",justifyContent:"center",alignItems:"center",cornerRadius:16,fill:sel?"$accent":undefined}));Insert(c,T("D",d,13,sel?"#FFFFFF":out?"$text-muted":"$text-primary"))})})
tm=Insert(pop,F("TimeRow",{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[6,4],stroke:"$border",strokeWidth:{top:1}}))
Insert(tm,I("Icon","clock",16,"$text-secondary"));Insert(tm,T("Label","時刻",13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}));Insert(tm,T("Value","15:00",13,"$text-primary"))
rr=Insert(pop,F("RecurrenceRow",{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[6,4]}))
Insert(rr,I("Icon","repeat",16,"$text-secondary"));Insert(rr,T("Label","繰り返し",13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}));Insert(rr,T("Value","毎週土曜",13,"$text-primary"));Insert(rr,I("Chevron","chevron-right",14,"$text-muted"))
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d07);Update(d07,{placeholder:false})
pos2=FindEmptySpace({width:1440,height:900,direction:"right",padding:120,nodeId:d07})
d07b=Copy(d07,document,{name:"D-07b 繰り返し設定",x:pos2.x,y:pos2.y,placeholder:true})
old=Get(d07b,n=>n.name==="DatePopover"?n.id:undefined)[0]
rp=Replace(old,F("RecurrencePopover",{layoutPosition:"absolute",x:1040,y:300,layout:"vertical",width:320,fill:"$bg",cornerRadius:12,padding:"$space-3",gap:"$space-2",stroke:"$border",strokeWidth:1,effect:{type:"shadow",offset:{x:0,y:8},blur:24,color:"#00000022"}}))
Insert(rp,{type:"ref",ref:ids.TextField,name:"NaturalInput",width:"fill_container",descendants:{"Placeholder":{content:"毎週土曜",fill:"$text-primary"}}})
for (const [l,r] of [["毎日","FREQ=DAILY"],["平日","FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],["毎週 (土曜)","FREQ=WEEKLY;BYDAY=SA"],["毎月 (18日)","FREQ=MONTHLY;BYMONTHDAY=18"],["毎年 (10月18日)","FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=18"],["完了日から 3 日ごと","FREQ=DAILY;INTERVAL=3 (完了基準)"]]) {const row=Insert(rp,F("RP-"+l,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[6,4],cornerRadius:6,fill:l.startsWith("毎週")?"$bg-hover":undefined}));Insert(row,T("Label",l,13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}));Insert(row,T("Rule",r,10,"$text-muted"))}
ft=Insert(rp,F("Footer",{width:"fill_container",justifyContent:"end",gap:"$space-2",padding:[8,0,0,0]}))
Insert(ft,{type:"ref",ref:ids.ButtonSecondary,name:"Clear",descendants:{"Label":{content:"解除"}}})
Insert(ft,{type:"ref",ref:ids.Button,name:"Apply",descendants:{"Label":{content:"適用"}}})
problems(d07b);Update(d07b,{placeholder:false})
TakeScreenshot([Get(d07,n=>n.name==="DatePopover"?n.id:undefined)[0],rp])
```

- [ ] **Step 3: D-08 リマインダーと D-08b OS 通知**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d07=Get(n=>n.name==="D-07 日付ピッカー"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:d07})
d08=Copy(d07,document,{name:"D-08 リマインダー",x:pos.x,y:pos.y,placeholder:true})
old=Get(d08,n=>n.name==="DatePopover"?n.id:undefined)[0]
rp=Replace(old,F("ReminderPopover",{layoutPosition:"absolute",x:1040,y:420,layout:"vertical",width:320,fill:"$bg",cornerRadius:12,padding:"$space-3",gap:"$space-2",stroke:"$border",strokeWidth:1,effect:{type:"shadow",offset:{x:0,y:8},blur:24,color:"#00000022"}}))
seg=Insert(rp,F("Segmented",{width:"fill_container",cornerRadius:8,fill:"$bg-hover",padding:2}))
for (const [l,on] of [["期限から",true],["日時指定",false]]) {const s=Insert(seg,F("Seg-"+l,{width:"fill_container",justifyContent:"center",padding:[6,0],cornerRadius:6,fill:on?"$bg":undefined}));Insert(s,T("Label",l,13,on?"$text-primary":"$text-secondary",{fontWeight:on?"600":"400"}))}
Insert(rp,T("Heading","追加済み",12,"$text-secondary",{fontWeight:"700"}))
for (const l of ["期限と同時刻 (15:00)","30 分前 (14:30)"]) {const r=Insert(rp,F("Added-"+l,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[6,4]}));Insert(r,I("Icon","bell",16,"$accent"));Insert(r,T("Label",l,13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}));Insert(r,I("Remove","x",14,"$text-muted"))}
Insert(rp,T("Heading2","候補",12,"$text-secondary",{fontWeight:"700"}))
for (const l of ["10 分前","1 時間前","前日 9:00","1 週間前"]) {const r=Insert(rp,F("Cand-"+l,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[6,4]}));Insert(r,I("Icon","plus",16,"$text-secondary"));Insert(r,T("Label",l,13,"$text-primary"))}
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d08);Update(d08,{placeholder:false})
pos2=FindEmptySpace({width:1440,height:900,direction:"right",padding:120,nodeId:d08})
d08b=Insert(document,F("D-08b OS 通知",{x:pos2.x,y:pos2.y,width:1440,height:900,clip:true,placeholder:true,fill:"#2B2F3A",layout:"vertical",alignItems:"end",padding:[16,16]}))
bn=Insert(d08b,F("Banner",{width:360,gap:"$space-3",alignItems:"center",padding:[12,14],cornerRadius:14,fill:"#F5F5F7EE",effect:{type:"shadow",offset:{x:0,y:6},blur:20,color:"#00000044"}}))
ic=Insert(bn,F("AppIcon",{width:40,height:40,cornerRadius:10,fill:"$accent",layout:"vertical",justifyContent:"center",alignItems:"center"}))
Insert(ic,I("Check","check",22,"#FFFFFF"))
bb=Insert(bn,F("Body",{layout:"vertical",gap:1,width:"fill_container"}))
Insert(bb,T("App","PowerToDo · 今",11,"#6E6E73"))
Insert(bb,T("Title","牛乳と卵を買う",13,"#1D1D1F",{fontWeight:"600",textGrowth:"fixed-width",width:"fill_container"}))
Insert(bb,T("Sub","15:00 · 買い物",12,"#3A3A3C"))
ba=Insert(bn,F("Actions",{layout:"vertical",gap:4}))
for (const l of ["完了","後で"]) {const b=Insert(ba,F("B-"+l,{padding:[4,10],cornerRadius:6,fill:"#FFFFFF"}));Insert(b,T("Label",l,12,"#1D1D1F"))}
problems(d08b);Update(d08b,{placeholder:false})
TakeScreenshot([rp,bn])
```

- [ ] **Step 4: コミット**

```bash
git add design/powertodo.pen
git commit -m "design: add labels, date picker, recurrence, reminder, and OS notification screens"
```

---

### Task 8: D-09 設定 / D-12 初回起動

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Consumes: `D-01 プロジェクト`、component `Button`, `ButtonSecondary`, `TextField`
- Produces: 画面 `D-09 設定` (D-01 のコピー + 中央 `SettingsDialog` 幅 760: 左 `SettingsNav` 160、右 `SettingsBody`。Body は「Google Drive」タブの状態: クライアント ID 入力、接続ボタン、接続済みアカウント、最終同期、手動同期ボタン、データフォルダ)。`D-09b 競合バナー` (D-01 のコピー + Main 上部に `ConflictBanner`、ステータスバー右下に `SyncStatus`)。`D-12 初回起動` (1440×900 中央にカード 560: 3 ステップ表示、ステップ 1 データフォルダ選択)

- [ ] **Step 1: D-09 設定**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d08=Get(n=>n.name==="D-08 リマインダー"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:d08})
d09=Copy(Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0],document,{name:"D-09 設定",x:pos.x,y:pos.y,placeholder:true})
ov=Insert(d09,F("Overlay",{layoutPosition:"absolute",x:0,y:0,width:1440,height:900,fill:"#00000055",layout:"vertical",alignItems:"center",justifyContent:"center"}))
dlg=Insert(ov,F("SettingsDialog",{width:760,height:560,fill:"$bg",cornerRadius:12,clip:true,effect:{type:"shadow",offset:{x:0,y:8},blur:32,color:"#00000033"}}))
nav=Insert(dlg,F("SettingsNav",{layout:"vertical",width:180,height:"fill_container",fill:"$bg-sidebar",padding:[16,8],gap:2}))
Insert(nav,T("Heading","設定",16,"$text-primary",{fontWeight:"700"}))
for (const [ic,l,on] of [["user","アカウント",false],["cloud","Google Drive",true],["folder","データ",false],["bell","通知",false],["palette","外観",false],["calendar","日付と時刻",false],["keyboard","キーボード",false]]) {const r=Insert(nav,F("Nav-"+l,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[6,8],cornerRadius:6,fill:on?"$bg-hover":undefined}));Insert(r,I("Icon",ic,16,on?"$text-primary":"$text-secondary"));Insert(r,T("Label",l,13,"$text-primary"))}
body=Insert(dlg,F("SettingsBody",{layout:"vertical",width:"fill_container",height:"fill_container",padding:[20,24],gap:"$space-4"}))
Insert(body,T("Title","Google Drive",18,"$text-primary",{fontWeight:"700"}))
sec=(title,desc)=>{const s=Insert(body,F("S-"+title,{layout:"vertical",width:"fill_container",gap:"$space-2"}));Insert(s,T("Label",title,13,"$text-primary",{fontWeight:"600"}));if(desc)Insert(s,T("Desc",desc,12,"$text-secondary",{textGrowth:"fixed-width",width:"fill_container"}));return s}
s1=sec("OAuth クライアント ID","Google Cloud コンソールで「デスクトップアプリ」のクライアント ID を作成し、ここに貼り付けます。")
Insert(s1,{type:"ref",ref:ids.TextField,name:"ClientId",width:"fill_container",descendants:{"Placeholder":{content:"123456789012-abcdefg.apps.googleusercontent.com",fill:"$text-primary"}}})
s2=sec("接続状態","")
row=Insert(s2,F("Status",{width:"fill_container",alignItems:"center",gap:"$space-2"}))
Insert(row,{type:"ellipse",name:"Dot",width:8,height:8,fill:"$success"})
Insert(row,T("Text","接続済み · user@example.com",13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}))
Insert(row,{type:"ref",ref:ids.ButtonSecondary,name:"Disconnect",descendants:{"Label":{content:"接続を解除"}}})
s3=sec("同期","最終同期: 今日 09:41 · Drive フォルダ: PowerToDo/")
r3=Insert(s3,F("SyncRow",{gap:"$space-2"}))
Insert(r3,{type:"ref",ref:ids.Button,name:"SyncNow",descendants:{"Label":{content:"今すぐ同期"}}})
Insert(r3,{type:"ref",ref:ids.ButtonSecondary,name:"ChooseFolder",descendants:{"Label":{content:"Drive フォルダを変更"}}})
s4=sec("ローカルキャッシュ","~/Library/Application Support/PowerToDo/data/")
Insert(s4,{type:"ref",ref:ids.ButtonSecondary,name:"OpenFolder",descendants:{"Label":{content:"フォルダを開く"}}})
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d09);Update(d09,{placeholder:false});TakeScreenshot([dlg])
```

- [ ] **Step 2: D-09b 競合バナー + 同期ステータス**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d09=Get(n=>n.name==="D-09 設定"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"right",padding:120,nodeId:d09})
d09b=Copy(Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0],document,{name:"D-09b 競合バナー",x:pos.x,y:pos.y,placeholder:true})
main=Get(d09b,n=>n.name==="Main"?n.id:undefined)[0]
bn=Insert(main,F("ConflictBanner",{width:"fill_container",alignItems:"center",gap:"$space-3",padding:[10,24],fill:"$accent-soft",stroke:"$border",strokeWidth:{bottom:1}}))
Insert(bn,I("Icon","alert-triangle",18,"$accent"))
Insert(bn,T("Text","「買い物.xlsx」が別の端末でも変更されていました。新しい方を採用し、古い方を「買い物 (競合 2026-10-13 0941).xlsx」として保存しました。",13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}))
Insert(bn,{type:"ref",ref:ids.ButtonSecondary,name:"Open",descendants:{"Label":{content:"競合ファイルを開く"}}})
Insert(bn,{type:"ref",ref:ids.IconButton,name:"Close",descendants:{"Icon":{icon:"x"}}})
Move(bn,main,0)
st=Insert(d09b,F("SyncStatus",{layoutPosition:"absolute",x:1440-200,y:900-36,width:184,gap:"$space-1",alignItems:"center",padding:[4,8],cornerRadius:6,fill:"$bg-sidebar",stroke:"$border",strokeWidth:1}))
Insert(st,I("Icon","cloud-off",14,"$text-secondary"))
Insert(st,T("Text","オフライン · 最終同期 09:41",11,"$text-secondary"))
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d09b);Update(d09b,{placeholder:false});TakeScreenshot([bn,st])
```

- [ ] **Step 3: D-12 初回起動**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d09=Get(n=>n.name==="D-09 設定"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:d09})
d12=Insert(document,F("D-12 初回起動",{x:pos.x,y:pos.y,width:1440,height:900,clip:true,placeholder:true,fill:"$bg-sidebar",layout:"vertical",alignItems:"center",justifyContent:"center"}))
card=Insert(d12,F("Card",{layout:"vertical",width:560,fill:"$bg",cornerRadius:16,padding:[32,40],gap:"$space-6",effect:{type:"shadow",offset:{x:0,y:8},blur:32,color:"#00000022"}}))
hd=Insert(card,F("Head",{layout:"vertical",gap:"$space-2",width:"fill_container",alignItems:"center"}))
lg=Insert(hd,F("Logo",{width:56,height:56,cornerRadius:14,fill:"$accent",layout:"vertical",justifyContent:"center",alignItems:"center"}));Insert(lg,I("Check","check",28,"#FFFFFF"))
Insert(hd,T("Title","PowerToDo へようこそ",22,"$text-primary",{fontWeight:"700"}))
Insert(hd,T("Sub","タスクは Excel ファイルとして保存されます。保存先を選びましょう。",13,"$text-secondary",{textGrowth:"fixed-width",width:"fill_container",textAlign:"center"}))
steps=Insert(card,F("Steps",{width:"fill_container",gap:"$space-2",alignItems:"center",justifyContent:"center"}))
for (const [n,l,on] of [["1","保存先",true],["2","Google 接続",false],["3","受信トレイ",false]]) {const s=Insert(steps,F("Step-"+n,{gap:"$space-1",alignItems:"center"}));const c=Insert(s,F("Num",{width:22,height:22,cornerRadius:11,fill:on?"$accent":"$bg-hover",layout:"vertical",justifyContent:"center",alignItems:"center"}));Insert(c,T("N",n,11,on?"#FFFFFF":"$text-secondary",{fontWeight:"700"}));Insert(s,T("L",l,13,on?"$text-primary":"$text-secondary"));if(n!=="3")Insert(s,{type:"rectangle",name:"Line",width:32,height:1,fill:"$border"})}
fld=Insert(card,F("FolderPick",{layout:"vertical",width:"fill_container",gap:"$space-2"}))
Insert(fld,T("Label","データフォルダ",13,"$text-primary",{fontWeight:"600"}))
r=Insert(fld,F("Row",{width:"fill_container",gap:"$space-2",alignItems:"center"}))
Insert(r,{type:"ref",ref:ids.TextField,name:"Path",width:"fill_container",descendants:{"Placeholder":{content:"~/Library/Application Support/PowerToDo/data",fill:"$text-primary"}}})
Insert(r,{type:"ref",ref:ids.ButtonSecondary,name:"Browse",descendants:{"Label":{content:"選択"}}})
Insert(fld,T("Hint","Google Drive との同期は次のステップで設定できます。あとからでも変更できます。",12,"$text-secondary",{textGrowth:"fixed-width",width:"fill_container"}))
ft=Insert(card,F("Footer",{width:"fill_container",justifyContent:"space_between",alignItems:"center"}))
Insert(ft,T("Skip","あとで設定する",13,"$text-secondary"))
Insert(ft,{type:"ref",ref:ids.Button,name:"Next",descendants:{"Label":{content:"次へ"}}})
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d12);Update(d12,{placeholder:false});TakeScreenshot([card])
```

- [ ] **Step 4: コミット**

```bash
git add design/powertodo.pen
git commit -m "design: add settings, conflict banner, sync status, and onboarding screens"
```

---

### Task 9: D-10 ボード / D-11 状態 3 種 / D-13 最小ウィンドウ

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Consumes: `D-01 プロジェクト`、component `TaskRow`, `SectionHeader`, `AddTaskRow`, `Button`
- Produces: `D-10 ボード` (Main 内に横並び `Board`、列 3 本 幅 280、各列に `ColumnHeader` とカード ×1〜3、末尾 `AddSection` 列)。`D-11a 空のプロジェクト`、`D-11b 読み込みエラー`、`D-11c 要修正行` (TaskRow に警告アイコンと「要修正」バッジ)。`D-13 最小ウィンドウ` (960×600、サイドバー折りたたみ 56 幅、アイコンのみ)

- [ ] **Step 1: D-10 ボード**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d12=Get(n=>n.name==="D-12 初回起動"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:d12})
d10=Copy(Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0],document,{name:"D-10 ボード",x:pos.x,y:pos.y,placeholder:true})
col=Get(d10,n=>n.name==="Column"?n.id:undefined)[0]
Update(col,{width:"fill_container",padding:[40,32]})
list=Get(col,n=>n.name==="List"?n.id:undefined)[0]
board=Replace(list,F("Board",{gap:"$space-4",alignItems:"start",width:"fill_container"}))
cols={"今週":[["牛乳と卵を買う","明日","P1","$priority-1"],["洗剤の詰め替え","今週末","P3","$priority-3"]],"いつか":[["新しいフライパン","","P4","$priority-4"]],"完了":[["ティッシュ","","P4","$priority-4"]]}
for (const [sec,cards] of Object.entries(cols)) {
  const c=Insert(board,F("Col-"+sec,{layout:"vertical",width:280,gap:"$space-2"}))
  const h=Insert(c,F("ColumnHeader",{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[4,4]}))
  Insert(h,T("Title",sec,14,"$text-primary",{fontWeight:"700"}));Insert(h,T("Count",String(cards.length),12,"$text-muted",{textGrowth:"fixed-width",width:"fill_container"}));Insert(h,{type:"ref",ref:ids.IconButton,name:"More",descendants:{"Icon":{icon:"more-horizontal"}}})
  for (const [t,dt,p,pc] of cards) {const k=Insert(c,F("Card-"+t,{layout:"vertical",width:"fill_container",padding:"$space-3",gap:"$space-2",cornerRadius:"$radius",fill:"$bg",stroke:"$border",strokeWidth:1,effect:{type:"shadow",offset:{x:0,y:1},blur:3,color:"#00000014"}}));const r=Insert(k,F("Row",{gap:"$space-2",alignItems:"start",width:"fill_container"}));Insert(r,{type:"ref",ref:ids.Checkbox,name:"Checkbox",descendants:{}});Insert(r,T("Title",t,13,sec==="完了"?"$text-muted":"$text-primary",{textGrowth:"fixed-width",width:"fill_container",strikethrough:sec==="完了"}));if(dt){const m=Insert(k,F("Meta",{gap:"$space-2"}));Insert(m,{type:"ref",ref:ids.DateChip,name:"Date",descendants:{"Label":{content:dt}}});Insert(m,{type:"ref",ref:ids.PriorityChip,name:"Prio",descendants:{"Label":{content:p},"Dot":{fill:pc}}})}}
  Insert(c,{type:"ref",ref:ids.AddTaskRow,name:"Add-"+sec,width:"fill_container"})
}
ac=Insert(board,F("AddSection",{width:280,padding:[8,12],cornerRadius:"$radius",stroke:"$border",strokeWidth:1,gap:"$space-2",alignItems:"center"}))
Insert(ac,I("Plus","plus",16,"$text-secondary"));Insert(ac,T("Label","セクションを追加",13,"$text-secondary"))
Get(d10,n=>n.name==="HA-layout-list"&&Get(n.id,m=>m.name==="Label"&&Update(m.id,{content:"ボード"})))
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d10);Update(d10,{placeholder:false});TakeScreenshot([board])
```

- [ ] **Step 2: D-11 状態 3 種**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
d01=Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0]
d10=Get(n=>n.name==="D-10 ボード"?n.id:undefined)[0]
pos=FindEmptySpace({width:1440,height:900,direction:"right",padding:120,nodeId:d10})
mkState=(name,x,build)=>{const s=Copy(d01,document,{name,x,y:pos.y,placeholder:true});const col=Get(s,n=>n.name==="Column"?n.id:undefined)[0];const list=Get(col,n=>n.name==="List"?n.id:undefined)[0];const l=Replace(list,F("List",{layout:"vertical",width:"fill_container",alignItems:"center",padding:[80,0],gap:"$space-3"}));build(s,l);problems(s);Update(s,{placeholder:false});return s}
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
a=mkState("D-11a 空のプロジェクト",pos.x,(s,l)=>{Insert(l,I("Icon","clipboard-list",56,"$text-muted"));Insert(l,T("Title","タスクはまだありません",16,"$text-primary",{fontWeight:"600"}));Insert(l,T("Sub","「タスクを追加」または Q キーで最初のタスクを作成します。",13,"$text-secondary"));Insert(l,{type:"ref",ref:ids.Button,name:"Add"})})
b=mkState("D-11b 読み込みエラー",pos.x+1560,(s,l)=>{Insert(l,I("Icon","file-warning",56,"$danger"));Insert(l,T("Title","「買い物.xlsx」を読み込めません",16,"$text-primary",{fontWeight:"600"}));Insert(l,T("Sub","ファイルが別のアプリで開かれているか、壊れています。このファイルは上書きしません。",13,"$text-secondary",{textGrowth:"fixed-width",width:480,textAlign:"center"}));const r=Insert(l,F("Buttons",{gap:"$space-2"}));Insert(r,{type:"ref",ref:ids.Button,name:"Retry",descendants:{"Label":{content:"再試行"}}});Insert(r,{type:"ref",ref:ids.ButtonSecondary,name:"Reveal",descendants:{"Label":{content:"ファイルの場所を開く"}}})})
c=Copy(d01,document,{name:"D-11c 要修正行",x:pos.x+3120,y:pos.y,placeholder:true})
row=Get(c,n=>n.name==="Row-洗剤の詰め替え"?n.id:undefined)[0]
Update(row,{fill:"$accent-soft"})
tgt=Get(row,{resolveInstances:true});titlePath=Get(row,n=>n.name==="Title"?n.id:undefined,{resolveInstances:true})[0]
Update(titlePath,{content:"洗剤の詰め替え    ⚠ 要修正: 「終了」列が日付ではありません (値: 来週)"})
bn=Insert(Get(c,n=>n.name==="Main"?n.id:undefined)[0],F("FixBanner",{width:"fill_container",alignItems:"center",gap:"$space-3",padding:[10,24],fill:"$accent-soft",stroke:"$border",strokeWidth:{bottom:1}}))
Insert(bn,I("Icon","alert-triangle",18,"$accent"))
Insert(bn,T("Text","1 行に型の不整合があります。Excel で修正するまで、その行はアプリから編集できません。",13,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}))
Insert(bn,{type:"ref",ref:ids.ButtonSecondary,name:"OpenExcel",descendants:{"Label":{content:"Excel で開く"}}})
Move(bn,Get(c,n=>n.name==="Main"?n.id:undefined)[0],0)
problems(c);Update(c,{placeholder:false})
TakeScreenshot([a,c])
```

Expected: `titlePath` の Update が「cannot update descendant of instance」で失敗する場合は、Copy の `descendants` で `"Title":{content:"..."}` を指定した行を 1 本足し直し、元の行を `Delete` する。

- [ ] **Step 3: D-13 最小ウィンドウ 960×600**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
c=Get(n=>n.name==="D-11c 要修正行"?n.id:undefined)[0]
pos=FindEmptySpace({width:960,height:600,direction:"bottom",padding:120,nodeId:Get(n=>n.name==="D-10 ボード"?n.id:undefined)[0]})
d13=Copy(Get(n=>n.name==="D-01 プロジェクト"?n.id:undefined)[0],document,{name:"D-13 最小ウィンドウ 960x600",x:pos.x,y:pos.y,width:960,height:600,placeholder:true})
sb=Get(d13,n=>n.name==="Sidebar"?n.id:undefined)[0]
rail=Replace(sb,F("SidebarRail",{layout:"vertical",width:56,height:"fill_container",fill:"$bg-sidebar",padding:[12,0],gap:"$space-2",alignItems:"center"}))
for (const ic of ["panel-left-open","plus-circle","search","inbox","calendar-check","calendar-days","layout-grid"]) Insert(rail,{type:"ref",ref:ids.IconButton,name:"R-"+ic,descendants:{"Icon":{icon:ic,fill:ic==="plus-circle"?"$accent":"$text-secondary"}}})
col=Get(d13,n=>n.name==="Column"?n.id:undefined)[0]
Update(col,{width:"fill_container",padding:[24,32]})
Get(d13,n=>n.name==="Row-長文"&&Delete(n.id))
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(d13);Update(d13,{placeholder:false});TakeScreenshot([d13])
```

Expected: 幅 960 で Column が `fill_container` になり、TaskRow の Actions 4 アイコンがはみ出さない。はみ出す場合は Column の padding を `[24,16]` に下げる。

- [ ] **Step 4: コミット**

```bash
git add design/powertodo.pen
git commit -m "design: add board view, empty/error/invalid-row states, and 960x600 layout"
```

---

### Task 10: ダーク版 3 枚

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Consumes: `D-01 プロジェクト`, `D-03 タスク詳細`, `D-04 今日`
- Produces: `D-01 プロジェクト (ダーク)`, `D-03 タスク詳細 (ダーク)`, `D-04 今日 (ダーク)`。`theme:{mode:"dark"}` を画面 frame に付けたコピー

- [ ] **Step 1: コピーして theme を付ける**

```js
srcs=["D-01 プロジェクト","D-03 タスク詳細","D-04 今日"]
anchor=Get(n=>n.name==="D-13 最小ウィンドウ 960x600"?n.id:undefined)[0]
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
made=[]
for (const nm of srcs) {const src=Get(n=>n.name===nm?n.id:undefined)[0];const pos=FindEmptySpace({width:1440,height:900,direction:"bottom",padding:120,nodeId:anchor});const d=Copy(src,document,{name:nm+" (ダーク)",x:pos.x,y:pos.y,theme:{mode:"dark"},placeholder:true});anchor=d;made.push(d);problems(d);Update(d,{placeholder:false})}
TakeScreenshot(made)
```

- [ ] **Step 2: 確認する**

Expected: 背景 `#1E1E1E`、サイドバー `#282828`、本文白。ベタ書き色 (QuickAdd の Caret、D-08b、OS 通知) はダークにならないが D-01 / D-03 / D-04 には含まれないので問題なし。コントラストが不足するテキスト (例 `$text-muted` on `$bg-sidebar`) があれば Task 1 の dark 値を `SetVariables` で調整する (ノードは触らない)。

- [ ] **Step 3: コミット**

```bash
git add design/powertodo.pen
git commit -m "design: add dark theme variants for project, detail, and today"
```

---

### Task 11: モバイル 7 画面 (390×844)

**Files:**
- Modify: `design/powertodo.pen`

**Interfaces:**
- Consumes: component 全部
- Produces: component `TabBar` (下部タブ 4 つ、高さ 56 + ホームインジケータ 34)、`MobileHeader` (左ハンバーガー、タイトル、右 more)。画面 `M-01 プロジェクト`, `M-02 クイック追加`, `M-03 タスク詳細`, `M-04 今日`, `M-05 近日`, `M-06 ドロワー`, `M-07 設定`

- [ ] **Step 1: モバイル用 component と M-01**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
cx=0;Get(n=>n.reusable&&n.y===0&&(cx=Math.max(cx,n.x+(n.width||100))))
tab=Insert(document,F("TabBar",{x:cx+60,y:0,reusable:true,layout:"vertical",width:390,fill:"$bg",stroke:"$border",strokeWidth:{top:1}}))
tr=Insert(tab,F("Tabs",{width:"fill_container",height:56,justifyContent:"space_around",alignItems:"center"}))
for (const [ic,l,on] of [["calendar-check","今日",true],["calendar-days","近日",false],["search","検索",false],["list","一覧",false]]) {const t=Insert(tr,F("Tab-"+l,{layout:"vertical",alignItems:"center",gap:2,width:80}));Insert(t,I("Icon",ic,22,on?"$accent":"$text-secondary"));Insert(t,T("Label",l,10,on?"$accent":"$text-secondary"))}
hi=Insert(tab,F("HomeIndicator",{width:"fill_container",height:34,justifyContent:"center",alignItems:"center"}));Insert(hi,{type:"rectangle",name:"Bar",width:134,height:5,cornerRadius:3,fill:"$text-primary"})
mh=Insert(document,F("MobileHeader",{x:cx+60,y:120,reusable:true,layout:"vertical",width:390,fill:"$bg"}))
Insert(mh,F("StatusBar",{width:"fill_container",height:47}))
hr=Insert(mh,F("Row",{width:"fill_container",alignItems:"center",padding:[6,12],gap:"$space-2"}))
Insert(hr,{type:"ref",ref:ids.IconButton,name:"Menu",descendants:{"Icon":{icon:"menu"}}})
Insert(hr,T("Title","買い物",20,"$text-primary",{fontWeight:"700",textGrowth:"fixed-width",width:"fill_container"}))
Insert(hr,{type:"ref",ref:ids.IconButton,name:"More",descendants:{"Icon":{icon:"more-horizontal"}}})
anchor=Get(n=>n.name==="D-04 今日 (ダーク)"?n.id:undefined)[0]
pos=FindEmptySpace({width:390,height:844,direction:"bottom",padding:120,nodeId:anchor})
m01=Insert(document,F("M-01 プロジェクト",{x:pos.x,y:pos.y,width:390,height:844,clip:true,placeholder:true,fill:"$bg",layout:"vertical"}))
Insert(m01,{type:"ref",ref:mh,name:"Header"})
body=Insert(m01,F("Body",{layout:"vertical",width:"fill_container",height:"fill_container",padding:[0,16]}))
rows={"今週":[["牛乳と卵を買う","明日"],["洗剤の詰め替え","今週末"]],"いつか":[["新しいフライパン",""]]}
for (const [sec,tasks] of Object.entries(rows)) {Insert(body,{type:"ref",ref:ids.SectionHeader,name:"Sec-"+sec,width:"fill_container",descendants:{"Title":{content:sec},"Count":{content:String(tasks.length)}}});for (const [t,dt] of tasks) Insert(body,{type:"ref",ref:ids.TaskRow,name:"Row-"+t,width:"fill_container",descendants:{"Title":{content:t},"Description":{enabled:false},"Date":{enabled:!!dt},"Label1":{enabled:false},"More":{enabled:false},"Project":{enabled:false},"Actions":{enabled:false}}})}
sw=Insert(body,F("SwipeDemo",{width:"fill_container",alignItems:"center",fill:"$success",cornerRadius:6}))
sl=Insert(sw,F("SwipeLabel",{padding:[10,12],gap:"$space-1",alignItems:"center"}));Insert(sl,I("Icon","check",16,"#FFFFFF"));Insert(sl,T("Label","完了",13,"#FFFFFF",{fontWeight:"600"}))
Insert(sw,{type:"ref",ref:ids.TaskRow,name:"Row-スワイプ中",width:260,descendants:{"Title":{content:"食パン"},"Description":{enabled:false},"Meta":{enabled:false},"Actions":{enabled:false}}})
fab=Insert(m01,F("FAB",{layoutPosition:"absolute",x:390-16-56,y:844-90-56-16,width:56,height:56,cornerRadius:28,fill:"$accent",layout:"vertical",justifyContent:"center",alignItems:"center",effect:{type:"shadow",offset:{x:0,y:4},blur:12,color:"#00000044"}}))
Insert(fab,I("Plus","plus",26,"#FFFFFF"))
Insert(m01,{type:"ref",ref:tab,name:"TabBar",descendants:{}})
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(m01);Update(m01,{placeholder:false});TakeScreenshot([m01])
```

Expected: TabBar が最下部に来る。来ない場合は Body の `height:"fill_container"` が効いているか確認し、m01 に `justifyContent:"space_between"` を付ける。

- [ ] **Step 2: M-02 クイック追加 (下部シート、キーボード領域あり)、M-03 タスク詳細**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
m01=Get(n=>n.name==="M-01 プロジェクト"?n.id:undefined)[0]
pos=FindEmptySpace({width:390,height:844,direction:"right",padding:80,nodeId:m01})
m02=Copy(m01,document,{name:"M-02 クイック追加",x:pos.x,y:pos.y,placeholder:true})
Get(m02,n=>n.name==="FAB"&&Delete(n.id))
ov=Insert(m02,F("Overlay",{layoutPosition:"absolute",x:0,y:0,width:390,height:844,fill:"#00000055",layout:"vertical",justifyContent:"end"}))
sheet=Insert(ov,F("Sheet",{layout:"vertical",width:"fill_container",fill:"$bg",cornerRadius:[16,16,0,0],padding:[12,16],gap:"$space-3"}))
inp=Insert(sheet,F("Input",{gap:"$space-1",alignItems:"center",width:"fill_container"}))
Insert(inp,T("Text","牛乳と卵を買う ",16,"$text-primary"))
for (const [t,col] of [["明日","$success"],["p1","$priority-1"]]) {const c=Insert(inp,F("Tok-"+t,{padding:[1,4],cornerRadius:4,fill:"$bg-hover"}));Insert(c,T("Label",t,16,col))}
Insert(sheet,T("Desc","説明",14,"$text-muted"))
tb=Insert(sheet,F("Toolbar",{width:"fill_container",gap:"$space-2",alignItems:"center"}))
for (const [ic,col] of [["calendar","$success"],["flag","$priority-1"],["bell","$text-secondary"],["tag","$text-secondary"],["folder","$text-secondary"]]) Insert(tb,{type:"ref",ref:ids.IconButton,name:"TB-"+ic,descendants:{"Icon":{icon:ic,fill:col}}})
sp=Insert(tb,F("Spacer",{width:"fill_container"}))
send=Insert(tb,F("Send",{width:36,height:36,cornerRadius:18,fill:"$accent",layout:"vertical",justifyContent:"center",alignItems:"center"}));Insert(send,I("Icon","arrow-up",18,"#FFFFFF"))
kb=Insert(ov,F("Keyboard",{width:"fill_container",height:291,fill:"#D1D4DA",layout:"vertical",justifyContent:"center",alignItems:"center"}))
Insert(kb,T("Label","キーボード領域 (291pt)",12,"#6E6E73"))
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
problems(m02);Update(m02,{placeholder:false})
pos2=FindEmptySpace({width:390,height:844,direction:"right",padding:80,nodeId:m02})
m03=Insert(document,F("M-03 タスク詳細",{x:pos2.x,y:pos2.y,width:390,height:844,clip:true,placeholder:true,fill:"$bg",layout:"vertical"}))
hd=Insert(m03,F("Header",{layout:"vertical",width:"fill_container"}))
Insert(hd,F("StatusBar",{width:"fill_container",height:47}))
hr=Insert(hd,F("Row",{width:"fill_container",alignItems:"center",padding:[6,12],gap:"$space-2"}))
Insert(hr,{type:"ref",ref:ids.IconButton,name:"Back",descendants:{"Icon":{icon:"chevron-left"}}})
bc=Insert(hr,F("Breadcrumb",{gap:"$space-1",alignItems:"center",width:"fill_container"}));Insert(bc,{type:"ellipse",name:"Dot",width:10,height:10,fill:"$priority-2"});Insert(bc,T("Project","買い物 / 今週",13,"$text-secondary"))
Insert(hr,{type:"ref",ref:ids.IconButton,name:"More",descendants:{"Icon":{icon:"more-horizontal"}}})
body=Insert(m03,F("Body",{layout:"vertical",width:"fill_container",height:"fill_container",padding:[8,16],gap:"$space-4"}))
th=Insert(body,F("TaskHead",{gap:"$space-3",alignItems:"start",width:"fill_container"}));Insert(th,{type:"ref",ref:ids.Checkbox,name:"Checkbox",descendants:{}});Insert(th,T("Title","牛乳と卵を買う",20,"$text-primary",{fontWeight:"600",textGrowth:"fixed-width",width:"fill_container"}))
Insert(body,T("Description","近所のスーパーで。卵は 10 個入り。",14,"$text-secondary",{textGrowth:"fixed-width",width:"fill_container"}))
props=Insert(body,F("Properties",{layout:"vertical",width:"fill_container",stroke:"$border",strokeWidth:{top:1}}))
for (const [ic,k,v,col] of [["calendar","期限","明日 15:00","$success"],["flag","優先度","P1","$priority-1"],["tag","ラベル","@食品 @急ぎ","$text-primary"],["bell","リマインダー","30 分前","$text-primary"],["repeat","繰り返し","毎週土曜","$text-primary"]]) {const r=Insert(props,F("Prop-"+k,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[12,0],stroke:"$border",strokeWidth:{bottom:1}}));Insert(r,I("Icon",ic,18,"$text-secondary"));Insert(r,T("Key",k,14,"$text-secondary",{width:96,textGrowth:"fixed-width"}));Insert(r,T("Value",v,14,col,{textGrowth:"fixed-width",width:"fill_container"}));Insert(r,I("Chevron","chevron-right",16,"$text-muted"))}
sub=Insert(body,F("Subtasks",{layout:"vertical",width:"fill_container"}));Insert(sub,T("Heading","サブタスク 1/3",13,"$text-primary",{fontWeight:"700"}))
for (const [t,done] of [["牛乳 1L",true],["卵 10 個入り",false],["食パン",false]]) Insert(sub,{type:"ref",ref:ids.TaskRow,name:"Sub-"+t,width:"fill_container",descendants:{"Title":{content:t,strikethrough:done,fill:done?"$text-muted":"$text-primary"},"Description":{enabled:false},"Meta":{enabled:false},"Actions":{enabled:false}}})
Insert(sub,{type:"ref",ref:ids.AddTaskRow,name:"AddSub",width:"fill_container",descendants:{"Label":{content:"サブタスクを追加"}}})
cm=Insert(m03,F("CommentBar",{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[8,16],stroke:"$border",strokeWidth:{top:1}}))
Insert(cm,{type:"ref",ref:ids.TextField,name:"CommentInput",width:"fill_container",descendants:{"Placeholder":{content:"コメント"}}})
Insert(cm,{type:"ref",ref:ids.IconButton,name:"Send",descendants:{"Icon":{icon:"send"}}})
Insert(m03,F("HomeIndicatorSpace",{width:"fill_container",height:34}))
problems(m03);Update(m03,{placeholder:false});TakeScreenshot([m02,m03])
```

- [ ] **Step 3: M-04 今日、M-05 近日、M-06 ドロワー、M-07 設定**

```js
T=(name,content,fontSize,fill,extra={})=>({type:"text",name,content,fontFamily:"$font-body",fontSize,fill,...extra})
F=(name,extra={})=>({type:"frame",name,...extra})
I=(name,icon,size,fill)=>({type:"icon",name,library:"lucide",icon,width:size,height:size,fill})
ids={};Get(n=>n.reusable&&(ids[n.name]=n.id))
m01=Get(n=>n.name==="M-01 プロジェクト"?n.id:undefined)[0]
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
anchor=Get(n=>n.name==="M-03 タスク詳細"?n.id:undefined)[0]
next=()=>{const p=FindEmptySpace({width:390,height:844,direction:"right",padding:80,nodeId:anchor});return p}
rebuildBody=(screen,title,build)=>{Get(screen,n=>n.name==="Title"&&n.fontSize===20&&Update(n.id,{content:title}));const body=Get(screen,n=>n.name==="Body"?n.id:undefined)[0];const b=Replace(body,F("Body",{layout:"vertical",width:"fill_container",height:"fill_container",padding:[0,16]}));build(b)}
p=next();m04=Copy(m01,document,{name:"M-04 今日",x:p.x,y:p.y,placeholder:true});anchor=m04
rebuildBody(m04,"今日",b=>{Insert(b,T("Sub","10月13日 月曜日 · 5 件",12,"$text-secondary"));Insert(b,{type:"ref",ref:ids.SectionHeader,name:"Sec-期限切れ",width:"fill_container",descendants:{"Title":{content:"期限切れ"},"Count":{content:"2"}}});for (const t of ["請求書を送る","歯医者の予約"]) Insert(b,{type:"ref",ref:ids.TaskRow,name:"Row-"+t,width:"fill_container",descendants:{"Title":{content:t},"Description":{enabled:false},"Label1":{enabled:false},"More":{enabled:false},"Project":{enabled:false},"Actions":{enabled:false},"Date":{descendants:{"Icon":{fill:"$danger"},"Label":{content:"10月10日",fill:"$danger"}}}}});Insert(b,{type:"ref",ref:ids.SectionHeader,name:"Sec-今日",width:"fill_container",descendants:{"Title":{content:"今日"},"Count":{content:"3"}}});for (const t of ["牛乳と卵を買う","週報を書く","ゴミ出し"]) Insert(b,{type:"ref",ref:ids.TaskRow,name:"Row-"+t,width:"fill_container",descendants:{"Title":{content:t},"Description":{enabled:false},"Date":{enabled:false},"Label1":{enabled:false},"More":{enabled:false},"Project":{enabled:false},"Actions":{enabled:false}}})})
problems(m04);Update(m04,{placeholder:false})
p=next();m05=Copy(m01,document,{name:"M-05 近日",x:p.x,y:p.y,placeholder:true});anchor=m05
rebuildBody(m05,"近日",b=>{const strip=Insert(b,F("WeekStrip",{width:"fill_container",gap:4,justifyContent:"space_between",padding:[4,0,8,0],stroke:"$border",strokeWidth:{bottom:1}}));for (const [d,w,on] of [["13","月",true],["14","火",false],["15","水",false],["16","木",false],["17","金",false],["18","土",false],["19","日",false]]) {const c=Insert(strip,F("Day-"+d,{layout:"vertical",alignItems:"center",gap:2,padding:[6,0],width:"fill_container",cornerRadius:8,fill:on?"$accent-soft":undefined}));Insert(c,T("W",w,10,"$text-secondary"));Insert(c,T("D",d,15,on?"$accent":"$text-primary",{fontWeight:on?"700":"400"}))};for (const [d,tasks] of [["10月13日 · 今日",["牛乳と卵を買う","週報を書く"]],["10月14日 · 明日",["粗大ごみの申し込み"]],["10月16日 · 木曜日",["読書会の課題本"]]]) {Insert(b,{type:"ref",ref:ids.SectionHeader,name:"Day-"+d,width:"fill_container",descendants:{"Title":{content:d},"Count":{enabled:false},"Chevron":{enabled:false}}});for (const t of tasks) Insert(b,{type:"ref",ref:ids.TaskRow,name:"Row-"+t,width:"fill_container",descendants:{"Title":{content:t},"Description":{enabled:false},"Meta":{enabled:false},"Actions":{enabled:false}}})}})
Get(m05,n=>n.name==="Tab-今日"&&Get(n.id,m=>(m.name==="Icon"||m.name==="Label")&&Update(m.id,{fill:"$text-secondary"})))
Get(m05,n=>n.name==="Tab-近日"&&Get(n.id,m=>(m.name==="Icon"||m.name==="Label")&&Update(m.id,{fill:"$accent"})))
problems(m05);Update(m05,{placeholder:false})
p=next();m06=Copy(m01,document,{name:"M-06 ドロワー",x:p.x,y:p.y,placeholder:true});anchor=m06
Get(m06,n=>n.name==="FAB"&&Delete(n.id))
ov=Insert(m06,F("Overlay",{layoutPosition:"absolute",x:0,y:0,width:390,height:844,fill:"#00000055"}))
dr=Insert(ov,F("Drawer",{layout:"vertical",width:300,height:"fill_container",fill:"$bg-sidebar",padding:[60,12,24,12],gap:"$space-4"}))
acc=Insert(dr,F("Account",{gap:"$space-2",alignItems:"center",width:"fill_container"}));Insert(acc,{type:"ellipse",name:"Avatar",width:32,height:32,fill:"$accent"});Insert(acc,T("Name","ktakeuchi",15,"$text-primary",{fontWeight:"600",textGrowth:"fixed-width",width:"fill_container"}));Insert(acc,{type:"ref",ref:ids.IconButton,name:"Settings",descendants:{"Icon":{icon:"settings"}}})
nav=Insert(dr,F("Nav",{layout:"vertical",width:"fill_container",gap:2}))
for (const [ic,l,c] of [["inbox","受信トレイ","12"],["calendar-check","今日","5"],["calendar-days","近日",""],["layout-grid","フィルターとラベル",""]]) Insert(nav,{type:"ref",ref:ids.SidebarItem,name:"Nav-"+l,width:"fill_container",descendants:{"Icon":{icon:ic},"Label":{content:l},"Count":{content:c}}})
pj=Insert(dr,F("Projects",{layout:"vertical",width:"fill_container",gap:2}));Insert(pj,T("Heading","マイプロジェクト",12,"$text-secondary",{fontWeight:"700"}))
for (const [l,c,col] of [["仕事","8","$priority-3"],["買い物","4","$priority-2"],["家のこと","3","$success"],["読書","2","$priority-4"]]) Insert(pj,{type:"ref",ref:ids.ProjectItem,name:"Pj-"+l,width:"fill_container",descendants:{"Label":{content:l},"Count":{content:c},"Dot":{fill:col}}})
problems(m06);Update(m06,{placeholder:false})
p=next();m07=Copy(m01,document,{name:"M-07 設定",x:p.x,y:p.y,placeholder:true});anchor=m07
Get(m07,n=>n.name==="FAB"&&Delete(n.id))
rebuildBody(m07,"設定",b=>{const grp=(title,rows)=>{const g=Insert(b,F("G-"+title,{layout:"vertical",width:"fill_container",padding:[12,0,0,0]}));Insert(g,T("H",title,12,"$text-secondary",{fontWeight:"700"}));for (const [ic,k,v] of rows) {const r=Insert(g,F("R-"+k,{width:"fill_container",alignItems:"center",gap:"$space-2",padding:[12,0],stroke:"$border",strokeWidth:{bottom:1}}));Insert(r,I("Icon",ic,18,"$text-secondary"));Insert(r,T("K",k,14,"$text-primary",{textGrowth:"fixed-width",width:"fill_container"}));Insert(r,T("V",v,13,"$text-secondary"));Insert(r,I("Ch","chevron-right",16,"$text-muted"))}};grp("同期",[["cloud","Google Drive","接続済み"],["refresh-cw","最終同期","09:41"],["folder","Drive フォルダ","PowerToDo/"]]);grp("通知",[["bell","リマインダー","許可"],["clock","既定のリマインダー","期限と同時刻"]]);grp("外観",[["palette","テーマ","システム"],["calendar","週の開始","月曜"]]);grp("アカウント",[["user","表示名","ktakeuchi"]])})
problems(m07);Update(m07,{placeholder:false})
TakeScreenshot([m04,m05,m06,m07])
```

- [ ] **Step 4: コミット**

```bash
git add design/powertodo.pen
git commit -m "design: add mobile screens (project, quick add, detail, today, upcoming, drawer, settings)"
```

---

### Task 12: storyboard.md

**Files:**
- Create: `design/storyboard.md`

**Interfaces:**
- Consumes: Task 3〜11 の画面名 (pen ノード名)
- Produces: ユーザーが storyboard を触るときの手引き

- [ ] **Step 1: 画面名一覧を pen から取る**

```js
Get(n=>!n.reusable&&(n.name||"").match(/^(D|M)-/)&&Print(n.id,"|",n.name,"|",n.width,"x",n.height),{depth:0})
```

出力を次のステップの「画面一覧」表に写す (id 列は pen ノード id)。

- [ ] **Step 2: storyboard.md を書く**

```bash
cat > design/storyboard.md <<'EOF'
# PowerToDo storyboard メモ

pen.dev の `powertodo.pen` で画面ごとの操作性を確認するための手引き。
画面間リンクは pen の API では張れないため、必要なものだけ pen.dev 上で手で張る。

## 画面一覧

| No | 画面 (pen ノード名) | サイズ | 対応 Phase |
| --- | --- | --- | --- |
| D-01 | D-01 プロジェクト | 1440x900 | 1 |
| D-02 | D-02 クイック追加 | 1440x900 | 1 |
| D-03 | D-03 タスク詳細 | 1440x900 | 1〜5 |
| D-04 | D-04 今日 / D-04 今日 (期限切れなし) | 1440x900 | 2 |
| D-05 | D-05 近日 | 1440x900 | 2 |
| D-06 | D-06 フィルターとラベル / D-06b ラベル詳細 | 1440x900 | 2, 5 |
| D-07 | D-07 日付ピッカー / D-07b 繰り返し設定 | 1440x900 | 2, 3 |
| D-08 | D-08 リマインダー / D-08b OS 通知 | 1440x900 | 3 |
| D-09 | D-09 設定 / D-09b 競合バナー | 1440x900 | 4 |
| D-10 | D-10 ボード | 1440x900 | 5 |
| D-11 | D-11a 空のプロジェクト / D-11b 読み込みエラー / D-11c 要修正行 | 1440x900 | 1 |
| D-12 | D-12 初回起動 | 1440x900 | 1, 4 |
| D-13 | D-13 最小ウィンドウ 960x600 | 960x600 | 1 |
| ダーク | D-01 プロジェクト (ダーク) / D-03 タスク詳細 (ダーク) / D-04 今日 (ダーク) | 1440x900 | 5 |
| M-01 | M-01 プロジェクト | 390x844 | 6 |
| M-02 | M-02 クイック追加 | 390x844 | 6 |
| M-03 | M-03 タスク詳細 | 390x844 | 6 |
| M-04 | M-04 今日 | 390x844 | 6 |
| M-05 | M-05 近日 | 390x844 | 6 |
| M-06 | M-06 ドロワー | 390x844 | 6 |
| M-07 | M-07 設定 | 390x844 | 6 |

## 遷移表

| 起点 | 操作 | 遷移先 | 備考 |
| --- | --- | --- | --- |
| D-01 | サイドバー「タスクを追加」/ Q キー | D-02 | ダイアログ |
| D-01 | タスク行をクリック | D-03 | 右パネルが開く |
| D-01 | サイドバー「今日」 | D-04 | |
| D-01 | サイドバー「近日」 | D-05 | |
| D-01 | サイドバー「フィルターとラベル」 | D-06 | |
| D-01 | ヘッダ「表示」→ ボード | D-10 | |
| D-01 | アカウント → 設定 | D-09 | |
| D-02 | 追加 / Enter | D-01 | 行が追加される |
| D-02 | キャンセル / Esc | D-01 | |
| D-03 | 「期限」行 | D-07 | ポップオーバー |
| D-07 | 「繰り返し」行 | D-07b | |
| D-03 | 「リマインダー」行 | D-08 | |
| D-03 | 閉じる / Esc | D-01 | |
| D-04 | 「再スケジュール」 | D-07 | 期限切れ全件に適用 |
| D-06 | ラベル行 | D-06b | |
| D-09 | 競合発生時 | D-09b | バナー表示 |
| D-12 | 次へ ×3 | D-01 | 初回のみ |
| M-01 | ハンバーガー | M-06 | ドロワー |
| M-01 | FAB | M-02 | 下部シート |
| M-01 | タスク行タップ | M-03 | 全画面 |
| M-01 | 行を右スワイプ | (完了) | M-01 内 |
| M-01 | 行を左スワイプ | 日付シート (D-07 相当、未作成) | Phase 6 で追加 |
| M-01 | 下部タブ「今日」 | M-04 | |
| M-01 | 下部タブ「近日」 | M-05 | |
| M-06 | 設定アイコン | M-07 | |
| M-03 | 戻る | M-01 | |

## 画面ごとの操作項目と確認観点

### D-01 プロジェクト
- 操作: セクション折りたたみ、チェックで完了、行ホバーで 4 アイコン (編集 / 日付 / コメント / その他)、末尾「タスクを追加」、完了表示トグル
- 確認観点: 長文タイトル行 (60 文字) の折り返しで操作アイコンの位置が崩れないか。サイドバーの件数表示が邪魔でないか

### D-02 クイック追加
- 操作: 入力中に `明日` `p1` `#買い物` `@食品` がチップ化。ツールバーで補完。プロジェクト選択は左下
- 確認観点: チップ化が入力の邪魔にならないか。Enter で追加、Shift+Enter で説明に移る想定

### D-03 タスク詳細
- 操作: タイトル / 説明の直接編集、各プロパティ行をクリックでポップオーバー、サブタスクの追加と完了、コメント投稿
- 確認観点: パネル幅 400 で情報量が多すぎないか。プロパティの順序 (プロジェクト → 期限 → 優先度 → ラベル → リマインダー → 繰り返し)

### D-04 今日
- 操作: 期限切れグループの一括再スケジュール、各行の完了
- 確認観点: 期限切れなしのときの見出し省略が自然か

### D-05 近日
- 操作: 週ストリップで日付移動、月セレクタ、各日の追加
- 確認観点: 予定なしの日 (10/15) に「タスクを追加」だけ出る表示でよいか

### D-06 フィルターとラベル
- 操作: フィルター / ラベルの追加、件数表示、ラベル詳細へ
- 確認観点: Phase 5 のフィルターをここに同居させてよいか

### D-07 日付ピッカー / D-07b 繰り返し
- 操作: 自然言語入力、クイック選択、カレンダー、時刻、繰り返しプリセット、RRULE プレビュー
- 確認観点: RRULE 文字列の表示がノイズか (非表示にする選択肢あり)

### D-08 リマインダー / D-08b OS 通知
- 操作: 期限から / 日時指定の切替、候補の追加、追加済みの削除
- 確認観点: 通知の「完了」「後で」ボタンで足りるか

### D-09 設定 / D-09b 競合
- 操作: クライアント ID 貼り付け、接続、今すぐ同期、Drive フォルダ変更
- 確認観点: クライアント ID を自分で作る手順をここに書くか、別ページにするか。競合バナーの文言が分かるか

### D-10 ボード
- 操作: カードのドラッグ (storyboard では表現なし)、列追加
- 確認観点: カードの情報量 (タイトル + 期限 + 優先度) で足りるか

### D-11 状態
- 確認観点: エラー文言が次の行動 (再試行 / 場所を開く / Excel で開く) を示しているか

### D-12 初回起動
- 確認観点: 3 ステップで迷わないか。「あとで設定する」の位置

### D-13 最小ウィンドウ
- 確認観点: サイドバーをアイコンだけにしたとき、プロジェクト一覧へどう行くか (アイコン「一覧」で展開)

### モバイル M-01〜M-07
- 確認観点: 下部タブ 4 つ (今日 / 近日 / 検索 / 一覧) で足りるか。FAB の位置がタブと干渉しないか。スワイプの左右割り当て (右 = 完了、左 = 日付)。クイック追加シートがキーボード上に収まるか
EOF
```

- [ ] **Step 3: コミット**

```bash
git add design/storyboard.md
git commit -m "docs: add storyboard notes with screen list, transitions, and review points"
```

---

### Task 13: 最終確認と PR

**Files:**
- Modify: `design/powertodo.pen` (必要な修正のみ)
- Modify: `docs/superpowers/specs/2026-10-13-powertodo-overall-design.md` (決定ログに追記)

- [ ] **Step 1: placeholder とクリップ問題を全画面で確認する**

```js
Get(n=>n.placeholder&&Print("PLACEHOLDER",n.id,n.name),{depth:0})
problems=(id)=>Get(id,(n,c)=>c.problems&&Print(n.name,"|",c.parentCtx?.node.name,"|",c.problems))
Get(n=>!n.reusable&&(n.name||"").match(/^(D|M)-/)?n.id:undefined,{depth:0}).forEach(id=>problems(id))
Print("done")
```

Expected: `PLACEHOLDER` 行なし、problems の Print なし。あれば該当ノードを `Update` で直す (作り直さない)。

- [ ] **Step 2: 全画面のスクリーンショットで視覚確認する**

```js
ids=Get(n=>!n.reusable&&(n.name||"").match(/^(D|M)-/)?n.id:undefined,{depth:0})
TakeScreenshot(ids.slice(0,8))
```

残りも 8 枚ずつ `TakeScreenshot(ids.slice(8,16))`、`TakeScreenshot(ids.slice(16))` で確認する。確認項目: 文字がはみ出していない、色のコントラストが足りる (ダーク 3 枚を特に見る)、画面ごとの余白が揃っている。

- [ ] **Step 3: 決定ログに追記してコミットし、PR を作る**

全体設計 spec の決定ログ (§10 の表) に 1 行追加する:

```
| 2026-10-13 | Phase 0 のフォントは Noto Sans JP に統一 (Inter との併用は見送り) | component が倍になるのを避ける。実装時に Latin だけ Inter にするかは Phase 1 で決める |
```

```bash
git add docs/superpowers/specs/2026-10-13-powertodo-overall-design.md design/powertodo.pen
git commit -m "design: final pass on all screens; note font decision in design log"
git push origin feature/phase0-pen-design
```

PR は `gh pr create --base main --head feature/phase0-pen-design` で作る。タイトルは `design: Phase 0 pen デザイン全画面と storyboard メモ`。本文には画面一覧 (storyboard.md へのリンク) と「pen.dev で `design/powertodo.pen` を開いて確認」の手順を書く。末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)` を付ける。`Co-Authored-By` は付けない。

- [ ] **Step 4: ユーザーの操作性確認を待つ**

ユーザーが pen.dev の storyboard で確認し、修正点を返す。修正は既存ノードの `Update` で行う。PR を announce 済みなら新ブランチ `feature/phase0-pen-fixes` に積む (announce 済み PR には push しない)。修正が確定したら全体設計 spec の決定ログに追記し、Phase 0 完了。
