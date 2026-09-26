import { toast } from 'sonner';
import { countOf } from './format';

interface BatchWording {
  /** What was acted on, one of them: "product". */
  noun: string;
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
  if (done > 0) toast.success(`${countOf(done, wording.noun)} ${wording.done}`);
  const skipped = asked - done;
  if (skipped > 0) toast.warning(`${countOf(skipped, wording.noun)} ${wording.skipped}`, { description: wording.why });
}
