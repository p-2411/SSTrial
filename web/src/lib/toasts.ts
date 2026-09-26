import { toast } from 'sonner';
import { countOf } from './format';

interface BatchWording {
  /** What was acted on, one of them ("failed upload"), or nothing when the list already says: "3 deleted". */
  noun?: string;
  /** What happened to those it acted on, after the count: "deleted". */
  done: string;
  /** What happened to the rest: "not deleted". */
  skipped: string;
  /** Why the rest were skipped. */
  why: string;
}

/**
 * How an action on several products or uploads went, in a toast each way: how many it acted on, and how
 * many the server skipped, and why. Either is left out when there are none.
 */
export function toastBatchResult(done: number, asked: number, wording: BatchWording): void {
  const counted = (count: number) => (wording.noun ? countOf(count, wording.noun) : String(count));
  if (done > 0) toast.success(`${counted(done)} ${wording.done}`);
  const skipped = asked - done;
  if (skipped > 0) toast.warning(`${counted(skipped)} ${wording.skipped}`, { description: wording.why });
}
