import objectHash from 'object-hash';
import { createExpressFile } from 'src/__tests__/utils/file';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  BenchBranch,
  loadBranch,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import { startBuilding } from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import {
  createdProductId,
  FkFilesShape,
  ORDERS,
  orderId,
  orderSchema,
  PRODUCTS,
  productId,
  productSchema,
} from 'src/features/partial-changes-poc/__bench__/support/fk-files-dataset';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

type Role = 'head' | 'draft';

interface StoredVersion {
  versionId: string;
  createdId: string;
  readonly: boolean;
  data: Record<string, unknown>;
  meta: unknown;
  hash: string;
  schemaHash: string;
  createdAt: Date;
  publishedAt: Date;
  fileHashes: string[];
}

interface Sample {
  label: string;
  tableId: string;
  role: Role;
  generated: string;
  native: string;
}

export interface FkFilesVerification {
  comparisons: Array<{ label: string; mismatches: string[] }>;
  rowsSummary: unknown;
  expectedRowsSummary: Record<string, number>;
  matches: boolean;
}

const CONTROL_ROWS = 3;

export async function verifyFkFilesDataset(
  kit: PartialChangesTestKit,
  dataset: BenchBranch,
  shape: FkFilesShape,
): Promise<FkFilesVerification> {
  const control = await buildNativeControl(kit);
  const comparisons: FkFilesVerification['comparisons'] = [];

  for (const sample of samplesOf(shape)) {
    const generated = await storedVersion(
      kit,
      dataset,
      sample,
      sample.generated,
    );
    const native = await storedVersion(kit, control, sample, sample.native);
    comparisons.push({
      label: sample.label,
      mismatches: compareVersions(generated, native),
    });
  }
  comparisons.push({
    label: 'lineage of a photo edit',
    mismatches: await compareLineage(kit, dataset, control, [
      productId(shape.deleted),
      productId(1),
    ]),
  });

  const summary = await kit.revisionChanges.revisionChanges({
    revisionId: dataset.draftRevisionId,
  });
  const expectedRowsSummary = {
    added: shape.created,
    removed: shape.deleted,
    modified: shape.photoEdits + shape.repointed + shape.noteEdits,
  };
  const rows = summary.rowsSummary as unknown as Record<string, number>;
  return {
    comparisons: comparisons.filter(({ mismatches }) => mismatches.length > 0),
    rowsSummary: summary.rowsSummary,
    expectedRowsSummary,
    matches:
      comparisons.every(({ mismatches }) => mismatches.length === 0) &&
      Object.entries(expectedRowsSummary).every(
        ([key, value]) => rows[key] === value,
      ),
  };
}

function samplesOf(shape: FkFilesShape): Sample[] {
  return [
    {
      label: 'head product',
      tableId: PRODUCTS,
      role: 'head',
      generated: productId(shape.deleted),
      native: productId(1),
    },
    {
      label: 'photo-edited draft product',
      tableId: PRODUCTS,
      role: 'draft',
      generated: productId(shape.deleted),
      native: productId(1),
    },
    {
      label: 'created draft product',
      tableId: PRODUCTS,
      role: 'draft',
      generated: createdProductId(0),
      native: createdProductId(0),
    },
    {
      label: 'head order',
      tableId: ORDERS,
      role: 'head',
      generated: orderId(0),
      native: orderId(0),
    },
    {
      label: 'repointed draft order',
      tableId: ORDERS,
      role: 'draft',
      generated: orderId(0),
      native: orderId(0),
    },
    {
      label: 'note-edited draft order',
      tableId: ORDERS,
      role: 'draft',
      generated: orderId(shape.repointed),
      native: orderId(1),
    },
  ];
}

async function buildNativeControl(
  kit: PartialChangesTestKit,
): Promise<BenchBranch> {
  const building = await startBuilding(kit, 'fkfiles-control');
  const revisionId = building.draftRevisionId;
  await kit.draftApi.apiCreateTable({
    revisionId,
    tableId: PRODUCTS,
    schema: productSchema as InputJsonValue,
  });
  await kit.draftApi.apiCreateTable({
    revisionId,
    tableId: ORDERS,
    schema: orderSchema as InputJsonValue,
  });
  for (let index = 0; index < CONTROL_ROWS; index++) {
    await createProduct(kit, revisionId, productId(index), index);
    await kit.draftApi.apiCreateRows({
      revisionId,
      tableId: ORDERS,
      rows: [
        {
          rowId: orderId(index),
          data: { product: productId(index), note: '', qty: index + 1 },
        },
      ],
    });
  }
  await kit.draftApi.apiCreateRevision(building);

  const committed = await loadBranch(kit.prisma, building.branchId);
  const draft = committed.draftRevisionId;
  await createProduct(kit, draft, createdProductId(0), 0);
  await kit.draftApi.apiPatchRow({
    revisionId: draft,
    tableId: ORDERS,
    rowId: orderId(0),
    patches: [{ op: 'replace', path: 'product', value: createdProductId(0) }],
  });
  await kit.draftApi.apiRemoveRow({
    revisionId: draft,
    tableId: PRODUCTS,
    rowId: productId(0),
  });
  await uploadPhoto(kit, draft, productId(1));
  await kit.draftApi.apiPatchRow({
    revisionId: draft,
    tableId: PRODUCTS,
    rowId: productId(1),
    patches: [{ op: 'replace', path: 'price', value: 2 }],
  });
  await kit.draftApi.apiPatchRow({
    revisionId: draft,
    tableId: ORDERS,
    rowId: orderId(1),
    patches: [{ op: 'replace', path: 'note', value: 'edited' }],
  });
  return committed;
}

