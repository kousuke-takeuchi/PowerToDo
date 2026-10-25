import type React from "react";
import { useRef, useState } from "react";
import { ArrowUp, Bell, Calendar, Check, Flag, Folder, Inbox, Plus, Repeat, Tag, Text, X } from "lucide-react";
import { useEscLayer } from "../app/layers";
import { confirmDiscard } from "../api/dialogs";
import { dateLabel } from "../mock/data";
import { DatePicker } from "./DatePicker";
import { LabelPicker } from "./LabelPicker";
import { PopRow, PopoverShell } from "./PopoverShell";
import { ProjectPicker, type PickerProject } from "./ProjectPicker";
import { RecurrencePicker, recurrenceLabel } from "./RecurrencePicker";
import { ReminderPicker, reminderSummary } from "./ReminderPicker";
import { changed, submitKey, type EditorValue } from "./taskEditorValue";

export type TaskEditorProps = {
  mode: "add" | "edit";
  initial: EditorValue;
  /** Shows the project chip. Left out for subtasks (they stay with the parent). */
  projects?: PickerProject[];
  /** The inbox's name (its chip gets the inbox icon). */
  inbox?: string;
  allLabels: string[];
  today: string;
  /** Resolves true when saved. Add: the editor clears (keeping project and section) and stays open. */
  onSubmit: (v: EditorValue) => Promise<boolean>;
  onCancel: () => void;
  /** Stories: open with this popover. */
  initialPopover?: "plus" | "date" | "priority" | "project";
};

type Pop = "plus" | "date" | "priority" | "project" | "labels" | "reminders" | "repeat";

const PRIORITY_COLOR: Record<1 | 2 | 3 | 4, string> = {
  1: "var(--color-priority-1)",
  2: "var(--color-priority-2)",
  3: "var(--color-priority-3)",
  4: "var(--color-text-secondary)",
};

const TONE = { success: "var(--color-success)", danger: "var(--color-danger)", muted: "var(--color-text-secondary)" } as const;

const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 26,
  padding: "0 8px",
  boxSizing: "border-box",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: 0,
  outline: "none",
  background: "none",
  padding: 0,
  fontFamily: "var(--font-body)",
  color: "var(--color-text-primary)",
  resize: "none",
};

