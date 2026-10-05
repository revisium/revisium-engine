import {
  givenFileCandidate,
  proveAddedFileSlot,
  readyFile,
  requireBlocked,
} from './support/file-candidate-scenario';

describe('candidate files: initialization context', () => {
  it('blocks an uninitialized file slot when no successful schema projection proves its source', async () => {
    const uninitialized = readyFile({ fileId: '' });
    const scenario = givenFileCandidate({
      head: { value: uninitialized },
      draft: { value: uninitialized },
    });

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'UNINITIALIZED_FILE_VALUE',
        role: 'head',
        path: '/file',
      }),
    );
  });

  it('rejects a malformed source ID when initializing an added file slot', async () => {
    const source = readyFile();
    const scenario = givenFileCandidate({
      head: { value: source },
      draft: { value: source },
    });
    scenario.setFile('head', readyFile({ fileId: '' }));
    scenario.setFile('draft', readyFile({ fileId: '' }));
    scenario.setSourceFile('draft', { ...source, fileId: 'malformed' });
    proveAddedFileSlot(scenario);

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FILE_VALUE',
        role: 'draft',
        path: '/file',
      }),
    );
  });
});
