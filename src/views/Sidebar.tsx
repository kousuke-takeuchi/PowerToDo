import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { Bell, CalendarCheck, CalendarDays, Inbox, LayoutGrid, PanelLeftClose, Plus, Search } from "lucide-react";
import { DragCtx } from "../app/drag/DragContext";
import { isImeKey } from "../app/keys";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { ProjectItem } from "../components/ProjectItem";
import { SidebarItem } from "../components/SidebarItem";
import { SyncStatus } from "../components/SyncStatus";
import { TextField } from "../components/TextField";
import type { SyncState } from "../components/SyncStatus";
import type { counts } from "../mock/data";
import type { Project } from "../types/model";

export type SidebarProps = {
  active: { kind: "inbox" | "today" | "upcoming" | "labels" | "project" | "label"; name?: string };
  counts: typeof counts;
  projects: Project[];
  syncState: SyncState;
  lastSyncedAt?: string;
  /** 同期状態の補足 (エラーの理由など。ツールチップに出す)。 */
  syncDetail?: string;
  /** 同期オフのときの文言 (既定は絵コンテの「同期オフ · 未ログイン」)。 */
  syncOffText?: string;
  /** 同期エラーの文言 (既定は絵コンテの「同期エラー · クリックで再試行」)。 */
  syncErrorText?: string;
  /** アプリの更新の準備で同期を止めているときの文言 (クリックできない)。 */
  syncPausedText?: string;
  /** 同期状態をクリックしたとき (エラーのときの「今すぐ同期」)。 */
  onSyncClick?: () => void;
  onNavigate?: (target: SidebarProps["active"]) => void;
  onAddTask?: () => void;
  /** 「検索」をクリックしたとき。 */
  onSearch?: () => void;
  /** アカウント (アバター + 名前) をクリックしたとき。設定ダイアログを開き直す Story が渡す。 */
  onOpenSettings?: () => void;
  /** 渡すとマイプロジェクトの「+」が名前入力欄を開き、Enter でこれを呼ぶ (Esc で閉じる)。 */
  onCreateProject?: (name: string) => void;
  /** 「サイドバーを閉じる」を押したとき。 */
  onClose?: () => void;
  /** アカウント欄の表示名。既定は絵コンテのサンプル名。 */
  displayName?: string;
};

const heading: React.CSSProperties = {
  fontSize: 12,
  lineHeight: "17px",
  fontWeight: 700,
  color: "var(--color-text-secondary)",
};