/** Spec ② §3: the inline editor of a row, and of every "add task" slot (Todoist's task editor). */
export function TaskEditor({ mode, initial, projects, inbox, allLabels, today, onSubmit, onCancel, initialPopover }: TaskEditorProps) {
  const [v, setV] = useState<EditorValue>(initial);
  const [showNote, setShowNote] = useState(initial.note !== "");
  const [pop, setPop] = useState<Pop | null>(initialPopover ?? null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<EditorValue>) => setV((cur) => ({ ...cur, ...patch }));
  const canSubmit = v.title.trim() !== "" && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const ok = await onSubmit(v).finally(() => setBusy(false));
    if (ok && mode === "add") {
      setV({ ...initial, project: v.project, section: v.section });
      setShowNote(initial.note !== "");
      titleRef.current?.focus();
    }
  };
  const cancel = async () => {
    if (changed(initial, v) && !(await confirmDiscard("保存されていない変更を破棄しますか?", "破棄").catch(() => false))) return;
    onCancel();
  };
  // Esc closes the open popover first, then the editor.
  useEscLayer(pop === null, () => void cancel());
  useEscLayer(pop !== null, () => setPop(null));

  const due = v.due ? dateLabel(v.due, today) : undefined;
  const toggle = (p: Pop) => setPop((cur) => (cur === p ? null : p));
  const popover = (() => {
    switch (pop) {
      case "plus":
        return (
          <PopoverShell label="その他の項目" gap="0">
            <PopRow
              icon={<Text size={16} />}
              onClick={() => {
                setShowNote(true);
                setPop(null);
              }}
            >
              説明
            </PopRow>
            <PopRow icon={<Tag size={16} />} onClick={() => setPop("labels")}>
              ラベル
            </PopRow>
            <PopRow icon={<Bell size={16} />} onClick={() => setPop("reminders")}>
              リマインダー
            </PopRow>
            <PopRow icon={<Repeat size={16} />} onClick={() => setPop("repeat")}>
              繰り返し
            </PopRow>
          </PopoverShell>
        );
      case "date":
        return (
          <DatePicker
            value={v.due}
            time={v.dueTime}
            today={today}
            recurrenceLabel={recurrenceLabel(v.rrule)}
            onOpenRecurrence={() => setPop("repeat")}
            onChange={({ date, time }) => {
              set({ due: date, dueTime: date ? time : undefined });
              setPop(null);
            }}
          />
        );
      case "priority":
        return (
          <PopoverShell label="優先度" gap="0">
            {([1, 2, 3, 4] as const).map((p) => (
              <PopRow
                key={p}
                icon={<Flag size={16} />}
                iconColor={PRIORITY_COLOR[p]}
                selected={v.priority === p}
                onClick={() => {
                  set({ priority: p });
                  setPop(null);
                }}
              >
                {`優先度 ${p}`}
              </PopRow>
            ))}
          </PopoverShell>
        );
      case "project":
        return projects ? (
          <ProjectPicker
            projects={projects}
            current={{ project: v.project, section: v.section }}
            onPick={(project, section) => {
              set({ project, section });
              setPop(null);
            }}
          />
        ) : null;
      case "labels":
        return (
          <LabelPicker
            labels={allLabels}
            selected={v.labels}
            onToggle={(name) => set({ labels: v.labels.includes(name) ? v.labels.filter((l) => l !== name) : [...v.labels, name] })}
          />
        );
      case "reminders":
        return <ReminderPicker reminders={v.reminders} dueTime={v.dueTime} onChange={(reminders) => set({ reminders })} />;
      case "repeat":
        return (
          <RecurrencePicker
            value={v.rrule}
            onChange={(rrule) => {
              set({ rrule });
              setPop(null);
            }}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div
      role="group"
      aria-label={mode === "add" ? "タスクを追加" : "タスクを編集"}
      style={{
        position: "relative",
        border: "1px solid var(--color-text-muted)",
        borderRadius: 10,
        padding: "8px 10px",
        margin: "4px 0",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "var(--color-bg)",
      }}
    >
      <input
        ref={titleRef}
        autoFocus
        aria-label="タスク名"
        placeholder="タスク名"
        value={v.title}
        onFocus={(e) => {
          const n = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(n, n);
        }}
        onChange={(e) => set({ title: e.target.value })}
        onKeyDown={(e) => {
          if (submitKey(e.nativeEvent, "title")) {
            e.preventDefault();
            void submit();
          }
        }}
        style={{ ...field, fontSize: 14, lineHeight: "20px", fontWeight: 500 }}
      />
      {showNote && (
        <textarea
          aria-label="説明"
          placeholder="説明"
          rows={Math.min(6, Math.max(1, v.note.split("\n").length))}
          value={v.note}
          onChange={(e) => set({ note: e.target.value })}
          onKeyDown={(e) => {
            if (submitKey(e.nativeEvent, "note")) {
              e.preventDefault();
              void submit();
            }
          }}
          style={{ ...field, fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button type="button" aria-label="その他の項目" style={{ ...chip, padding: "0 5px" }} onClick={() => toggle("plus")}>
          <Plus size={14} />
        </button>
        <button type="button" style={{ ...chip, color: due ? TONE[due.tone] : chip.color }} onClick={() => toggle("date")}>
          <Calendar size={14} />
          {due ? `${due.label}${v.dueTime ? ` ${v.dueTime}` : ""}` : "日付"}
        </button>
        <button type="button" style={{ ...chip, color: v.priority < 4 ? PRIORITY_COLOR[v.priority] : chip.color }} onClick={() => toggle("priority")}>
          <Flag size={14} />
          {v.priority < 4 ? `P${v.priority}` : "優先度"}
        </button>
        {v.labels.map((l) => (
          <button key={l} type="button" style={chip} onClick={() => setPop("labels")}>
            <Tag size={14} />
            {l}
          </button>
        ))}
        {v.reminders.length > 0 && (
          <button type="button" style={chip} onClick={() => setPop("reminders")}>
            <Bell size={14} />
            {reminderSummary(v.reminders)}
          </button>
        )}
        {v.rrule && (
          <button type="button" style={chip} onClick={() => setPop("repeat")}>
            <Repeat size={14} />
            {recurrenceLabel(v.rrule)}
          </button>
        )}
        {projects && (
          <button type="button" style={chip} onClick={() => toggle("project")}>
            {v.project === inbox ? <Inbox size={14} /> : <Folder size={14} />}
            {v.section ? `${v.project} / ${v.section}` : v.project}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="キャンセル"
          onClick={() => void cancel()}
          style={{ ...chip, border: 0, padding: "0 4px", color: "var(--color-text-secondary)" }}
        >
          <X size={18} />
        </button>
        <button
          type="button"
          aria-label={mode === "add" ? "タスクを追加" : "保存"}
          disabled={!canSubmit}
          onClick={() => void submit()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            border: 0,
            borderRadius: 6,
            background: "var(--color-accent)",
            color: "#fff",
            opacity: canSubmit ? 1 : 0.5,
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          {mode === "add" ? <ArrowUp size={16} /> : <Check size={16} />}
        </button>
      </div>
      {popover && (
        <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 20, marginTop: 4 }} onMouseDown={(e) => e.stopPropagation()}>
          {popover}
        </div>
      )}
    </div>
  );
}
