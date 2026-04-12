import type { PlanCalendarEntry, PlanCalendarSlot, TrainingReschedule } from "@/lib/types";
import { shiftIsoDate } from "@/lib/utils";

const calendarCycle: PlanCalendarSlot[] = ["A", "B", "C", "rest"];

function getCalendarLabelSuffix(slot: PlanCalendarSlot) {
  return slot === "rest" ? "浼?" : slot;
}

function toCalendarEntry(date: string, index: number, slot: PlanCalendarSlot): PlanCalendarEntry {
  const week = Math.floor(index / 7) + 1;
  const dayIndex = (index % 7) + 1;

  return {
    date,
    week,
    dayIndex,
    slot,
    label: `W${week}D${dayIndex}${getCalendarLabelSuffix(slot)}`,
  };
}

function getNextCalendarSlot(slot: PlanCalendarSlot) {
  const currentIndex = calendarCycle.indexOf(slot);
  return calendarCycle[(currentIndex + 1) % calendarCycle.length];
}

function extendCalendarEntriesToDate(calendarEntries: PlanCalendarEntry[], targetDate: string) {
  if (!calendarEntries.length || calendarEntries[calendarEntries.length - 1]!.date >= targetDate) {
    return calendarEntries;
  }

  const extended = calendarEntries.map(({ date, slot }) => ({ date, slot }));
  while (extended[extended.length - 1]!.date < targetDate) {
    const lastEntry = extended[extended.length - 1]!;
    extended.push({
      date: shiftIsoDate(lastEntry.date, 1),
      slot: getNextCalendarSlot(lastEntry.slot),
    });
  }

  return reindexCalendarEntries(extended);
}

export function reindexCalendarEntries(entries: Array<Pick<PlanCalendarEntry, "date" | "slot">>) {
  return [...entries]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((entry, index) => toCalendarEntry(entry.date, index, entry.slot));
}

export function buildCalendarEntries(startDate: string, durationWeeks: number): PlanCalendarEntry[] {
  const totalDays = durationWeeks * 7;

  return Array.from({ length: totalDays }, (_, index) =>
    toCalendarEntry(shiftIsoDate(startDate, index), index, calendarCycle[index % calendarCycle.length]),
  );
}

export function materializePlanCalendar(baseCalendarEntries: PlanCalendarEntry[], reschedules: TrainingReschedule[]) {
  if (!baseCalendarEntries.length) {
    return [];
  }

  let currentCalendar = reindexCalendarEntries(baseCalendarEntries);
  for (const reschedule of [...reschedules].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    currentCalendar = extendCalendarEntriesToDate(currentCalendar, reschedule.targetDate);
    const sourceIndex = currentCalendar.findIndex((entry) => entry.date === reschedule.sourceDate);
    const targetIndex = currentCalendar.findIndex((entry) => entry.date === reschedule.targetDate);

    if (sourceIndex < 0 || targetIndex < 0) {
      throw new Error(`Unable to apply reschedule ${reschedule.id}`);
    }
    if (targetIndex <= sourceIndex) {
      throw new Error(`Reschedule target must be after source for ${reschedule.id}`);
    }
    if (currentCalendar[sourceIndex]!.slot === "rest") {
      throw new Error(`Cannot move a rest day for ${reschedule.id}`);
    }

    const movedSlot = currentCalendar[sourceIndex]!.slot;
    const nextSlots = [
      ...currentCalendar.slice(0, sourceIndex).map((entry) => entry.slot),
      "rest" as const,
      ...currentCalendar.slice(sourceIndex + 1, targetIndex).map((entry) => entry.slot),
      movedSlot,
      ...currentCalendar.slice(targetIndex).map((entry) => entry.slot),
    ];
    const startDate = currentCalendar[0]!.date;
    currentCalendar = reindexCalendarEntries(
      nextSlots.map((slot, index) => ({
        date: shiftIsoDate(startDate, index),
        slot,
      })),
    );
  }

  return currentCalendar;
}
