// Keeps the app framed to what is visible while a phone keyboard is open.
//
// On iPhone the keyboard does not shrink the page (100dvh stays the full
// screen); it covers the bottom, and Safari scrolls the whole page up to
// bring the focused field into view. In Chat that pushed the person you are
// talking to off the top of the screen. A native messenger instead keeps
// its header where it is and sits the composer on the keyboard.
//
// So while the keyboard is up, .shell (theme.css, `html.kb-open`) is fixed to
// the visible area: --vv-h tall, --vv-top down. Everything inside already
// measures its own box (Page's --page-avail-h), so the message list simply
// gets shorter and the composer lands right above the keys.
export function installKeyboardViewport() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return;
  const root = document.documentElement;

  let frame = 0;
  const sync = () => {
    frame = 0;
    // Pinch zoom also shrinks the visual viewport; that is not a keyboard.
    const open = vv.scale <= 1.01 && window.innerHeight - vv.height > 120;
    root.classList.toggle("kb-open", open);
    if (open) {
      root.style.setProperty("--vv-h", `${vv.height}px`);
      root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
      // Undo the page scroll Safari made to reveal the field: the frame is
      // already sized to the visible area, so there is nothing to reveal.
      if (window.scrollY) window.scrollTo(0, 0);
    } else {
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sync);
  };
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  sync();
}
