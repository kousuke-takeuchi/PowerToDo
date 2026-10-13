import { Ellipsis, Plus } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { AddTaskRow } from "../components/AddTaskRow";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { DateChip } from "../components/DateChip";
import { PriorityChip } from "../components/PriorityChip";
import { dateLabel } from "../mock/data";
import type { Section, Task } from "../types/model";
import { PageHeader, titleStyle } from "./HeaderActions";

export type BoardViewProps = {
  project: string;
  tasks: Task[];
  sections: Section[];
  /** ドラッグ中のカードの task no。そのカードに影と回転、いつか列の先頭にドロップ線を出す (D-10)。 */
  dragging?: number;
};

const DROP_COLUMN = "いつか"; // ドロップ線を出す列 (pen の D-10)
const DONE_COLUMN = "完了";
const LIFT_OFFSET = 9; // 幅 270 のカードを 2° 回転したときの外接枠の増分 (270 x sin 2° ≒ 9.4)

/** プロジェクトのタスクをセクション列 + 完了列に並べるボード (D-10)。AppShell の fullWidth 内に置く。 */
export function BoardView({ project, tasks, sections, dragging }: BoardViewProps) {
  const [doneOverride, setDoneOverride] = useState<Map<number, boolean>>(() => new Map());
  const mine = tasks.filter((t) => t.project === project && t.parentNo === undefined).sort((a, b) => a.order - b.order);
  const isDone = (t: Task) => doneOverride.get(t.no) ?? t.progress === 100;
  const open = mine.filter((t) => t.progress !== 100);
  const columns = [
    ...sections
      .filter((s) => s.project === project)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ name: s.name, tasks: open.filter((t) => t.category === s.name) })),
    { name: DONE_COLUMN, tasks: mine.filter((t) => t.progress === 100) },
  ];

  const card = (t: Task): React.ReactNode => {
    const date = dateLabel(t.due);
    const lifted = t.no === dragging;
    const body = (
      <div
        style={{
          boxSizing: "border-box",
          width: lifted ? 270 : "100%",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          padding: "var(--space-3)",
          background: "var(--color-bg)",
          boxShadow: `${lifted ? "var(--shadow-drag)" : "var(--shadow-card)"}, inset 0 0 0 1px var(--color-border)`,
          borderRadius: "var(--radius)",
          transform: lifted ? "rotate(-2deg)" : undefined, // pen の rotation=2 は反時計回り
          transformOrigin: "top left",
        }}
      >
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Checkbox
            checked={isDone(t)}
            ariaLabel={`${t.title}を完了にする`}
            onChange={(c) => setDoneOverride((m) => new Map(m).set(t.no, c))}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              lineHeight: "19px",
              color: isDone(t) ? "var(--color-text-muted)" : "var(--color-text-primary)",
            }}
          >
            {t.title}
          </span>
        </div>
        {date && (
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <DateChip label={date.label} tone={date.tone} />
            <PriorityChip priority={t.priority} />
          </div>
        )}
      </div>
    );
    // pen は回転後の外接枠 (高さ +約 9) で列を並べるので、持ち上げたカードは上に 9px の余白を取って同じ位置に合わせる。
    return lifted ? (
      <div key={t.no} style={{ paddingTop: LIFT_OFFSET }}>
        {body}
      </div>
    ) : (
      <div key={t.no}>{body}</div>
    );
  };

  return (
    <>
      <PageHeader viewLabel="ボード">
        <h1 style={titleStyle}>{project}</h1>
      </PageHeader>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)", fontFamily: "var(--font-body)" }}>
        {columns.map((col) => (
          <section key={col.name} aria-label={col.name} style={{ flex: "0 0 280px", width: 280, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={{ boxSizing: "border-box", display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-1)" }}>
              <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>{col.name}</span>
              <span style={{ flex: 1, fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{col.tasks.length}</span>
              <Button variant="icon" icon={Ellipsis} ariaLabel={`${col.name}のメニュー`} />
            </div>
            {dragging !== undefined && col.name === DROP_COLUMN && (
              <div aria-hidden style={{ height: 3, borderRadius: 2, background: "var(--color-accent)" }} />
            )}
            {col.tasks.map(card)}
            <AddTaskRow />
          </section>
        ))}
        <button
          type="button"
          className="bg-transparent hover:bg-[var(--color-bg-hover)]"
          style={{
            flex: "0 0 200px",
            width: 200,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "8px 12px",
            border: 0,
            boxShadow: "inset 0 0 0 1px var(--color-border)",
            borderRadius: "var(--radius)",
            fontFamily: "var(--font-body)",
            fontSize: 13,
            lineHeight: "19px",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          <Plus size={16} />
          セクションを追加
        </button>
      </div>
    </>
  );
}
