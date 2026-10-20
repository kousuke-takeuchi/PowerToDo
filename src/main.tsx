import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { api } from "./api/client";
import { DEFAULT_PLATFORM, PlatformContext } from "./app/platform";
import "./styles/index.css";

// Read the platform before the first render so the right screens mount at once (no desktop flash on a phone).
// If the command fails, treat it as the desktop.
async function boot() {
  const platform = await api.platformInfo().catch(() => DEFAULT_PLATFORM);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <PlatformContext.Provider value={platform}>
        <App />
      </PlatformContext.Provider>
    </React.StrictMode>,
  );
}
void boot();
