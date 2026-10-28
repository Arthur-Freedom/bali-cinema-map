const {test}=require('node:test');
const assert=require('node:assert/strict');
const {unseenMovies,baliDate,arrivalGroups}=require('../movie-alerts.js');
test('first visit has no backlog; only later first discoveries appear, never returns or malformed dates',()=>{
  const first='2026-10-06T13:17:00+08:00', next='2026-10-07T07:17:00+08:00';
  const snapshot={refreshedAt:next,movies:[
    {id:'returning',firstSeenAt:first},{id:'new',firstSeenAt:next},{id:'unknown'},
    {id:'future',firstSeenAt:'2027-01-01T00:00:00Z'}]};
  assert.deepEqual(unseenMovies(snapshot,null),[]);
  assert.deepEqual(unseenMovies(snapshot,next),[]);
  assert.deepEqual(unseenMovies(snapshot,first).map(m=>m.id),['new']);
});

const now=Date.parse('2026-10-28T14:00:00+08:00');
const arrivals={refreshedAt:'2026-10-28T10:15:00+08:00',movies:[
  {id:'older',title:'A older film',firstSeenAt:'2026-10-26T09:00:00+08:00'},
  {id:'today-b',title:'The Mongoose',firstSeenAt:'2026-10-28T10:15:00+08:00',languageInfo:{status:'verified',codes:['en']}},
  {id:'yesterday',title:'Yesterday',firstSeenAt:'2026-10-27T09:00:00+08:00'},
  {id:'today-a',title:'HUNGRY',firstSeenAt:'2026-10-28T10:15:00+08:00',languageInfo:{status:'verified',codes:['en']}},
  {id:'unknown',title:'Unknown date'},
  {id:'null',title:'Null date',firstSeenAt:null},
  {id:'future',title:'Future',firstSeenAt:'2026-10-29T09:00:00+08:00'}
]};
test('dates use Bali midnight; backlog groups and movies put newest discoveries first',()=>{
  assert.equal(baliDate('2026-10-27T16:00:00Z'),'2026-10-28');
  assert.equal(baliDate('2026-10-27T15:59:59Z'),'2026-10-27');
  const groups=arrivalGroups(arrivals,'2026-10-25T00:00:00Z',now);
  assert.deepEqual(groups.map(g=>g.date),['2026-10-28','2026-10-27','2026-10-26']);
  assert.deepEqual(groups[0].movies.map(m=>m.id),['today-a','today-b']);
});
test('today survives acknowledgement and a first visit without creating an older backlog',()=>{
  for (const through of [null,arrivals.refreshedAt]) {
    assert.deepEqual(arrivalGroups(arrivals,through,now).flatMap(g=>g.movies.map(m=>m.id)),['today-a','today-b']);
  }
  assert.deepEqual(arrivalGroups(arrivals,null,Date.parse('2026-10-29T00:00:00+08:00')),[]);
  assert.deepEqual(arrivalGroups({...arrivals,refreshedAt:'bad'},null,now),[]);
});
test('notification links keep their exact movie selection and date order',()=>{
  assert.deepEqual(arrivalGroups(arrivals,arrivals.refreshedAt,now,['older','today-b','null','missing'])
    .flatMap(g=>g.movies.map(m=>m.id)),['today-b','older']);
});

