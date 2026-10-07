const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../push-notifications.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function boot({saved=[],failSave=false,signedIn=true,legacy=false}={}) {
  const elements=new Map(),events={},calls=[];
  function makeElement() {
    return {hidden:false,disabled:false,checked:false,textContent:'',value:'',children:[],handlers:{},attrs:{},
      addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(...nodes){this.children=nodes;},append(...nodes){this.children.push(...nodes);},
      setAttribute(key,value){this.attrs[key]=value;},focus(){this.focused=true;}};
  }
  const element=id=>{if(!elements.has(id)) elements.set(id,makeElement()); return elements.get(id);};
  const window={CinemaShowtimes:require('../showtime-utils.js'),addEventListener:(type,fn)=>events[type]=fn,CinemaOwner:{signedIn,
    async api(path,method,body){
      calls.push({path,method,body});
      if(path==='/api/push/config') return {publicKey:'test',...(legacy?{language:saved[0]||''}:{selectedLanguages:saved}),languages:['en','id','ko','ja','cmn','ban']};
      assert.equal(path,'/api/push/preferences');
      if(failSave) throw new Error('Connection interrupted.');
      saved=body.selectedLanguages; return {selectedLanguages:saved};
    }}};
  vm.runInNewContext(source,{window,document:{getElementById:element,addEventListener:()=>{},createElement:makeElement,createTextNode:text=>({textContent:text})},
    navigator:{userAgent:'Test',platform:'Test'},matchMedia:()=>({matches:false}),localStorage:{getItem:()=>null},setTimeout,clearTimeout});
  await settle();
  const checkbox=code=>elements.get('push-language-options').children.find(label=>label.children[0].value===code).children[0];
  const toggle=(code,checked)=>{const input=checkbox(code);input.checked=checked;input.handlers.change();};
  return {elements,window,events,calls,checkbox,toggle,saved:()=>saved};
}
test('saved selections migrate and save together for every device, with readable Balinese and Mandarin labels',async()=>{
  const page=await boot({saved:['en'],legacy:true}),button=page.elements.get('push-language');
  assert.equal(button.textContent,'English');
  assert.equal(button.disabled,false);
  const labels=page.elements.get('push-language-options').children.map(label=>label.children[1].textContent);
  assert.ok(labels.includes('Mandarin')); assert.ok(labels.includes('Balinese')); assert.ok(!labels.includes('ban'));
  button.handlers.click();
  page.toggle('ko',true); page.toggle('cmn',true);
  assert.equal(page.elements.get('push-language-any').checked,false);
  assert.equal(page.saved().join(','),'en');
  await page.elements.get('push-language-save').handlers.click();
  assert.equal([...page.saved()].sort().join(','),'cmn,en,ko');
  assert.equal(page.calls.at(-1).method,'POST');
  assert.equal(page.elements.get('push-language-panel').hidden,true);
  assert.match(page.elements.get('push-preference-status').textContent,/Saved for all devices/);
  assert.equal(button.textContent,'English, Korean + 1 more');
  const next=await boot({saved:page.saved()});
  assert.equal(next.checkbox('ko').checked,true);
});
test('Any language clears specific selections; Cancel restores the saved set without an API call',async()=>{
  const page=await boot({saved:['en','ko']});
  page.elements.get('push-language').handlers.click();
  const any=page.elements.get('push-language-any'); any.checked=true; any.handlers.change();
  assert.equal(page.checkbox('en').checked,false);
  page.elements.get('push-language-cancel').handlers.click();
  assert.equal(page.checkbox('en').checked,true);
  assert.equal(page.calls.length,1);
  page.elements.get('push-language').handlers.click(); any.checked=true; any.handlers.change();
  await page.elements.get('push-language-save').handlers.click();
  assert.equal(page.saved().length,0);
  assert.equal(page.elements.get('push-language').textContent,'Any language');
});
test('failed saves retain the active preference and leave the draft available for retry',async()=>{
  const page=await boot({saved:['en'],failSave:true});
  page.elements.get('push-language').handlers.click(); page.toggle('ko',true);
  await page.elements.get('push-language-save').handlers.click();
  assert.equal(page.elements.get('push-language').textContent,'English');
  assert.equal(page.elements.get('push-language-fields').disabled,false);
  assert.equal(page.elements.get('push-language-panel').hidden,false);
  assert.match(page.elements.get('push-preference-status').textContent,/Could not save.*previous selection is still active/);
});
test('signed-out visitors cannot edit account-wide alerts; sign-out closes editing',async()=>{
  const guest=await boot({signedIn:false});
  assert.equal(guest.elements.get('push-language').disabled,true);
  assert.equal(guest.calls.length,0);
  const page=await boot({saved:['en']}); page.elements.get('push-language').handlers.click();
  page.window.CinemaOwner.signedIn=false; await page.events['cinema:owner-changed']();
  assert.equal(page.elements.get('push-language').disabled,true);
  assert.equal(page.elements.get('push-language-panel').hidden,true);
});
