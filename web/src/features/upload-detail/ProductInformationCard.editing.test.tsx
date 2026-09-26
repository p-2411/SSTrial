import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditResultRequest, ExtractionConfidence, LabelExtraction, UploadDetail } from '@label-extractor/shared';
import { uploadKeys, useUploadDetail } from '@/api/queries';
import { detail } from '@/test/fixtures';
import { createTestQueryClient, jsonResponse, Providers, renderWithProviders } from '@/test/render';
import { ProductInformationCard } from './ProductInformationCard';

const RESULT: LabelExtraction = {
  productName: 'Maple Pecan Crunch',
  brand: 'Harvest & Hearth',
  ingredients: [
    { name: 'Rolled oats', percent: 48, subIngredients: [], allergens: ['oats'] },
    { name: 'Puffed rice', percent: null, subIngredients: ['rice', 'salt'], allergens: [] },
  ],
  allergens: ['oats'],
  netWeight: { value: 500, unit: 'g', text: 'Net Wt 500 g' },
};

const CONFIDENCE: ExtractionConfidence = {
  productName: { score: 97, reasons: [] },
  brand: { score: 95, reasons: [] },
  netWeight: { score: 58, reasons: ['Partly hidden by a fold.'] },
  allergens: { score: 90, reasons: [] },
  ingredients: { score: 92, reasons: [] },
};

type Upload = UploadDetail & { result: LabelExtraction };
const upload = (overrides: Partial<UploadDetail> = {}): Upload =>
  ({ ...detail({ id: 'u1', status: 'completed', fieldConfidence: CONFIDENCE, ...overrides }), result: RESULT }) as Upload;

/** What the server answers to PATCH …/result: by default, the upload with the changes applied. */
let answer: (request: EditResultRequest) => Response;
const sent: EditResultRequest[] = [];
/** The upload as the server has it now: what GET /api/uploads/u1 answers. */
let onServer: Upload;

const conflict = () => jsonResponse({ error: { code: 'EDIT_CONFLICT', message: 'Someone else just changed this upload.' } }, 409);

beforeEach(() => {
  sent.length = 0;
  onServer = upload();
  answer = (request) =>
    jsonResponse({ upload: upload({ result: { ...RESULT, ...request.changes } as LabelExtraction, revision: 1 } as Partial<UploadDetail>) });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const request = JSON.parse(String(init.body)) as EditResultRequest;
        sent.push(request);
        return answer(request);
      }
      if (url === '/api/uploads/u1') return jsonResponse({ upload: onServer });
      return jsonResponse({ uploads: [], nextCursor: null, counts: {} });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** The card as the app shows it: fed from the cached upload, so a refetch reaches it. */
function LiveCard() {
  const { data } = useUploadDetail('u1');
  return data?.result ? <ProductInformationCard upload={{ ...data, result: data.result }} /> : null;
}

function renderLiveCard() {
  const client = createTestQueryClient();
  client.setQueryData(uploadKeys.detail('u1'), onServer);
  renderWithProviders(<LiveCard />, { client });
}

function renderCard(value: Upload = upload()) {
  const { client, rerender } = renderWithProviders(<ProductInformationCard upload={value} />);
  // A live update arriving: the same card, with the upload as it is now on the server.
  const update = (next: Upload) =>
    rerender(
      <Providers client={client}>
        <ProductInformationCard upload={next} />
      </Providers>,
    );
  return Object.assign(screen.getByRole('region', { name: 'Product information' }), { update });
}

describe('editing extracted data', () => {
  it('edits a field in place and saves it against the revision it was made on', async () => {
    renderCard(upload({ revision: 3 }));

    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    const input = screen.getByRole('textbox', { name: 'Brand' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Hearth & Co');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent).toEqual([{ revision: 3, changes: { brand: 'Hearth & Co' } }]);
    expect(await screen.findByRole('button', { name: 'Edit brand' })).toBeInTheDocument(); // editor closed
  });

  it('saves an empty value as "not on the label"', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit product name' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Product name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent).toEqual([{ revision: 0, changes: { productName: null } }]);
  });

  it('cancels with Escape, sending nothing', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand' }), ' Ltd{Escape}');

    expect(screen.queryByRole('textbox', { name: 'Brand' })).not.toBeInTheDocument();
    expect(screen.getByText('Harvest & Hearth')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('keeps the editor open with the reason when a value is refused', async () => {
    answer = () => jsonResponse({ error: { code: 'INVALID_EDIT', message: "Brand isn't valid: too long." } }, 422);
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand' }), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Brand isn't valid: too long.")).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Brand' })).toBeInTheDocument();
  });

  it('edits the net weight as an amount and a unit', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit net weight' }));
    const amount = screen.getByRole('spinbutton', { name: 'Amount' });
    await userEvent.clear(amount);
    await userEvent.type(amount, '1.5');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Unit' }), 'kg');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent).toEqual([{ revision: 0, changes: { netWeight: { value: 1.5, unit: 'kg' } } }]);
  });

  it('removes and adds allergens', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit allergens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove oats' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Add allergen' }), 'Milk{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent).toEqual([{ revision: 0, changes: { allergens: ['milk'] } }]);
  });

  it('edits ingredients row by row, keeping what it can’t edit', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit ingredients' }));
    // Its columns are headed, so it's clear which input is which.
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    const firstName = screen.getByRole('textbox', { name: 'Ingredient 1' });
    await userEvent.clear(firstName);
    await userEvent.type(firstName, 'Oat flakes');
    await userEvent.click(screen.getByRole('button', { name: 'Add ingredient' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Ingredient 3' }), 'Sea salt');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Ingredient 3 percentage' }), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent[0]!.changes!.ingredients).toEqual([
      { name: 'Oat flakes', percent: 48, subIngredients: [], allergens: ['oats'] },
      { name: 'Puffed rice', percent: null, subIngredients: ['rice', 'salt'], allergens: [] },
      { name: 'Sea salt', percent: 1, subIngredients: [], allergens: [] },
    ]);
  });
});

