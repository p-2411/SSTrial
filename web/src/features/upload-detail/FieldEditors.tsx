import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import {
  FIELD_LABELS,
  NET_QUANTITY_UNITS,
  type Ingredient,
  type NetQuantity,
  type NetQuantityUnit,
  type ResultChanges,
} from '@label-extractor/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';
import {
  addAllergen,
  allergensChanges,
  ingredientDrafts,
  ingredientsChanges,
  netWeightChanges,
  textChanges,
  type IngredientDraft,
} from './fieldChanges';

/**
 * In-place editors for extracted fields. Each keeps the person's draft and turns it into a change
 * for PATCH …/result (see fieldChanges.ts); the server validates the whole result, the same way it
 * validates model output.
 */

/** Someone else saved a different value for the field while it was open here. */
export interface EditConflict {
  /** Their value, as text. */
  theirs: string;
  /** Carry on with this draft: saving it replaces their value. */
  onKeepMine: () => void;
  /** Drop this draft for their value. */
  onUseTheirs: () => void;
}

/** How saving is going, for the form around an editor. */
export interface EditorFormState {
  onCancel: () => void;
  saving: boolean;
  /** Why the last save was refused, to show under the editor. */
  error: string | null;
  conflict: EditConflict | null;
}

interface EditorProps<T> extends EditorFormState {
  value: T;
  onSave: (changes: ResultChanges) => void;
}

/**
 * Save and Cancel, Escape to cancel, and the reason if a save was refused. While someone else's
 * change is waiting to be seen, Save waits for the person to choose between theirs and their own.
 */