async function createProduct(
  kit: PartialChangesTestKit,
  revisionId: string,
  rowId: string,
  index: number,
): Promise<void> {
  await kit.draftApi.apiCreateRows({
    revisionId,
    tableId: PRODUCTS,
    rows: [
      {
        rowId,
        data: {
          title: `product ${index}`,
          price: 1,
          qty: 1,
          total: 0,
          photo: {
            status: '',
            fileId: '',
            url: '',
            fileName: '',
            hash: '',
            extension: '',
            mimeType: '',
            size: 0,
            width: 0,
            height: 0,
          },
        },
      },
    ],
  });
  await uploadPhoto(kit, revisionId, rowId);
}

async function uploadPhoto(
  kit: PartialChangesTestKit,
  revisionId: string,
  rowId: string,
): Promise<void> {
  const row = await kit.rowApi.getRow({
    revisionId,
    tableId: PRODUCTS,
    rowId,
  });
  const photo = (row?.data as Record<string, { fileId: string }>).photo;
  await kit.draftApi.apiUploadFile({
    revisionId,
    tableId: PRODUCTS,
    rowId,
    fileId: photo?.fileId ?? '',
    file: {
      ...createExpressFile(),
      buffer: Buffer.from(`${rowId}-${Date.now()}`),
    },
  });
}

async function storedVersion(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  sample: Sample,
  rowId: string,
): Promise<StoredVersion> {
  const revisionId =
    sample.role === 'head' ? branch.headRevisionId : branch.draftRevisionId;
  const stored = await kit.prisma.row.findFirstOrThrow({
    where: {
      id: rowId,
      tables: {
        some: { id: sample.tableId, revisions: { some: { id: revisionId } } },
      },
    },
    include: { fileBlobs: { where: { deletedAt: null } } },
  });
  return {
    ...stored,
    data: stored.data as Record<string, unknown>,
    fileHashes: stored.fileBlobs.map((blob) => blob.hash).sort(),
  };
}

function compareVersions(
  generated: StoredVersion,
  native: StoredVersion,
): string[] {
  const mismatches: string[] = [];
  for (const field of ['readonly', 'schemaHash'] as const) {
    if (generated[field] !== native[field]) {
      mismatches.push(field);
    }
  }
  if (JSON.stringify(generated.meta) !== JSON.stringify(native.meta)) {
    mismatches.push('meta');
  }
  if (statusOf(generated.data) !== statusOf(native.data)) {
    mismatches.push(
      `photo status ${statusOf(generated.data)} vs ${statusOf(native.data)}`,
    );
  }
  if (shapeOf(generated.data) !== shapeOf(native.data)) {
    mismatches.push(
      `data shape ${shapeOf(generated.data)} vs ${shapeOf(native.data)}`,
    );
  }
  for (const [name, version] of [
    ['generated', generated],
    ['native', native],
  ] as const) {
    if (version.hash !== objectHash(version.data)) {
      mismatches.push(`${name} hash != objectHash(data)`);
    }
    const photo = version.data.photo as { hash?: string } | undefined;
    const expectedBlobs = photo?.hash ? [photo.hash] : [];
    if (JSON.stringify(version.fileHashes) !== JSON.stringify(expectedBlobs)) {
      mismatches.push(
        `${name} blob links ${JSON.stringify(version.fileHashes)}`,
      );
    }
  }
  return mismatches;
}

async function compareLineage(
  kit: PartialChangesTestKit,
  dataset: BenchBranch,
  control: BenchBranch,
  [generatedId, nativeId]: [string, string],
): Promise<string[]> {
  const lineage = async (branch: BenchBranch, rowId: string) => {
    const sample = { label: '', tableId: PRODUCTS, generated: '', native: '' };
    const head = await storedVersion(
      kit,
      branch,
      { ...sample, role: 'head' },
      rowId,
    );
    const draft = await storedVersion(
      kit,
      branch,
      { ...sample, role: 'draft' },
      rowId,
    );
    return {
      sameVersion: head.versionId === draft.versionId,
      sameCreatedId: head.createdId === draft.createdId,
      sameCreatedAt: head.createdAt.getTime() === draft.createdAt.getTime(),
      samePublishedAt:
        head.publishedAt.getTime() === draft.publishedAt.getTime(),
    };
  };
  const generated = await lineage(dataset, generatedId);
  const native = await lineage(control, nativeId);
  return Object.entries(generated)
    .filter(([key, value]) => native[key as keyof typeof native] !== value)
    .map(([key]) => `lineage.${key}`);
}

function shapeOf(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return typeof value;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${key}:${shapeOf((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function statusOf(data: Record<string, unknown>): unknown {
  return (data.photo as { status?: unknown } | undefined)?.status;
}
