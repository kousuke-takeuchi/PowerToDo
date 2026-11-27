import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../api/client";

/** The Google accounts logged in for calendars on this device (settings, spec 2026-11-27): list, add, log out. */
export function useCalendarAccounts(active: boolean, onChanged?: () => void) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api.calendarAccounts().then(
      (a) => !cancelled && setAccounts(a),
      (e) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [active]);

  const add = useCallback(async () => {
    setBusy(true);
    setWaiting(true);
    setError(null);
    try {
      const r = await api.calendarLogin();
      if (r.outcome === "done" && r.email) {
        const email = r.email;
        setAccounts((a) => (a.includes(email) ? a : [...a, email]));
        onChanged?.();
      } else if (r.outcome === "denied") setError("Google でのログインが許可されませんでした");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setWaiting(false);
    }
  }, [onChanged]);

  const cancel = useCallback(() => void api.googleLoginCancel().catch(() => undefined), []);

  const logout = useCallback(
    async (email: string) => {
      setBusy(true);
      setError(null);
      try {
        await api.calendarLogout(email);
        setAccounts((a) => a.filter((x) => x !== email));
        onChanged?.();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  return { accounts, busy, waiting, error, add, cancel, logout };
}
