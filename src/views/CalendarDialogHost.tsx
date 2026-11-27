import { useCalendarChooser } from "../app/useCalendarChooser";
import type { CalendarLink } from "../types/model";
import { CalendarDialog } from "./CalendarDialog";

/** The dialog with its state (the state lives only while it is open). */
export function CalendarDialogHost({ project, current, onChanged, onClose }: { project: string; current: CalendarLink[]; onChanged: () => void; onClose: () => void }) {
  const chooser = useCalendarChooser(project, current, onChanged);
  return <CalendarDialog project={project} chooser={chooser} onClose={onClose} />;
}
