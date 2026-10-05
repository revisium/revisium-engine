import {
  blob,
  givenFileCandidate,
  preparedRow,
  readFile,
  requirePrepared,
  uploadedFile,
} from './support/file-candidate-scenario';

describe('candidate files: preservation and detachment', () => {
  it('preserves allowed filename and URL edits with unrelated row values', async () => {
    const sourceBlob = blob('source-blob', 'e'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const scenario = givenFileCandidate({
      head: { value: source, blobs: [sourceBlob] },
      draft: { value: source, blobs: [sourceBlob] },
      headCaption: 'Head caption',
      draftCaption: 'Draft caption',
      headMeta: { label: 'Head', nested: { value: 'head-meta' } },
      draftMeta: { label: 'Draft', nested: { value: 'draft-meta' } },
    });
    scenario.setFile('draft', {
      ...source,
      fileName: 'renamed.png',
      url: 'https://example.com/display/renamed.png',
    });

    const prepared = requirePrepared(await scenario.prepare());
    const draftRow = preparedRow(prepared.draft, 'draft');

    expect(draftRow.data).toMatchObject({ caption: 'Draft caption' });
    expect(draftRow.meta).toEqual({
      label: 'Draft',
      nested: { value: 'draft-meta' },
    });
    expect(draftRow.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(readFile(draftRow.data)).toMatchObject({
      fileName: 'renamed.png',
      url: 'https://example.com/display/renamed.png',
      hash: source.hash,
    });
  });

  it('returns deeply detached states without mutating snapshot sources', async () => {
    const sourceBlob = blob('source-blob', 'f'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const scenario = givenFileCandidate({
      head: { value: source, blobs: [sourceBlob] },
      draft: { value: source, blobs: [sourceBlob] },
    });
    const originalInput = structuredClone(scenario.input);

    const prepared = requirePrepared(await scenario.prepare());
    scenario.setCaption(preparedRow(prepared.draft, 'draft'), 'edited output');

    expect(prepared.draft).not.toBe(scenario.input.draft);
    expect(scenario.input).toEqual(originalInput);
    expect(scenario.sourceRow('draft').fileBlobs.map(({ id }) => id)).toEqual([
      'source-blob',
    ]);
  });

  it('rebuilds blob associations from the snapshot instead of trusting candidate links', async () => {
    const sourceBlob = blob('source-blob', '1'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const scenario = givenFileCandidate({
      head: { value: source, blobs: [sourceBlob] },
      draft: { value: source, blobs: [sourceBlob] },
    });
    scenario.setCandidateBlobIds('draft', ['forged-blob']);

    const prepared = requirePrepared(await scenario.prepare());

    expect(preparedRow(prepared.draft, 'draft').fileBlobs).toEqual([
      { id: 'source-blob' },
    ]);
  });
});
