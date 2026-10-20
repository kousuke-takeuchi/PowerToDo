import { createContext, useContext } from "react";
import type { PlatformInfo } from "../types/model";

/** Desktop is the default, so Storybook and the desktop app render as before without a provider. */
export const DEFAULT_PLATFORM: PlatformInfo = { os: "macos", mobile: false };

export const PlatformContext = createContext<PlatformInfo>(DEFAULT_PLATFORM);

export function usePlatform(): PlatformInfo {
  return useContext(PlatformContext);
}
