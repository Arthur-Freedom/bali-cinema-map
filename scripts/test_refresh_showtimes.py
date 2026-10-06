import unittest

from refresh_showtimes import parse_schedule, parse_trailer, add_trailers
from unittest.mock import patch


class ScheduleParsingTests(unittest.TestCase):
    def page(self, groups, date='20261005'):
        return f'''<div id="tabc_sched">
          <div id="tgl_ftab"><li class="active"><a data-ref="schedule?date={date}">Date</a></li></div>
          <div class="thealist"><div class="item"><div class="sched_desc">
          <h2><a href="https://jadwalnonton.com/film/2026/example/">Example</a></h2>
          {groups}</div></div><div class="item">Advertising</div></div></div>'''

    def parse(self, html):
        return parse_schedule(html, {'id': 'example-cinema'}, '2026-10-05')

    def test_preserves_each_formats_price_and_times(self):
        html = self.page('''<span class="showgroup">Regular 2D</span>
          <span class="htm">Tiket Rp 25.000</span><ul class="usch"><li>12:00</li><li>17:00</li></ul>
          <span class="showgroup">VIP 2D</span><span class="htm">Tiket Rp 100.000</span>
          <ul class="usch"><li>19:00</li></ul>''')
        movies, offers = self.parse(html)
        self.assertEqual(list(movies), ['2026/example'])
        self.assertEqual([(o['format'], o['price'], o['times']) for o in offers],
                         [('Regular 2D', 25000, ['12:00', '17:00']), ('VIP 2D', 100000, ['19:00'])])

    def test_does_not_borrow_price_from_next_format(self):
        html = self.page('''<span class="showgroup">Regular 2D</span><ul class="usch"><li>12:00</li></ul>
          <span class="showgroup">Premiere</span><span class="htm">Tiket Rp 100.000</span>
          <ul class="usch"><li>19:00</li></ul>''')
        _, offers = self.parse(html)
        self.assertIsNone(offers[0]['price'])
        self.assertEqual(offers[1]['price'], 100000)

    def test_rejects_outdated_source(self):
        with self.assertRaisesRegex(ValueError, 'Schedule date'):
            self.parse(self.page('', date='20261004'))

    def test_rejects_broken_schedule_instead_of_silently_dropping_movie(self):
        with self.assertRaisesRegex(ValueError, 'Showtimes missing'):
            self.parse(self.page('<span class="showgroup">Regular 2D</span>'))


class TrailerParsingTests(unittest.TestCase):
    def test_uses_source_trailer_and_ignores_other_embeds(self):
        html = '''<iframe src="https://www.youtube.com/embed/ABCDEFGHIJK"></iframe>
          <iframe class="vtrail" src="https://www.youtube.com/embed/vMZO8caQu1M?rel=0"></iframe>'''
        self.assertEqual(parse_trailer(html), 'vMZO8caQu1M')

    def test_rejects_untrusted_hosts_and_malformed_video_ids(self):
        for src in ('https://youtube.com.evil.example/embed/vMZO8caQu1M',
                    'https://evil.example/embed/vMZO8caQu1M',
                    'https://www.youtube.com/embed/too-short',
                    'https://www.youtube.com/embed/vMZO8caQu1M/other'):
            with self.subTest(src=src):
                self.assertIsNone(parse_trailer(f'<iframe class="vtrail" src="{src}"></iframe>'))

    def test_missing_or_failed_trailer_does_not_remove_movie(self):
        movies = {'2026/example': {'id': '2026/example', 'title': 'Example', 'url': 'https://jadwalnonton.com/film/2026/example/'}}
        with patch('refresh_showtimes.download_page', side_effect=TimeoutError):
            add_trailers(movies)
        self.assertEqual(len(movies), 1)
        self.assertNotIn('trailerYouTubeId', movies['2026/example'])
        self.assertIsNone(parse_trailer('<p>No trailer available</p>'))


if __name__ == '__main__':
    unittest.main()
