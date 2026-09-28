// Calendar dates ("2026-09-28") in the device's own time zone.
//
// new Date().toISOString().slice(0, 10) looks like "today" but is today in
// UTC. Nigeria is an hour ahead of UTC, so for the first hour after midnight
// it gave yesterday, and the first of a month came out as the last day of the
// month before — which is how the Store's Profit tab opened on 31 August.
// Anything that means "the date on the person's calendar" should come from
// here.

export const localISODate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const todayISO = () => localISODate(new Date());

export const daysAgoISO = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localISODate(d);
};

export const monthStartISO = () => {
  const d = new Date();
  return localISODate(new Date(d.getFullYear(), d.getMonth(), 1));
};
