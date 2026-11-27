import type React from "react";
import { useContext, useState } from "react";
import { Ban, Calendar, CalendarPlus, Check, ChevronLeft, Clock3, Repeat, Sofa, Sun } from "lucide-react";
import { TODAY, monthDay, weekdayShort } from "../../mock/data";
import { calendarMonths, quickRows, repeatChoices, weekHeader } from "../../app/dateSheet";
import { TimeSelect } from "../../components/TimeSelect";
import { DueParserContext } from "../DueParserContext";
import { SheetCard, SheetRow } from "./BottomSheet";

/** The form id the sheet's red check (BottomSheet confirmForm) submits. */
export const DATE_SHEET_FORM = "date-sheet";

export type DateSheetProps = {
  value?: string;
  time?: string;
  /** The task's repeat now (its RRULE and how it reads), for the 繰り返し row. */
  rrule?: string;
  rruleLabel?: string;
  today?: string;
  weekStart?: "mon" | "sun";
  /** The red check. `rrule`: undefined = left as it was, null = taken off. */
  onApply: (v: { date?: string; time?: string; rrule?: string | null }) => void;
  onClose: () => void;
  /** 日付だけ選ばせる (期限切れの再スケジュール): 「日付なし」「時間」「繰り返し」を出さない。 */
  dateOnly?: boolean;
  /** No 繰り返し row (the swipe's date sheet changes the date only). */
  noRepeat?: boolean;
};

type Page = "root" | "time" | "repeat";
const MONTHS = 6;


/**
 * The date sheet in Todoist's form (spec 2026-11-28): a field you can type into (「毎週水曜 10:00」), the quick rows with their weekday,
 * the weekday header over one list of months, and the rows 「時間」 and 「繰り返し」 that open a page each. Nothing is applied until the
 * red check; the 「×」 drops the changes. A time is picked in 5-minute steps from the next round time.
 */
