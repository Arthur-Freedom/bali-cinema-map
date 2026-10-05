import unittest

from refresh_showtimes import parse_schedule


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


if __name__ == '__main__':
    unittest.main()
