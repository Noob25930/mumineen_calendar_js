#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const HijriDate = require("../source/assets/javascripts/_lib/hijri_date.js");

const ROOT = path.resolve(__dirname, "..");
const MIQAATS_PATH = path.join(ROOT, "source", "data", "miqaats.json");
const OUTPUT_DIR = path.join(ROOT, "source", "calendars");

const MONTH_NAMES = Array.from({ length: 12 }, (_, month) => HijriDate.getMonthName(month));

function parseArgs(argv) {
  const args = { startYear: 1440, endYear: 1460 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--start-year" && argv[i + 1]) args.startYear = Number(argv[++i]);
    else if (argv[i] === "--end-year" && argv[i + 1]) args.endYear = Number(argv[++i]);
  }
  if (!Number.isInteger(args.startYear) || !Number.isInteger(args.endYear) || args.startYear > args.endYear) {
    throw new Error("Invalid Hijri year range. Example: --start-year 1440 --end-year 1460");
  }
  return args;
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function gregorianDateParts(hijriYear, hijriMonth, hijriDay) {
  const date = new HijriDate(hijriYear, hijriMonth, hijriDay).toGregorian();
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
}

function formatDate(parts) {
  return `${pad(parts.year, 4)}${pad(parts.month)}${pad(parts.day)}`;
}

function nextGregorianDate(parts) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line) {
  const max = 72;
  if (line.length <= max) return line;
  const parts = [];
  let remaining = line;
  while (remaining.length > max) {
    parts.push(remaining.slice(0, max));
    remaining = remaining.slice(max);
  }
  parts.push(remaining);
  return parts.join("\r\n ");
}

function calendarHeader(name, description) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mumineen Calendar//Dawoodi Bohra Hijri Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(name)}`,
    `X-WR-CALDESC:${escapeIcs(description)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D"
  ];
}

function allDayEvent({ uid, summary, description, date, categories }) {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${formatDate(date)}`,
    `DTEND;VALUE=DATE:${formatDate(nextGregorianDate(date))}`,
    `SUMMARY:${escapeIcs(summary)}`,
    "TRANSP:TRANSPARENT"
  ];
  if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);
  if (categories && categories.length) lines.push(`CATEGORIES:${categories.map(escapeIcs).join(",")}`);
  lines.push("END:VEVENT");
  return lines;
}

function serializeCalendar(lines) {
  return `${lines.map(foldLine).join("\r\n")}\r\nEND:VCALENDAR\r\n`;
}

function safeSlug(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "event";
}

function buildMiqaatIndex(miqaatsData) {
  const index = new Map();
  for (const day of miqaatsData) index.set(`${day.month}-${day.date}`, day.miqaats || []);
  return index;
}

function generateFeeds(startYear, endYear, miqaatsData) {
  const miqaatIndex = buildMiqaatIndex(miqaatsData);

  const feeds = {
    dates: calendarHeader(
      "Dawoodi Bohra Hijri Dates",
      "Daily Dawoodi Bohra Hijri dates generated with the Mumineen Calendar conversion algorithm."
    ),
    events: calendarHeader(
      "Dawoodi Bohra Miqaats",
      "All Miqaats and events from Mumineen Calendar."
    ),
    major: calendarHeader(
      "Dawoodi Bohra Major Miqaats",
      "Priority 1 Miqaats and events from Mumineen Calendar."
    ),
    important: calendarHeader(
      "Dawoodi Bohra Important Miqaats",
      "Priority 1 and 2 Miqaats and events from Mumineen Calendar."
    )
  };

  const stats = { dates: 0, events: 0, major: 0, important: 0 };

  for (let year = startYear; year <= endYear; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const daysInMonth = HijriDate.daysInMonth(year, month);
      for (let day = 1; day <= daysInMonth; day += 1) {
        const gregorian = gregorianDateParts(year, month, day);
        const hijriLabel = `${day} ${MONTH_NAMES[month]} ${year}H`;

        feeds.dates.push(...allDayEvent({
          uid: `hijri-date-${year}-${pad(month + 1)}-${pad(day)}@mumineen-calendar`,
          summary: hijriLabel,
          description: `Dawoodi Bohra Hijri date: ${hijriLabel}`,
          date: gregorian,
          categories: ["Hijri Date"]
        }));
        stats.dates += 1;

        const dayMiqaats = miqaatIndex.get(`${month}-${day}`) || [];
        dayMiqaats.forEach((miqaat, index) => {
          if (miqaat.year && miqaat.year > year) return;

          const phase = miqaat.phase || "day";
          const priority = Number(miqaat.priority || 3);
          const descriptionParts = [
            miqaat.description,
            `Hijri date: ${hijriLabel}`,
            `Phase: ${phase.charAt(0).toUpperCase()}${phase.slice(1)}`,
            `Priority: ${priority}`
          ].filter(Boolean);

          const eventLines = allDayEvent({
            uid: `miqaat-${year}-${pad(month + 1)}-${pad(day)}-${index + 1}-${safeSlug(miqaat.title)}@mumineen-calendar`,
            summary: miqaat.title,
            description: descriptionParts.join("\n"),
            date: gregorian,
            categories: ["Miqaat", `Priority ${priority}`, phase === "night" ? "Night" : "Day"]
          });

          feeds.events.push(...eventLines);
          stats.events += 1;

          if (priority === 1) {
            feeds.major.push(...eventLines);
            stats.major += 1;
          }
          if (priority <= 2) {
            feeds.important.push(...eventLines);
            stats.important += 1;
          }
        });
      }
    }
  }

  return { feeds, stats };
}

function writeFeed(filename, lines) {
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), serializeCalendar(lines), "utf8");
}

function main() {
  const { startYear, endYear } = parseArgs(process.argv.slice(2));
  const miqaatsData = JSON.parse(fs.readFileSync(MIQAATS_PATH, "utf8"));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const { feeds, stats } = generateFeeds(startYear, endYear, miqaatsData);
  writeFeed("hijri-dates.ics", feeds.dates);
  writeFeed("hijri-events.ics", feeds.events);
  writeFeed("hijri-major-events.ics", feeds.major);
  writeFeed("hijri-important-events.ics", feeds.important);

  console.log(`Generated Hijri ${startYear}H-${endYear}H`);
  console.log(`Daily dates: ${stats.dates}`);
  console.log(`All events: ${stats.events}`);
  console.log(`Priority 1 events: ${stats.major}`);
  console.log(`Priority 1-2 events: ${stats.important}`);
}

main();
