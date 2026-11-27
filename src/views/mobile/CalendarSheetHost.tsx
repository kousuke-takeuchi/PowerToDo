import { useEffect } from "react";
import { api } from "../../api/client";
import { useCalendarChooser } from "../../app/useCalendarChooser";
import type { CalendarLink } from "../../types/model";
import { CalendarSheet } from "./CalendarSheet";

/** The sheet with its state (so the state lives only while the sheet is open). A login still waiting is cancelled when it closes. */
export function CalendarSheetHost({ project, current, onChanged }: { project: string; current: CalendarLink[]; onChanged: () => void }) {
  const chooser = useCalendarChooser(project, current, onChanged);
  useEffect(() => () => void api.googleLoginCancel().catch(() => undefined), []);
  return <CalendarSheet chooser={chooser} />;
}
