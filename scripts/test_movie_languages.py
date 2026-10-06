from copy import deepcopy
from datetime import datetime, timezone, timedelta
import unittest
from unittest.mock import Mock

from movie_languages import add_languages, find_lsf_candidates, language_codes, parse_lsf_language

MOVIE = {'id': '2026/example', 'title': 'Example', 'url': 'https://jadwalnonton.com/film/2026/example/'}
NOW = datetime(2026, 10, 7, tzinfo=timezone.utc)
SOURCE = 'https://lsf.go.id/en/film/example/123'


def page(title='Example', year='2026', language='English', duration='100 menit'):
    fields = {'Production Year': year, 'Language': language, 'Duration': duration}
    return f'<h3>{title}</h3>' + ''.join(
        f'<div class="movie-info-item"><strong>{key}:</strong><span>{value}</span></div>'
        for key, value in fields.items())


def listing(title='Example', url=SOURCE):
    return f'<div class="movie-img"><img class="poster" alt="{title}"><a href="{url}"></a></div>'


class LanguageParsingTests(unittest.TestCase):
    def test_explicit_languages_and_multilingual_labels(self):
        self.assertEqual(language_codes('English'), ['en'])
        self.assertEqual(language_codes('Bahasa Indonesia / Korea'), ['id', 'ko'])
        self.assertEqual(language_codes('English and Japanese'), ['en', 'ja'])
        for value in (None, '-', 'United States', 'English subtitles', 'English / something unknown'):
            self.assertEqual(language_codes(value), [])

    def test_matches_full_title_and_safe_source_links(self):
        movie = {**MOVIE, 'title': 'Example: The Movie'}
        html = listing('EXAMPLE - The Movie') + listing('Example: The Movie', 'https://evil.example/film/123')
        self.assertEqual(find_lsf_candidates(html, movie), [SOURCE])
        self.assertEqual(find_lsf_candidates(listing('Example 2'), MOVIE), [])

    def test_checks_release_identity_and_uses_language_not_country(self):
        self.assertEqual(parse_lsf_language(page(), MOVIE, {'runtimeMinutes': 103})['codes'], ['en'])
        self.assertIsNone(parse_lsf_language(page(year='2002'), MOVIE))
        self.assertIsNone(parse_lsf_language(page(title='Example Returns'), MOVIE))
        self.assertIsNone(parse_lsf_language(page(duration='150 menit'), MOVIE, {'runtimeMinutes':100}))
        self.assertIsNone(parse_lsf_language(page(language='-').replace('Language', 'Country'), MOVIE))

    def test_indonesian_labels_and_rerelease_year(self):
        html = page(year='2019', language='Indonesia').replace('Production Year', 'Tahun Produksi').replace('Language', 'Bahasa')
        html += '<div class="movie-info-item"><strong>Tanggal Tayang:</strong><span>23/09/2026</span></div>'
        self.assertEqual(parse_lsf_language(html, MOVIE)['codes'], ['id'])

    def test_reviewed_title_alias_still_requires_release_year(self):
        movie = {**MOVIE, 'id':'2026/daniel-and-the-fiery-furnace', 'title':'Daniel and the Fiery Furnace'}
        self.assertEqual(parse_lsf_language(page(title='Daniel : The Fiery Furnace'), movie)['codes'], ['en'])
        self.assertIsNone(parse_lsf_language(page(title='Daniel : The Fiery Furnace', year='2013'), movie))


class LanguageEnrichmentTests(unittest.TestCase):
    def enrich(self, fetch, previous=(), metadata=None):
        movies = {MOVIE['id']: deepcopy(MOVIE)}
        add_languages(movies, metadata, previous, fetch_page=fetch, now=NOW)
        return movies[MOVIE['id']]['languageInfo']

    def test_keeps_provenance_and_reuses_verified_cache_without_requests(self):
        fetch = Mock(side_effect=[listing(), page()])
        info = self.enrich(fetch)
        self.assertEqual(info['codes'], ['en'])
        self.assertEqual(info['sourceUrl'], SOURCE)
        cached = {**MOVIE, 'languageInfo':info}
        no_network = Mock(side_effect=AssertionError('Cache should avoid network'))
        self.assertEqual(self.enrich(no_network, [cached]), info)
        no_network.assert_not_called()

    def test_missing_and_ambiguous_sources_remain_unknown(self):
        self.assertEqual(self.enrich(Mock(return_value='<p>No matching record</p>'))['status'], 'unknown')
        duplicate = listing() + listing(url='https://lsf.go.id/en/film/example/456')
        info = self.enrich(Mock(side_effect=[duplicate, page(), page()]))
        self.assertEqual(info['codes'], [])
        self.assertEqual(info['status'], 'unknown')

    def test_falls_back_to_indonesian_guide(self):
        source = 'https://lsf.go.id/film/example/123'
        info = self.enrich(Mock(side_effect=['<p>No English entry</p>', listing(url=source), page(language='Indonesia')]))
        self.assertEqual(info['codes'], ['id'])
        self.assertEqual(info['sourceUrl'], source)

    def test_failure_keeps_previous_verification_time(self):
        info = {'status':'verified', 'codes':['en'], 'sourceUrl':SOURCE, 'sourceName':'LSF',
                'checkedAt':(NOW-timedelta(days=10)).isoformat()}
        self.assertEqual(self.enrich(Mock(side_effect=TimeoutError), [{**MOVIE, 'languageInfo':info}]), info)
        self.assertEqual(self.enrich(Mock(side_effect=TimeoutError))['status'], 'unavailable')

    def test_explicit_schedule_metadata_takes_precedence_and_no_subtitle_guessing(self):
        metadata = {MOVIE['id']:{'status':'ok', 'details':{'language':'Korean','subtitles':'English'}}}
        info = self.enrich(Mock(side_effect=AssertionError('Unneeded lookup')), metadata=metadata)
        self.assertEqual(info['codes'], ['ko'])
        self.assertEqual(info['sourceName'], 'JadwalNonton')
        self.assertEqual(self.enrich(None, metadata={MOVIE['id']:{'details':{'subtitles':'English'}}})['codes'], [])


if __name__ == '__main__':
    unittest.main()
