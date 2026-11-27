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
  /** The Google login for a new account (spec 2026-11-27); the account is then chosen. Cancel with `api.googleLoginCancel`. */
  addAccount: () => Promise<void>;
  /** Pick a calendar: sets the project's link. */
  pick: (c: CalendarInfo) => Promise<boolean>;
  /** Take the calendar off the project. */
  clear: () => Promise<boolean>;
};

/**
 * The state behind choosing a project's Google calendar: the accounts logged in on this device, the calendars of the chosen account,
 * and the login of a new one. Both the iPhone sheet and the desktop dialog use it. `onChanged` runs after the link changed (refetch).
 */
export function useCalendarChooser(project: string, current: CalendarLink | null, onChanged: () => void): CalendarChooserApi {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState<string | null>(current?.account ?? null);
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
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
    async (link: CalendarLink | null) => {
      setBusy(true);
      setError(null);
      try {
        await api.calendarSetLink(project, link);
        onChanged();
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [project, onChanged],
  );

  const pick = useCallback((c: CalendarInfo) => (account ? save({ account, calendarId: c.id, color: c.color ?? "", name: c.name }) : Promise.resolve(false)), [account, save]);
  const clear = useCallback(() => save(null), [save]);
  return { accounts, account, setAccount, calendars, busy, error, addAccount, pick, clear };
}
