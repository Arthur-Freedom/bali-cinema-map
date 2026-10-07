"""Explicit film-language metadata from JadwalNonton or Indonesia's LSF film guide.

Film language is not a guarantee of a particular screening's dubbing or subtitles.
Never infer it from a title, production country, cast, or synopsis language.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlencode, urlparse

from bs4 import BeautifulSoup

LANGUAGES = {
    'en': ('english', 'inggris'), 'id': ('indonesian', 'indonesia'),
    'ko': ('korean', 'korea', 'korea selatan', 'south korean'), 'ja': ('japanese', 'jepang'),
    'zh': ('chinese', 'tionghoa'), 'cmn': ('mandarin', 'mandarin chinese'), 'yue': ('cantonese', 'kanton'),
    'th': ('thai', 'thailand'), 'ms': ('malay', 'melayu'), 'hi': ('hindi',),
    'ta': ('tamil',), 'te': ('telugu',), 'ml': ('malayalam',), 'kn': ('kannada',),
    'fr': ('french', 'perancis', 'prancis'), 'es': ('spanish', 'spanyol'),
    'de': ('german', 'jerman'), 'it': ('italian', 'italia'), 'ar': ('arabic', 'arab'),
    'jv': ('javanese', 'jawa'), 'su': ('sundanese', 'sunda'), 'ban': ('balinese', 'bali'),
}
ALIASES = {name: code for code, names in LANGUAGES.items() for name in names}
# Reviewed against source pages: same directors, casts, release and runtime.
TITLE_ALIASES = {
    '2026/daniel-and-the-fiery-furnace': ('Daniel : The Fiery Furnace',),
    '2026/reawakened-man': ('REAWAKENED MAN: THE RED',),
    '2026/wind-up-the-movie': ('WIND UP',),
}
# LSF's 2026 rerelease record explicitly identifies the original 2005 film.
# Permit only this reviewed record, with matching title and 105-minute runtime.
REVIEWED_RERELEASES = {
    '2005/fullmetal-alchemist-the-movie-conqueror-of-shamballa': {
        'sourcePath': '/film/fullmetal-alchemist-movie-conqueror-shamballa/1570',
        'sourceYear': '2026', 'runtimeMinutes': 105,
    },
}
REVIEWED_LANGUAGES = json.loads(Path(__file__).with_name('reviewed_languages.json').read_text(encoding='utf-8'))


def title_key(value):
    value = unicodedata.normalize('NFKD', value).casefold()
    return ''.join(c for c in value if c.isalnum())


def language_codes(value):
    if not isinstance(value, str):
        return []
    parts = re.split(r'\s*(?:[,;/&+]|\band\b|\bdan\b)\s*', value.casefold())
    codes = [ALIASES.get(re.sub(r'^bahasa\s+', '', part).strip()) for part in parts]
    # Partially understood labels must not silently become "English only".
    return sorted(set(codes)) if codes and all(codes) else []


def search_keywords(title):
    words = re.findall(r'\w+', title)
    if not words:
        return []
    prefix = ' '.join(words[:2] if len(words[0]) < 4 else words[:1])
    # LSF's search treats punctuation literally: "Ibu Bagaimana" misses
    # "Ibu, Bagaimana". A single significant word still gets full-title checks.
    single = next((word for word in words if len(word) >= 4), words[0])
    return list(dict.fromkeys((prefix, single)))


def reviewed_language(movie, details):
    record = REVIEWED_LANGUAGES.get(movie['id'])
    if not record or title_key(movie['title']) != title_key(record['title']):
        return None
    duration = details.get('runtimeMinutes')
    if not duration or abs(duration - record['runtimeMinutes']) > 10:
        return None
    codes = language_codes(record['reportedLanguage'])
    return {key: record[key] for key in ('reportedLanguage', 'sourceName', 'sourceUrl', 'checkedAt')} | {
        'codes': codes, 'status': 'verified',
    } if codes else None


def valid_lsf_url(url):
    parsed = urlparse(url)
    return (parsed.scheme == 'https' and parsed.netloc == 'lsf.go.id'
            and bool(re.fullmatch(r'/(?:en/)?film/[a-z0-9-]+/\d+', parsed.path)))


def find_lsf_candidates(html, movie):
    soup = BeautifulSoup(html, 'html.parser')
    matches = []
    for card in soup.select('.movie-img'):
        poster, link = card.select_one('img.poster[alt]'), card.select_one('a[href]')
        titles = (movie['title'], *TITLE_ALIASES.get(movie['id'], ()))
        if (poster and link and title_key(poster['alt']) in {title_key(title) for title in titles}
                and valid_lsf_url(link['href'])):
            matches.append(link['href'])
    return list(dict.fromkeys(matches))


def parse_lsf_language(html, movie, details=None, source_url=''):
    soup = BeautifulSoup(html, 'html.parser')
    heading = soup.find('h3')
    titles = (movie['title'], *TITLE_ALIASES.get(movie['id'], ()))
    if not heading or title_key(heading.get_text(' ', strip=True)) not in {title_key(title) for title in titles}:
        return None
    fields = {}
    for item in soup.select('.movie-info-item'):
        label, value = item.find('strong'), item.find('span')
        if label and value:
            fields[label.get_text(' ', strip=True).rstrip(':').casefold()] = value.get_text(' ', strip=True)
    # Match this release, not a same-named older film. Re-releases may retain
    # their original production year, so an explicit premiere year also counts.
    year = movie['id'].split('/')[0]
    years = re.findall(r'\b(?:19|20)\d{2}\b', ' '.join(fields.get(key, '') for key in
                      ('production year', 'premiere date', 'tahun produksi', 'tanggal tayang')))
    duration = re.search(r'\d+', fields.get('duration', fields.get('durasi', '')))
    expected_duration = (details or {}).get('runtimeMinutes')
    rerelease = REVIEWED_RERELEASES.get(movie['id'], {})
    reviewed_rerelease = (rerelease and valid_lsf_url(source_url)
        and urlparse(source_url).path.removeprefix('/en') == rerelease['sourcePath']
        and rerelease['sourceYear'] in years and duration
        and int(duration[0]) == expected_duration == rerelease['runtimeMinutes'])
    if not re.fullmatch(r'\d{4}', year) or (year not in years and not reviewed_rerelease):
        return None
    if duration and expected_duration and abs(int(duration[0]) - expected_duration) > 10:
        return None
    reported = fields.get('language', fields.get('bahasa', ''))
    codes = language_codes(reported)
    return {'codes': codes, 'reportedLanguage': reported} if codes else None


def add_languages(movies, metadata=None, previous_movies=(), *, fetch_page=None, now=None, retry_unknown=False):
    """Reuse verified metadata for a week; retry unknown/failed matches next day.

    Passing no fetch_page supports offline schedule fixtures without network calls.
    Optional metadata failure never blocks a valid cinema-schedule refresh.
    """
    now = now or datetime.now(timezone.utc)
    checked_at = now.isoformat(timespec='seconds')
    previous = {movie['id']: movie for movie in previous_movies}

    def lookup(movie):
        check = (metadata or {}).get(movie['id'], {})
        details = check.get('details', {})
        fallback = reviewed_language(movie, details)
        explicit = details.get('language')
        codes = language_codes(explicit)
        if codes:
            return movie['id'], {'status': 'verified', 'codes': codes, 'reportedLanguage': explicit,
                'sourceName': 'JadwalNonton', 'sourceUrl': movie['url'], 'checkedAt': check.get('checkedAt') or checked_at}
        cached_movie = previous.get(movie['id'], {})
        cached = cached_movie.get('languageInfo')
        if cached and title_key(cached_movie.get('title', '')) == title_key(movie['title']):
            try:
                age = now - datetime.fromisoformat(cached['checkedAt'])
                if timedelta(0) <= age < timedelta(days=7 if cached['status'] == 'verified' else 1):
                    if cached['status'] == 'verified':
                        return movie['id'], deepcopy(cached)
                    if not retry_unknown:
                        return movie['id'], deepcopy(fallback or cached)
            except (KeyError, ValueError, TypeError):
                pass
        else:
            cached = None
        if fetch_page is None:
            return movie['id'], deepcopy(fallback or cached) if fallback or cached else {'status': 'unknown', 'codes': [], 'checkedAt': checked_at}
        try:
            # Search a short prefix so source punctuation does not hide a result;
            # validate the complete title and release year on its detail page.
            for keyword in search_keywords(movie['title']):
                for base in ('https://lsf.go.id/en/film', 'https://lsf.go.id/film'):
                    candidates = find_lsf_candidates(fetch_page(base + '?' + urlencode({'keyword': keyword})), movie)
                    matches = []
                    # An unexpectedly broad result is ambiguous; do not crawl arbitrary pages.
                    if len(candidates) <= 3:
                        for url in candidates:
                            info = parse_lsf_language(fetch_page(url), movie, details, url)
                            if info:
                                matches.append({**info, 'sourceName': 'LSF', 'sourceUrl': url})
                    if len(matches) == 1:
                        return movie['id'], {**matches[0], 'status': 'verified', 'checkedAt': checked_at}
                    if len(matches) > 1 or len(candidates) > 3:
                        return movie['id'], fallback or {'status': 'unknown', 'codes': [], 'checkedAt': checked_at}
            return movie['id'], fallback or {'status': 'unknown', 'codes': [], 'checkedAt': checked_at}
        except (OSError, ValueError):
            # Keep an older verified observation if its source temporarily fails.
            if cached and cached.get('status') == 'verified':
                return movie['id'], deepcopy(cached)
            return movie['id'], fallback or {'status': 'unavailable', 'codes': [], 'checkedAt': checked_at}

    with ThreadPoolExecutor(max_workers=3) as pool:
        for movie_id, info in pool.map(lookup, movies.values()):
            movies[movie_id]['languageInfo'] = info
    verified = sum(movie['languageInfo']['status'] == 'verified' for movie in movies.values())
    print(f'Film languages verified for {verified}/{len(movies)} movies', flush=True)


if __name__ == '__main__':
    # Enrich an existing dated snapshot without claiming its schedules were refreshed.
    import argparse
    from refresh_showtimes import download_page, write_json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--retry-unknown', action='store_true', help='Retry unresolved languages before their daily cache expires')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    path = root / 'showtimes.json'
    snapshot = json.loads(path.read_text(encoding='utf-8'))
    history_path = root / 'tracking/history.json'
    history = json.loads(history_path.read_text(encoding='utf-8')) if history_path.exists() else {}
    metadata = {key: {'details': value.get('details', {}), 'checkedAt': value.get('detailsObservedAt')}
                for key, value in history.get('movies', {}).items()}
    movies = {movie['id']: movie for movie in snapshot['movies']}
    add_languages(movies, metadata, deepcopy(snapshot['movies']), fetch_page=download_page, retry_unknown=args.retry_unknown)
    write_json(path, snapshot)
