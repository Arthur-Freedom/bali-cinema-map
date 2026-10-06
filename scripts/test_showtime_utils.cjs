'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {nextShowtime, matchesMovieType} = require('../showtime-utils.js');

test('finds the soonest remaining session, skipping already started screenings', () => {
  const now = Date.parse('2026-10-05T16:45:30+08:00');
  assert.deepEqual(nextShowtime('2026-10-05', ['19:00', '12:30', '16:45', '17:05'], now),
    {time:'17:05', start:Date.parse('2026-10-05T17:05:00+08:00')});
});
test('returns no next session when all screenings in the dated snapshot have passed', () => {
  assert.equal(nextShowtime('2026-10-05', ['12:30', '17:05'], Date.parse('2026-10-05T22:00:00+08:00')), null);
  assert.equal(nextShowtime('2026-10-04', ['23:55'], Date.parse('2026-10-05T00:01:00+08:00')), null);
});
test('uses the schedule date and Bali timezone across midnight', () => {
  const now = Date.parse('2026-10-05T23:50:00+08:00');
  assert.deepEqual(nextShowtime('2026-10-06', ['12:00', '00:05'], now),
    {time:'00:05', start:Date.parse('2026-10-05T16:05:00Z')});
});
test('ignores invalid time strings and sessions starting exactly now', () => {
  const now = Date.parse('2026-10-05T12:00:00+08:00');
  assert.equal(nextShowtime('2026-10-05', ['not a time', '24:00', '12:99', '12:00'], now), null);
});
test('finds Premiere, VIP and IMAX variants without classifying other formats as these', () => {
  for (const [format, category] of [['Premiere', 'premiere'], ['VIP 2D', 'vip'], ['IMAX 2D', 'imax']]) {
    assert.equal(matchesMovieType(format, category), true);
    assert.equal(matchesMovieType(format, 'premium'), true);
  }
  assert.equal(matchesMovieType('Regular 2D', 'premium'), false);
  assert.equal(matchesMovieType('Executive', 'premium'), false);
  assert.equal(matchesMovieType('Premiere', 'imax'), false);
  assert.equal(matchesMovieType('Regular 2D', ''), true);
});

test('filters the other studio experiences without treating them as premium', () => {
  for (const [format, category] of [['Regular 2D', 'regular'], ['Deluxe', 'deluxe'], ['Executive', 'executive']]) {
    assert.equal(matchesMovieType(format, category), true);
    assert.equal(matchesMovieType(format, 'premium'), false);
    assert.equal(matchesMovieType('IMAX 2D', category), false);
  }
  assert.equal(matchesMovieType('Deluxe', 'executive'), false);
});