describe('reviewing', () => {
  it('offers to mark a doubtful field as checked, and only that one', async () => {
    renderCard();
    const buttons = screen.getAllByRole('button', { name: /Mark .* as checked/ });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Mark net weight as checked']);

    await userEvent.click(buttons[0]!);
    expect(sent).toEqual([{ revision: 0, checked: ['netWeight'] }]);
  });

  it('shows who reviewed a field in place of its score', () => {
    const card = renderCard(
      upload({ fieldReviews: { netWeight: { kind: 'checked', by: 'alice@example.com', at: new Date().toISOString() } } }),
    );
    expect(within(card).getByText(/Checked by alice@example\.com/)).toBeInTheDocument();
    expect(within(card).queryByText('58%')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Mark net weight as checked' })).not.toBeInTheDocument();
  });

  it("shows someone else's change to the open field beside the draft, and saves over it only when told to", async () => {
    const card = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand' }), ' Mine');
    // Their save arrives through the live stream: a new revision, and a different brand.
    card.update({ ...upload({ revision: 1 }), result: { ...RESULT, brand: 'Theirs' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Someone else changed this: Theirs');
    expect(screen.getByRole('textbox', { name: 'Brand' })).toHaveValue('Harvest & Hearth Mine');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(sent).toEqual([{ revision: 1, changes: { brand: 'Harvest & Hearth Mine' } }]);
  });

  it('drops the draft for their value when told to', async () => {
    const card = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand' }), ' Mine');
    card.update({ ...upload({ revision: 1 }), result: { ...RESULT, brand: 'Theirs' } });
    await userEvent.click(screen.getByRole('button', { name: 'Use theirs' }));

    expect(screen.queryByRole('textbox', { name: 'Brand' })).not.toBeInTheDocument();
    expect(screen.getByText('Theirs')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('saves again on top of theirs when a save is refused over a change to another field', async () => {
    answer = (request) => {
      if (sent.length > 1) return jsonResponse({ upload: { ...onServer, revision: 2, result: { ...onServer.result, ...request.changes } } });
      // Someone renamed the product while this save was on its way.
      onServer = { ...upload({ revision: 1 }), result: { ...RESULT, productName: 'Renamed by someone else' } };
      return conflict();
    };
    renderLiveCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand' }), ' Mine');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Harvest & Hearth Mine')).toBeInTheDocument(); // saved, editor closed
    expect(screen.getByText('Renamed by someone else')).toBeInTheDocument();
    expect(sent).toEqual([
      { revision: 0, changes: { brand: 'Harvest & Hearth Mine' } },
      { revision: 1, changes: { brand: 'Harvest & Hearth Mine' } },
    ]);
  });

  it('keeps the draft, showing their value, when a save is refused over a change to the same field', async () => {
    answer = () => {
      onServer = { ...upload({ revision: 1 }), result: { ...RESULT, brand: 'Theirs' } };
      return conflict();
    };
    renderLiveCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand' }), ' Mine');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this: Theirs');
    expect(screen.getByRole('textbox', { name: 'Brand' })).toHaveValue('Harvest & Hearth Mine');
    expect(sent).toHaveLength(1); // not retried over their change

    answer = (request) => jsonResponse({ upload: { ...onServer, revision: 2, result: { ...onServer.result, ...request.changes } } });
    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(sent[1]).toEqual({ revision: 1, changes: { brand: 'Harvest & Hearth Mine' } });
    expect(await screen.findByText('Harvest & Hearth Mine')).toBeInTheDocument();
  });

  it("saves against the latest revision when someone else changed a different field", async () => {
    const card = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand' }), ' Mine');
    card.update({ ...upload({ revision: 1 }), result: { ...RESULT, productName: 'Renamed by someone else' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent).toEqual([{ revision: 1, changes: { brand: 'Harvest & Hearth Mine' } }]);
  });

  it('keeps an open editor, and its draft, when another field is marked as checked', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit brand' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand' }), ' Mine');
    await userEvent.click(screen.getByRole('button', { name: 'Mark net weight as checked' }));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(screen.getByRole('textbox', { name: 'Brand' })).toHaveValue('Harvest & Hearth Mine');
  });

  it('sends one check, however quickly it is clicked twice', async () => {
    // The first request is still on its way when the second click lands.
    let release: (response: Response) => void = () => {};
    answer = () => new Promise<Response>((resolve) => (release = resolve)) as unknown as Response;
    renderCard();
    const check = screen.getByRole('button', { name: 'Mark net weight as checked' });
    await userEvent.dblClick(check);

    expect(sent).toHaveLength(1);
    release(jsonResponse({ upload: upload({ revision: 1 }) }));
  });
});
