import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(
  new URL('../public/index.html', import.meta.url),
  'utf8',
);
const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(script, 'The selected UI must contain its application script.');

// Execute the real UI handlers with a minimal DOM and isolated synthetic storage.
function app({ storage = new Map(), storageFails = false } = {}) {
  const elements = new Map(),
    handlers = new Map();
  function element(key) {
    if (!elements.has(key)) {
      const el = {
        innerHTML: '',
        textContent: '',
        value: '',
        hidden: false,
        dataset: {},
        style: {},
        focus() {},
        setAttribute() {},
        getBoundingClientRect: () => ({ top: 0 }),
        scrollIntoView() {},
        querySelector: () => null,
      };
      el.parentElement = el;
      elements.set(key, el);
    }
    return elements.get(key);
  }
  const context = {
    console,
    Date,
    setTimeout: () => 0,
    clearTimeout() {},
    scrollY: 0,
    window: { scrollTo() {} },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => {
        if (storageFails) throw new Error('QuotaExceededError');
        storage.set(key, value);
      },
    },
    document: {
      querySelector: element,
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener: (name, fn) => {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(fn);
      },
    },
    FileReader: class {},
    Image: class {},
  };
  vm.createContext(context);
  vm.runInContext(script, context, { timeout: 5000 });
  const run = (code) => vm.runInContext(code, context, { timeout: 5000 });
  const value = (code) => JSON.parse(run(`JSON.stringify(${code})`));
  return {
    run,
    value,
    storage,
    elements,
    handlers,
    failStorage: () => {
      storageFails = true;
    },
  };
}
const manager = "ui.session={role:'manager',id:'manager'};ui.tab='inactive';";
const staff = "ui.session={role:'staff',id:'vusi'};ui.tab='members';";
const retained =
  '({members:S.members.map(({active,...m})=>m),payments:S.payments,checkins:S.checkins,denied:S.denied})';
function fixtures(a) {
  a.run(
    "S.members.find(m=>m.id==='m13').photo='data:image/jpeg;base64,SYNTHETIC';S.denied.push({id:'test-denial',m:'m13',time:nowStr(),idEntered:'TEST',staff:'vusi',reason:'EXPIRED'});",
  );
}

