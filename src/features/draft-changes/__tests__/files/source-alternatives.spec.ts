import {
  blob,
  blobIds,
  givenFileCandidate,
  preparedRow,
  readFile,
  requirePrepared,
  uploadedFile,
} from './support/file-candidate-scenario';

describe('candidate files: source alternatives', () => {
  it('matches the Head and Draft uploads independently for one stable file ID', async () => {
    const headBlob = blob('head-blob', 'a'.repeat(64));
    const draftBlob = blob('draft-blob', 'b'.repeat(64));
    const headFile = uploadedFile({ hash: headBlob.hash });
    const draftFile = uploadedFile({ hash: draftBlob.hash });
    const scenario = givenFileCandidate({
      head: { value: headFile, blobs: [headBlob] },
      draft: { value: draftFile, blobs: [draftBlob] },
    });
    scenario.setCandidateBlobIds('head', []);
    scenario.setCandidateBlobIds('draft', []);

    const prepared = requirePrepared(await scenario.prepare());

    expect(prepared.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'head',
          path: '/file',
          beforeBlobIds: [],
          afterBlobIds: ['head-blob'],
        }),
        expect.objectContaining({
          role: 'draft',
          path: '/file',
          beforeBlobIds: [],
          afterBlobIds: ['draft-blob'],
        }),
      ]),
    );
    expect(prepared.effects).toHaveLength(2);
    expect(blobIds(preparedRow(prepared.head, 'head'))).toEqual(['head-blob']);
    expect(blobIds(preparedRow(prepared.draft, 'draft'))).toEqual([
      'draft-blob',
    ]);
  });

  it('does not reject a valid Head restoration because another Draft source is unused', async () => {
    const headBlob = blob('head-blob', 'a'.repeat(64));
    const restored = uploadedFile({ hash: headBlob.hash });
    const scenario = givenFileCandidate({
      head: { value: restored, blobs: [headBlob] },
      draft: {
        value: uploadedFile({ hash: 'c'.repeat(64) }),
        blobs: [blob('unused-blob', 'c'.repeat(64))],
      },
    });
    scenario.setFile('draft', restored);
    scenario.setCandidateBlobIds('head', []);
    scenario.setCandidateBlobIds('draft', []);
    scenario.setSourceFile('draft', { ...restored, fileId: '' });

    const prepared = requirePrepared(await scenario.prepare());

    expect(blobIds(preparedRow(prepared.head, 'head'))).toEqual(['head-blob']);
    expect(blobIds(preparedRow(prepared.draft, 'draft'))).toEqual([
      'head-blob',
    ]);
    expect(readFile(preparedRow(prepared.head, 'head').data)).toEqual(restored);
    expect(readFile(preparedRow(prepared.draft, 'draft').data)).toEqual(
      restored,
    );
  });

  it('deduplicates repeated references to the same uploaded hash', async () => {
    const sharedBlob = blob('shared-blob', 'd'.repeat(64));
    const primary = uploadedFile({ hash: sharedBlob.hash });
    const secondary = uploadedFile({
      fileId: 'file-id-1111111111111',
      hash: sharedBlob.hash,
    });
    const scenario = givenFileCandidate({
      head: { value: primary, blobs: [sharedBlob] },
      draft: { value: primary, blobs: [sharedBlob] },
      additionalFiles: {
        thumbnail: {
          head: { value: secondary, blobs: [sharedBlob] },
          draft: { value: secondary, blobs: [sharedBlob] },
        },
      },
    });

    const prepared = requirePrepared(await scenario.prepare());

    expect(blobIds(preparedRow(prepared.head, 'head'))).toEqual([
      'shared-blob',
    ]);
    expect(blobIds(preparedRow(prepared.draft, 'draft'))).toEqual([
      'shared-blob',
    ]);
  });
});
