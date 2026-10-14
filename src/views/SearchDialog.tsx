import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionTiming } from "../motion";
import { isImeKey } from "../app/keys";
import { useEscLayer } from "../app/layers";
import { Segmented } from "../components/Segmented";
import { TaskRow } from "../components/TaskRow";
import { dateLabel } from "../mock/data";
import type { SearchHit } from "../types/model";

export type SearchDialogProps = {
  open: boolean;
  query: string;
  onChangeQuery(q: string): void;
  includeDone: boolean;
  onToggleIncludeDone(): void;
  hits: SearchHit[];
  /** Index of the keyboard-selected hit. */
  selected: number;
  onSelect(i: number): void;
  /** Enter or a click on a row: go to the task. */
  onOpen(hit: SearchHit): void;
  onToggleDone(hit: SearchHit, done: boolean): void;
  onClose(): void;
  today: string;
  busy?: boolean;
};

const modeOptions = [
  { value: "open", label: "未完了" },
  { value: "all", label: "完了を含む" },
];

/**
 * 検索ダイアログ。AppShell の overlay スロットに入れる (QuickAddDialog と同じ scrim + カードの開閉)。
 * 入力欄にフォーカスしたまま ↑↓ で選択、Enter (IME 変換中は除く) で開く、Esc / scrim クリックで閉じる。
 * 結果の取得とデバウンスは親 (useSearch) の仕事で、ここは props だけで描画する。
 */
export function SearchDialog({
  open,
  query,
  onChangeQuery,
  includeDone,
  onToggleIncludeDone,
  hits,
  selected,
  onSelect,
  onOpen,
  onToggleDone,
  onClose,
  today,
  busy,
}: SearchDialogProps) {
  const { reduced, t } = useMotionTiming();
  useEscLayer(open, onClose);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [open, selected, hits]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isImeKey(e)) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hits.length) onSelect(Math.min(selected + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) onSelect(Math.max(selected - 1, 0));
    } else if (e.key === "Enter") {
      const hit = hits[selected];
      if (hit) {
        e.preventDefault();
        onOpen(hit);
      }
    }
  };

  const empty = !query.trim() ? "名前・備考・ラベルを検索します" : busy ? "" : "見つかりません";

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="search"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t(0.15)}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          style={{
            boxSizing: "border-box",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: 160,
            background: "var(--color-scrim)",
            pointerEvents: "auto",
            fontFamily: "var(--font-body)",
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="検索"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            transition={t(0.18)}
            style={{
              boxSizing: "border-box",
              width: 640,
              maxWidth: "calc(100% - 32px)",
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              padding: "var(--space-4)",
              background: "var(--color-bg)",
              borderRadius: 12,
              boxShadow: "var(--shadow-dialog)",
              color: "var(--color-text-primary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <Search size={18} color="var(--color-text-muted)" aria-hidden style={{ flex: "0 0 auto" }} />
              <input
                autoFocus
                aria-label="検索キーワード"
                value={query}
                placeholder="タスクを検索"
                onChange={(e) => onChangeQuery(e.target.value)}
                onKeyDown={onKeyDown}
                className="placeholder:text-[var(--color-text-muted)]"
                style={{
                  boxSizing: "border-box",
                  flex: 1,
                  minWidth: 0,
                  padding: 0,
                  border: 0,
                  outline: "none",
                  background: "transparent",
                  fontFamily: "var(--font-body)",
                  fontSize: 16,
                  lineHeight: "23px",
                  color: "var(--color-text-primary)",
                }}
              />
              {/* mousedown を止めて、トグルを押しても入力欄のフォーカスを外さない (↑↓ / Enter を効かせ続ける) */}
              <div style={{ flex: "0 0 auto", width: 200 }} onMouseDown={(e) => e.preventDefault()}>
                <Segmented
                  options={modeOptions}
                  value={includeDone ? "all" : "open"}
                  onChange={(v) => {
                    if ((v === "all") !== includeDone) onToggleIncludeDone();
                  }}
                />
              </div>
            </div>
            <div style={{ height: 1, background: "var(--color-border)", flex: "0 0 auto" }} />
            {hits.length === 0 ? (
              <div
                style={{
                  padding: "var(--space-6) 0",
                  textAlign: "center",
                  fontSize: 14,
                  lineHeight: "20px",
                  color: "var(--color-text-muted)",
                }}
              >
                {empty}
              </div>
            ) : (
              <div
                ref={listRef}
                role="listbox"
                aria-label="検索結果"
                // チェックボックスや行を押しても入力欄のフォーカスを外さない (スクロールバー自体の操作は除く)
                onMouseDown={(e) => {
                  if (e.target !== e.currentTarget) e.preventDefault();
                }}
                style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
              >
                {hits.map((h, i) => (
                  <div
                    key={`${h.task.project}/${h.task.no}`}
                    role="option"
                    aria-selected={i === selected}
                    style={{ paddingLeft: "var(--space-2)", paddingRight: "var(--space-2)" }}
                  >
                    <TaskRow
                      focused={i === selected}
                      title={h.task.title}
                      description={h.matched === "note" ? h.task.note : undefined}
                      done={h.task.progress === 100}
                      priority={h.task.priority}
                      project={h.task.project}
                      date={dateLabel(h.task.due, today)}
                      labels={h.task.labels}
                      onClick={() => onOpen(h)}
                      onToggleDone={() => onToggleDone(h, h.task.progress !== 100)}
                    />
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