test('selected UI keeps its public entry and removes member deletion controls and handlers', () => {
  const a = app();
  a.run(manager);
  assert.ok(a.run("viewPublic().includes('Membership plans')"));
  assert.doesNotMatch(
    a.run('pgInactive()'),
    /data-act="del|delete permanently/i,
  );
  assert.equal(a.run('typeof delMember'), 'undefined');
  assert.equal(
    a.run("['delask','delallask','delyes','delallyes'].some(k=>k in A)"),
    false,
  );
});
test('single suspension preserves identity, photo, payments, visits and denial history', () => {
  const a = app();
  a.run(manager);
  fixtures(a);
  const before = a.value(retained);
  assert.ok(a.run("S.checkins.some(c=>c.m==='m13')"));
  a.run(
    "A.suspendask({dataset:{id:'m13'}});A.suspendyes({dataset:{id:'m13'}})",
  );
  assert.equal(a.run("S.members.find(m=>m.id==='m13').active"), false);
  assert.deepEqual(a.value(retained), before);
  assert.deepEqual(a.value('S.memberStatusLog.map(({at,...event})=>event)'), [
    { memberId: 'm13', enabled: false, by: 'manager' },
  ]);
  assert.match(
    a.run('S.memberStatusLog[0].at'),
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
  );
});
test('cancelled suspension makes no state or storage change', () => {
  const a = app();
  a.run(manager);
  const before = a.value('S');
  a.run(
    "A.suspendask({dataset:{id:'m13'}});A.suspendno();A.suspendyes({dataset:{id:'m13'}})",
  );
  assert.deepEqual(a.value('S'), before);
  assert.equal(a.storage.size, 0);
});
test('bulk suspension preserves all history and affects only enabled long-inactive accounts', () => {
  const a = app();
  a.run(manager);
  fixtures(a);
  const before = a.value(retained);
  const ids = a.value('inactiveList().filter(m=>m.active).map(m=>m.id)');
  assert.ok(ids.length > 1);
  a.run('A.suspendallask();A.suspendallyes()');
  assert.deepEqual(
    a.value('S.members.filter(m=>!m.active).map(m=>m.id)').sort(),
    ids.sort(),
  );
  assert.deepEqual(a.value(retained), before);
  assert.equal(a.run('S.memberStatusLog.length'), ids.length);
  const saved = a.storage.get('gms-demo-v3');
  a.run('A.suspendallask();A.suspendallyes()');
  assert.equal(
    a.storage.get('gms-demo-v3'),
    saved,
    'No duplicate events for already suspended accounts.',
  );
});
test('inactive-page suspension cannot target a current paid member', () => {
  const a = app();
  a.run(manager);
  const before = a.value('S');
  a.run("A.suspendask({dataset:{id:'m1'}});A.suspendyes({dataset:{id:'m1'}})");
  assert.deepEqual(a.value('S'), before);
});
test('staff can suspend and enable from Members without changing payment-derived expiry', () => {
  const a = app();
  a.run(staff);
  fixtures(a);
  const before = a.value(retained),
    expiry = a.run("memExpiry('m1')");
  a.run("A.togglemem({dataset:{id:'m1'}})");
  assert.equal(a.run('S.members[0].active'), false);
  assert.equal(a.run("memExpiry('m1')"), expiry);
  a.run("A.togglemem({dataset:{id:'m1'}})");
  assert.equal(a.run('S.members[0].active'), true);
  assert.deepEqual(a.value(retained), before);
  assert.deepEqual(a.value('S.memberStatusLog.map(x=>x.enabled)'), [
    false,
    true,
  ]);
});
test('staff cannot invoke manager-only bulk or inactive-page suspension', () => {
  const a = app();
  a.run(staff);
  const before = a.value('S');
  a.run(
    "A.suspendallask();ui.suspendAsk='all';A.suspendallyes();ui.suspendAsk='m13';A.suspendyes({dataset:{id:'m13'}})",
  );
  assert.deepEqual(a.value('S'), before);
});
test('public and member sessions cannot modify account access', () => {
  const a = app();
  const before = a.value('S');
  a.run(
    "A.togglemem({dataset:{id:'m13'}});ui.session={role:'member',id:'m1'};A.togglemem({dataset:{id:'m13'}})",
  );
  assert.deepEqual(a.value('S'), before);
});
test('disabled staff and a forged manager role cannot change account access', () => {
  const a = app();
  const before = a.value('S');
  a.run(
    "ui.session={role:'staff',id:'bongani'};A.togglemem({dataset:{id:'m13'}});ui.session={role:'manager',id:'vusi'};A.togglemem({dataset:{id:'m13'}})",
  );
  assert.deepEqual(a.value('S'), before);
});
test('suspension blocks check-in and appends an attributed SUSPENDED denial', () => {
  const a = app();
  a.run(staff);
  a.run("setMemberStatuses(['m1'],false)");
  const visits = a.value('S.checkins'),
    denials = a.run('S.denied.length');
  a.run("A.ciconfirm({dataset:{id:'m1'}})");
  assert.deepEqual(a.value('S.checkins'), visits);
  assert.equal(a.run('S.denied.length'), denials + 1);
  assert.deepEqual(
    a.value('(({reason,staff,m})=>({reason,staff,m}))(S.denied.at(-1))'),
    { reason: 'SUSPENDED', staff: 'vusi', m: 'm1' },
  );
});
test('suspended member remains searchable with accessible history and re-enable action', () => {
  const a = app();
  a.run(manager);
  fixtures(a);
  a.run("setMemberStatuses(['m13'],false);ui.mq='Jabu'");
  assert.match(a.run('memTable()'), /Jabu Ndlela/);
  const detail = a.run("modalMember(S.members.find(m=>m.id==='m13'))");
  for (const label of [
    'Payments',
    'Recent check-ins',
    'Denied attempts',
    'Account access history',
    'Enable account',
  ])
    assert.ok(detail.includes(label), label);
  assert.ok(a.run("inactiveList().some(m=>m.id==='m13')"));
});
test('suspension is separate from active-paid dashboard totals and open visits', () => {
  const a = app();
  a.run(manager);
  const before = a.run('pgDash()'),
    visits = a.value('S.checkins');
  a.run("setMemberStatuses(['m1'],false)");
  assert.equal(a.run('pgDash()'), before);
  assert.deepEqual(a.value('S.checkins'), visits);
  assert.match(a.run('statusOf(S.members[0]).sub'), /paid through/);
});
test('v3 data without status history survives suspension and reload', () => {
  const a = app();
  fixtures(a);
  a.run('save()');
  assert.equal(
    'memberStatusLog' in JSON.parse(a.storage.get('gms-demo-v3')),
    false,
  );
  const b = app({ storage: a.storage });
  b.run(staff);
  assert.equal(b.run("setMemberStatuses(['m13'],false)"), true);
  const c = app({ storage: a.storage });
  c.run(manager);
  assert.equal(c.run("S.members.find(m=>m.id==='m13').active"), false);
  assert.deepEqual(c.value(retained), a.value(retained));
  assert.equal(c.run('S.memberStatusLog.length'), 1);
});
test('failed single-status persistence preserves the previous state and displays an error', () => {
  const a = app();
  a.run(staff);
  const before = a.value('S');
  a.failStorage();
  a.run("A.togglemem({dataset:{id:'m13'}})");
  assert.deepEqual(a.value('S'), before);
  assert.match(a.elements.get('#toast-root').innerHTML, /not saved/);
});
test('failed bulk persistence cannot leave partially suspended accounts', () => {
  const a = app();
  a.run(manager);
  const before = a.value('S');
  a.failStorage();
  a.run('A.suspendallask();A.suspendallyes()');
  assert.deepEqual(a.value('S'), before);
  assert.equal(a.run('ui.suspendAsk'), 'all');
  assert.equal(a.storage.size, 0);
});
test('unknown member and invalid status values do not write any changes', () => {
  const a = app();
  a.run(staff);
  const before = a.value('S');
  assert.equal(a.run("setMemberStatuses(['missing'],false)"), false);
  assert.equal(a.run("setMemberStatuses(['m1'],'false')"), false);
  assert.deepEqual(a.value('S'), before);
  assert.equal(a.storage.size, 0);
});

