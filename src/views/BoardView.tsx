import type React from "react";
import type { Task } from "../types/model";

/** One board column (spec ⑤ §4): 未分類, a section, or 完了. `live`: it takes drops and its cards can be dragged. */
export type BoardColumn = {
  key: string;
  title: string;
  /** The section a card dropped here joins. Null: unsectioned. */
  section: string | null;
  tasks: Task[];
  /** Cards that are not done (the number in the header). */
  count: number;
  live: boolean;
};

export type BoardViewProps = {
  columns: BoardColumn[];
  /** Sorted by a rule: the cards take no between-drops, so a drop lands at the end of the column (spec ⑤ §5). */
  sorted: boolean;
  /** One card (an ActionRow with the list's row props). */
  renderCard: (t: Task, column: BoardColumn) => React.ReactNode;
  /** The "add task" slot at the end of a live column. */
  renderAdd: (section: string | null) => React.ReactNode;
  /** After the last column, e.g. 「セクションを追加」. */
  trailing?: React.ReactNode;
};

export const COLUMN_WIDTH = 272;
const CARD_GAP = 8;

const cardStyle: React.CSSProperties = {
  boxSizing: "border-box",
  padding: "0 12px 0 24px",
  background: "var(--color-bg)",
  boxShadow: "var(--shadow-card), inset 0 0 0 1px var(--color-border)",
  borderRadius: "var(--radius)",
};

/**
 * The columns of a project board. Each live column is its own drop list for the drag engine (`data-drop-list`), so
 * the pointer picks the column; the cards and the add row carry the same `data-*` as the list rows (spec ③ §8).
 * AppShell's `fullWidth` holds it; it scrolls sideways when the columns are wider than the screen.
 */
export function BoardView({ columns, sorted, renderCard, renderAdd, trailing }: BoardViewProps) {
  const card = (t: Task, col: BoardColumn) => {
    const body = <div style={cardStyle}>{renderCard(t, col)}</div>;
    // No drop row of its own (a sorted column's cards share one), but the drag ghost is measured from it.
    if (!col.live || sorted) return <div key={t.no} data-drag-box="" style={{ paddingBottom: CARD_GAP }}>{body}</div>;
    return (
      <div
        key={t.no}
        data-row=""
        data-row-kind="task"
        data-key={`${t.project}/${t.no}`}
        data-no={t.no}
        data-depth={0}
        data-parent=""
        data-section={col.section ?? ""}
        style={{ paddingBottom: CARD_GAP }}
      >
        {body}
      </div>
    );
  };

  return (
    <div
      style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)", overflowX: "auto", paddingBottom: "var(--space-2)", fontFamily: "var(--font-body)" }}
    >
      {columns.map((col) => {
        const cards = col.tasks.map((t) => card(t, col));
        return (
          <section key={col.key} aria-label={col.title} style={{ flex: `0 0 ${COLUMN_WIDTH}px`, width: COLUMN_WIDTH, display: "flex", flexDirection: "column" }}>
            <div style={{ boxSizing: "border-box", display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-1)", marginBottom: "var(--space-2)" }}>
              <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>{col.title}</span>
              <span style={{ flex: 1, fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{col.count}</span>
            </div>
            {col.live ? (
              <div data-drop-list="project" data-level0="0" {...(sorted ? { "data-sorted": "" } : {})}>
                {sorted ? (
                  // One header-kind row for all the cards: a drop on them goes after the last card (section "" = unsectioned).
                  <div data-row="" data-row-kind="header" data-section={col.section ?? ""}>
                    {cards}
                  </div>
                ) : (
                  cards
                )}
                <div data-row="" data-row-kind="slot" data-section={col.section ?? ""}>
                  {renderAdd(col.section)}
                </div>
              </div>
            ) : (
              cards
            )}
          </section>
        );
      })}
      {trailing && <div style={{ flex: "0 0 200px", width: 200 }}>{trailing}</div>}
    </div>
  );
}
