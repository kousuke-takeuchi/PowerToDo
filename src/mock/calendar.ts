import type { CalendarInfo, CalendarLink } from "../types/model";
import type { ShownEvent } from "../app/calendarEvents";
import type { CalendarChooserApi } from "../app/useCalendarChooser";

/** Sample Google Calendar data for the stories (a fixed day: mock/data TODAY is 2026-10-13). */
export const calendarEvents: ShownEvent[] = [
  { id: "a", project: "買い物", color: "#16a765", title: "町内会の集まり", date: "2026-10-13", allDay: true },
  { id: "b", project: "買い物", color: "#16a765", title: "スーパーの特売 (牛乳 1 本 100 円)", date: "2026-10-13", startTime: "10:00", endTime: "11:30", allDay: false, location: "駅前のスーパー" },
  { id: "c", project: "買い物", color: "#16a765", title: "歯医者", date: "2026-10-15", startTime: "15:30", endTime: "16:30", allDay: false },
  { id: "d", project: "買い物", color: "#16a765", title: "家族の誕生日", date: "2026-10-18", allDay: true },
];

export const calendarList: CalendarInfo[] = [
  { id: "me@example.com", name: "自分", color: "#4285f4", primary: true },
  { id: "family", name: "家族", color: "#16a765", primary: false },
  { id: "work", name: "仕事", color: "#f4511e", primary: false },
];

export const calendarLink: CalendarLink = { account: "me@example.com", calendarId: "family", color: "#16a765", name: "家族" };

const noop = () => undefined;

/** A chooser with fixed state (no Google): the accounts step, or the calendars of `account`. */
export const chooserStub = (account: string | null): CalendarChooserApi => ({
  accounts: ["me@example.com", "work@example.com"],
  account,
  setAccount: noop,
  calendars: account ? calendarList : null,
  busy: false,
  error: null,
  addAccount: async () => undefined,
  pick: async () => true,
  clear: async () => true,
});
