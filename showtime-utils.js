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
    if (type === 'regular') return /\bregular\b/i.test(format);
    if (type === 'deluxe') return /\bdeluxe\b/i.test(format);
    if (type === 'executive') return /\bexecutive\b/i.test(format);
    return type === 'premium' ? Boolean(category) : category === type;
  }
  function movieLanguageCodes(movie) {
    const info = movie?.languageInfo;
    return info?.status === 'verified' && Array.isArray(info.codes)
      ? info.codes.filter(code => typeof code === 'string' && /^[a-z]{2,3}$/.test(code)) : [];
  }
  function matchesMovieLanguage(movie, language) {
    const codes = movieLanguageCodes(movie);
    return !language || (language === 'unknown' ? !codes.length : codes.includes(language));
  }
  const helpers = {nextShowtime, matchesMovieType, movieLanguageCodes, matchesMovieLanguage};
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  else window.CinemaShowtimes = helpers;
})();
