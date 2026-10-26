import type React from "react";
import { Search } from "lucide-react";
import { Segmented } from "../../components/Segmented";
import { TaskRow } from "../../components/TaskRow";
import type { TabBarProps } from "../../components/TabBar";
import { TODAY, dateLabel } from "../../mock/data";
import type { SearchHit } from "../../types/model";
import { MobileShell } from "./MobileShell";

export type MobileSearchProps = {
  query: string;
  onChangeQuery: (q: string) => void;
  includeDone: boolean;
  onToggleIncludeDone: () => void;
  hits: SearchHit[];
  busy?: boolean;
  today?: string;
  /** 実機用: 幅 100% / 高さ 100dvh、上下はセーフエリア。 */
  fill?: boolean;
  onOpenHit?: (hit: SearchHit) => void;
  onToggleDone?: (hit: SearchHit, done: boolean) => void;
  onFab?: () => void;
  onMenu?: () => void;
  onTabChange?: TabBarProps["onChange"];
  overlay?: React.ReactNode;
  /** header の下に流す帯 (MobileShell の banner)。 */
  banner?: React.ReactNode;
};

const modeOptions = [
  { value: "open", label: "未完了" },
  { value: "all", label: "完了を含む" },
];

/** 検索タブ (仕様 §4.2): 入力欄 (iOS が拡大しないよう 16px) + 未完了 / 完了を含む + 結果。入力と取得の状態は呼び出し側 (useSearch)。 */
export function MobileSearch({
  query,
  onChangeQuery,
  includeDone,
  onToggleIncludeDone,
  hits,
  busy,
  today = TODAY,
  fill,
  onOpenHit,
  onToggleDone,
  onFab,
  onMenu,
  onTabChange,
  overlay,
  banner,
}: MobileSearchProps) {
  return (
    <MobileShell
      banner={banner}
      fill={fill}
      title="検索"
      onMenu={onMenu}
      tab="search"
      onTabChange={onTabChange}
      fab
      onFab={onFab}
      overlay={overlay}
    >
      <div style={{ padding: "0 16px" }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "0 12px",
            height: 40,
            boxSizing: "border-box",
            borderRadius: 8,
            background: "var(--color-bg-hover)",
            color: "var(--color-text-secondary)",
          }}
        >
          <Search size={18} />
          <input
            type="search"
            value={query}
            onChange={(e) => onChangeQuery(e.target.value)}
            placeholder="タスクを検索"
            aria-label="検索"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              fontFamily: "var(--font-body)",
              fontSize: 16, // 16px 未満だと iOS が入力時に拡大する
              color: "var(--color-text-primary)",
            }}
          />
        </label>
        <div style={{ padding: "var(--space-2) 0" }}>
          <Segmented
            ariaLabel="対象"
            options={modeOptions}
            value={includeDone ? "all" : "open"}
            onChange={(v) => (v === "all") !== includeDone && onToggleIncludeDone()}
          />
        </div>
        {hits.map((h) => (
          <TaskRow
            key={`${h.task.project}/${h.task.no}`}
            variant="mobile"
            title={h.task.title}
            done={h.task.progress === 100}
            priority={h.task.priority}
            date={dateLabel(h.task.due, today)}
            project={h.task.project}
            onToggleDone={() => onToggleDone?.(h, h.task.progress !== 100)}
            onClick={onOpenHit ? () => onOpenHit(h) : undefined}
          />
        ))}
        {query.trim() !== "" && hits.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>
            {busy ? "検索中…" : "見つかりませんでした"}
          </div>
        )}
      </div>
    </MobileShell>
  );
}
