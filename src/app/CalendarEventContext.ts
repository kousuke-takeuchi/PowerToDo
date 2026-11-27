import { createContext } from "react";
import type { ShownEvent } from "./calendarEvents";

/** Opens the detail of a Google Calendar event (spec 2026-11-27). Null (stories, tests): the rows are not tappable. */
export const OpenCalendarEventContext = createContext<((e: ShownEvent) => void) | null>(null);
