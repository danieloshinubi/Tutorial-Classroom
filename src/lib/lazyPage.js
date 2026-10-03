import { lazy } from "react";

// React.lazy, plus recovery from a release that went out while this tab was
// open: the screen's file has a new name now, so the old one fails to load
// ("ChunkLoadError"). Reload once to pick up the new release instead of
// showing a broken page; if it still fails, the error is real and surfaces.
const RELOADED_KEY = "schoolivio:chunk-reload";

export const lazyPage = (load) =>
  lazy(() =>
    load()
      .then((module) => {
        try {
          window.sessionStorage.removeItem(RELOADED_KEY);
        } catch {
          // Storage unavailable: nothing to clear.
        }
        return module;
      })
      .catch((err) => {
        const stale = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
          `${err?.name} ${err?.message}`
        );
        let alreadyReloaded = false;
        try {
          alreadyReloaded = window.sessionStorage.getItem(RELOADED_KEY) === "1";
          if (stale && !alreadyReloaded) window.sessionStorage.setItem(RELOADED_KEY, "1");
        } catch {
          alreadyReloaded = true;
        }
        if (stale && !alreadyReloaded) {
          window.location.reload();
          return new Promise(() => {});
        }
        throw err;
      })
  );
