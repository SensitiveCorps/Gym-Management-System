import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(script,'The selected UI must contain its application script.');

// Execute the real UI handlers with a minimal DOM and isolated synthetic storage.
function app({storage=new Map(),storageFails=false}={}){
  const elements=new Map();
  function element(key){
    if(!elements.has(key)){
      const el={innerHTML:'',textContent:'',value:'',hidden:false,dataset:{},style:{},
        focus(){},setAttribute(){},getBoundingClientRect:()=>({top:0}),scrollIntoView(){},querySelector:()=>null};
      el.parentElement=el;elements.set(key,el);
    }
    return elements.get(key);
  }
  const context={console,Date,setTimeout:()=>0,clearTimeout(){},scrollY:0,window:{scrollTo(){}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{
      if(storageFails)throw new Error('QuotaExceededError');storage.set(key,value);
    }},document:{querySelector:element,getElementById:element,addEventListener(){}},FileReader:class{},Image:class{}};
  vm.createContext(context);vm.runInContext(script,context,{timeout:5000});
  const run=code=>vm.runInContext(code,context,{timeout:5000});
  const value=code=>JSON.parse(run(`JSON.stringify(${code})`));
  return {run,value,storage,elements,failStorage:()=>{storageFails=true}};
}
const manager="ui.session={role:'manager',id:'manager'};ui.tab='inactive';";
const staff="ui.session={role:'staff',id:'vusi'};ui.tab='members';";
const retained="({members:S.members.map(({active,...m})=>m),payments:S.payments,checkins:S.checkins,denied:S.denied})";
function fixtures(a){a.run("S.members.find(m=>m.id==='m13').photo='data:image/jpeg;base64,SYNTHETIC';S.denied.push({id:'test-denial',m:'m13',time:nowStr(),idEntered:'TEST',staff:'vusi',reason:'EXPIRED'});");}