export function Sidebar({
  active,
  counts: c,
  projects,
  syncState,
  lastSyncedAt,
  syncDetail,
  syncOffText,
  syncErrorText,
  syncPausedText,
  onSyncClick,
  onNavigate,
  onAddTask,
  onSearch,
  onOpenSettings,
  onCreateProject,
  onClose,
  displayName = "たろう",
}: SidebarProps) {
  // 選択行のハイライトだけ内部で持つ (画面遷移は Story を切り替える)。active が変わったらそれに合わせる。
  const [current, setCurrent] = useState(active);
  useEffect(() => setCurrent(active), [active.kind, active.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (target: SidebarProps["active"]) => {
    setCurrent(target);
    onNavigate?.(target);
  };
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (creating) newNameRef.current?.querySelector("input")?.focus();
  }, [creating]);
  const closeCreate = () => {
    setCreating(false);
    setNewName("");
  };
  useEscLayer(creating && onCreateProject !== undefined, closeCreate);
  const countOf = (name: string) => (c as Record<string, number>)[name];
  const isActive = (kind: SidebarProps["active"]["kind"]) => current.kind === kind || (kind === "labels" && current.kind === "label");
  const drag = useContext(DragCtx);
  const inboxName = projects.find((p) => p.inbox)?.name;
  const mine = projects.filter((p) => !p.inbox);
  const favorites = projects.filter((p) => p.favorite);
  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "12px 16px",
        background: "var(--color-bg-sidebar)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", height: 32 }}>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="アカウントと設定"
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: 0,
            border: 0,
            background: "none",
            fontFamily: "var(--font-body)",
            textAlign: "left",
            cursor: onOpenSettings ? "pointer" : "default",
          }}
        >
          <span aria-hidden style={{ width: 28, height: 28, borderRadius: 14, background: "var(--color-accent)", flex: "0 0 auto" }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {displayName}
          </span>
        </button>
        <Button variant="icon" icon={Bell} ariaLabel="通知" />
        <Button variant="icon" icon={PanelLeftClose} ariaLabel="サイドバーを閉じる" onClick={onClose} />
      </div>

      <button
        type="button"
        onClick={onAddTask}
        className="bg-transparent hover:bg-[var(--color-bg-hover)]"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "6px 10px",
          borderRadius: 6,
          border: 0,
          fontFamily: "var(--font-body)",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {/* Todoist: a filled red circle with a white plus. */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 11,
            background: "var(--color-accent)",
            color: "#FFFFFF" /* アクセント上の白 (他と同じ固定値) */,
            flex: "0 0 auto",
          }}
        >
          <Plus size={16} strokeWidth={2.5} />
        </span>
        <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 600, color: "var(--color-accent)" }}>タスクを追加</span>
      </button>

      <nav aria-label="ナビゲーション" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <SidebarItem icon={Search} label="検索" onClick={onSearch} />
        <div data-drop-project={inboxName}>
          <SidebarItem
            icon={Inbox}
            label="受信トレイ"
            count={c.inbox}
            active={isActive("inbox")}
            onClick={() => go({ kind: "inbox" })}
          />
        </div>
        <SidebarItem
          icon={CalendarCheck}
          label="今日"
          count={c.today}
          active={isActive("today")}
          onClick={() => go({ kind: "today" })}
        />
        <SidebarItem icon={CalendarDays} label="近日" active={isActive("upcoming")} onClick={() => go({ kind: "upcoming" })} />
        <SidebarItem
          icon={LayoutGrid}
          label="フィルターとラベル"
          active={isActive("labels")}
          onClick={() => go({ kind: "labels" })}
        />
      </nav>

      {favorites.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={heading}>お気に入り</div>
          {favorites.map((p) => (
            <div key={p.name} data-drop-project={p.name}>
              <ProjectItem color={p.color} label={p.name} count={countOf(p.name)} onClick={() => go({ kind: "project", name: p.name })} />
            </div>
          ))}
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 32 }}>
          <span style={heading}>マイプロジェクト</span>
          <Button variant="icon" icon={Plus} ariaLabel="プロジェクトを追加" onClick={onCreateProject ? () => setCreating(true) : undefined} />
        </div>
        {creating && onCreateProject && (
          <div
            ref={newNameRef}
            onKeyDown={(e) => {
              // IME 変換を確定する Enter は作成にしない (keys.ts)。Esc は Esc レイヤーで閉じる。
              if (isImeKey(e)) return;
              if (e.key === "Enter" && newName.trim()) {
                onCreateProject(newName.trim());
                closeCreate();
              }
            }}
            onBlur={() => {
              if (!newName.trim()) closeCreate();
            }}
          >
            <TextField value={newName} placeholder="プロジェクト名" onChange={setNewName} />
          </div>
        )}
        <div data-project-list="" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {mine.map((p) => (
            <div key={p.name} data-project-item={p.name} data-drop-project={p.name}>
              <ProjectItem
                color={p.color}
                label={p.name}
                count={countOf(p.name)}
                active={current.kind === "project" && current.name === p.name}
                onClick={() => go({ kind: "project", name: p.name })}
                onHandlePointerDown={
                  drag ? (e) => drag.start(e, { kind: "project", name: p.name }, <ProjectItem color={p.color} label={p.name} />) : undefined
                }
                dragging={drag?.active?.kind === "project" && drag.active.name === p.name}
              />
            </div>
          ))}
        </div>
      </section>

      <div style={{ flex: 1 }} />
      <SyncStatus state={syncState} lastSyncedAt={lastSyncedAt} detail={syncDetail} offText={syncOffText} errorText={syncErrorText} pausedText={syncPausedText} onClick={onSyncClick} />
    </div>
  );
}
