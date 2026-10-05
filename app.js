'use strict';
(() => {
  const search = document.getElementById('search');
  const list = document.getElementById('cinema-list');
  const count = document.getElementById('count');
  const empty = document.getElementById('empty');
  const notice = document.getElementById('map-notice');
  const home = document.getElementById('show-all');
  const choosePoint = document.getElementById('choose-point');
  const clearPoint = document.getElementById('clear-point');
  const useLocation = document.getElementById('use-location');
  const pointStatus = document.getElementById('point-status');
  const pointHint = document.getElementById('point-hint');
  const app = document.querySelector('.app');
  const movieSelect = document.getElementById('movie-select');
  const formatSelect = document.getElementById('format-select');
  const priceSort = document.getElementById('price-sort');
  const movieDataStatus = document.getElementById('movie-data-status');
  const comparisonRows = document.getElementById('comparison-rows');
  const movieSource = document.getElementById('movie-source');
  let showtimes = null, comparing = false;
  const colors = {XXI:'#9a6c19', 'Cinépolis':'#235aa7', Independent:'#a3405b'};
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cinemas = [], selected = null, map = null, ready = false;
  let origin = null, originMarker = null, choosing = false;
  let hovered = null, focused = null, labelPopup = null;
  let labelExitTimer = null;
  try {
    const saved = JSON.parse(localStorage.getItem('bali-cinema-starting-point'));
    if (Array.isArray(saved) && saved.length === 2 && saved.every(Number.isFinite) && Math.abs(saved[0]) <= 180 && Math.abs(saved[1]) <= 90) origin = saved;
  } catch {}
  const pins = new Map();
  const rows = new Map();
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const rupiah = price => `Rp${new Intl.NumberFormat('id-ID').format(price)}`;
  const requestedMovie = new URL(window.location.href).searchParams.get('movie');

  function setView(value) {
    comparing = value === 'movies';
    if (comparing) { setChoosing(false); hovered = null; focused = null; if (labelPopup) labelPopup.remove(); }
    app.classList.toggle('is-comparing', comparing);
    document.getElementById('view-map').setAttribute('aria-pressed', String(!comparing));
    document.getElementById('view-movies').setAttribute('aria-pressed', String(comparing));
    document.getElementById('movie-finder').hidden = !comparing;
    document.getElementById('comparison').hidden = !comparing;
    document.getElementById('map-view').hidden = comparing;
    updateMovieUrl();
    if (!comparing && map) requestAnimationFrame(() => map.resize());
  }
  function updateMovieUrl() {
    const url = new URL(window.location.href);
    if (comparing && movieSelect.value) url.searchParams.set('movie', movieSelect.value);
    else url.searchParams.delete('movie');
    window.history.replaceState(null, '', url);
  }
  function movieOffers() {
    return (showtimes?.screenings || []).filter(s => s.movieId === movieSelect.value);
  }
  function buildFormats() {
    const previous = formatSelect.value;
    formatSelect.replaceChildren(new Option('All formats', ''));
    [...new Set(movieOffers().map(s => s.format))].sort().forEach(format => formatSelect.add(new Option(format, format)));
    formatSelect.value = [...formatSelect.options].some(o => o.value === previous) ? previous : '';
    formatSelect.disabled = !movieSelect.value;
  }
  function renderComparison() {
    priceSort.querySelector('option[value="distance"]').disabled = !origin;
    if (!origin && priceSort.value === 'distance') priceSort.value = 'price';
    const movie = showtimes?.movies.find(m => m.id === movieSelect.value);
    document.getElementById('comparison-title').textContent = movie?.title || 'Pick a movie to compare';
    document.getElementById('comparison-results').hidden = !movie;
    movieSource.hidden = !movie;
    if (!movie) {
      document.getElementById('comparison-summary').textContent = 'See each venue, studio format, ticket price and showtime in one overview.';
      return;
    }
    movieSource.href = `${movie.url.replace(/\/$/, '')}/di-bali/`;
    const all = movieOffers();
    const offers = all.filter(s => !formatSelect.value || s.format === formatSelect.value)
      .map(s => ({...s, cinema: cinemas.find(c => c.id === s.cinemaId)})).filter(s => s.cinema);
    const priced = offers.filter(s => Number.isFinite(s.price));
    const minimum = priced.length ? Math.min(...priced.map(s => s.price)) : null;
    const maximum = priced.length ? Math.max(...priced.map(s => s.price)) : null;
    offers.sort((a, b) => {
      if (priceSort.value === 'distance' && origin) return distance(a.cinema) - distance(b.cinema) || (a.price ?? Infinity) - (b.price ?? Infinity);
      if (priceSort.value === 'name') return a.cinema.name.localeCompare(b.cinema.name) || (a.price ?? Infinity) - (b.price ?? Infinity);
      return (a.price ?? Infinity) - (b.price ?? Infinity) || a.cinema.name.localeCompare(b.cinema.name) || a.format.localeCompare(b.format);
    });
    const venueCount = new Set(offers.map(s => s.cinemaId)).size;
    const dateText = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Makassar'}).format(new Date(`${showtimes.date}T12:00:00+08:00`));
    document.getElementById('comparison-summary').textContent = `${dateText} · ${venueCount} ${venueCount === 1 ? 'venue' : 'venues'}${minimum !== null ? ' · ' + rupiah(minimum) + (maximum !== minimum ? '–' + rupiah(maximum) : '') : ''}${formatSelect.value ? ' · ' + formatSelect.value : ' · all formats'}`;
    comparisonRows.replaceChildren();
    offers.forEach(offer => {
      const c = offer.cinema;
      const row = document.createElement('tr');
      const venue = document.createElement('th'); venue.scope = 'row';
      const name = document.createElement('strong'); name.textContent = c.name;
      const area = document.createElement('span'); area.className = 'venue-meta';
      area.textContent = `${c.area} · ${c.chain}${origin ? ' · ' + distanceText(c) : ''}`;
      const links = document.createElement('div'); links.className = 'venue-links';
      const onMap = document.createElement('button'); onMap.type = 'button'; onMap.textContent = 'Show on map';
      onMap.setAttribute('aria-label', `Show ${c.name} on map`);
      onMap.addEventListener('click', () => {
        search.value = ''; renderSearch(); setView('map'); showCinema(c);
        pins.get(c.id)?.element.focus({preventScroll:true});
      });
      const source = document.createElement('a'); source.textContent = 'Check listing ↗'; source.href = c.scheduleUrl; source.target = '_blank'; source.rel = 'noopener';
      source.setAttribute('aria-label', `Check ${c.name} listing`);
      links.append(onMap, source); venue.append(name, area, links);
      const format = document.createElement('td'); format.dataset.label = 'Studio';
      const formatTag = document.createElement('span'); formatTag.className = 'format-tag'; formatTag.textContent = offer.format;
      format.append(formatTag);
      const price = document.createElement('td'); price.dataset.label = 'Ticket price'; price.className = 'ticket-price';
      const amount = document.createElement('strong'); amount.textContent = Number.isFinite(offer.price) ? rupiah(offer.price) : 'Not listed'; price.append(amount);
      if (offer.price !== null && offer.price === minimum) {
        const badge = document.createElement('span'); badge.className = 'lowest-price'; badge.textContent = 'Lowest listed'; price.append(badge);
      }
      const times = document.createElement('td'); times.dataset.label = 'Showtimes · WITA'; times.className = 'showtimes';
      offer.times.forEach(time => {const span = document.createElement('span'); span.textContent = time; times.append(span);});
      row.append(venue, format, price, times); comparisonRows.append(row);
    });
    document.getElementById('comparison-empty').hidden = offers.length > 0;
    const listedIds = new Set(all.map(s => s.cinemaId));
    const unlisted = cinemas.filter(c => !listedIds.has(c.id));
    document.getElementById('unlisted-venues').hidden = !unlisted.length;
    document.getElementById('unlisted-summary').textContent = `${unlisted.length} ${unlisted.length === 1 ? 'cinema has' : 'cinemas have'} no listing for this movie`;
    document.getElementById('unlisted-names').textContent = `${unlisted.map(c => c.name).join(' · ')}. No listing in the saved schedule; this does not confirm the film is unavailable.`;
    const refreshed = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Makassar'}).format(new Date(showtimes.refreshedAt));
    document.getElementById('comparison-updated').textContent = `Source: JadwalNonton · ${showtimes.sources.length} cinema schedules checked · refreshed ${refreshed} WITA. Listed prices may differ from the final booking total.`;
  }
  function loadMovies() {
    fetch('./showtimes.json', {cache:'no-store'}).then(response => {
      if (!response.ok) throw new Error('Movie listings unavailable');
      return response.json();
    }).then(data => {
      if (!Array.isArray(data.movies) || !data.movies.length || !Array.isArray(data.screenings)) throw new Error('Invalid movie listings');
      showtimes = data;
      movieSelect.replaceChildren(new Option('Choose a movie…', ''));
      data.movies.forEach(movie => movieSelect.add(new Option(movie.title, movie.id)));
      movieSelect.disabled = false;
      const dateText = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', timeZone:'Asia/Makassar'}).format(new Date(`${data.date}T12:00:00+08:00`));
      movieDataStatus.textContent = `${data.movies.length} movies · listings for ${dateText}`;
      const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Makassar', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
      const warning = document.getElementById('snapshot-warning');
      warning.hidden = data.date === today;
      warning.textContent = `These are saved listings for ${dateText}, not today’s schedule. Open the source listing for current prices and showtimes.`;
      if (requestedMovie && data.movies.some(m => m.id === requestedMovie)) movieSelect.value = requestedMovie;
      else if (requestedMovie) movieDataStatus.textContent += ' · The linked movie is no longer in this snapshot. Choose another movie.';
      buildFormats(); renderComparison(); updateMovieUrl();
    }).catch(() => {
      movieSelect.replaceChildren(new Option('Movies unavailable', ''));
      movieDataStatus.replaceChildren();
      const message = document.createTextNode('Movie listings could not load. ');
      const source = document.createElement('a'); source.textContent = 'Browse current Bali schedules ↗'; source.href = 'https://jadwalnonton.com/bioskop/di-bali/'; source.target = '_blank'; source.rel = 'noopener';
      movieDataStatus.append(message, source);
    });
  }
  document.getElementById('view-map').addEventListener('click', () => setView('map'));
  document.getElementById('view-movies').addEventListener('click', () => setView('movies'));
  movieSelect.addEventListener('change', () => {formatSelect.value = ''; buildFormats(); renderComparison(); updateMovieUrl();});
  formatSelect.addEventListener('change', renderComparison);
  priceSort.addEventListener('change', renderComparison);
  if (requestedMovie) setView('movies');

  function cinemaIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
    svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','1.8'); svg.setAttribute('stroke-linecap','round');
    svg.setAttribute('stroke-linejoin','round');
    const frame = document.createElementNS(svg.namespaceURI,'rect');
    frame.setAttribute('x','3'); frame.setAttribute('y','4'); frame.setAttribute('width','18');
    frame.setAttribute('height','16'); frame.setAttribute('rx','2');
    const perforations = document.createElementNS(svg.namespaceURI,'path');
    perforations.setAttribute('d','M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4');
    svg.append(frame,perforations); return svg;
  }
  function cinemaActions(c) {
    const actions = document.createElement('div'); actions.className = 'actions';
    [['Films & prices',c.scheduleUrl],['Directions',`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.name+' '+c.address)}${origin ? '&origin='+encodeURIComponent(origin[1]+','+origin[0]) : ''}`]].forEach(([text,url])=>{
      const a = document.createElement('a'); a.textContent=text; a.href=url; a.target='_blank'; a.rel='noopener'; actions.append(a);
    });
    return actions;
  }
  function scheduleLabelExit(id) {
    window.clearTimeout(labelExitTimer);
    labelExitTimer = window.setTimeout(()=>{
      if(labelPopup?.getElement().contains(document.activeElement)) return;
      if(hovered===id) hovered=null;
      renderMapLabel();
    },200);
  }
  function renderMapLabel() {
    const id = hovered || focused || selected;
    const cinema = cinemas.find(c=>c.id===id);
    pins.forEach(pin=>pin.element.removeAttribute('aria-describedby'));
    if (!map || !cinema || pins.get(id)?.element.style.display === 'none' || choosing) {
      if(labelPopup) labelPopup.remove();
      return;
    }
    const content = document.createElement('div'); content.id = 'cinema-map-label';
    const name = document.createElement('strong'); name.textContent = cinema.name;
    const area = document.createElement('span'); area.textContent = `${cinema.area} · ${cinema.chain}${origin ? ' · '+distanceText(cinema) : ''}`;
    const address = document.createElement('p'); address.className = 'cinema-address'; address.textContent = cinema.address;
    content.append(name,area,address);
    if(cinema.accuracy !== 'cinema') {
      const note = document.createElement('p'); note.className = 'location-note';
      note.textContent = cinema.accuracy === 'approximate' ? 'Approximate pin · use Directions for the venue.' : 'Pin marks the mall location.';
      content.append(note);
    }
    content.append(cinemaActions(cinema));
    content.addEventListener('mouseenter',()=>window.clearTimeout(labelExitTimer));
    content.addEventListener('mouseleave',()=>scheduleLabelExit(cinema.id));
    content.addEventListener('focusin',()=>{window.clearTimeout(labelExitTimer);hovered=cinema.id;});
    content.addEventListener('focusout',event=>{if(!content.contains(event.relatedTarget))scheduleLabelExit(cinema.id);});
    if(!labelPopup) labelPopup = new maplibregl.Popup({closeButton:false,closeOnClick:false,focusAfterOpen:false,offset:24,maxWidth:'270px',className:'cinema-label'});
    labelPopup.setLngLat(cinema.coordinates).setDOMContent(content).addTo(map);
    labelPopup.getElement().setAttribute('role','group');
    labelPopup.getElement().setAttribute('aria-label',cinema.name);
    pins.get(id).element.setAttribute('aria-describedby',content.id);
  }

  function distance(c) {
    const radians = degrees => degrees * Math.PI / 180;
    const [lon1, lat1] = origin.map(radians), [lon2, lat2] = c.coordinates.map(radians);
    const a = Math.sin((lat2-lat1)/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin((lon2-lon1)/2)**2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0,1-a)));
  }
  function distanceText(c) { return `${distance(c).toFixed(1)} km away`; }
  function setChoosing(value) {
    choosing = value; choosePoint.textContent = value ? 'Cancel choosing' : 'Choose on map';
    choosePoint.setAttribute('aria-pressed',String(value)); pointHint.hidden = !value;
    if (map) map.getCanvas().style.cursor = value ? 'crosshair' : '';
    renderMapLabel();
  }
  function renderOrigin() {
    clearPoint.hidden = !origin;
    pointStatus.textContent = origin ? 'Nearest first · straight-line distance. Saved in this browser.' : 'Set a starting point to sort cinemas by distance.';
    if (originMarker) { originMarker.remove(); originMarker = null; }
    if (origin && map) {
      const element = document.createElement('div'); element.className = 'origin-pin'; element.title = 'You · starting point';
      const dot = document.createElement('span'); dot.className = 'origin-dot';
      const label = document.createElement('span'); label.className = 'origin-label'; label.textContent = 'You';
      element.append(dot,label);
      originMarker = new maplibregl.Marker({element}).setLngLat(origin).addTo(map);
      element.setAttribute('aria-label','You · starting point');
    }
    renderSearch();
    if (selected) showCinema(cinemas.find(c=>c.id===selected));
    renderComparison();
  }
  function setOrigin(coords) {
    origin = coords; setChoosing(false);
    try { if(origin) localStorage.setItem('bali-cinema-starting-point',JSON.stringify(origin)); else localStorage.removeItem('bali-cinema-starting-point'); } catch {}
    renderOrigin();
    if(origin && ready) fit([...(matched().length ? matched() : cinemas), {coordinates:origin}]);
  }

  function matched() {
    const query = normalize(search.value.trim());
    const results = cinemas.filter(c => normalize([c.name,c.area,c.chain,c.address].join(' ')).includes(query));
    return origin ? results.sort((a,b)=>distance(a)-distance(b) || a.number-b.number) : results;
  }
  function bounds(items) {
    const ext = new maplibregl.LngLatBounds();
    items.forEach(c => ext.extend(c.coordinates));
    return ext;
  }
  function fit(items = cinemas) {
    if (!map || !ready || !items.length) return;
    map.fitBounds(bounds(items), {padding:{top:78,bottom:80,left:56,right:56},maxZoom:12.5,duration:reduceMotion?0:700});
  }
  function renderSearch() {
    const results = matched(), ids = new Set(results.map(c => c.id));
    results.forEach(c => {
      const row = rows.get(c.id);
      if(row) {row.querySelector('small').textContent = `${c.area} · ${c.chain}${origin ? ' · '+distanceText(c) : ''}`; list.append(row);}
    });
    rows.forEach((row,id) => row.hidden = !ids.has(id));
    pins.forEach((pin,id) => pin.element.style.display = ids.has(id) ? '' : 'none');
    count.textContent = `${ids.size} ${ids.size === 1 ? 'cinema' : 'cinemas'}`;
    empty.hidden = ids.size > 0;
    if (selected && !ids.has(selected)) clearSelection();
    renderMapLabel();
  }
  function clearSelection() {
    selected = null;
    rows.forEach(row => row.querySelector('button').setAttribute('aria-pressed','false'));
    pins.forEach(pin => pin.element.setAttribute('aria-pressed','false'));
    renderMapLabel();
  }
  function showCinema(c) {
    selected = c.id;
    rows.forEach((row,id) => row.querySelector('button').setAttribute('aria-pressed',String(id===selected)));
    pins.forEach((pin,id) => {pin.element.setAttribute('aria-pressed',String(id===selected));pin.element.style.zIndex = id===selected ? '5' : '1';});
    renderMapLabel();
    if (map && ready) map.flyTo({center:c.coordinates,zoom:Math.max(12.5,map.getZoom()),duration:reduceMotion?0:800});
  }
  function buildList() {
    cinemas.forEach(c => {
      const li = document.createElement('li'); li.dataset.id = c.id;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cinema-row';
      button.setAttribute('aria-pressed','false'); button.setAttribute('aria-label',`${c.name}, ${c.area}`);
      const symbol = document.createElement('span'); symbol.className = 'cinema-symbol'; symbol.style.setProperty('--pin',colors[c.chain]); symbol.append(cinemaIcon());
      const text = document.createElement('span'); text.className='row-text';
      const name = document.createElement('strong'); name.textContent=c.name;
      const meta = document.createElement('small'); meta.textContent=`${c.area} · ${c.chain}`;
      text.append(name,meta); button.append(symbol,text); button.addEventListener('click',()=>showCinema(c));
      li.append(button); list.append(li); rows.set(c.id,li);
    });
    renderSearch();
  }
  function startMap() {
    if (!window.maplibregl) {
      notice.textContent = 'The map is unavailable in this browser. You can still browse cinemas and open Directions.';
      home.disabled = true; choosePoint.disabled = true; return;
    }
    try {
      map = new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/positron',center:[115.209,-8.715],zoom:10.4,minZoom:7,maxZoom:17,attributionControl:false});
    } catch (error) {
      console.error('Unable to initialize the cinema map:', error);
      notice.textContent = 'The map is unavailable in this browser. You can still browse cinemas and open Directions.';
      home.disabled = true; choosePoint.disabled = true; return;
    }
    map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
    cinemas.forEach(c => {
      const element = document.createElement('button'); element.type='button'; element.className='map-pin';
      element.append(cinemaIcon()); element.style.setProperty('--pin',colors[c.chain]);
      element.setAttribute('aria-label',`Show ${c.name} on the map`); element.setAttribute('aria-pressed','false');
      element.addEventListener('mouseenter',()=>{window.clearTimeout(labelExitTimer);hovered=c.id;renderMapLabel();});
      element.addEventListener('mouseleave',()=>scheduleLabelExit(c.id));
      element.addEventListener('focus',()=>{focused=c.id;hovered=null;renderMapLabel();});
      element.addEventListener('blur',event=>{
        if(focused===c.id)focused=null;
        if(labelPopup?.getElement().contains(event.relatedTarget)){hovered=c.id;return;}
        renderMapLabel();
      });
      element.addEventListener('click',event => {if(choosing){event.stopPropagation();setOrigin(c.coordinates);}else showCinema(c);});
      const marker = new maplibregl.Marker({element}).setLngLat(c.coordinates).addTo(map);
      element.setAttribute('aria-label',`Show ${c.name} on the map`);
      pins.set(c.id,{element,marker});
    });
    map.once('load',()=>{ready=true;notice.hidden=true;fit();if(selected)showCinema(cinemas.find(c=>c.id===selected));});
    map.on('click',event=>{
      const target = event.originalEvent?.target;
      if(target instanceof Element && target.closest('.map-pin, .cinema-label, .maplibregl-ctrl')) return;
      if(choosing){setOrigin([event.lngLat.lng,event.lngLat.lat]);return;}
      window.clearTimeout(labelExitTimer);
      hovered=null;focused=null;
      clearSelection();
    });
    map.on('error',()=>{if(!ready){notice.hidden=false;notice.textContent='The basemap could not load. Cinema pins and the list are still available; try refreshing.';}});
    window.setTimeout(()=>{if(!ready){notice.hidden=false;notice.textContent='The basemap is taking longer to load. Cinema pins and the list are still available.';}},12000);
    renderSearch();
  }
  search.addEventListener('input',renderSearch);
  search.addEventListener('keydown',event=>{
    if(event.key==='Enter'){const results=matched();if(results.length)showCinema(results[0]);}
    if(event.key==='Escape'){search.value='';renderSearch();clearSelection();}
  });
  document.getElementById('clear-search').addEventListener('click',()=>{search.value='';renderSearch();search.focus();});
  home.addEventListener('click',()=>{search.value='';clearSelection();renderSearch();fit();});
  choosePoint.addEventListener('click',()=>setChoosing(!choosing));
  clearPoint.addEventListener('click',()=>setOrigin(null));
  useLocation.addEventListener('click',()=>{
    if(!navigator.geolocation){pointStatus.textContent='Location is unavailable. Choose a point on the map instead.';return;}
    useLocation.disabled = true; pointStatus.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(position=>{
      useLocation.disabled = false;setOrigin([position.coords.longitude,position.coords.latitude]);
    },()=>{useLocation.disabled=false;pointStatus.textContent='Location could not be found. Choose a point on the map instead.';},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){hovered=null;focused=null;clearSelection();setChoosing(false);}});
  fetch('./cinemas.json').then(response=>{if(!response.ok)throw new Error('Data unavailable');return response.json();}).then(data=>{
    cinemas=data.cinemas;buildList();startMap();renderOrigin();loadMovies();
  }).catch(()=>{
    count.textContent='Unable to load';notice.textContent='Cinema data could not load. Please check your connection and refresh.';
    const error=document.createElement('li');error.className='empty';error.textContent='Cinema data could not load. ';
    const source=document.createElement('a');source.href='https://jadwalnonton.com/bioskop/di-bali/';source.textContent='Open the source listing';error.append(source);list.append(error);home.disabled=true;
  });
})();
