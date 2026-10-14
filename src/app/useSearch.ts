import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { SearchHit } from "../types/model";

/** Search state for the dialog: debounced (150 ms) `search` calls; stale responses are dropped; reset on open. */
export function useSearch(open: boolean) {
  const [query, setQuery] = useState("");
  const [includeDone, setIncludeDone] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  // Reset on open (not on close) so the card keeps its content during the exit animation; closing only drops
  // responses still in flight.
  useEffect(() => {
    if (open) {
      setQuery("");
      setIncludeDone(false);
      setHits([]);
      setBusy(false);
    } else {
      seq.current++;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      seq.current++;
      setHits([]);
      setBusy(false);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const id = window.setTimeout(() => {
      api
        .search(query, includeDone, 50)
        .then((r) => {
          if (mine === seq.current) setHits(r.hits);
        })
        .catch(() => {
          if (mine === seq.current) setHits([]);
        })
        .finally(() => {
          if (mine === seq.current) setBusy(false);
        });
    }, 150);
    return () => window.clearTimeout(id);
  }, [open, query, includeDone, tick]);

  return {
    query,
    setQuery,
    includeDone,
    toggleIncludeDone: () => setIncludeDone((v) => !v),
    hits,
    busy,
    /** Re-run the current search (after a check-off changes what matches). */
    refresh: () => setTick((t) => t + 1),
  };
}