function EditorForm({
  onSubmit,
  onCancel,
  saving,
  error,
  conflict,
  children,
}: EditorFormState & { onSubmit: () => void; children: ReactNode }) {
  const canSave = !saving && !conflict;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSave) onSubmit();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation(); // don't also close the detail panel
      onCancel();
    }
  };
  return (
    <form className="grid grid-cols-1 gap-2" onSubmit={submit} onKeyDown={escape}>
      {children}
      {conflict && (
        <div role="alert" className={cn('grid grid-cols-1 gap-1.5 rounded-md border px-2.5 py-2 text-xs', TONE_CLASSES.warning)}>
          <p>
            Someone else changed this: <span className="font-semibold">{conflict.theirs}</span>
          </p>
          <div className="flex gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={conflict.onKeepMine}>
              Keep mine
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={conflict.onUseTheirs}>
              Use theirs
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <Button type="submit" size="xs" loading={saving} disabled={Boolean(conflict)}>
          Save
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Product name or brand. Emptied means the label doesn't show one. */
export function TextEditor({
  field,
  value,
  onSave,
  ...form
}: EditorProps<string | null> & { field: 'productName' | 'brand' }) {
  const [text, setText] = useState(value ?? '');
  return (
    <EditorForm {...form} onSubmit={() => onSave(textChanges(field, text))}>
      <Input aria-label={FIELD_LABELS[field]} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
      <p className="text-xs text-muted-foreground">Leave it empty if the label doesn't show one.</p>
    </EditorForm>
  );
}

/** Amount and unit. The pack's printed wording is kept as it was. Emptied means none on the label. */
export function NetWeightEditor({ value, onSave, ...form }: EditorProps<NetQuantity | null>) {
  const [amount, setAmount] = useState(value ? String(value.value) : '');
  const [unit, setUnit] = useState<NetQuantityUnit>(value?.unit ?? 'g');
  return (
    <EditorForm {...form} onSubmit={() => onSave(netWeightChanges(amount, unit))}>
      <div className="flex gap-1.5">
        <Input
          aria-label="Amount"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          className="w-28"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          autoFocus
        />
        <select
          aria-label="Unit"
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={unit}
          onChange={(event) => setUnit(event.target.value as NetQuantityUnit)}
        >
          {NET_QUANTITY_UNITS.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">Leave the amount empty if the label doesn't show one.</p>
    </EditorForm>
  );
}

/** Allergens as chips: remove one with its ×, add one by typing it and pressing Enter. */
export function AllergensEditor({ value, onSave, ...form }: EditorProps<string[]>) {
  const [allergens, setAllergens] = useState(value);
  const [draft, setDraft] = useState('');
  const addOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault(); // Enter adds the allergen; it doesn't save the form
    setAllergens(addAllergen(allergens, draft));
    setDraft('');
  };
  return (
    <EditorForm {...form} onSubmit={() => onSave(allergensChanges(allergens, draft))}>
      {allergens.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {allergens.map((allergen) => (
            <li key={allergen} className="flex items-center gap-0.5 rounded-full border py-0.5 pr-1 pl-2.5 text-sm capitalize">
              {allergen}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-5 rounded-full"
                aria-label={`Remove ${allergen}`}
                onClick={() => setAllergens(allergens.filter((a) => a !== allergen))}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Input
        aria-label="Add allergen"
        placeholder="Add an allergen, then press Enter"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={addOnEnter}
        autoFocus
      />
    </EditorForm>
  );
}

/** A draft row, keyed so React keeps each row's inputs as rows are added and removed. */
interface Row extends IngredientDraft {
  key: number;
}

/** The ingredients editor's columns: position, title, percentage, remove. */
const INGREDIENT_COLUMNS = 'grid grid-cols-[1.75rem_minmax(0,1fr)_5rem_auto] gap-1.5';

/**
 * Ingredients as editable rows: name and percentage, remove, add. Sub-ingredients and allergen
 * links stay as extracted (new rows have none), so they're carried through untouched.
 */
export function IngredientsEditor({ value, onSave, ...form }: EditorProps<Ingredient[]>) {
  const [rows, setRows] = useState<Row[]>(() => ingredientDrafts(value).map((draft, key) => ({ ...draft, key })));
  const [nextKey, setNextKey] = useState(value.length);
  const update = (key: number, change: (row: Row) => Row) => setRows(rows.map((row) => (row.key === key ? change(row) : row)));
  const add = () => {
    setRows([...rows, { key: nextKey, ingredient: { name: '', percent: null, subIngredients: [], allergens: [] }, percent: '' }]);
    setNextKey(nextKey + 1);
  };

  return (
    <EditorForm {...form} onSubmit={() => onSave(ingredientsChanges(rows))}>
      {/* Column headings, for sight: each input already has its own accessible name. The empty
          last column is the remove buttons'. */}
      <div aria-hidden className={cn(INGREDIENT_COLUMNS, 'text-xs font-medium text-muted-foreground')}>
        <span />
        <span>Title</span>
        <span>%</span>
        <span className="w-6" />
      </div>
      <ol className="grid grid-cols-1 gap-1.5">
        {rows.map((row, index) => (
          <li key={row.key} className={cn(INGREDIENT_COLUMNS, 'items-center text-sm')}>
            <span aria-hidden className="text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <Input
              aria-label={`Ingredient ${index + 1}`}
              value={row.ingredient.name}
              onChange={(event) => update(row.key, (r) => ({ ...r, ingredient: { ...r.ingredient, name: event.target.value } }))}
              autoFocus={index === rows.length - 1 && row.ingredient.name === ''}
            />
            <Input
              aria-label={`Ingredient ${index + 1} percentage`}
              type="number"
              step="any"
              min="0"
              max="100"
              placeholder="%"
              value={row.percent}
              onChange={(event) => update(row.key, (r) => ({ ...r, percent: event.target.value }))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${row.ingredient.name || `ingredient ${index + 1}`}`}
              onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
            >
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      {/* Room above and below, so it reads as part of neither the list nor Save and Cancel. */}
      <Button type="button" variant="outline" size="xs" className="my-2 justify-self-start" onClick={add}>
        <Plus data-icon="inline-start" aria-hidden />
        Add ingredient
      </Button>
    </EditorForm>
  );
}
