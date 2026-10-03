import type { ChangesTestKit } from './test-kit';
import { loadChangesProvider } from './test-kit';

interface WriterBoundary {
  applyState(...args: unknown[]): Promise<unknown>;
}

interface ExecutionBoundary {
  execute(
    input: unknown,
    apply: () => Promise<{ status: string }>,
  ): Promise<unknown>;
}

const injectedFailure = 'Draft Changes acceptance test: injected write failure';

export async function withFailureAfterWrite(
  kit: ChangesTestKit,
  action: () => Promise<unknown>,
) {
  const token = await loadChangesProvider<WriterBoundary>(
    'draft-changes-writer.service',
    'DraftChangesWriterService',
  );
  const writer = kit.module.get(token);
  const original = writer.applyState.bind(writer);
  const hook = jest
    .spyOn(writer, 'applyState')
    .mockImplementation(async (...args) => {
      await original(...args);
      throw new Error(injectedFailure);
    });
  try {
    await expect(action()).rejects.toThrow(injectedFailure);
  } finally {
    hook.mockRestore();
  }
}

export async function withFailureBeforeReceipt(
  kit: ChangesTestKit,
  action: () => Promise<unknown>,
) {
  const token = await loadChangesProvider<ExecutionBoundary>(
    'draft-changes-execution.service',
    'DraftChangesExecutionService',
  );
  const execution = kit.module.get(token);
  const original = execution.execute.bind(execution);
  const hook = jest
    .spyOn(execution, 'execute')
    .mockImplementation((input, apply) =>
      original(input, async () => {
        await apply();
        throw new Error(injectedFailure);
      }),
    );
  try {
    await expect(action()).rejects.toThrow(injectedFailure);
  } finally {
    hook.mockRestore();
  }
}
