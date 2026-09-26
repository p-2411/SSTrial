import { lazy, Suspense, useState } from 'react';
import { CalendarDays, ChevronDown, Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ANY_TIME, DAY_PRESETS, describeDayRange, sameRange, toDay, type DayRange } from '@/lib/dayRange';
import { importWithReload } from '@/lib/importWithReload';
import { midSentence } from '@/lib/text';
import { cn } from '@/lib/utils';

// The calendar (react-day-picker) is only fetched when someone opens the menu: most never pick a
// range by hand, and the presets need none of it.
const DayRangeCalendar = lazy(() => importWithReload(() => import('./DayRangeCalendar')));

interface DayRangeMenuProps {
  range: DayRange;
  onChange: (range: DayRange) => void;
  /** Says what the days are of, before the choice: "Added" reads "Added last 7 days". */
  label?: string;
}

/**
 * Which days to show: one click for a common span (today, the last week…), or any range picked on
 * a calendar. Days are the viewer's own, and none after today can be picked.
 */
export function DayRangeMenu({ range, onChange, label }: DayRangeMenuProps) {
  const [open, setOpen] = useState(false);
  const today = toDay(new Date());
  const described = describeDayRange(range, today);
  const choices = [{ label: 'Any time', range: ANY_TIME }, ...DAY_PRESETS.map((preset) => ({ label: preset.label, range: preset.range(today) }))];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9" aria-label={label ? undefined : `Dates: ${described}`}>
          <CalendarDays data-icon="inline-start" aria-hidden />
          {label ? (
            // The space keeps the accessible name "Added any time" rather than "Addedany time".
            <>
              <span className="font-normal">{label}</span> {midSentence(described)}
            </>
          ) : (
            described
          )}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto p-0">
        <div role="group" aria-label="Common spans" className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-border/70 p-2">
          {choices.map((choice) => {
            const chosen = sameRange(choice.range, range);
            return (
              <Button
                key={choice.label}
                variant="ghost"
                size="sm"
                aria-pressed={chosen}
                className={cn('justify-start font-normal', chosen && 'bg-accent font-medium')}
                onClick={() => {
                  onChange(choice.range);
                  setOpen(false);
                }}
              >
                {choice.label}
              </Button>
            );
          })}
        </div>
        {/* If the calendar's code can't be fetched (see importWithReload), the spans on the left still work. */}
        <ErrorBoundary fallback={() => <CalendarUnavailable />}>
          <Suspense
            fallback={
              <div role="status" aria-label="Loading the calendar" className={cn(CALENDAR_SIZE, 'grid place-items-center text-muted-foreground')}>
                <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
              </div>
            }
          >
            <DayRangeCalendar range={range} today={today} onChange={onChange} />
          </Suspense>
        </ErrorBoundary>
      </PopoverContent>
    </Popover>
  );
}

/** The calendar's footprint, which what stands in for it keeps, so the menu doesn't change size. */
const CALENDAR_SIZE = 'h-[19.5rem] w-[17.5rem]';

function CalendarUnavailable() {
  return (
    <p role="alert" className={cn(CALENDAR_SIZE, 'grid place-content-center p-6 text-center text-sm text-muted-foreground')}>
      The calendar couldn't load. Pick a span on the left, or reload the page to try again.
    </p>
  );
}