export function DateSheet({ value, time, rrule, rruleLabel, today = TODAY, weekStart = "mon", onApply, onClose, dateOnly, noRepeat }: DateSheetProps) {
  const parse = useContext(DueParserContext);
  const [date, setDate] = useState<string | undefined>(value);
  const [at, setAt] = useState<string | undefined>(time);
  // The repeat is only sent when touched.
  const [repeat, setRepeat] = useState<string | null | undefined>(undefined);
  const [page, setPage] = useState<Page>("root");
  const [typed, setTyped] = useState("");
  const [bad, setBad] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply({ date, time: date ? at : undefined, rrule: repeat });
    onClose();
  };
  const pickDate = (d: string | undefined) => {
    setDate(d);
    if (!d) setAt(undefined);
  };
  const readTyped = async () => {
    const text = typed.trim();
    if (!text || !parse) return;
    const r = await parse(text, today).catch(() => null);
    if (!r || (!r.due && !r.rrule)) return setBad(true);
    setBad(false);
    setTyped("");
    if (r.due) setDate(r.due);
    if (r.time) setAt(r.time);
    if (r.rrule) setRepeat(r.rrule);
  };
  const repeatText = repeat === undefined ? (rruleLabel ?? (rrule ? "あり" : "なし")) : (repeatChoices(date ?? today).find((c) => c.rrule === repeat)?.label ?? "あり");
  const back = (title: string) => (
    <button type="button" onClick={() => setPage("root")} style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 44, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600, color: "var(--color-accent)", cursor: "pointer" }}>
      <ChevronLeft size={18} aria-hidden />
      {title}
    </button>
  );

  if (page === "time") {
    return (
      <form id={DATE_SHEET_FORM} onSubmit={submit}>
        {back("時間")}
        <SheetCard label="時間">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minHeight: 56, padding: "0 16px", fontSize: 16, color: "var(--color-text-primary)" }}>
            <span style={{ display: "inline-flex", color: "var(--color-text-secondary)" }}>
              <Clock3 size={18} />
            </span>
            <span style={{ flex: 1 }}>時間</span>
            <TimeSelect
              value={at}
              size={16}
              height={36}
              onChange={(t) => {
                setAt(t);
                // A time without a date is for today.
                if (t && !date) setDate(today);
              }}
            />
          </div>
        </SheetCard>
      </form>
    );
  }
  if (page === "repeat") {
    const choices = repeatChoices(date ?? today);
    const current = repeat === undefined ? (rrule ? undefined : null) : repeat;
    return (
      <form id={DATE_SHEET_FORM} onSubmit={submit}>
        {back("繰り返し")}
        <SheetCard label="繰り返し">
          {choices.map((c) => (
            <SheetRow
              key={c.key}
              icon={current === c.rrule ? <Check size={18} /> : <span style={{ width: 18 }} />}
              label={c.label}
              onClick={() => {
                setRepeat(c.rrule);
                if (c.rrule && !date) setDate(today);
                setPage("root");
              }}
            />
          ))}
        </SheetCard>
      </form>
    );
  }

  const quickIcon: Record<string, React.ReactNode> = { tomorrow: <Sun size={18} />, later: <CalendarPlus size={18} />, weekend: <Sofa size={18} />, nextweek: <CalendarPlus size={18} /> };
  const quickColor: Record<string, string> = { tomorrow: "var(--color-priority-2)", later: "var(--color-priority-3)", weekend: "var(--color-priority-3)", nextweek: "var(--color-priority-3)" };
  const months = calendarMonths(today, MONTHS, weekStart);
  return (
    <form id={DATE_SHEET_FORM} onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input
        aria-label="日付を入力"
        value={typed || (bad ? typed : "")}
        placeholder={date ? `${monthDay(date)}${at ? ` ${Number(at.slice(0, 2))}:${at.slice(3, 5)}` : ""}` : "日付を入力"}
        onChange={(e) => {
          setTyped(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          // Enter reads the text (「毎週水曜 10:00」); the red check applies the sheet.
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void readTyped();
          }
        }}
        onBlur={() => void readTyped()}
        style={{ boxSizing: "border-box", width: "100%", height: 44, padding: "0 12px", border: bad ? "1px solid var(--color-danger)" : 0, borderRadius: 10, background: "var(--color-bg-hover)", fontFamily: "var(--font-body)", fontSize: 16, color: "var(--color-text-primary)", outline: "none" }}
      />
      {bad && <div role="alert" style={{ marginTop: -6, fontSize: 12, lineHeight: "17px", color: "var(--color-danger)" }}>日付として読めませんでした</div>}
      <SheetCard label="日付">
        <SheetRow icon={<Calendar size={18} />} iconColor="var(--color-success)" label="今日" value={weekdayShort(today)} selected={date === today} onClick={() => pickDate(today)} />
        {quickRows(today).map((r) => (
          <SheetRow key={r.key} icon={quickIcon[r.key]} iconColor={quickColor[r.key]} label={r.label} value={weekdayShort(r.date)} selected={date === r.date} onClick={() => pickDate(r.date)} />
        ))}
        {!dateOnly && <SheetRow icon={<Ban size={18} />} iconColor="var(--color-text-secondary)" label="日付なし" selected={date === undefined} onClick={() => pickDate(undefined)} />}
      </SheetCard>
      <SheetCard label="カレンダー">
        <div style={{ padding: "4px 8px 8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: 12, lineHeight: "24px", color: "var(--color-text-secondary)" }}>
            {weekHeader(weekStart).map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          {months.map((m) => (
            <section key={m.key} aria-label={m.title}>
              <div style={{ padding: "10px 4px 4px", fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>{m.title}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 2 }}>
                {m.cells.map((c, i) =>
                  c === null ? (
                    <span key={i} />
                  ) : (
                    <button
                      key={c}
                      type="button"
                      disabled={c < today}
                      aria-label={c}
                      aria-pressed={c === date}
                      onClick={() => pickDate(c)}
                      style={{ justifySelf: "center", width: 40, height: 40, display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: 20, fontFamily: "var(--font-body)", fontSize: 15, background: c === date ? "var(--color-accent)" : "transparent", color: c === date ? "#FFFFFF" : c < today ? "var(--color-text-muted)" : c === today ? "var(--color-accent)" : "var(--color-text-primary)", fontWeight: c === today || c === date ? 700 : 400, cursor: c < today ? "default" : "pointer" }}
                    >
                      {Number(c.slice(8))}
                    </button>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      </SheetCard>
      {!dateOnly && (
        <SheetCard label="時間と繰り返し">
          <SheetRow icon={<Clock3 size={18} />} label="時間" value={at ? `${Number(at.slice(0, 2))}:${at.slice(3, 5)}` : "なし"} chevron onClick={() => setPage("time")} />
          {!noRepeat && <SheetRow icon={<Repeat size={18} />} label="繰り返し" value={repeatText} chevron onClick={() => setPage("repeat")} />}
        </SheetCard>
      )}
    </form>
  );
}
