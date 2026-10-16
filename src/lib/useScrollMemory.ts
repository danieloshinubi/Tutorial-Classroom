import { useEffect, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Where a page was scrolled to, put back after a reload or when coming back
// to it (2026-10-16). Remembered per address for this browser tab. A fresh
// visit (a link clicked) starts at the top as usual; only a reload or the
// back/forward buttons restore.
//
// The page's content usually arrives a moment after it opens, so the restore
// waits until the page is tall enough, and gives up the moment the person
// scrolls themselves or after a few seconds.
const PREFIX = "schoolivio.scroll:";

export const useScrollMemory = (ref: RefObject<HTMLElement | null>) => {
  const { pathname, search } = useLocation();
  const navigationType = useNavigationType();
  const key = `${PREFIX}${pathname}${search}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let saved = 0;
    try {
      saved = Number(window.sessionStorage.getItem(key)) || 0;
    } catch {
      saved = 0;
    }

    let done = navigationType !== "POP" || saved <= 0;
    let timer = 0;
    let tries = 0;
    const restore = () => {
      if (done) return;
      if (el.scrollHeight - el.clientHeight >= saved - 2) {
        done = true;
        el.scrollTop = saved;
      } else if ((tries += 1) < 50) {
        timer = window.setTimeout(restore, 100);
      } else {
        done = true;
        el.scrollTop = saved; // as far as it goes
      }
    };
    restore();

    // The person taking over stops any restore still waiting.
    const takeOver = () => {
      done = true;
      window.clearTimeout(timer);
    };

    let frame = 0;
    const remember = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        try {
          window.sessionStorage.setItem(key, String(Math.round(el.scrollTop)));
        } catch {
          // Storage unavailable: nothing to remember with.
        }
      });
    };

    el.addEventListener("scroll", remember, { passive: true });
    el.addEventListener("wheel", takeOver, { passive: true });
    el.addEventListener("touchstart", takeOver, { passive: true });
    el.addEventListener("keydown", takeOver);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      el.removeEventListener("scroll", remember);
      el.removeEventListener("wheel", takeOver);
      el.removeEventListener("touchstart", takeOver);
      el.removeEventListener("keydown", takeOver);
    };
  }, [key, navigationType, ref]);
};
