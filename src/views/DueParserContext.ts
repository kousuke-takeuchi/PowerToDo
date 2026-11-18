import { createContext } from "react";
import type { DueTextDto } from "../types/model";

/**
 * 日付ポップオーバーの入力欄の解釈 (api.parseDueText)。App が供給する。無ければ (Storybook など) 欄は解釈せず、
 * 打った文字は使われない。
 */
export type DueParser = (text: string, today: string) => Promise<DueTextDto | null>;
export const DueParserContext = createContext<DueParser | null>(null);
