import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../dist/model.mjs';

let checks=0;
const check=(name,fn)=>{fn();checks++;};
const day='2026-10-20';
const fresh=()=>core.seedState(day);
check('Local date uses gym timezone, including the UTC day boundary',()=>{
  assert.equal(core.localDate('2026-10-19T23:15:00Z'),'2026-10-20');
  assert.equal(core.localDate('2026-10-19T20:15:00Z'),'2026-10-19');
});
check('Active and expired renewals use the proposed inclusive rules',()=>{
  const s=fresh(),active=s.members[0],expired=s.members[3];
  const old=core.membership(s,active,day).expiry;
  const p=core.renew(s,active.id,{planId:'monthly',receipt:'TEST-A',cashConfirmed:true},'staff',day);
  assert.equal(p.resultingExpiry,core.addDays(old,30));
  const p2=core.renew(s,expired.id,{planId:'monthly',receipt:'TEST-B',cashConfirmed:true},'staff',day);
  assert.equal(p2.resultingExpiry,'2026-11-18');
  assert.equal(core.membership(s,expired,day).days,30);
  assert.equal(s.payments.length,14);
});
check('Duplicate receipts reject without adding a payment',()=>{
  const s=fresh(),before=JSON.stringify(s);
  assert.throws(()=>core.renew(s,s.members[0].id,{planId:'monthly',receipt:s.payments[0].receipt,cashConfirmed:true},'staff',day),/already been used/);
  assert.equal(JSON.stringify(s),before);
});
check('Registration and first payment are atomic; passwords are not retained',()=>{
  const s=fresh(),input={first:'Test',last:'Member',idType:'Passport',idNumber:'TEST-500',photo:core.avatarSVG(),password:'sample-only-password',planId:'monthly',receipt:'TEST-C',cashConfirmed:true};
  const r=core.register(s,input,'staff',day);
  assert.equal(s.members.length,13);assert.equal(s.payments.length,13);
  assert.equal(r.payment.memberId,r.member.id);assert.equal(r.payment.resultingExpiry,'2026-11-18');
  assert.ok(!JSON.stringify(s).includes(input.password));
  const before=JSON.stringify(s);assert.throws(()=>core.register(s,{...input,receipt:'TEST-D'},'manager',day),/already exists/);assert.equal(JSON.stringify(s),before);
  assert.throws(()=>core.register(s,{...input,idNumber:'TEST-501',receipt:s.payments[0].receipt},'staff',day),/already been used/);assert.equal(JSON.stringify(s),before);
});
check('Successful entry needs confirmation and permits one open visit only',()=>{
  const s=fresh(),m=s.members[0],start=s.visits.length;
  assert.equal(core.attemptCheckIn(s,m.id,false,'staff',day).reason,'Photo not confirmed');
  assert.equal(s.visits.length,start);assert.equal(s.denials.length,1);
  const ok=core.attemptCheckIn(s,m.id,true,'staff',day);assert.ok(ok.ok);assert.equal(ok.visit.confirmedBy,'staff-demo');
  assert.equal(core.attemptCheckIn(s,m.id,true,'staff',day).reason,'Already checked in');
  core.checkOut(s,ok.visit.id,'staff');assert.equal(ok.visit.source,'MANUAL');assert.equal(ok.visit.checkedOutBy,'staff-demo');
  assert.ok(core.attemptCheckIn(s,m.id,true,'staff',day).ok,'A later same-day visit is allowed');
});
check('Unknown, suspended and expired entry attempts retain actor and reason',()=>{
  const s=fresh();
  for(const [id,reason] of [['UNKNOWN','Unknown identifier'],[s.members[7].id,'Account suspended'],[s.members[3].id,'Membership expired']]){
    const r=core.attemptCheckIn(s,id,true,'manager',day);assert.equal(r.reason,reason);assert.equal(r.denial.actor,'manager-demo');assert.ok(r.denial.at);
  }
  assert.equal(s.denials[0].memberId,null);assert.equal(s.denials[1].memberId,s.members[7].id);
});
check('Public and member roles cannot mutate front-desk records',()=>{
  const s=fresh(),before=JSON.stringify(s);
  for(const role of ['public','member']){
    assert.throws(()=>core.attemptCheckIn(s,s.members[0].id,true,role,day),/staff workspace/);
    assert.throws(()=>core.renew(s,s.members[0].id,{planId:'monthly',receipt:'X',cashConfirmed:true},role,day),/staff workspace/);
    assert.throws(()=>core.checkOut(s,s.visits.find(v=>!v.checkedOut).id,role),/staff workspace/);
  }
  assert.equal(JSON.stringify(s),before);
});
check('Manager notices are immediately visible when upcoming, and cancellation is audited',()=>{
  const s=fresh(),input={message:'Test future closure',detail:'Demo',scope:'gym',starts:'2026-10-25',ends:'2026-10-25'};
  assert.throws(()=>core.publishNotice(s,input,'staff'),/Only a manager/);
  const n=core.publishNotice(s,input,'manager');assert.equal(core.visibleNotices(s,day).find(x=>x.id===n.id).status,'Upcoming');
  assert.equal(core.visibleNotices(s,'2026-10-25').find(x=>x.id===n.id).status,'In effect');
  assert.ok(!core.visibleNotices(s,'2026-10-26').some(x=>x.id===n.id));
  assert.throws(()=>core.cancelNotice(s,n.id,'staff'),/Only a manager/);
  core.cancelNotice(s,n.id,'manager');assert.ok(!core.visibleNotices(s,day).some(x=>x.id===n.id));
  assert.equal(s.audit.at(-1).action,'Cancelled notice');
});
check('Dated overrides win only on their date and stay unique per scope/date',()=>{
  const s=fresh(),input={mode:'override',scope:'gym',date:day,closed:true};
  assert.throws(()=>core.saveHours(s,input,'staff'),/Only a manager/);
  core.saveHours(s,input,'manager');assert.ok(core.resolveHours(s,'gym',day).closed);
  assert.equal(core.resolveHours(s,'gym','2026-10-21').closed,false);
  core.saveHours(s,{...input,closed:false,open:'09:00',close:'17:00'},'manager');
  assert.equal(s.overrides.length,1);assert.equal(core.resolveHours(s,'gym',day).open,'09:00');
  const before=s.audit.length;assert.throws(()=>core.saveHours(s,{...input,closed:false,open:'17:00',close:'09:00'},'manager'),/after opening/);assert.equal(s.audit.length,before);
});

