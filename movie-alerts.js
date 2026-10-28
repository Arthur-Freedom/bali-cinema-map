'use strict';
(function(root) {
  function unseenMovies(snapshot, through) {
    const start=Date.parse(through), end=Date.parse(snapshot?.refreshedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    return (snapshot.movies || []).filter(movie=>Date.parse(movie.firstSeenAt)>start && Date.parse(movie.firstSeenAt)<=end);
  }
  function baliDate(value) {
    const time=new Date(value);
    return Number.isFinite(time.getTime()) ? new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'
    }).format(time) : null;
  }
  function arrivalGroups(snapshot, through, now=Date.now(), requested=null) {
    const today=baliDate(now), end=Date.parse(snapshot?.refreshedAt);
    const unseen=new Set(unseenMovies(snapshot,through).map(movie=>movie.id));
    const groups=new Map();
    for (const movie of snapshot?.movies || []) {
      const observed=Date.parse(movie.firstSeenAt), date=baliDate(movie.firstSeenAt);
      if (!date || !Number.isFinite(observed) || !Number.isFinite(end) || observed>end) continue;
      if (requested ? !requested.includes(movie.id) : date!==today && !unseen.has(movie.id)) continue;
      if (!groups.has(date)) groups.set(date,[]);
      groups.get(date).push(movie);
    }
    return [...groups].sort(([a],[b])=>b.localeCompare(a)).map(([date,movies])=>({date,movies:movies.sort((a,b)=>
      Date.parse(b.firstSeenAt)-Date.parse(a.firstSeenAt) || a.title.localeCompare(b.title))}));
  }
  if (typeof module==='object' && module.exports) { module.exports={unseenMovies,baliDate,arrivalGroups}; return; }
  const notice=document.getElementById('new-movies');
  const summary=document.getElementById('new-movies-summary');
  const list=document.getElementById('new-movies-list');
  const dismiss=document.getElementById('new-movies-dismiss');
  const storageKey='bali-cinema-movies-seen-through';
  let through=null, latest=null, renderedDay=null;
  try { through=localStorage.getItem(storageKey); } catch {}
  function remember(value) {
    through=value;
    try { localStorage.setItem(storageKey,value); } catch {}
  }
  function update(snapshot) {
    latest=snapshot;
    const requested=new URL(location.href).searchParams.get('new');
    const fromPush=Boolean(requested);
    if (!Number.isFinite(Date.parse(through))) remember(snapshot.refreshedAt);
    const groups=arrivalGroups(snapshot,through,Date.now(),fromPush?requested.split(','):null);
    const count=groups.reduce((total,group)=>total+group.movies.length,0);
    const today=baliDate(Date.now()), todayCount=groups.find(group=>group.date===today)?.movies.length || 0;
    renderedDay=today;
    notice.hidden=!count;
    if (!count) { notice.open=false; return; }
    summary.textContent=fromPush ? `${count} ${count===1?'movie':'movies'} from this alert`
      : todayCount ? `${todayCount} added today` : `${count} unseen ${count===1?'movie':'movies'}`;
    list.replaceChildren();
    let earlier=null;
    if (!fromPush && todayCount && count>todayCount) {
      earlier=document.createElement('details'); earlier.className='new-movies-earlier';
      const heading=document.createElement('summary'); heading.textContent=`${count-todayCount} earlier unseen`;
      earlier.append(heading);
    }
    for (const group of groups) {
      const section=document.createElement('section'), heading=document.createElement('h3'), movies=document.createElement('ul');
      const dateText=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Makassar'})
        .format(new Date(`${group.date}T12:00:00+08:00`));
      heading.textContent=`${group.date===today?'Today · ':''}${dateText} · ${group.movies.length}`;
      section.append(heading,movies);
      for (const movie of group.movies) {
        const item=document.createElement('li'), button=document.createElement('button'), language=document.createElement('small');
        button.type='button'; button.textContent=movie.title;
        const codes=root.CinemaShowtimes.movieLanguageCodes(movie);
        language.textContent=codes.length ? codes.map(root.CinemaShowtimes.languageName).join(', ') : 'Language unknown';
        button.addEventListener('click',()=>root.dispatchEvent(new CustomEvent('cinema:choose-movie',{detail:movie.id})));
        item.append(button,language); movies.append(item);
      }
      (earlier && group.date!==today ? earlier : list).append(section);
    }
    if (earlier) list.append(earlier);
    dismiss.hidden=!fromPush && !unseenMovies(snapshot,through).length;
    if (fromPush) notice.open=true;
  }
  dismiss.addEventListener('click',()=>{
    if (latest) remember(latest.refreshedAt);
    const url=new URL(location.href); url.searchParams.delete('new'); history.replaceState(null,'',url);
    notice.open=false;
    if (latest) update(latest);
  });
  root.addEventListener('storage',event=>{
    if (event.key===storageKey && Number.isFinite(Date.parse(event.newValue))) { through=event.newValue; if(latest) update(latest); }
  });
  // Refresh the date labels when a tab stays open across midnight in Bali.
  function refreshDay() { if(latest && baliDate(Date.now())!==renderedDay) update(latest); }
  root.addEventListener('focus',refreshDay);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) refreshDay();});
  root.setInterval(()=>{if(!document.hidden) refreshDay();},60000);
  root.CinemaMovieAlerts={update};
})(typeof window!=='undefined'?window:globalThis);
