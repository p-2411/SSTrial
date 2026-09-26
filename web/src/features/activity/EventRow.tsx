import type { ReactNode } from 'react';
import type { LogEvent } from '@label-extractor/shared';
import type { EventDetailsSource } from '@/api/logs';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { formatDateTimeWithSeconds } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EventDetails, EventDetailsTrigger } from './EventDetails';

interface EventRowProps {
  event: Pick<LogEvent, 'id' | 'occurredAt' | 'hasDetails'>;
  /** Where its details are fetched from: the activity log, or an upload's history. */
  source: EventDetailsSource;
  /** When it happened, as this list puts it (the time of day under a day's heading, or date and time). */
  time: string;
  /** The row's grid: its columns, spacing and padding. */
  className: string;
  timeClassName: string;
  /** Where the details go in the grid once opened: under the message. */
  detailsClassName: string;
  /** What happened: the message, and anything with it (the log's level badge). */
  children: ReactNode;
  /** Actions before Details, such as View upload or Revert, each in a column of its own. */
  actions?: ReactNode[];
}

/**
 * One event in a list, as the activity log and each upload's history both show it: when it
 * happened (to the second, on hover), what happened, then, always in view on its right however
 * long the message runs, its actions and Details. Every row has a cell for each action, empty or
 * not, so they line up down the list. Details (what a change did to the data, or the event's
 * facts) are fetched only when opened, and open under the message.
 */
export function EventRow({ event, source, time, className, timeClassName, detailsClassName, children, actions = [] }: EventRowProps) {
  return (
    <Collapsible className={cn('group/event grid items-baseline', className)}>
      <time dateTime={event.occurredAt} title={formatDateTimeWithSeconds(event.occurredAt)} className={cn('text-muted-foreground tabular-nums', timeClassName)}>
        {time}
      </time>
      {children}
      {actions.map((action, index) => (
        <span key={index} className="justify-self-end">
          {action}
        </span>
      ))}
      <span className="justify-self-end">{event.hasDetails && <EventDetailsTrigger />}</span>
      <CollapsibleContent className={cn('min-w-0', detailsClassName)}>
        <EventDetails source={source} eventId={event.id} />
      </CollapsibleContent>
    </Collapsible>
  );
}
