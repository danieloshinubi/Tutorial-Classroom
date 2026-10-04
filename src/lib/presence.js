// "Last seen" wording, the way WhatsApp says it.
//   just now, 5 min ago, today at 14:05, yesterday at 09:10,
//   Mon at 16:20 (this week), 12 Sep (this year), 12 Sep 2025.
const time = (d) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const relativeMoment = (value, now = new Date()) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const minutes = Math.floor((now - d) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days === 0) return `today at ${time(d)}`;
  if (days === 1) return `yesterday at ${time(d)}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} at ${time(d)}`;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
};

// What to show under someone's name: "Online", "Away", "Last seen 5 min
// ago", or nothing if they have never been active.
export const presenceLabel = ({ status, online, lastSeen }) => {
  const now = status || (online ? "online" : "offline");
  if (now === "online") return "Online";
  if (now === "away") return "Away";
  const when = relativeMoment(lastSeen);
  return when ? `Last seen ${when}` : "";
};
