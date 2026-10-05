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
    cinemas=data.cinemas;buildList();startMap();renderOrigin();
  }).catch(()=>{
    count.textContent='Unable to load';notice.textContent='Cinema data could not load. Please check your connection and refresh.';
    const error=document.createElement('li');error.className='empty';error.textContent='Cinema data could not load. ';
    const source=document.createElement('a');source.href='https://jadwalnonton.com/bioskop/di-bali/';source.textContent='Open the source listing';error.append(source);list.append(error);home.disabled=true;
  });
})();