// Execute templates and interaction routing with a small DOM contract.
// This is not a browser or a visual-layout test.
const els=new Map(),handlers=new Map();
const element=selector=>{if(!els.has(selector))els.set(selector,{innerHTML:'',textContent:'',value:selector==='#plan-input'?'monthly':selector==='#renew-member'?'M0001':'',checked:false,disabled:false,open:false,dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},focus(){},setSelectionRange(){},scrollIntoView(){}});return els.get(selector);};
const storage=new Map();
const sandbox={core,console,Intl,Date,Math,Set,Map,Number,String,JSON,Object,Array,Boolean,Error,URL,Blob,FileReader:class{},FormData:class{constructor(f){this.rows=Object.entries(f.fields||{});}[Symbol.iterator](){return this.rows[Symbol.iterator]();}},setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=>null,setItem(){}},window:{scrollTo(){},print(){}},document:{querySelector:element,body:{classList:{add(){},remove(){}}},addEventListener:(event,fn)=>{if(!handlers.has(event))handlers.set(event,[]);handlers.get(event).push(fn);},createElement:()=>({click(){}})}};
vm.createContext(sandbox);
let script=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const imports=script.match(/^import\s*\{([^}]+)\}[^;]+;/)[1];
script=script.replace(/^import[^;]+;/,`const {${imports}}=core;`);
vm.runInContext(script,sandbox,{timeout:5000});
const run=js=>vm.runInContext(js,sandbox,{timeout:5000});
check('All staff and manager pages render without runtime errors',()=>{
  for(const role of ['staff','manager'])for(const page of ['overview','members','attendance','payments','notices','reports',...(role==='manager'?['audit']:[])]){
    run(`role=${JSON.stringify(role)};view=${JSON.stringify(page)};render();`);const html=element('#app').innerHTML;assert.ok(html.includes('<main'));assert.ok(!html.includes('undefined'),'No missing data in '+role+'/'+page);
  }
});
check('Member and public templates exclude identity photographs and staff tools',()=>{
  for(const [role,page] of [['member','portal'],['public','status']]){
    run(`role=${JSON.stringify(role)};view=${JSON.stringify(page)};render();`);const html=element('#app').innerHTML;
    assert.ok(!html.includes('data:image'));assert.ok(!html.includes('data-action="register"'));assert.ok(!html.includes('data-action="notice"'));assert.ok(!html.includes('data-action="confirm-entry"'));
  }
});
check('Manager controls stay out of the staff notice page',()=>{
  run("role='staff';view='notices';render();");let html=element('#app').innerHTML;assert.ok(!html.includes('data-action="notice"'));assert.ok(!html.includes('data-action="hours"'));
  run("role='manager';view='notices';render();");html=element('#app').innerHTML;assert.ok(html.includes('data-action="notice"'));assert.ok(html.includes('data-action="hours"'));
});
check('Registration, renewal, entry, notice and hours dialogs render',()=>{
  run("role='staff';registerModal();");assert.ok(element('#modal').innerHTML.includes('id="register-form"'));
  run("renewModal('M0001');");assert.ok(element('#modal').innerHTML.includes('id="renew-form"'));
  run("checkinModal('M0001');");assert.ok(element('#checkin-result').innerHTML.includes('id="photo-confirm"'));assert.ok(element('#checkin-result').innerHTML.includes('disabled'));
  run("role='manager';noticeModal();");assert.ok(element('#modal').innerHTML.includes('id="notice-form"'));
  run("hoursModal();");assert.ok(element('#modal').innerHTML.includes('id="hours-form"'));
});
check('Entry confirmation cannot be bypassed through the interface event handler',()=>{
  run("role='staff';state=seedState();");element('#photo-confirm').checked=false;
  const click=handlers.get('click')[0];click({target:{closest:()=>({disabled:false,dataset:{action:'confirm-entry',id:'M0001'}})},preventDefault(){}});
  assert.equal(run('state.denials.at(-1).reason'),'Photo not confirmed');
  element('#photo-confirm').checked=true;click({target:{closest:()=>({disabled:false,dataset:{action:'confirm-entry',id:'M0001'}})},preventDefault(){}});
  assert.equal(run("!!openVisit(state,'M0001')"),true);
});
check('Responsive, keyboard and reduced-motion styles exist with no external assets',()=>{
  const css=readFileSync(new URL('../dist/styles.css',import.meta.url),'utf8');
  assert.ok(css.includes('@media(max-width:650px)'));assert.ok(css.includes('@media(max-width:900px)'));assert.ok(css.includes(':focus-visible'));assert.ok(css.includes('prefers-reduced-motion'));assert.ok(css.includes('@media print'));
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');assert.ok(html.includes('name="viewport"'));assert.ok(!css.includes('@import'));assert.ok(!html.includes('https://'));
});
console.log(`${checks} checks passed: membership transactions, attendance and denial paths, permissions, notice visibility, hours, UI templates and interaction routing.`);
console.log('Visual browser QA is not available in this environment; responsive layout is implemented but has not been browser-rendered.');
