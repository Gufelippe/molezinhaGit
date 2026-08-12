const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const yearFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const fullFmt = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function stripMonthDot(value: string): string {
  return value.replace(/\./g, "");
}

/** Short timestamp for message meta lines: "14:52", "ontem 14:52", "12 ago 14:52". */
export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = timeFmt.format(d);
  if (d.toDateString() === now.toDateString()) return time;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `ontem ${time}`;

  if (d.getFullYear() === now.getFullYear()) return `${stripMonthDot(dayFmt.format(d))} ${time}`;
  return stripMonthDot(yearFmt.format(d));
}

/** Long form used in tooltips, where the exact moment matters. */
export function formatFullTime(iso: string): string {
  return fullFmt.format(new Date(iso));
}
