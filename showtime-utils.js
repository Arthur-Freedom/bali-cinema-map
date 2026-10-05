'use strict';
(() => {
  function nextShowtime(date, times, now = Date.now()) {
    let next = null;
    for (const time of times) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
      // The date belongs to the saved schedule; every session is in Bali time.
      const start = Date.parse(`${date}T${time}:00+08:00`);
      if (start > now && (!next || start < next.start)) next = {time, start};
    }
    return next;
  }
  function matchesMovieType(format, type) {
    if (!type) return true;
    const category = /premiere/i.test(format) ? 'premiere' : /\bvip\b/i.test(format) ? 'vip' : /\bimax\b/i.test(format) ? 'imax' : '';
    return type === 'premium' ? Boolean(category) : category === type;
  }
  const helpers = {nextShowtime, matchesMovieType};
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  else window.CinemaShowtimes = helpers;
})();
