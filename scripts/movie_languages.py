"""Explicit film-language metadata from JadwalNonton or Indonesia's LSF film guide.

Film language is not a guarantee of a particular screening's dubbing or subtitles.
Never infer it from a title, production country, cast, or synopsis language.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import re
import unicodedata
from urllib.parse import urlencode, urlparse

from bs4 import BeautifulSoup

LANGUAGES = {
    'en': ('english', 'inggris'), 'id': ('indonesian', 'indonesia'),
    'ko': ('korean', 'korea'), 'ja': ('japanese', 'jepang'),
    'zh': ('chinese', 'mandarin', 'mandarin chinese'), 'yue': ('cantonese', 'kanton'),
    'th': ('thai', 'thailand'), 'ms': ('malay', 'melayu'), 'hi': ('hindi',),
    'ta': ('tamil',), 'te': ('telugu',), 'ml': ('malayalam',), 'kn': ('kannada',),
    'fr': ('french', 'perancis', 'prancis'), 'es': ('spanish', 'spanyol'),
    'de': ('german', 'jerman'), 'it': ('italian', 'italia'), 'ar': ('arabic', 'arab'),
    'jv': ('javanese', 'jawa'), 'su': ('sundanese', 'sunda'), 'ban': ('balinese', 'bali'),
}
ALIASES = {name: code for code, names in LANGUAGES.items() for name in names}
# Same 2026 release, directors and 108-minute runtime on both source pages.
TITLE_ALIASES = {'2026/daniel-and-the-fiery-furnace': ('Daniel : The Fiery Furnace',)}


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


def parse_lsf_language(html, movie, details=None):
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
    if not re.fullmatch(r'\d{4}', year) or year not in years:
        return None
    duration = re.search(r'\d+', fields.get('duration', fields.get('durasi', '')))
    expected_duration = (details or {}).get('runtimeMinutes')
    if duration and expected_duration and abs(int(duration[0]) - expected_duration) > 10:
        return None
    reported = fields.get('language', fields.get('bahasa', ''))
    codes = language_codes(reported)
    return {'codes': codes, 'reportedLanguage': reported} if codes else None


def add_languages(movies, metadata=None, previous_movies=(), *, fetch_page=None, now=None):
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
                    return movie['id'], deepcopy(cached)
            except (KeyError, ValueError, TypeError):
                pass
        else:
            cached = None
        if fetch_page is None:
            return movie['id'], deepcopy(cached) if cached else {'status': 'unknown', 'codes': [], 'checkedAt': checked_at}
        try:
            # Search a short prefix so source punctuation does not hide a result;
            # validate the complete title and release year on its detail page.
            words = re.findall(r'\w+', movie['title'])
            if not words:
                return movie['id'], {'status': 'unknown', 'codes': [], 'checkedAt': checked_at}
            keyword = ' '.join(words[:2] if len(words[0]) < 4 else words[:1])
            for base in ('https://lsf.go.id/en/film', 'https://lsf.go.id/film'):
                candidates = find_lsf_candidates(fetch_page(base + '?' + urlencode({'keyword': keyword})), movie)
                matches = []
                # An unexpectedly broad result is ambiguous; do not crawl arbitrary pages.
                if len(candidates) <= 3:
                    for url in candidates:
                        info = parse_lsf_language(fetch_page(url), movie, details)
                        if info:
                            matches.append({**info, 'sourceName': 'LSF', 'sourceUrl': url})
                if len(matches) == 1:
                    return movie['id'], {**matches[0], 'status': 'verified', 'checkedAt': checked_at}
                if len(matches) > 1:
                    break
            return movie['id'], {'status': 'unknown', 'codes': [], 'checkedAt': checked_at}
        except (OSError, ValueError):
            # Keep an older verified observation if its source temporarily fails.
            if cached and cached.get('status') == 'verified':
                return movie['id'], deepcopy(cached)
            return movie['id'], {'status': 'unavailable', 'codes': [], 'checkedAt': checked_at}

    with ThreadPoolExecutor(max_workers=3) as pool:
        for movie_id, info in pool.map(lookup, movies.values()):
            movies[movie_id]['languageInfo'] = info
    verified = sum(movie['languageInfo']['status'] == 'verified' for movie in movies.values())
    print(f'Film languages verified for {verified}/{len(movies)} movies', flush=True)


if __name__ == '__main__':
    # Enrich an existing dated snapshot without claiming its schedules were refreshed.
    import json
    from pathlib import Path
    from refresh_showtimes import download_page, write_json
    root = Path(__file__).resolve().parents[1]
    path = root / 'showtimes.json'
    snapshot = json.loads(path.read_text(encoding='utf-8'))
    history_path = root / 'tracking/history.json'
    history = json.loads(history_path.read_text(encoding='utf-8')) if history_path.exists() else {}
    metadata = {key: {'details': value.get('details', {}), 'checkedAt': value.get('detailsObservedAt')}
                for key, value in history.get('movies', {}).items()}
    movies = {movie['id']: movie for movie in snapshot['movies']}
    add_languages(movies, metadata, deepcopy(snapshot['movies']), fetch_page=download_page)
    write_json(path, snapshot)
