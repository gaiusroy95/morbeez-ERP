import { PoolClient } from 'pg';
import { AiService } from './ai.service';
import { AiRepository } from './repositories/ai.repository';
import { AiDataRepository } from './repositories/ai-data.repository';
import { RecommendationRecord } from './entities/ai.entity';
import * as producers from './producers';

jest.mock('./producers', () => {
  const actual = jest.requireActual('./producers');
  return {
    ...actual,
    productInputs: jest.fn(),
    procurement: jest.fn(),
    pricing: jest.fn(),
    logisticsRoute: jest.fn(),
    logisticsLoad: jest.fn(),
    customerTerms: jest.fn(),
    exceptions: jest.fn(),
  };
});

const owner = { tenantId: 't', userId: 'owner', permissions: ['ai:read', 'ai:decide:pricing', 'ai:decide:procurement', 'ai:decide:logistics', 'ai:decide:customers', 'ai:decide:exceptions'] };
const ops = { tenantId: 't', userId: 'ops', permissions: ['ai:read', 'ai:decide:logistics'] };

const rec = (over: Partial<RecommendationRecord> = {}): RecommendationRecord => ({
  id: 'r1', runId: 'run', type: 'procurement', subjectKind: 'product', subjectId: 'p1', subjectName: null, targetDate: '2026-09-30',
  title: 'Buy', proposal: { action: 'purchase_order', compare: { quantity: '210.000', farmerId: 'f1' } }, evidence: [{ fact: 'x' }],
  explanation: '', expectedImpact: null, confidence: 'solid', sensitive: false, producer: 'baseline', expiresAt: new Date(Date.now() + 3_600_000),
  createdAt: new Date(), status: 'open', decision: null, ...over,
});

function setup(found: RecommendationRecord | null = rec()) {
  const queries: string[] = [];
  const client = { query: jest.fn(async (sql: string) => {
    queries.push(sql);
    if (/unnest\(\$1::date\[\]\)/.test(sql)) return { rows: [0, 1, 6, 13].map((o) => ({ d: new Date(Date.UTC(2026, 8, 29 + o)).toISOString().slice(0, 10), at: new Date() })) };
    return { rows: [], rowCount: 1 };
  }) } as unknown as PoolClient;
  const repo = {
    find: jest.fn().mockResolvedValue(found),
    decide: jest.fn().mockResolvedValue(true),
    settings: jest.fn().mockResolvedValue({ targetMarginPct: '20.00', maxPriceMovePct: '15.00', minCustomerMarginPct: '5.00', costOfCapitalPct: '12.00', defaultCostPerKm: '18.00', disabledTypes: ['customer_terms'], version: 1 }),
    lockRuns: jest.fn(),
    insertRun: jest.fn(),
    expireOpen: jest.fn(),
    insert: jest.fn(),
  } as unknown as jest.Mocked<AiRepository>;
  const data = {
    books: jest.fn().mockResolvedValue({ today: '2026-09-29', timezone: 'Asia/Kolkata', currency: 'INR' }),
    names: jest.fn().mockResolvedValue(new Map([['p1', 'Tomato']])),
  } as unknown as jest.Mocked<AiDataRepository>;
  const db = {
    withTenant: jest.fn((_t: string, work: (c: PoolClient) => unknown) => work(client)),
    withTenantReadOnly: jest.fn((_t: string, _r: string, work: (c: PoolClient) => unknown) => work(client)),
  };
  const audit = { record: jest.fn() };
  return { service: new AiService(db as never, repo, data, audit as never), repo, db, queries };
}

describe('AiService.decide', () => {
  it('acting exactly as suggested is accepted; changing it is modified', async () => {
    const a = setup();
    await a.service.decide(owner, 'r1', { outcome: 'acted', submitted: { quantity: 210, farmerId: 'f1', extra: 1 }, resultRef: { kind: 'purchase_order', id: 'po1' } });
    expect(a.repo.decide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: 'accepted' }));
    const m = setup();
    await m.service.decide(owner, 'r1', { outcome: 'acted', submitted: { quantity: 180, farmerId: 'f1' } });
    expect(m.repo.decide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: 'modified' }));
  });

  it('only the owner, or a role given the type, decides (DR.2)', async () => {
    const { service, repo } = setup();
    await expect(service.decide(ops, 'r1', { outcome: 'dismissed', reason: 'no' })).rejects.toThrow(/ai:decide:procurement/);
    expect(repo.decide).not.toHaveBeenCalled();
    const l = setup(rec({ type: 'logistics_route', proposal: { action: 'resequence_stops', compare: { stopIds: ['a', 'b'] } } }));
    await l.service.decide(ops, 'r1', { outcome: 'dismissed', reason: 'Driver knows a shortcut' });
    expect(l.repo.decide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: 'dismissed', reason: 'Driver knows a shortcut' }));
  });

  it('a dismissal needs a reason; an expired or decided one is refused', async () => {
    await expect(setup().service.decide(owner, 'r1', { outcome: 'dismissed' })).rejects.toThrow(/why/);
    await expect(setup(rec({ expiresAt: new Date(Date.now() - 1000) })).service.decide(owner, 'r1', { outcome: 'acted', submitted: {} })).rejects.toThrow(/expired/);
    await expect(setup(rec({ decision: { decision: 'accepted', decidedByEmail: null, decidedAt: new Date(), submitted: null, reason: null, resultRef: null } })).service.decide(owner, 'r1', { outcome: 'dismissed', reason: 'x' })).rejects.toThrow(/Already accepted/);
  });

  it("flags about people are invisible without the exceptions permission (AISEC.8)", async () => {
    const { service } = setup(rec({ type: 'exception', sensitive: true, proposal: { action: 'review' } }));
    await expect(service.get(ops, 'r1')).rejects.toThrow(/not found/);
  });
});

describe('AiService.run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('computes read-only, isolates a failing producer, skips switched-off types, supersedes the rest', async () => {
    const { service, repo, db, queries } = setup();
    (producers.productInputs as jest.Mock).mockResolvedValue({ forecasts: new Map() });
    (producers.procurement as jest.Mock).mockRejectedValue(new producers.Suppressed('No sales in the last 4 weeks to forecast from'));
    (producers.pricing as jest.Mock).mockResolvedValue([{ type: 'pricing', title: 'Raise' }]);
    (producers.logisticsRoute as jest.Mock).mockRejectedValue(new Error('boom'));
    (producers.logisticsLoad as jest.Mock).mockResolvedValue([]);
    (producers.exceptions as jest.Mock).mockResolvedValue([{ type: 'exception', title: 'Short' }]);

    const r = await service.run(owner);
    expect(db.withTenantReadOnly).toHaveBeenCalledWith('t', 'morbeez_ai', expect.any(Function));
    expect(r.suppressed).toEqual({
      customer_terms: 'Switched off in AI settings',
      procurement: 'No sales in the last 4 weeks to forecast from',
      logistics_route: 'Could not compute: boom',
    });
    expect(r.produced).toMatchObject({ pricing: 1, exception: 1, logistics_load: 0 });
    expect(producers.customerTerms).not.toHaveBeenCalled();
    expect(queries.filter((q) => q === 'ROLLBACK TO SAVEPOINT producer')).toHaveLength(2);
    expect(repo.expireOpen).toHaveBeenCalledWith(expect.anything(), 't', expect.not.arrayContaining(['customer_terms']));
    expect(repo.insert).toHaveBeenCalledTimes(2);
  });
});
