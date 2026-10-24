/* Same-origin API adapter. This file is loaded only by the authenticated server. */
let csrfToken = null,
  serverBusy = false,
  searchSequence = 0;
const pendingRequests = new Map();
const paymentPreviews = new WeakMap();

function resetPaymentPreview(form) {
  if (!form) return;
  paymentPreviews.delete(form);
  const summary = form.querySelector(
    form.dataset.form === 'register' ? '#rg-sum' : '#rn-calc',
  );
  if (summary)
    summary.textContent =
      'Review the payment to see the price, payment date and new expiry before collecting cash.';
  const button = form.querySelector('button[type="submit"]');
  if (button) button.textContent = 'Review payment';
}
function paymentChoice(form) {
  const registration = form.dataset.form === 'register';
  return {
    planId: form.querySelector(registration ? '#rg-l' : '#rn-p')?.value,
    memberId: registration ? null : ui.modal?.id,
  };
}
function paymentPreviewMarkup(preview) {
  return `<table class="calc"><tbody>
    <tr><td>Plan</td><td>${esc(preview.planName)}</td></tr>
    <tr><td>Cash to collect</td><td>${E(preview.price)}</td></tr>
    <tr><td>Payment date</td><td>${fmtL(preview.paymentDate)}</td></tr>
    <tr><td>Current expiry</td><td>${preview.expiryBefore ? fmtL(preview.expiryBefore) : 'None'}</td></tr>
    <tr><td>Duration purchased</td><td>${preview.days} days</td></tr>
    <tr><td>New expiry</td><td>${fmtL(preview.expiryAfter)}</td></tr>
    </tbody></table>`;
}
async function reviewedPayment(form) {
  const choice = paymentChoice(form),
    signature = JSON.stringify(choice);
  const saved = paymentPreviews.get(form);
  if (saved?.signature === signature && saved.expected) return saved.expected;
  const pending = { signature };
  paymentPreviews.set(form, pending);
  const button = form.querySelector('button[type="submit"]');
  serverBusy = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Loading payment preview…';
  }
  try {
    const path =
      '/payments/preview?planId=' +
      encodeURIComponent(choice.planId) +
      (choice.memberId === null
        ? ''
        : '&memberId=' + encodeURIComponent(choice.memberId));
    const expected = await api(path);
    // Changing plans or closing/replacing the form invalidates an in-flight preview.
    if (paymentPreviews.get(form) !== pending || form.isConnected === false)
      return null;
    if (JSON.stringify(paymentChoice(form)) !== signature) {
      resetPaymentPreview(form);
      return null;
    }
    paymentPreviews.set(form, { signature, expected });
    const summary = form.querySelector(
      form.dataset.form === 'register' ? '#rg-sum' : '#rn-calc',
    );
    if (summary) summary.innerHTML = paymentPreviewMarkup(expected);
    if (button) button.textContent = 'Confirm payment of ' + E(expected.price);
    setMsg(
      form,
      'Review the terms above, then confirm after collecting cash.',
      'info',
    );
  } catch (error) {
    resetPaymentPreview(form);
    setMsg(form, error.message);
  } finally {
    serverBusy = false;
    if (button) button.disabled = false;
  }
  return null;
}
async function api(path, { method = 'GET', body, key } = {}) {
  const response = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function mergeMemberData(data) {
  for (const field of ['members', 'payments', 'checkins', 'denied']) {
    const byId = new Map(S[field].map((x) => [x.id, x]));
    for (const item of data[field] || []) byId.set(item.id, item);
    S[field] = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }
}
async function loadServerState(extraId) {
  const wanted = [...new Set([ui.modal?.id, extraId].filter(Boolean))],
    data = await api('/state');
  csrfToken = data.csrf;
  ui.session = data.session;
  S = data.state;
  if (!ui.session) {
    ui.modal = null;
    ui.peek = false;
    ui.view = 'public';
    return;
  }
  if (ui.session.role === 'staff') {
    for (const id of wanted)
      mergeMemberData(await api('/members/' + encodeURIComponent(id)));
    const query = (ui.tab === 'members' ? ui.mq : ui.q).trim();
    if (query)
      mergeMemberData(await api('/members?q=' + encodeURIComponent(query)));
  }
}
async function startServerMode() {
  try {
    await loadServerState();
    if (ui.session) ui.tab = ui.session.role === 'manager' ? 'dash' : 'checkin';
    render();
  } catch {
    document.querySelector('#app').innerHTML =
      '<main class="wrap"><div class="msg bad" role="alert">The server could not load the gym data. Reload the page to try again.</div></main>';
  }
}
async function runServer(action, data, form, after) {
  if (serverBusy) return;
  serverBusy = true;
  const signature = action + '\n' + JSON.stringify(data);
  const key = pendingRequests.get(signature) || crypto.randomUUID();
  pendingRequests.set(signature, key);
  try {
    const result = await api('/actions/' + action, {
      method: 'POST',
      body: data,
      key,
    });
    await loadServerState(result.memberId || data.id);
    pendingRequests.delete(signature);
    after?.(result);
    render();
    return result;
  } catch (error) {
    if (error.status && error.status < 500) pendingRequests.delete(signature);
    if (
      ['register', 'renew'].includes(action) &&
      [400, 409].includes(error.status)
    )
      resetPaymentPreview(form);
    if (error.status === 401) {
      await loadServerState();
      ui.view = 'login';
      render();
    } else if (form?.querySelector('.msg')) setMsg(form, error.message);
    else toast(error.message);
  } finally {
    serverBusy = false;
  }
}
const SERVER_ACTIONS = {
  ciconfirm: (t) => [
    'checkin',
    {
      memberId: t.dataset.id,
      entered:
        ui.q.trim() || S.members.find((m) => m.id === t.dataset.id).idNum,
      confirmed: true,
    },
  ],
  ciphoto: (t) => [
    'checkin',
    {
      memberId: t.dataset.id,
      entered:
        ui.q.trim() || S.members.find((m) => m.id === t.dataset.id).idNum,
      confirmed: false,
    },
  ],
  cinomatch: () => [
    'checkin',
    { memberId: null, entered: ui.q.trim(), confirmed: false },
  ],
  checkout: (t) => ['checkout', { id: t.dataset.id }],
  togglemem: (t) => [
    'memberstatus',
    {
      ids: [t.dataset.id],
      enabled: !S.members.find((m) => m.id === t.dataset.id).active,
    },
  ],
  suspendyes: (t) => [
    'memberstatus',
    { ids: [t.dataset.id], enabled: false, inactiveOnly: true },
  ],
  suspendallyes: () => [
    'memberstatus',
    {
      ids: inactiveList()
        .filter((m) => m.active)
        .map((m) => m.id),
      enabled: false,
      inactiveOnly: true,
    },
  ],
  ovdel: (t) => ['overridecancel', { id: t.dataset.id }],
  notecancel: (t) => ['noticecancel', { id: t.dataset.id }],
  pwsave: (t) => [
    'staffreset',
    { username: t.dataset.u, password: $('#sp-p').value },
  ],
  stsave: (t) => [
    'staffedit',
    {
      username: t.dataset.u,
      newUsername: $('#se-u').value,
      name: $('#se-n').value,
    },
  ],
  sttoggle: (t) => ['stafftoggle', { username: t.dataset.u }],
  msgdel: (t) => ['messagecancel', { id: t.dataset.id }],
};
async function serverAction(name, t) {
  if (
    (name === 'suspendyes' && ui.suspendAsk !== t.dataset.id) ||
    (name === 'suspendallyes' && ui.suspendAsk !== 'all')
  )
    return;
  const [action, data] = SERVER_ACTIONS[name](t);
  return runServer(action, data, null, (result) => {
    ui.suspendAsk = null;
    ui.staffPw = null;
    ui.staffEdit = null;
    if (action === 'checkin') {
      const days = result.accepted
        ? memLeft(S.members.find((m) => m.id === data.memberId))
        : null;
      ui.ciMsg = {
        type: result.accepted ? (days < 10 ? 'warn' : 'good') : 'bad',
        text: result.accepted
          ? 'Member checked in. ' +
            days +
            ' paid days remain.' +
            (days < 10 ? ' Advise the member to renew soon.' : '')
          : 'Entry refused: ' + result.reason,
      };
    } else if (action === 'checkout')
      ui.ciMsg = {
        type: 'info',
        text: 'Checkout recorded with your staff account and the exit time.',
      };
    else toast('Change saved.');
  });
}
async function serverSubmit(f) {
  const k = f.dataset.form,
    v = (id) => (f.querySelector('#' + id) || {}).value;
  if (k === 'login') {
    if (serverBusy) return;
    serverBusy = true;
    try {
      const result = await api('/login', {
        method: 'POST',
        body: {
          role: ui.login,
          username: v('lg-u'),
          idType: v('lg-idt'),
          idNum: v('lg-id'),
          password: v('lg-p'),
        },
      });
      csrfToken = result.csrf;
      await loadServerState();
      ui.tab = ui.session.role === 'manager' ? 'dash' : 'checkin';
      ui.loginErr = '';
      ui.peek = false;
      ui.view = 'app';
      lastActivity = Date.now();
      render();
    } catch (e) {
      setMsg(f, e.message);
    } finally {
      serverBusy = false;
    }
    return;
  }
  const forms = {
    register: () => [
      'register',
      {
        first: v('rg-f'),
        sur: v('rg-s'),
        idType: v('rg-t'),
        idNum: v('rg-n'),
        password: v('rg-p'),
        photo: ui.regPhoto,
        plan: v('rg-l'),
        receipt: v('rg-r'),
      },
    ],
    renew: () => [
      'renew',
      { id: ui.modal.id, plan: ui.modal.plan, receipt: v('rn-r') },
    ],
    memberedit: () => [
      'memberedit',
      {
        id: f.dataset.id,
        first: v('me-f'),
        sur: v('me-s'),
        idType: v('me-t'),
        idNum: v('me-n'),
        photo: ui.editPhoto,
      },
    ],
    changepw: () => [
      'changepw',
      { current: v('cp-old'), password: v('cp-new'), confirm: v('cp-confirm') },
    ],
    mempw: () => ['mempw', { id: f.dataset.id, password: v('mp-pw') }],
    newstaff: () => [
      'newstaff',
      { name: v('ns-n'), username: v('ns-u'), password: v('ns-p') },
    ],
    plans: () => [
      'plans',
      {
        plans: S.plans.map((p, i) => ({
          ...p,
          name: v('pl-n' + i),
          price: v('pl-p' + i),
          days: v('pl-d' + i),
          on: f.querySelector('#pl-o' + i).checked,
        })),
      },
    ],
    hours: () => [
      'hours',
      {
        scope: f.dataset.scope || null,
        week: DAYN.map((_, i) => ({
          closed: f.querySelector('#hr-x' + i).checked,
          open: v('hr-o' + i),
          close: v('hr-c' + i),
        })),
      },
    ],
    override: () => [
      'override',
      {
        scope: v('ov-scope') || null,
        date: v('ov-d'),
        closed: f.querySelector('#ov-closed').checked,
        open: v('ov-o'),
        close: v('ov-c'),
        reason: v('ov-r'),
      },
    ],
    notice: () => [
      'notice',
      {
        id: ui.noticeEdit,
        scope: v('nt-s') || null,
        message: v('nt-m'),
        start: v('nt-a'),
        end: v('nt-b'),
      },
    ],
    contact: () => [
      'contact',
      { address: v('ct-a'), phone: v('ct-p'), email: v('ct-e') },
    ],
    svc: () => ['service', { service: ui.draft }],
    staffmsg: () => ['staffmsg', { to: v('sm-to'), message: v('sm-m') }],
  };
  if (!forms[k]) return;
  const [action, data] = forms[k]();
  if (['register', 'renew'].includes(k)) {
    if (serverBusy) return;
    const expected = await reviewedPayment(f);
    if (!expected) return;
    data.expected = expected;
  }
  await runServer(action, data, f, (result) => {
    if (k === 'register') {
      ui.regDone = S.members.find((m) => m.id === result.memberId);
      ui.regPhoto = null;
    }
    if (['renew', 'memberedit'].includes(k)) ui.modal = null;
    if (k === 'svc') ui.draft = null;
    if (k === 'notice') ui.noticeEdit = null;
    toast('Saved successfully.');
  });
}
async function serverSearch(input) {
  const query = input.value.trim(),
    seq = ++searchSequence;
  if (!query) {
    ui.q = '';
    ui.mq = '';
    if (input.dataset.live === 'ci') ciRefresh();
    else $('#mem-tbl').innerHTML = memTable();
    return;
  }
  try {
    const data = await api('/members?q=' + encodeURIComponent(query));
    if (
      seq !== searchSequence ||
      !ui.session ||
      !['staff', 'manager'].includes(ui.session.role)
    )
      return;
    mergeMemberData(data);
    if (input.dataset.live === 'ci') {
      ui.q = query;
      ui.ciMsg = null;
      ciRefresh();
    } else {
      ui.mq = query;
      $('#mem-tbl').innerHTML = memTable();
    }
  } catch (error) {
    toast(error.message);
  }
}
async function serverMemberView(t, kind) {
  try {
    mergeMemberData(await api('/members/' + encodeURIComponent(t.dataset.id)));
    openModal({ t: kind, id: t.dataset.id, plan: null });
  } catch (error) {
    toast(error.message);
  }
}
async function serverLogout() {
  try {
    await api('/logout', { method: 'POST', body: {} });
  } catch (error) {
    if (error.status !== 401) {
      toast('Sign-out could not be confirmed. Try again.');
      return;
    }
  }
  csrfToken = null;
  pendingRequests.clear();
  ui.modal = null;
  ui.draft = null;
  ui.regPhoto = null;
  ui.regDone = null;
  ui.session = null;
  ui.view = 'public';
  await startServerMode();
}

// Public polling updates announcements without extending an authenticated session's idle timer.
if (typeof setInterval === 'function')
  setInterval(async () => {
    try {
      if (ui.session?.role === 'manager') return;
      const fresh = await api('/public');
      for (const field of [
        'notices',
        'hours',
        'areaHours',
        'overrides',
        'services',
        'plans',
        'contact',
      ])
        S[field] = fresh[field];
      if (
        !ui.modal &&
        (ui.peek ||
          (!ui.session && ui.view === 'public') ||
          (ui.session?.role === 'member' && !me()?.mustChangePassword))
      )
        render();
    } catch {
      /* Keep the last successful display; explicit actions still report network failures. */
    }
  }, 30000);