function bootAlerts({through='2026-10-25T00:00:00Z',query='',storageFails=false}={}) {
  const vm=require('node:vm'),fs=require('node:fs'),elements=new Map(),events={},dispatched=[];
  const makeElement=tag=>({tag,children:[],handlers:{},hidden:false,open:false,textContent:'',
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
    addEventListener(type,fn){this.handlers[type]=fn;}});
  const element=id=>{if(!elements.has(id)) elements.set(id,makeElement(id));return elements.get(id);};
  let time=now,remembered=through,tick;
  const location={href:'https://arthur-freedom.github.io/bali-cinema-map/'+query};
  const window={CinemaShowtimes:require('../showtime-utils.js'),addEventListener:(type,fn)=>events[type]=fn,
    dispatchEvent:event=>dispatched.push(event),setInterval:fn=>{tick=fn;}};
  const document={getElementById:element,createElement:makeElement,hidden:false,
    addEventListener:(type,fn)=>events[type]=fn};
  class Clock extends Date { static now(){return time;} }
  vm.runInNewContext(fs.readFileSync(require.resolve('../movie-alerts.js'),'utf8'),{window,document,Date:Clock,URL,location,
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    history:{replaceState:(_state,_title,url)=>location.href=String(url)},
    localStorage:{getItem:()=>{if(storageFails)throw Error('Storage blocked');return remembered;},
      setItem:(_key,value)=>{if(storageFails)throw Error('Storage blocked');remembered=value;}}});
  window.CinemaMovieAlerts.update(arrivals);
  return {element,events,dispatched,location,window,document,tick:()=>tick(),setTime:value=>time=value,remembered:()=>remembered};
}
test('banner distinguishes today from folded older films, labels languages and opens movie comparison',()=>{
  const page=bootAlerts(),list=page.element('new-movies-list');
  assert.equal(page.element('new-movies-summary').textContent,'2 added today');
  assert.match(list.children[0].children[0].textContent,/Today · 28 Oct 2026 · 2/);
  const item=list.children[0].children[1].children[0];
  assert.equal(item.children[1].textContent,'English');
  item.children[0].handlers.click();
  assert.equal(page.dispatched[0].detail,'today-a');
  assert.equal(list.children[1].tag,'details');
  assert.equal(list.children[1].open,false);
  assert.equal(list.children[1].children[0].textContent,'2 earlier unseen');
  page.element('new-movies-dismiss').handlers.click();
  assert.equal(page.remembered(),arrivals.refreshedAt);
  assert.equal(page.element('new-movies').hidden,false);
  assert.equal(page.element('new-movies-summary').textContent,'2 added today');
  assert.equal(page.element('new-movies-dismiss').hidden,true);
  assert.equal(list.children.length,1);
});
test('notification acknowledgement returns to today and retains unrelated URL parameters',()=>{
  const page=bootAlerts({query:'?new=older&language=en'});
  assert.equal(page.element('new-movies-summary').textContent,'1 movie from this alert');
  assert.equal(page.element('new-movies').open,true);
  page.element('new-movies-dismiss').handlers.click();
  assert.equal(new URL(page.location.href).searchParams.get('new'),null);
  assert.equal(new URL(page.location.href).searchParams.get('language'),'en');
  assert.equal(page.element('new-movies-summary').textContent,'2 added today');
  assert.equal(page.element('new-movies').open,false);
});
test('storage failures are tolerated; midnight updates only on a new Bali day without disturbing open history',()=>{
  const blocked=bootAlerts({storageFails:true});
  assert.equal(blocked.element('new-movies-summary').textContent,'2 added today');
  blocked.element('new-movies-dismiss').handlers.click();
  const page=bootAlerts(),list=page.element('new-movies-list'),earlier=list.children[1];
  earlier.open=true; page.tick();
  assert.equal(list.children[1],earlier);
  assert.equal(earlier.open,true);
  page.setTime(Date.parse('2026-10-29T00:00:00+08:00'));page.events.focus();
  assert.equal(page.element('new-movies-summary').textContent,'4 unseen movies');
  assert.ok(!list.children[0].children[0].textContent.includes('Today'));
});
test('service worker restricts notification navigation to this project',async()=>{
  const vm=require('node:vm'), fs=require('node:fs');
  const handlers={}, shown=[];
  const scope='https://arthur-freedom.github.io/bali-cinema-map/';
  const messages=[];
  const self={registration:{scope,showNotification:async(...args)=>shown.push(args)},
    clients:{matchAll:async()=>[{url:scope,postMessage:d=>messages.push(d)},
      {url:'https://arthur-freedom.github.io/another-project/',postMessage:()=>assert.fail('unrelated page')} ]},
    addEventListener:(type,fn)=>handlers[type]=fn};
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),{self,URL});
  let completion;
  handlers.push({data:{json:()=>({title:'Test',url:'https://evil.example/'})},waitUntil:p=>completion=p});
  await completion;
  assert.equal(shown[0][1].data.url,scope);
  handlers.push({data:{json:()=>({url:scope+'?movie=new',test:true})},waitUntil:p=>completion=p});
  await completion;
  assert.equal(shown[1][1].data.url,scope+'?movie=new');
  assert.equal(shown[1][1].requireInteraction,true);
  assert.equal(messages[1].test,true);
  assert.equal(typeof messages[1].receivedAt,'number');
  self.registration.showNotification=async()=>{throw Error('OS refused');};
  handlers.push({data:{json:()=>({test:true})},waitUntil:p=>completion=p});
  await assert.rejects(completion,/OS refused/);
  assert.equal(messages.length,2,'do not acknowledge when notification creation fails');
  assert.equal(handlers.fetch,undefined);
});
