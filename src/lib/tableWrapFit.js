// Keeps every .table-wrap sized to exactly fill the remaining viewport below
// its own top edge, so its sticky header has a real scroll pane of its own
// and the page around it never ALSO needs to scroll — one scrollbar (the
// table's), not two sitting side by side.
//
// The previous approach tried to reconstruct that available height by
// subtracting a fixed guess (a page header's measured height, a filter
// panel's measured height, plus a flat 130px "everything else" constant)
// from 100vh. That guess only holds for whatever happened to be on screen
// when the constant was chosen — add one more line of text above the table
// (as PeoplePanel's own "22 of 22 people" count did) and the guess comes up
// short, .table-wrap ends up a little taller than the room actually left for
// it, and the page itself gets a second, genuine scrollbar right beside the
// table's — which is exactly the "two scrollbars" bug.
//
// Measuring the table's own rendered top position instead of guessing it
// sidesteps the whole problem: whatever is above the table on a given page,
// however tall, is already baked into that measurement. Only .page's own
// fixed bottom padding (theme.css `.page`, kept in sync with the constant
// below) needs accounting for separately, since it sits below .table-wrap
// and getBoundingClientRect() on the table itself can't see it.
const PAGE_BOTTOM_PADDING = 32;
const BREATHING_ROOM = 8;
const MIN_HEIGHT = 200;

let scheduled = false;

const fit = () => {
  scheduled = false;
  document.querySelectorAll(".table-wrap").forEach((el) => {
    const top = el.getBoundingClientRect().top;
    const available = window.innerHeight - top - PAGE_BOTTOM_PADDING - BREATHING_ROOM;
    el.style.maxHeight = `${Math.max(MIN_HEIGHT, available)}px`;
  });
};

// setTimeout, not requestAnimationFrame — a background/inactive tab keeps
// running timers (throttled, but they still fire) while most browsers
// simply never call a pending rAF callback at all until the tab is
// foregrounded again. A table opened in a background tab would otherwise
// sit on the CSS fallback height forever, which is exactly the mismatch
// that causes the page to grow its own second scrollbar.
const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(fit, 0);
};

// One observer for the whole app rather than one per table — every page
// that renders a .table-wrap benefits without importing anything itself.
export const startTableWrapFit = () => {
  schedule();
  window.addEventListener("resize", schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => {
    window.removeEventListener("resize", schedule);
    observer.disconnect();
  };
};
