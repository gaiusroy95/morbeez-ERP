// Accounting engine through the real HTTP API, on top of the ledger the
// owner-modules browser E2E just produced. Money is compared as exact
// strings / integer paise — never floats.
const { API, PASSWORD } = require('../lib/env');

const results = [];
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`;
  results.push(line);
  console.log(line);
};
const cents = (v) => {
  const neg = String(v).startsWith('-');
  const [w, f = ''] = String(v).replace('-', '').split('.');
  const c = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -c : c;
};
const eq = (a, b) => cents(a) === cents(b);
const money = (c) => `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`;

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json();
  return j.accessToken || j.data?.accessToken;
}

function as(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: r.status, body: json };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b) };
}

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

(async () => {
  const owner = as(await login('owner@dev.morbeez.local'));
  const accountant = as(await login('accountant@dev.morbeez.local'));
  const ops = as(await login('ops-manager@dev.morbeez.local'));

  const periods = await owner.get('/accounting/periods');
  const today = periods.body.today;
  const yesterday = addDays(today, -1);
  const fourDaysAgo = addDays(today, -4);
  const monthStart = `${today.slice(0, 8)}01`;
  // The P&L range must cover the backdated journals too, even early in a month.
  const pnlFrom = fourDaysAgo < monthStart ? fourDaysAgo : monthStart;

  // ---- The ledger the operational flows produced ----
  const tb = await owner.get('/accounting/trial-balance');
  check('trial balance balances', tb.status === 200 && tb.body.balanced, `Dr ${tb.body.totals?.debit} = Cr ${tb.body.totals?.credit}`);
  const fin = await owner.get('/finance/ledger/trial-balance');
  check(
    "finance's control-account checks still agree with their sub-ledgers",
    fin.status === 200 && fin.body.balanced && fin.body.checks.every((c) => c.agrees),
    fin.body.checks?.map((c) => `${c.name} ${c.ledger}/${c.subledger}`).join('; '),
  );

  const accounts = await owner.get('/accounting/accounts');
  const bal = (code) => accounts.body.find((a) => a.code === code)?.balance;
  check('chart of accounts: 50 accounts installed (incl. GST, TDS, payroll, fleet, crates)', accounts.body.length === 50, `${accounts.body.length}`);
  check('trip float cleared after reconciliation', eq(bal('cash_with_drivers'), '0'), bal('cash_with_drivers'));
  check('trip fuel expense posted', eq(bal('trip_expense_fuel'), '400'), bal('trip_expense_fuel'));
  check('trip cash shortage posted', eq(bal('cash_shortage'), '50'), bal('cash_shortage'));
  check('shrinkage written off at lot cost (2 kg × ₹20)', eq(bal('shrinkage_expense'), '40'), bal('shrinkage_expense'));
  // ₹1,000 advance out, ₹550 back; every other payment in the UI run was UPI (bank).
  check('cash on hand: −₹1,000 advance + ₹550 returned', eq(bal('cash_on_hand'), '-450'), `cash ${bal('cash_on_hand')}, bank ${bal('bank')}`);

  const bs = await owner.get('/accounting/balance-sheet');
  check('balance sheet balances', bs.status === 200 && bs.body.balanced, `assets ${bs.body.assets?.total} = L+E ${bs.body.liabilitiesAndEquity}`);

  const pnl = await owner.get(`/accounting/profit-and-loss?from=${pnlFrom}&to=${today}`);
  const revenueMinusExpenses = accounts.body
    .filter((a) => a.rootType === 'revenue' || a.rootType === 'expense')
    .reduce((s, a) => s + (a.rootType === 'revenue' ? cents(a.balance) : -cents(a.balance)), 0n);
  check(
    'P&L net profit = revenue − expenses on the ledger',
    pnl.status === 200 && cents(pnl.body.figures.netProfit) === revenueMinusExpenses,
    JSON.stringify(pnl.body.figures),
  );
  check('P&L: net sales ₹3,000 from the delivered order', eq(pnl.body.figures.netSales, '3000'));
  check('P&L: shrinkage and transport are operating expenses, not cost of sales', eq(pnl.body.figures.operatingExpenses, '490'), pnl.body.figures.operatingExpenses);

  const cf = await owner.get(`/accounting/cash-flow?from=${pnlFrom}&to=${today}`);
  const activitySum = cf.body.activities.reduce((s, a) => s + cents(a.total), 0n);
  check(
    'cash flow: activities sum exactly to the change in cash',
    cf.status === 200 && activitySum === cents(cf.body.netChange) && cents(cf.body.closingCash) - cents(cf.body.openingCash) === cents(cf.body.netChange),
    `net ${cf.body.netChange}: ${cf.body.activities.map((a) => `${a.activity} ${a.total}`).join(', ')}`,
  );
  check('cash flow: closing cash = cash + bank balances', eq(cf.body.closingCash, money(cents(bal('cash_on_hand')) + cents(bal('bank')))), cf.body.closingCash);

  // ---- Manual journals ----
  const capital = await owner.post('/accounting/journal-entries', {
    date: today,
    memo: 'Capital introduced',
    reference: 'DEP-001',
    lines: [
      { accountCode: 'bank', debit: 100000 },
      { accountCode: 'owner_capital', credit: 100000 },
    ],
  });
  check('journal: owner capital posted, numbered #1', capital.status === 201 && capital.body.journalNumber === 1, `${capital.status} ${capital.body.total}`);
  const rent = await owner.post('/accounting/journal-entries', {
    date: fourDaysAgo,
    memo: 'Warehouse rent',
    lines: [
      { accountCode: 'rent', debit: 15000 },
      { accountCode: 'bank', credit: 15000 },
    ],
  });
  check('journal: backdated rent posted (#2)', rent.status === 201 && rent.body.journalNumber === 2 && rent.body.date === fourDaysAgo, `${rent.status} ${rent.body.date}`);

  const refused = async (name, body, expectStatus, pattern) => {
    const r = await owner.post('/accounting/journal-entries', body);
    const msg = r.body?.error?.message ?? JSON.stringify(r.body);
    check(name, r.status === expectStatus && (!pattern || pattern.test(msg)), `${r.status} ${msg}`);
  };
  await refused('journal: unbalanced refused', { date: today, memo: 'x y z', lines: [{ accountCode: 'rent', debit: 10 }, { accountCode: 'bank', credit: 9 }] }, 400, /equal/);
  await refused('journal: control account refused', { date: today, memo: 'x y z', lines: [{ accountCode: 'accounts_receivable', debit: 10 }, { accountCode: 'bank', credit: 10 }] }, 400, /control account/);
  await refused('journal: unknown account refused', { date: today, memo: 'x y z', lines: [{ accountCode: 'nope_account', debit: 10 }, { accountCode: 'bank', credit: 10 }] }, 400, /no account/);
  await refused('journal: future date refused', { date: addDays(today, 1), memo: 'x y z', lines: [{ accountCode: 'rent', debit: 10 }, { accountCode: 'bank', credit: 10 }] }, 400, /future/);

  const pnl2 = await owner.get(`/accounting/profit-and-loss?from=${pnlFrom}&to=${today}`);
  check('P&L now shows the rent', cents(pnl.body.figures.netProfit) - cents(pnl2.body.figures.netProfit) === cents('15000'), `${pnl.body.figures.netProfit} → ${pnl2.body.figures.netProfit}`);
  const cf2 = await owner.get(`/accounting/cash-flow?from=${pnlFrom}&to=${today}`);
  const financing = cf2.body.activities.find((a) => a.activity === 'financing');
  check('cash flow: capital shows under financing', eq(financing.total, '100000'), JSON.stringify(financing.lines));

  // Reversal.
  const reversal = await owner.post(`/accounting/journal-entries/${rent.body.id}/reverse`, {});
  check('journal: rent reversed with a linked entry', reversal.status === 201 && reversal.body.reversesEntryId === rent.body.id && reversal.body.entryType === 'journal_reversal', `${reversal.status}`);
  const again = await owner.post(`/accounting/journal-entries/${rent.body.id}/reverse`, {});
  check('journal: second reversal refused', again.status === 409, `${again.status} ${again.body?.error?.message}`);
  const sysEntry = (await owner.get('/accounting/journal-entries?days=30&pageSize=100')).body.items.find((e) => e.entryType === 'invoice_issued');
  const sysReverse = await owner.post(`/accounting/journal-entries/${sysEntry.id}/reverse`, {});
  check('journal: an invoice entry cannot be reversed here', sysReverse.status === 409, sysReverse.body?.error?.message);
  const manual = await owner.get('/accounting/journal-entries?days=30&manualOnly=true');
  check('journal list: manual filter', manual.status === 200 && manual.body.items.length === 3, `${manual.body.items?.length} entries`);
  const withLines = (await owner.get('/accounting/journal-entries?days=30&pageSize=100')).body.items;
  check('journal list: every entry balances', withLines.every((e) => e.lines.reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0n) === 0n), `${withLines.length} entries`);
  check('journal list: invoice lines name the customer', withLines.some((e) => e.lines.some((l) => l.partyName === 'Hotel Sagar')));

  // ---- Chart of accounts ----
  const cold = await owner.post('/accounting/accounts', { number: 6810, name: 'Cold storage', rootType: 'expense', reportGroup: 'operating_expense' });
  check('account: tenant adds its own', cold.status === 201 && cold.body.code === 'cold_storage' && !cold.body.isSystem, `${cold.status} ${cold.body.code}`);
  const dupe = await owner.post('/accounting/accounts', { number: 6810, name: 'Other', rootType: 'expense', reportGroup: 'operating_expense' });
  check('account: duplicate number refused', dupe.status === 409, dupe.body?.error?.message);
  await owner.post('/accounting/journal-entries', { date: today, memo: 'Cold storage fee', lines: [{ accountCode: 'cold_storage', debit: 1200 }, { accountCode: 'cash_on_hand', credit: 1200 }] });
  const retire = await owner.patch('/accounting/accounts/cold_storage', { version: 1, isActive: false });
  check('account: one with a balance cannot be retired', retire.status === 409, retire.body?.error?.message);
  const retireSys = await owner.patch('/accounting/accounts/bank', { version: 1, isActive: false });
  check('account: a system account cannot be retired', retireSys.status === 409, retireSys.body?.error?.message);
  const rename = await owner.patch('/accounting/accounts/bank', { version: 1, name: 'HDFC current account' });
  check('account: a system account can be renamed', rename.status === 200 && rename.body.name === 'HDFC current account' && rename.body.version === 2);
  const stale = await owner.patch('/accounting/accounts/bank', { version: 1, name: 'Stale' });
  check('account: stale version refused', stale.status === 409, stale.body?.error?.message);

  // ---- General ledger ----
  const gl = await owner.get(`/accounting/ledger/bank?from=${pnlFrom}&to=${today}`);
  const bankNow = (await owner.get('/accounting/accounts')).body.find((a) => a.code === 'bank').balance;
  check(
    'general ledger: opening + movements = closing = balance',
    gl.status === 200 && eq(gl.body.closing, bankNow) && eq(gl.body.lines.at(-1).balance, gl.body.closing),
    `opening ${gl.body.opening}, Dr ${gl.body.totals.debit}, Cr ${gl.body.totals.credit}, closing ${gl.body.closing}`,
  );

  // ---- Period closing ----
  const preview = await owner.get(`/accounting/periods/close-preview?through=${yesterday}`);
  check('close preview: only the rent (dated 4 days ago) falls in the period — its reversal is today', preview.status === 200 && eq(preview.body.netIncome, '-15000'), `net ${preview.body.netIncome}, ${preview.body.lines?.length} lines, warnings: ${preview.body.warnings?.join(' | ') || 'none'}`);
  const badClose = await owner.post('/accounting/periods/close', { through: today });
  check('close: today cannot be closed', badClose.status === 409, badClose.body?.error?.message);
  const accClose = await accountant.post('/accounting/periods/close', { through: yesterday });
  check('close: accountant is not allowed to close', accClose.status === 403);
  const closed = await owner.post('/accounting/periods/close', { through: yesterday, notes: 'September close' });
  check('close: owner closes through yesterday', closed.status === 201 && closed.body.lockedThrough === yesterday, `${closed.status} locked ${closed.body.lockedThrough}`);
  const closeRow = closed.body.closes[0];
  check('close: rent (−15,000, dated 4 days ago) moved to retained earnings', eq(closeRow.netIncome, '-15000') && closeRow.closingEntryId, `net ${closeRow.netIncome}`);

  const accounts2 = (await owner.get('/accounting/accounts')).body;
  const b2 = (code) => accounts2.find((a) => a.code === code)?.balance;
  check('after close: retained earnings carries the loss', eq(b2('retained_earnings'), '-15000'), b2('retained_earnings'));
  check('after close: rent holds only the open-period reversal', eq(b2('rent'), '-15000'), `rent ${b2('rent')}`);
  const bs2 = await owner.get('/accounting/balance-sheet');
  check('after close: balance sheet still balances', bs2.body.balanced, `unclosed ${bs2.body.equity.unclosedProfit}`);
  const tb2 = await owner.get('/accounting/trial-balance');
  check('after close: trial balance still balances', tb2.body.balanced);
  const pnlClosed = await owner.get(`/accounting/profit-and-loss?from=${fourDaysAgo}&to=${yesterday}`);
  check('after close: the closed period\'s P&L still shows the rent (closing entry excluded)', eq(pnlClosed.body.figures.operatingExpenses, '15000'), pnlClosed.body.figures.operatingExpenses);

  const locked = await owner.post('/accounting/journal-entries', { date: yesterday, memo: 'late bill', lines: [{ accountCode: 'rent', debit: 10 }, { accountCode: 'bank', credit: 10 }] });
  check('lock: journal dated in the closed period refused', locked.status === 409, locked.body?.error?.message);
  const customers = (await owner.get('/customers?pageSize=100')).body.items;
  const hotel = customers.find((c) => c.name === 'Hotel Sagar');
  const backdated = await accountant.post('/finance/customer-payments', {
    customerId: hotel.id,
    amount: 100,
    method: 'cash',
    receivedAt: `${yesterday}T06:00:00.000Z`,
  });
  check('lock: a backdated customer payment is refused by the database (409, not 500)', backdated.status === 409 && backdated.body.error.code === 'PERIOD_CLOSED', `${backdated.status} ${backdated.body?.error?.message}`);
  const current = await accountant.post('/finance/customer-payments', { customerId: hotel.id, amount: 100, method: 'cash' });
  check('lock: a payment dated today still goes through', current.status === 201, `${current.status}`);

  const reopenOld = await owner.post(`/accounting/periods/${closeRow.id}/reopen`, { reason: 'Missed a supplier bill' });
  check('reopen: owner reopens the latest close', reopenOld.status === 201 && reopenOld.body.lockedThrough === null, `${reopenOld.status}`);
  const accounts3 = (await owner.get('/accounting/accounts')).body;
  check('after reopen: retained earnings back to zero', eq(accounts3.find((a) => a.code === 'retained_earnings').balance, '0'));
  const lateBill = await owner.post('/accounting/journal-entries', { date: yesterday, memo: 'Late supplier bill', lines: [{ accountCode: 'repairs_maintenance', debit: 800 }, { accountCode: 'cash_on_hand', credit: 800 }] });
  check('after reopen: the late bill can be posted', lateBill.status === 201);
  const reclosed = await owner.post('/accounting/periods/close', { through: yesterday });
  check('re-close includes the late bill', reclosed.status === 201 && eq(reclosed.body.closes[0].netIncome, '-15800'), reclosed.body.closes?.[0]?.netIncome);
  const reopenTwice = await owner.post(`/accounting/periods/${closeRow.id}/reopen`, { reason: 'again' });
  check('reopen: an already-reopened close refused', reopenTwice.status === 409, reopenTwice.body?.error?.message);
  const tb3 = await owner.get('/accounting/trial-balance');
  const bs3 = await owner.get('/accounting/balance-sheet');
  check('final: trial balance and balance sheet both balance', tb3.body.balanced && bs3.body.balanced, `TB ${tb3.body.totals.debit}; assets ${bs3.body.assets.total}`);

  // ---- Permissions ----
  const accRead = await accountant.get('/accounting/profit-and-loss');
  const accPost = await accountant.post('/accounting/journal-entries', { date: today, memo: 'Electricity', lines: [{ accountCode: 'utilities', debit: 300 }, { accountCode: 'bank', credit: 300 }] });
  const accManage = await accountant.post('/accounting/accounts', { number: 6820, name: 'X account', rootType: 'expense', reportGroup: 'operating_expense' });
  check('accountant: reads and posts, but cannot change the chart', accRead.status === 200 && accPost.status === 201 && accManage.status === 403, `${accRead.status}/${accPost.status}/${accManage.status}`);
  const opsRead = await ops.get('/accounting/trial-balance');
  check('ops manager: no access to the books', opsRead.status === 403);

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
})().catch((e) => {
  console.error('FAILED:', e.stack);
  process.exit(1);
});
