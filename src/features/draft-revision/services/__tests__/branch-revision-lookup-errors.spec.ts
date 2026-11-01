import { BadRequestException } from '@nestjs/common';
import {
  createRevisionLookupTestKit,
  draftRevisionLookup,
  headRevisionLookup,
  serializationFailure,
} from './support/revision-lookup-test-kit';

describe.each([headRevisionLookup, draftRevisionLookup])(
  'DraftRevision $name lookup errors',
  (lookup) => {
    it('refuses a missing record with its not-found 400', async () => {
      const scenario = await testKit.givenBranchLookup(lookup);
      await scenario.loseRecord();

      const refusal = scenario.find();

      await expect(refusal).rejects.toThrow(BadRequestException);
      await expect(refusal).rejects.toThrow(lookup.notFoundMessage);
    });

    it('keeps a serialization failure as it is, so the transaction can retry it', async () => {
      const failure = serializationFailure();
      const scenario = await testKit.givenBranchLookup(lookup);
      scenario.failOnceWith(failure);

      await expect(scenario.find()).rejects.toBe(failure);
    });

    it('keeps an unrelated failure as it is', async () => {
      const failure = new Error('Revision lookup unavailable');
      const scenario = await testKit.givenBranchLookup(lookup);
      scenario.failOnceWith(failure);

      await expect(scenario.find()).rejects.toBe(failure);
    });

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
  },
);
