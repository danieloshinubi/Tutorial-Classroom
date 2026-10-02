// Keeps the app framed to what is visible while a phone keyboard is open.
//
// On iPhone the keyboard does not shrink the page (100dvh stays the full
// screen); it covers the bottom, and Safari pans the whole page up to bring
// the focused field into view. In Chat that pushed the person you are
// talking to off the top of the screen. A native messenger instead keeps
// its header where it is and sits the composer on the keyboard.
//
// So the visible area is published all the time as --vv-h (its height) and
// --vv-top (how far Safari has panned), and Chat on a phone is framed to
// exactly that box (theme.css, "Chat on a phone"). Everything inside
// measures its own box (Page's --page-avail-h), so the message list gets
// shorter and the composer lands right above the keys.
//
// html.kb-open marks "typing on a touch screen": an editable field has focus
// on a touch device, or the visible area is clearly shorter than it was.
// Focus is the main signal because iOS versions disagree about which heights
// change when the keyboard opens; the height check covers Android.
const isEditable = (el) =>
  !!el &&
  (el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|file|range|color)$/i.test(el.type || "")));

export function installKeyboardViewport() {
  if (typeof window === "undefined") return;
  const vv = window.visualViewport;
  const root = document.documentElement;
  const touch = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;

  // Tallest visible height seen at the current width: the keyboard-closed size.
  let baseline = 0;
  let baselineWidth = 0;

  let frame = 0;
  const sync = () => {
    frame = 0;
    const height = vv ? vv.height : window.innerHeight;
    const width = vv ? vv.width : window.innerWidth;
    const zoomed = vv ? vv.scale > 1.01 : false;
    if (width !== baselineWidth) {
      baselineWidth = width;
      baseline = height;
    }
    if (!zoomed) baseline = Math.max(baseline, height);

    root.style.setProperty("--vv-h", `${height}px`);
    root.style.setProperty("--vv-top", `${vv ? vv.offsetTop : 0}px`);

    const typing = touch && isEditable(document.activeElement);
    const open = !zoomed && (typing || baseline - height > 120);
    root.classList.toggle("kb-open", open);
    // Undo the page scroll Safari made to reveal the field: the frame is
    // already the visible area, so there is nothing to reveal.
    if (open && window.scrollY) window.scrollTo(0, 0);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sync);
  };
  if (vv) {
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
  }
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  // Focus moves before the keyboard animates in; react to it straight away,
  // and again once the keyboard has settled.
  document.addEventListener("focusin", () => { schedule(); setTimeout(schedule, 350); });
  document.addEventListener("focusout", () => setTimeout(schedule, 50));
  sync();
}
