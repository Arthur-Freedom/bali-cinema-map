import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from movie_tracking import parse_movie_details, update_history
from refresh_showtimes import refresh


def snapshot(day='06', movies=('a', 'b')):
    return {'date': f'2026-10-{day}', 'refreshedAt': f'2026-10-{day}T13:17:00+08:00',
            'movies': [{'id': mid, 'title': mid.upper(), 'url': f'https://jadwalnonton.com/film/2026/{mid}/'} for mid in movies],
            'sources': [{'cinemaId': 'cinema'}],
            'screenings': [{'movieId': mid, 'cinemaId': 'cinema', 'format': 'VIP 2D', 'price': 40000,
                            'times': ['15:00', '19:00']} for mid in movies]}


class MovieMetadataTests(unittest.TestCase):
    def test_source_labels_and_indonesian_release_date(self):
        details = parse_movie_details('''<p><span class="sjdl">Duration</span><span class="sisi">108 minutes</span></p>
            <p><span class="sjdl">Rating</span><span class="sisi">Remaja</span></p>
            <p><span class="sjdl">Genre</span><span class="sisi">Drama, Adventure</span></p>
            <p class="hlite">Film <b>Daniel</b> tayang di bioskop sejak tanggal 23 September 2026 s/d hari ini</p>
            <p>A film from America with an English title</p>''')
        self.assertEqual(details['runtimeMinutes'], 108)
        self.assertEqual(details['ageRating'], 'Remaja')
        self.assertEqual(details['genres'], ['Drama', 'Adventure'])
        self.assertEqual(details['sourceReleaseDate'], '2026-09-23')
        self.assertIsNone(details['language'])
        self.assertIsNone(details['subtitles'])

    def test_invalid_values_remain_unknown_and_languages_require_explicit_fields(self):
        details = parse_movie_details('''<p><span class="sjdl">Duration</span><span class="sisi">999 minutes</span></p>
            <p><span class="sjdl">Language</span><span class="sisi">English</span></p>
            <p><span class="sjdl">Subtitles</span><span class="sisi">Indonesian</span></p>
            <p class="hlite">sejak tanggal 31 Februari 2026</p>''')
        self.assertIsNone(details['runtimeMinutes'])
        self.assertIsNone(details['sourceReleaseDate'])
        self.assertEqual(details['language'], 'English')
        self.assertEqual(details['subtitles'], 'Indonesian')


class MovieHistoryTests(unittest.TestCase):
    def test_disappearance_return_and_per_format_history(self):
        first = snapshot()
        history, _ = update_history(None, first)
        second = snapshot('07', ('a',))
        second['screenings'][0].update(format='Regular 2D', price=25000, times=['18:00'])
        history, changes = update_history(history, second)
        self.assertEqual(changes['missingMovies'], ['b'])
        self.assertEqual(history['movies']['b']['lastSeenAt'], first['refreshedAt'])
        self.assertEqual(history['movies']['b']['missingSince'], second['refreshedAt'])
        self.assertEqual(history['movies']['b']['latestCounts']['showtimeCount'], 0)
        self.assertFalse(next(row for row in history['movies']['a']['listings'] if row['format'] == 'VIP 2D')['currentlyListed'])
        history, changes = update_history(history, snapshot('08'))
        self.assertEqual(changes['returnedMovies'], ['b'])
        self.assertEqual(len(changes['returnedListings']), 2)
        self.assertEqual(history['movies']['b']['firstSeenAt'], first['refreshedAt'])
        self.assertIsNone(history['movies']['b']['missingSince'])

    def test_price_and_availability_changes_preserve_multiple_offers(self):
        history, _ = update_history(None, snapshot())
        new = snapshot('07')
        new['screenings'][0]['price'] = 50000
        new['screenings'].append({'movieId':'a', 'cinemaId':'cinema', 'format':'VIP 2D', 'price':60000, 'times':['21:00']})
        history, changes = update_history(history, new)
        self.assertEqual(changes['priceChanges'][0]['before'], [40000])
        self.assertEqual(changes['priceChanges'][0]['after'], [50000, 60000])
        self.assertEqual(history['movies']['a']['latestCounts'], {'cinemaCount':1, 'formatListingCount':1, 'showtimeCount':3})
        self.assertEqual(len(history['movies']['a']['listings'][0]['offers']), 2)
        unknown = snapshot('08')
        unknown['screenings'][0]['price'] = None
        _, changes = update_history(history, unknown)
        self.assertEqual(changes['priceChanges'], [])

    def test_failed_metadata_keeps_original_observation_time(self):
        first = snapshot()
        detail = parse_movie_details('<p><span class="sjdl">Duration</span><span class="sisi">90 minutes</span></p>')
        history, _ = update_history(None, first, {'a': {'status':'ok', 'details':detail, 'checkedAt':first['refreshedAt']}})
        history, _ = update_history(history, snapshot('07'), {'a': {'status':'error'}})
        self.assertEqual(history['movies']['a']['details']['runtimeMinutes'], 90)
        self.assertEqual(history['movies']['a']['detailsObservedAt'], first['refreshedAt'])


class RefreshDiagnosticsTests(unittest.TestCase):
    def test_failed_source_preserves_snapshot_and_absence_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prior = snapshot()
            history, _ = update_history(None, prior)
            (root / 'tracking').mkdir()
            (root / 'showtimes.json').write_text(json.dumps(prior), encoding='utf-8')
            (root / 'tracking' / 'history.json').write_text(json.dumps(history), encoding='utf-8')
            (root / 'cinemas.json').write_text(json.dumps({'cinemas':[
                {'id':'one', 'name':'One', 'scheduleUrl':'https://jadwalnonton.com/one'},
                {'id':'two', 'name':'Two', 'scheduleUrl':'https://jadwalnonton.com/two'}]}), encoding='utf-8')
            stale = '<div id="tabc_sched"><div id="tgl_ftab"><li class="active"><a data-ref="?date=20261006">Yesterday</a></li></div></div>'
            with patch('refresh_showtimes.download_page', side_effect=[TimeoutError, stale]):
                self.assertFalse(refresh(root=root, expected_date='2026-10-07'))
            self.assertEqual(json.loads((root / 'showtimes.json').read_text()), prior)
            self.assertEqual(json.loads((root / 'tracking' / 'history.json').read_text()), history)
            report = json.loads((root / 'tracking' / 'latest.json').read_text())
            self.assertEqual([check['status'] for check in report['scheduleChecks']], ['error', 'outdated'])
            self.assertEqual(report['scheduleChecks'][1]['sourceDate'], '2026-10-06')
            self.assertIsNone(report['changes'])


if __name__ == '__main__':
    unittest.main()
