import { createContext } from "react";

/**
 * 縦長の幅 (iPhone) で並べるか。SyncPane / Banners の `narrow` が供給し、設定の Row・帯・入力欄が読む
 * (縦に並べ、ボタンを全幅にし、入力欄は 16px で iOS の拡大を避ける)。デスクトップは供給しない (false)。
 */
export const NarrowContext = createContext(false);
