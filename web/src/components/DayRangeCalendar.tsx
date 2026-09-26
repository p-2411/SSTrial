import { useState } from 'react';
import { DayPicker, type ChevronProps, type DayButtonProps } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { startOfDay, toDay, type DayRange } from '@/lib/dayRange';
import { cn } from '@/lib/utils';

interface DayRangeCalendarProps {
  range: DayRange;
  /** The viewer's today: nothing after it can be picked. */
  today: string;
  onChange: (range: DayRange) => void;
}

/**
 * Picking a range of days: the first click is its first day (and, until a second, its only one),
 * the second its last, whichever order they're in. A third starts a new range. Each click applies
 * at once, so the list follows along. Split out of DayRangeMenu so it loads only when opened.
 */
export default function DayRangeCalendar({ range, today, onChange }: DayRangeCalendarProps) {
  // The first day picked, waiting for the last.
  const [anchor, setAnchor] = useState<string | null>(null);
  const selected = range.from || range.to ? { from: toDate(range.from), to: toDate(range.to) } : undefined;

  const pick = (clicked: Date) => {
    const day = toDay(clicked);
    if (anchor === null) {
      setAnchor(day);
      onChange({ from: day, to: day });
    } else {
      setAnchor(null);
      // YYYY-MM-DD strings sort as the days do.
      onChange(day < anchor ? { from: day, to: anchor } : { from: anchor, to: day });
    }
  };

  return (
    <div className="p-3">
      <DayPicker
        mode="range"
        selected={selected}
        onSelect={(_range, clicked) => pick(clicked)}
        defaultMonth={selected?.to ?? selected?.from ?? startOfDay(today)}
        endMonth={startOfDay(today)}
        disabled={{ after: startOfDay(today) }}
        weekStartsOn={1}
        showOutsideDays
        components={{ Chevron, DayButton }}
        classNames={{
          root: 'relative',
          months: 'flex',
          month: 'grid gap-2',
          month_caption: 'flex h-8 items-center justify-center',
          caption_label: 'text-sm font-medium',
          nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
          button_previous: NAV_BUTTON,
          button_next: NAV_BUTTON,
          month_grid: 'border-collapse',
          weekday: 'size-9 text-xs font-normal text-muted-foreground',
          day: 'p-0 text-center',
          // The band joining a range's days, rounded at its ends.
          range_start: 'rounded-l-md bg-accent',
          range_middle: 'bg-accent',
          range_end: 'rounded-r-md bg-accent',
          outside: 'text-muted-foreground/60',
        }}
      />
    </div>
  );
}

const NAV_BUTTON =
  'grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-40';

function toDate(day: string | null): Date | undefined {
  return day ? startOfDay(day) : undefined;
}

function Chevron({ orientation, className }: ChevronProps) {
  const Icon = orientation === 'left' ? ChevronLeft : ChevronRight;
  return <Icon className={cn('size-4', className)} aria-hidden />;
}

/** A day: its ends of a range solid, the days between on the band, today underlined. */
function DayButton({ day: _day, modifiers, className, ...props }: DayButtonProps) {
  const end = modifiers.range_start || modifiers.range_end;
  return (
    <button
      {...props}
      className={cn(
        'grid size-9 place-items-center rounded-md text-sm tabular-nums outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35',
        modifiers.today && 'font-semibold underline underline-offset-4',
        end && 'bg-primary text-primary-foreground hover:bg-primary/90',
        className,
      )}
    />
  );
}
