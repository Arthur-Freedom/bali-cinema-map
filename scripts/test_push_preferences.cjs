const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../push-notifications.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function boot({saved='',failSave=false,signedIn=true}={}) {
  const elements=new Map(),events={},calls=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{hidden:false,disabled:false,textContent:'',value:'',options:[],handlers:{},
      addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(...options){this.options=options;},add(option){this.options.push(option);}});
    return elements.get(id);
  };
  const window={addEventListener:(type,fn)=>events[type]=fn,CinemaOwner:{signedIn,
    async api(path,method,body){
      calls.push({path,method,body});
      if(path==='/api/push/config') return {publicKey:'test',language:saved,languages:['en','id','ja','cmn']};
      assert.equal(path,'/api/push/preferences');
      if(failSave) throw new Error('Connection interrupted.');
      saved=body.language; return {language:saved};
    }}};
  vm.runInNewContext(source,{window,document:{getElementById:element,addEventListener:()=>{}},
    navigator:{userAgent:'Test',platform:'Test'},matchMedia:()=>({matches:false}),localStorage:{getItem:()=>null},
    Option:function(text,value){this.text=text;this.value=value;},setTimeout,clearTimeout});
  await settle();
  return {elements,window,events,calls,saved:()=>saved};
}
test('saved language loads on any signed-in device and changes save independently of browsing filters',async()=>{
  const page=await boot({saved:'en'}),select=page.elements.get('push-language');
  assert.equal(select.value,'en');
  assert.equal(select.disabled,false);
  assert.equal(select.options.find(o=>o.value==='cmn').text,'Mandarin');
  select.value='cmn'; await select.handlers.change();
  assert.equal(page.saved(),'cmn');
  assert.equal(page.calls.at(-1).method,'POST');
  assert.match(page.elements.get('push-preference-status').textContent,/Saved for all devices.*Mandarin/);
  assert.equal((await boot({saved:page.saved()})).elements.get('push-language').value,'cmn');
});
test('failed save restores the confirmed preference and reports failure',async()=>{
  const page=await boot({saved:'en',failSave:true}),select=page.elements.get('push-language');
  select.value=''; await select.handlers.change();
  assert.equal(select.value,'en');
  assert.equal(select.disabled,false);
  assert.match(page.elements.get('push-preference-status').textContent,/Could not save/);
});
test('signed-out visitors cannot change account-wide alerts; sign-out disables editing',async()=>{
  const guest=await boot({signedIn:false});
  assert.equal(guest.elements.get('push-language').disabled,true);
  assert.equal(guest.calls.length,0);
  const page=await boot({saved:'en'});
  page.window.CinemaOwner.signedIn=false;
  await page.events['cinema:owner-changed']();
  assert.equal(page.elements.get('push-language').disabled,true);
});
