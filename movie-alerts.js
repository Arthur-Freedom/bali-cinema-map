'use strict';
(function(root) {
  function unseenMovies(snapshot, through) {
    const start=Date.parse(through), end=Date.parse(snapshot?.refreshedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    return (snapshot.movies || []).filter(movie=>Date.parse(movie.firstSeenAt)>start && Date.parse(movie.firstSeenAt)<=end);
  }
  if (typeof module==='object' && module.exports) { module.exports={unseenMovies}; return; }
  const notice=document.getElementById('new-movies');
  const summary=document.getElementById('new-movies-summary');
  const list=document.getElementById('new-movies-list');
  const storageKey='bali-cinema-movies-seen-through';
  let through=null, latest=null;
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
    const movies=fromPush ? snapshot.movies.filter(movie=>requested.split(',').includes(movie.id)) : unseenMovies(snapshot,through);
    notice.hidden=!movies.length;
    if (!movies.length) return;
    summary.textContent=`${movies.length} new ${movies.length===1?'movie':'movies'}`;
    list.replaceChildren();
    for (const movie of movies) {
      const item=document.createElement('li'), button=document.createElement('button');
      button.type='button'; button.textContent=movie.title;
      button.addEventListener('click',()=>root.dispatchEvent(new CustomEvent('cinema:choose-movie',{detail:movie.id})));
      item.append(button); list.append(item);
    }
    if (fromPush) notice.open=true;
  }
  document.getElementById('new-movies-dismiss').addEventListener('click',()=>{
    if (latest) remember(latest.refreshedAt);
    const url=new URL(location.href); url.searchParams.delete('new'); history.replaceState(null,'',url);
    notice.hidden=true; notice.open=false;
  });
  root.addEventListener('storage',event=>{
    if (event.key===storageKey && Number.isFinite(Date.parse(event.newValue))) { through=event.newValue; if(latest) update(latest); }
  });
  root.CinemaMovieAlerts={update};
})(typeof window!=='undefined'?window:globalThis);