test('selected UI keeps its public entry and removes member deletion controls and handlers',()=>{
  const a=app();a.run(manager);
  assert.ok(a.run("viewPublic().includes('Membership plans')"));
  assert.doesNotMatch(a.run('pgInactive()'),/data-act="del|delete permanently/i);
  assert.equal(a.run("typeof delMember"),'undefined');
  assert.equal(a.run("['delask','delallask','delyes','delallyes'].some(k=>k in A)"),false);
});
test('single suspension preserves identity, photo, payments, visits and denial history',()=>{
  const a=app();a.run(manager);fixtures(a);const before=a.value(retained);
  assert.ok(a.run("S.checkins.some(c=>c.m==='m13')"));
  a.run("A.suspendask({dataset:{id:'m13'}});A.suspendyes({dataset:{id:'m13'}})");
  assert.equal(a.run("S.members.find(m=>m.id==='m13').active"),false);
  assert.deepEqual(a.value(retained),before);
  assert.deepEqual(a.value('S.memberStatusLog.map(({at,...event})=>event)'),[{memberId:'m13',enabled:false,by:'manager'}]);
  assert.match(a.run('S.memberStatusLog[0].at'),/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});
test('cancelled suspension makes no state or storage change',()=>{
  const a=app();a.run(manager);const before=a.value('S');
  a.run("A.suspendask({dataset:{id:'m13'}});A.suspendno();A.suspendyes({dataset:{id:'m13'}})");
  assert.deepEqual(a.value('S'),before);assert.equal(a.storage.size,0);
});
test('bulk suspension preserves all history and affects only enabled long-inactive accounts',()=>{
  const a=app();a.run(manager);fixtures(a);const before=a.value(retained);
  const ids=a.value('inactiveList().filter(m=>m.active).map(m=>m.id)');assert.ok(ids.length>1);
  a.run('A.suspendallask();A.suspendallyes()');
  assert.deepEqual(a.value('S.members.filter(m=>!m.active).map(m=>m.id)').sort(),ids.sort());
  assert.deepEqual(a.value(retained),before);assert.equal(a.run('S.memberStatusLog.length'),ids.length);
  const saved=a.storage.get('gms-demo-v3');a.run('A.suspendallask();A.suspendallyes()');
  assert.equal(a.storage.get('gms-demo-v3'),saved,'No duplicate events for already suspended accounts.');
});
test('inactive-page suspension cannot target a current paid member',()=>{
  const a=app();a.run(manager);const before=a.value('S');
  a.run("A.suspendask({dataset:{id:'m1'}});A.suspendyes({dataset:{id:'m1'}})");assert.deepEqual(a.value('S'),before);
});
test('staff can suspend and enable from Members without changing payment-derived expiry',()=>{
  const a=app();a.run(staff);fixtures(a);const before=a.value(retained),expiry=a.run("memExpiry('m1')");
  a.run("A.togglemem({dataset:{id:'m1'}})");assert.equal(a.run("S.members[0].active"),false);
  assert.equal(a.run("memExpiry('m1')"),expiry);
  a.run("A.togglemem({dataset:{id:'m1'}})");assert.equal(a.run("S.members[0].active"),true);
  assert.deepEqual(a.value(retained),before);
  assert.deepEqual(a.value('S.memberStatusLog.map(x=>x.enabled)'),[false,true]);
});
test('staff cannot invoke manager-only bulk or inactive-page suspension',()=>{
  const a=app();a.run(staff);const before=a.value('S');
  a.run("A.suspendallask();ui.suspendAsk='all';A.suspendallyes();ui.suspendAsk='m13';A.suspendyes({dataset:{id:'m13'}})");
  assert.deepEqual(a.value('S'),before);
});
test('public and member sessions cannot modify account access',()=>{
  const a=app();const before=a.value('S');
  a.run("A.togglemem({dataset:{id:'m13'}});ui.session={role:'member',id:'m1'};A.togglemem({dataset:{id:'m13'}})");
  assert.deepEqual(a.value('S'),before);
});
test('disabled staff and a forged manager role cannot change account access',()=>{
  const a=app();const before=a.value('S');
  a.run("ui.session={role:'staff',id:'bongani'};A.togglemem({dataset:{id:'m13'}});ui.session={role:'manager',id:'vusi'};A.togglemem({dataset:{id:'m13'}})");
  assert.deepEqual(a.value('S'),before);
});
test('suspension blocks check-in and appends an attributed SUSPENDED denial',()=>{
  const a=app();a.run(staff);a.run("setMemberStatuses(['m1'],false)");
  const visits=a.value('S.checkins'),denials=a.run('S.denied.length');
  a.run("A.ciconfirm({dataset:{id:'m1'}})");assert.deepEqual(a.value('S.checkins'),visits);
  assert.equal(a.run('S.denied.length'),denials+1);
  assert.deepEqual(a.value('(({reason,staff,m})=>({reason,staff,m}))(S.denied.at(-1))'),{reason:'SUSPENDED',staff:'vusi',m:'m1'});
});
test('suspended member remains searchable with accessible history and re-enable action',()=>{
  const a=app();a.run(manager);fixtures(a);a.run("setMemberStatuses(['m13'],false);ui.mq='Jabu'");
  assert.match(a.run('memTable()'),/Jabu Ndlela/);
  const detail=a.run("modalMember(S.members.find(m=>m.id==='m13'))");
  for(const label of ['Payments','Recent check-ins','Denied attempts','Account access history','Enable account'])assert.ok(detail.includes(label),label);
  assert.ok(a.run("inactiveList().some(m=>m.id==='m13')"));
});
test('suspension is separate from active-paid dashboard totals and open visits',()=>{
  const a=app();a.run(manager);const before=a.run('pgDash()'),visits=a.value('S.checkins');
  a.run("setMemberStatuses(['m1'],false)");assert.equal(a.run('pgDash()'),before);
  assert.deepEqual(a.value('S.checkins'),visits);assert.match(a.run('statusOf(S.members[0]).sub'),/paid through/);
});
test('v3 data without status history survives suspension and reload',()=>{
  const a=app();fixtures(a);a.run('save()');assert.equal('memberStatusLog' in JSON.parse(a.storage.get('gms-demo-v3')),false);
  const b=app({storage:a.storage});b.run(staff);assert.equal(b.run("setMemberStatuses(['m13'],false)"),true);
  const c=app({storage:a.storage});c.run(manager);
  assert.equal(c.run("S.members.find(m=>m.id==='m13').active"),false);
  assert.deepEqual(c.value(retained),a.value(retained));assert.equal(c.run('S.memberStatusLog.length'),1);
});
test('failed single-status persistence preserves the previous state and displays an error',()=>{
  const a=app();a.run(staff);const before=a.value('S');a.failStorage();
  a.run("A.togglemem({dataset:{id:'m13'}})");assert.deepEqual(a.value('S'),before);
  assert.match(a.elements.get('#toast-root').innerHTML,/not saved/);
});
test('failed bulk persistence cannot leave partially suspended accounts',()=>{
  const a=app();a.run(manager);const before=a.value('S');a.failStorage();
  a.run('A.suspendallask();A.suspendallyes()');assert.deepEqual(a.value('S'),before);
  assert.equal(a.run('ui.suspendAsk'),'all');assert.equal(a.storage.size,0);
});
test('unknown member and invalid status values do not write any changes',()=>{
  const a=app();a.run(staff);const before=a.value('S');
  assert.equal(a.run("setMemberStatuses(['missing'],false)"),false);
  assert.equal(a.run("setMemberStatuses(['m1'],'false')"),false);
  assert.deepEqual(a.value('S'),before);assert.equal(a.storage.size,0);
});
