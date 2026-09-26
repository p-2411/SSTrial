import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LabelExtraction, LabelField, ResultChanges, UploadDetail } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { fetchUpload, isEditConflict, refreshUpload, useEditResult } from '@/api/queries';
import { formatQuantity } from '@/lib/quantity';
import type { EditConflict, EditorFormState } from './FieldEditors';

interface OpenEditor {
  field: LabelField;
  /** The field's value (as JSON) the draft is based on: when it was opened, or when the person chose to keep theirs. */
  baseline: string;
  /**
   * From Save until the save has gone through or been given up on. Kept here rather than read from
   * the mutation, which is idle while a refused save is looked into and retried.
   */
  saving: boolean;
}

/**
 * Editing one field at a time, and confirming fields as right.
 *
 * Nobody's change is silently lost, and neither is the person's draft. The editor remembers the
 * value its draft is based on. If someone else changes that field meanwhile (arriving live, or
 * found when a save is refused), the editor says so beside the draft and Save waits: "Keep mine"
 * makes the draft the one to save, "Use theirs" drops it.
 *
 * The server refuses a save made against an older revision of the upload (409, EDIT_CONFLICT),
 * whichever field changed, so a refusal fetches the upload again: when this field is still as the
 * draft started, someone changed another one, and the save is retried once on top of theirs.
 */
export function useFieldReview(upload: UploadDetail & { result: LabelExtraction }) {
  const queryClient = useQueryClient();
  // One mutation each, so their states never mix: a check in flight is no reason to hold up Save.
  const saveEdit = useEditResult(upload.id);
  const markChecked = useEditResult(upload.id);
  const [editor, setEditor] = useState<OpenEditor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checking = useRef(false); // a double click mustn't send two checks (state would lag a render)
  const [checkingField, setCheckingField] = useState<LabelField | null>(null);

  /** Updates the open editor, if it's still this field's; null closes it. */
  const updateEditor = (field: LabelField, changes: Partial<OpenEditor> | null) =>
    setEditor((open) => (open?.field !== field ? open : changes && { ...open, ...changes }));

  // Their change is only news once any save of ours has settled: until then, a changed value may
  // well be the one we just saved.
  const theyChanged = editor && !editor.saving && valueOf(upload, editor.field) !== editor.baseline ? editor.field : null;
  const conflict: EditConflict | null = theyChanged && {
    theirs: describeValue(upload.result, theyChanged),
    onKeepMine: () => updateEditor(theyChanged, { baseline: valueOf(upload, theyChanged) }),
    onUseTheirs: () => updateEditor(theyChanged, null),
  };

  const save = async ({ field, baseline }: OpenEditor, changes: ResultChanges) => {
    const stop = (message: string | null) => {
      updateEditor(field, { saving: false });
      setError(message);
    };
    setError(null);
    updateEditor(field, { saving: true });
    let revision = upload.revision;
    for (let attempt = 1; ; attempt++) {
      try {
        await saveEdit.mutateAsync({ revision, changes });
        updateEditor(field, null);
        return;
      } catch (failure) {
        if (!isEditConflict(failure)) return stop(errorMessage(failure));
        const latest = await fetchUpload(queryClient, upload.id).catch(() => null);
        if (!latest) return stop(errorMessage(failure));
        // They changed this field: its new value now shows beside the draft (see `conflict`).
        if (valueOf(latest, field) !== baseline) return stop(null);
        // Still losing races on other fields: let the person try again when they're ready.
        if (attempt > 1) return stop(errorMessage(failure));
        revision = latest.revision;
      }
    }
  };

  const check = async (field: LabelField) => {
    if (checking.current) return;
    checking.current = true;
    setCheckingField(field);
    try {
      await markChecked.mutateAsync({ revision: upload.revision, checked: [field] });
    } catch (failure) {
      const refused = isEditConflict(failure);
      if (refused) await refreshUpload(queryClient, upload.id); // so their version shows
      toast.error(refused ? 'Someone else just changed this upload' : "Couldn't mark it as checked", {
        description: refused ? 'Showing their version. Check it again if it still applies.' : errorMessage(failure),
      });
    } finally {
      checking.current = false;
      setCheckingField(null);
    }
  };

  const editorProps: EditorFormState & { onSave: (changes: ResultChanges) => void } = {
    onSave: (changes) => {
      if (editor && !editor.saving && !conflict) void save(editor, changes);
    },
    onCancel: () => setEditor(null),
    saving: editor?.saving ?? false,
    error,
    conflict,
  };

  return {
    /** The field whose editor is open, if any. */
    editing: editor?.field ?? null,
    edit: (field: LabelField) => {
      setError(null);
      setEditor({ field, baseline: valueOf(upload, field), saving: false });
    },
    check: (field: LabelField) => void check(field),
    /** The field being marked as checked right now, if any. */
    checking: checkingField,
    /** For the open field's editor (see FieldEditors). */
    editorProps,
  };
}

/** A field's value as the server has it, in a form that compares by value. */
function valueOf(upload: UploadDetail, field: LabelField): string {
  return JSON.stringify(upload.result?.[field] ?? null);
}

/** A field's value in a few words, for telling the person what someone else changed it to. */
function describeValue(result: LabelExtraction, field: LabelField): string {
  switch (field) {
    case 'productName':
    case 'brand':
      return result[field] ?? 'none';
    case 'netWeight':
      return result.netWeight ? formatQuantity(result.netWeight) : 'none';
    case 'allergens':
      return result.allergens.join(', ') || 'none';
    case 'ingredients':
      return result.ingredients.map((ingredient) => ingredient.name).join(', ') || 'none';
  }
}