const PHOTO = 'data:image/jpeg;base64,AA=='; // Synthetic marker; real decoding is tested by the API suite.
function form(values, k, dataset = {}) {
  const msg = { textContent: '', className: '' };
  return {
    dataset: { form: k, ...dataset },
    msg,
    querySelector: (selector) =>
      selector === '.msg'
        ? msg
        : {
            value: values[selector.slice(1)] ?? '',
            checked: values[selector.slice(1)] === true,
          },
  };
}
function submit(a, f) {
  for (const fn of a.handlers.get('submit') || [])
    fn({ preventDefault() {}, target: f });
}
function registration(a, extra = {}) {
  a.run(staff + `ui.regPhoto=${JSON.stringify(PHOTO)}`);
  return form(
    {
      'rg-f': 'New',
      'rg-s': 'Member',
      'rg-t': 'Passport',
      'rg-n': 'TEST-UNIQUE',
      'rg-p': 'MemberPass123!',
      'rg-l': 'p1',
      'rg-r': 'TEST-NEW',
      ...extra,
    },
    'register',
  );
}

test('every report variant omits photos and full identity document numbers', () => {
  const a = app();
  a.run(manager + `S.members.forEach(m=>m.photo=${JSON.stringify(PHOTO)});`);
  const docIds = a.value('S.members.map(m=>m.idNum)');
  for (const report of ['active', 'lapsed', 'neu', 'exp', 'present']) {
    a.run('ui.rep=' + JSON.stringify(report));
    const html = a.run('pgReports()');
    assert.ok(!html.includes(PHOTO));
    for (const value of docIds) assert.ok(!html.includes(value));
  }
});
test('missing or unsafe photo cannot create a visit, including direct handler calls', () => {
  const a = app();
  a.run(staff + "S.checkins=S.checkins.filter(c=>c.m!=='m1');");
  const before = a.run('S.checkins.length');
  for (const photo of [
    null,
    'https://example.invalid/photo.jpg',
    'data:image/svg+xml;base64,AAAA',
  ]) {
    a.run('S.members[0].photo=' + JSON.stringify(photo));
    a.run("A.ciconfirm({dataset:{id:'m1'}})");
    assert.equal(a.run('S.checkins.length'), before);
    assert.equal(a.run('S.denied.at(-1).reason'), 'PHOTO_NOT_CONFIRMED');
  }
});
test('no saleable plan gives a useful empty state and no registration side effects', () => {
  const a = app();
  const f = registration(a, { 'rg-l': '' });
  a.run('S.plans.forEach(p=>p.on=false);save()');
  const before = a.value('S');
  submit(a, f);
  assert.deepEqual(a.value('S'), before);
  assert.match(f.msg.textContent, /available plan/);
  assert.match(a.run('pgRegister()'), /No plans are available/);
  a.run("ui.modal={t:'renew',id:'m1',plan:null}");
  assert.match(a.run('modalRenew()'), /No saleable plan/);
});
test('stale plan selection and duplicate receipt cannot insert a partial member', () => {
  const a = app();
  const f = registration(a, { 'rg-l': 'missing' });
  let before = a.value('S');
  submit(a, f);
  assert.deepEqual(a.value('S'), before);
  const duplicate = registration(a, { 'rg-r': a.run('S.payments[0].receipt') });
  before = a.value('S');
  submit(a, duplicate);
  assert.deepEqual(a.value('S'), before);
  assert.match(duplicate.msg.textContent, /already been used/);
});
test('registration commits member and snapshotted cash payment together with inclusive expiry', () => {
  const a = app();
  const f = registration(a);
  submit(a, f);
  const p = a.value('S.payments.at(-1)');
  assert.equal(p.days, 30);
  assert.equal(p.amount, 250);
  assert.equal(p.plan, 'Monthly');
  assert.equal(p.status, 'CONFIRMED');
  assert.match(p.recordedAt, /T\d{2}:\d{2}$/);
  assert.equal(a.run('S.members.at(-1).id'), p.memberId);
  assert.equal(p.expiry, a.run('addDays(TODAY(),29)'));
});
test('storage failure rolls back both registration records and reports the failed save', () => {
  const a = app();
  const f = registration(a);
  const before = a.value('S');
  a.failStorage();
  submit(a, f);
  assert.deepEqual(a.value('S'), before);
  assert.match(f.msg.textContent, /not saved/);
});
test('invalid plan amounts and fractional durations are rejected without changing the catalogue', () => {
  const a = app();
  a.run(manager);
  const values = {};
  for (const [i, p] of a.value('S.plans').entries())
    Object.assign(values, {
      ['pl-n' + i]: p.name,
      ['pl-p' + i]: String(p.price),
      ['pl-d' + i]: String(p.days),
      ['pl-o' + i]: p.on,
    });
  for (const [field, value] of [
    ['pl-p0', '-1'],
    ['pl-p0', '1.234'],
    ['pl-d0', '1.5'],
    ['pl-d0', '0'],
    ['pl-p0', ''],
  ]) {
    const before = a.value('S'),
      f = form({ ...values, [field]: value }, 'plans');
    submit(a, f);
    assert.deepEqual(a.value('S'), before);
    assert.match(f.msg.textContent, /nonnegative price/);
  }
});
test('daily, weekly and monthly shortcuts set whole-day durations', () => {
  const a = app();
  a.run(manager);
  for (const n of [1, 7, 30]) {
    a.run(`A.planduration({dataset:{i:'0',days:'${n}'}})`);
    assert.equal(a.elements.get('#pl-d0').value, String(n));
  }
});
test('latest confirmed payment wins over a larger expiry or an unconfirmed record', () => {
  const a = app();
  a.run(
    "S.payments.push({memberId:'m1',plan:'Older long expiry',expiry:'2099-01-01',status:'CONFIRMED'},{memberId:'m1',plan:'Latest confirmed',expiry:'2026-11-01',status:'CONFIRMED'},{memberId:'m1',plan:'Unconfirmed',expiry:'2099-02-01',status:'PENDING'})",
  );
  assert.equal(a.run("memExpiry('m1')"), '2026-11-01');
  assert.equal(a.run('memPlan(S.members[0])'), 'Latest confirmed');
});
test('expiry arithmetic covers one day, active renewal, expired renewal and leap/month boundaries', () => {
  const a = app();
  for (const [cur, pay, days, expected] of [
    [null, '2026-10-24', 1, '2026-10-24'],
    [null, '2026-10-24', 30, '2026-11-22'],
    ['2026-10-24', '2026-10-24', 7, '2026-10-31'],
    ['2026-10-23', '2026-10-24', 7, '2026-10-30'],
    ['2026-10-31', '2026-10-24', 30, '2026-11-30'],
    [null, '2028-02-28', 2, '2028-02-29'],
    [null, '2026-12-31', 2, '2027-01-01'],
  ])
    assert.equal(
      a.run(`calcExpiry(${JSON.stringify(cur)},'${pay}',${days}).exp`),
      expected,
    );
  a.run("S.payments.push({memberId:'m1',expiry:TODAY()})");
  assert.equal(a.run('memLeft(S.members[0])'), 1);
});
test('clock helper uses gym time independently of the computer timezone', () => {
  const a = app();
  const parts = a.value("clockParts(new Date('2026-10-24T22:30:00Z'))");
  assert.equal(parts.day, '25');
  assert.equal(parts.hour, '00');
  assert.equal(parts.minute, '30');
});
test('manual checkout retains both entry and exit staff', () => {
  const a = app();
  a.run(
    staff +
      "S.checkins=[{id:'TEST',m:'m1',in:nowStr(),out:null,staff:'nelisiwe'}];A.checkout({dataset:{id:'m1'}})",
  );
  assert.equal(a.run('S.checkins[0].staff'), 'nelisiwe');
  assert.equal(a.run('S.checkins[0].outBy'), 'vusi');
  assert.equal(a.run('S.checkins[0].outMethod'), 'MANUAL');
});
test('member home shows upcoming notices and gym/area hours without photos or full ID', () => {
  const a = app();
  a.run("ui.session={role:'member',id:'m1'}");
  const html = a.run('viewMember()');
  assert.ok(html.includes(a.run('upcomingNotices()[0].msg')));
  assert.match(html, /Gym and area hours/);
  assert.ok(!html.includes(a.run('S.members[0].idNum')));
  a.run("S.payments=S.payments.filter(p=>p.memberId!=='m1')");
  assert.match(
    a.run('viewMember()'),
    /No membership payment has been recorded/,
  );
});
test('gym and area overrides beat weekly schedules and gym closure closes every area', () => {
  const a = app();
  a.run(
    "S.overrides.push({id:'SUNDAY',date:'2026-10-25',closed:false,open:'09:00',close:'16:00'},{id:'AREA',date:'2026-10-25',svc:'s1',closed:false,open:'10:00',close:'18:00'})",
  );
  assert.deepEqual(a.value("hoursFor('2026-10-25','s1')"), {
    open: '10:00',
    close: '16:00',
    override: true,
  });
  a.run("S.overrides.find(o=>o.id==='SUNDAY').closed=true");
  assert.equal(a.run("hoursFor('2026-10-25','s1').closed"), true);
});
test('notice edit and cancellation preserve original author/time and append audit history', () => {
  const a = app();
  a.run(manager);
  const before = a.value('S.notices[0]');
  a.run("ui.noticeEdit='n1'");
  const f = form(
    {
      'nt-m': 'Updated message',
      'nt-s': '',
      'nt-a': before.start,
      'nt-b': before.end,
    },
    'notice',
  );
  submit(a, f);
  a.run("A.notecancel({dataset:{id:'n1'}})");
  assert.equal(a.run('S.notices[0].by'), before.by);
  assert.equal(a.run('S.notices[0].at'), before.at);
  assert.deepEqual(a.value('S.audit.map(a=>a.action)'), ['UPDATE', 'CANCEL']);
  assert.equal(a.run("S.notices.filter(n=>n.id==='n1').length"), 1);
});
test('member edit preserves relationships and rejects duplicate identity', () => {
  const a = app();
  a.run(staff + `S.members[0].photo=${JSON.stringify(PHOTO)};save();`);
  const history = a.value(
    '({payments:S.payments,checkins:S.checkins,denied:S.denied})',
  );
  const bad = form(
    {
      'me-f': 'Changed',
      'me-s': 'Member',
      'me-t': 'Student ID',
      'me-n': '202204518',
    },
    'memberedit',
    { id: 'm1' },
  );
  submit(a, bad);
  assert.match(bad.msg.textContent, /already registered/);
  const good = form(
    {
      'me-f': 'Changed',
      'me-s': 'Member',
      'me-t': 'Student ID',
      'me-n': '202301234',
    },
    'memberedit',
    { id: 'm1' },
  );
  submit(a, good);
  assert.equal(a.run('S.members[0].first'), 'Changed');
  assert.deepEqual(
    a.value('({payments:S.payments,checkins:S.checkins,denied:S.denied})'),
    history,
  );
});
test('temporary member password reset requires a different password before portal access', () => {
  const a = app();
  a.run(manager);
  submit(a, form({ 'mp-pw': 'Temporary123!' }, 'mempw', { id: 'm1' }));
  a.run("ui.session={role:'member',id:'m1'}");
  assert.match(a.run('viewMember()'), /Choose a new password/);
  submit(
    a,
    form(
      {
        'cp-old': 'Temporary123!',
        'cp-new': 'Replacement123!',
        'cp-confirm': 'Replacement123!',
      },
      'changepw',
    ),
  );
  assert.equal(a.run('S.members[0].mustChangePassword'), false);
  assert.match(a.run('viewMember()'), /Payment history/);
});
test('manager mutations are guarded even when staff call handlers or submit forms directly', () => {
  const a = app();
  a.run(staff);
  const before = a.value('S');
  a.run(
    'A.planadd();A.ovdel({dataset:{id:"o1"}});A.notecancel({dataset:{id:"n1"}})',
  );
  submit(a, form({}, 'newstaff'));
  assert.deepEqual(a.value('S'), before);
});
