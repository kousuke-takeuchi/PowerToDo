import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api/client";
import type { CalendarInfo, CalendarLink } from "../types/model";

export type CalendarChooserApi = {
  accounts: string[];
  /** The account whose calendars are listed (`null`: choosing the account). */
  account: string | null;
  setAccount: (a: string | null) => void;
  calendars: CalendarInfo[] | null;
  busy: boolean;
  error: string | null;
  /** The calendars the project shows now (of any accounts), in the order chosen. */
  selected: CalendarLink[];
  /** The Google login for a new account (spec 2026-11-27); the account is then chosen. Cancel with `api.googleLoginCancel`. */
  addAccount: () => Promise<void>;
  /** Show the calendar in the project, or stop showing it. Saves at once. */
  toggle: (c: CalendarInfo) => Promise<boolean>;
  /** Stop showing a selected calendar. */
  remove: (l: CalendarLink) => Promise<boolean>;
};

/** Is this calendar one of the selected? */
export const isSelected = (selected: CalendarLink[], account: string | null, calendarId: string) => selected.some((l) => l.account === account && l.calendarId === calendarId);

/**
 * The state behind choosing a project's Google calendars: the accounts logged in on this device, the calendars of the chosen account,
 * the login of a new one, and the selection (several calendars, of several accounts). Both the iPhone sheet and the desktop dialog
 * use it. A change is saved at once; `onChanged` runs after it (refetch).
 */
export function useCalendarChooser(project: string, current: CalendarLink[], onChanged: () => void): CalendarChooserApi {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState<string | null>(current.length === 1 ? current[0].account : null);
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [selected, setSelected] = useState<CalendarLink[]>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api.calendarAccounts().then(
      (a) => !cancelled && setAccounts(a),
      (e) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCalendars(null);
    if (account === null) return;
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api.calendarCalendars(account).then(
      (c) => {
        if (mine === seq.current) {
          setCalendars(c);
          setBusy(false);
        }
      },
      (e) => {
        if (mine === seq.current) {
          setError(errorMessage(e));
          setBusy(false);
        }
      },
    );
  }, [account]);

  const addAccount = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.calendarLogin();
      if (r.outcome === "done" && r.email) {
        const email = r.email;
        setAccounts((a) => (a.includes(email) ? a : [...a, email]));
        setAccount(email);
      } else if (r.outcome === "denied") setError("Google でのログインが許可されませんでした");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const save = useCallback(
    async (links: CalendarLink[]) => {
      const before = selected;
      setSelected(links);
      setError(null);
      try {
        await api.calendarSetLinks(project, links);
        onChanged();
        return true;
      } catch (e) {
        setSelected(before);
        setError(errorMessage(e));
        return false;
      }
    },
    [project, onChanged, selected],
  );

  const toggle = useCallback(
    (c: CalendarInfo) => {
      if (account === null) return Promise.resolve(false);
      return save(isSelected(selected, account, c.id) ? selected.filter((l) => !(l.account === account && l.calendarId === c.id)) : [...selected, { account, calendarId: c.id, color: c.color ?? "", name: c.name }]);
    },
    [account, selected, save],
  );
  const remove = useCallback((l: CalendarLink) => save(selected.filter((x) => !(x.account === l.account && x.calendarId === l.calendarId))), [selected, save]);
  return { accounts, account, setAccount, calendars, busy, error, selected, addAccount, toggle, remove };
}
