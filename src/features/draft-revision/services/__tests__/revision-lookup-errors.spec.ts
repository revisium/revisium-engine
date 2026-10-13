import {
  createRevisionLookupTestKit,
  serializationFailure,
} from './support/revision-lookup-test-kit';

describe('DraftRevision revision lookup errors', () => {
  let testKit: Awaited<ReturnType<typeof createRevisionLookupTestKit>>;

  beforeAll(async () => {
    testKit = await createRevisionLookupTestKit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await testKit.close();
  });

  it('preserves the original serialization failure', async () => {
    const failure = serializationFailure();
    const scenario = await testKit.givenReadFailure(failure);

    await expect(scenario.read()).rejects.toBe(failure);
  });

  it('lets the serializable transaction retry a failed revision read', async () => {
    const scenario = await testKit.givenReadFailure(serializationFailure());

    await expect(scenario.readSerializable()).resolves.toMatchObject({
      id: scenario.draftRevisionId,
    });
    expect(scenario.reads).toHaveBeenCalledTimes(2);
  });

  it('propagates an unrelated failure without retrying', async () => {
    const failure = new Error('Revision lookup unavailable');
    const scenario = await testKit.givenReadFailure(failure);

    await expect(scenario.readSerializable()).rejects.toBe(failure);
    expect(scenario.reads).toHaveBeenCalledTimes(1);
  });
});
