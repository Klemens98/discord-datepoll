const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function monthLabel(date, locale = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric"
  }).format(date);
}

export function dateLabel(key, locale = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(parseDateKey(key));
}

export function getMonthDays(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = new Date(year, month, day);
    return {
      date,
      key: dateKey(date),
      day
    };
  });
}

export function renderCalendar(monthDate, selectedKeys) {
  const days = getMonthDays(monthDate);
  const firstWeekday = (days[0].date.getDay() + 6) % 7;
  const cells = Array(firstWeekday).fill("  ");

  for (const day of days) {
    const marker = selectedKeys.has(day.key) ? "*" : " ";
    cells.push(`${String(day.day).padStart(2, " ")}${marker}`);
  }

  while (cells.length % 7 !== 0) {
    cells.push("  ");
  }

  const rows = [WEEKDAYS.join("  ")];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7).join(" "));
  }

  return `\`\`\`\n${rows.join("\n")}\n\`\`\`\n* = selected`;
}
