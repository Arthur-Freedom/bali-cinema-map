"""Build the movie comparison snapshot from the twelve linked cinema schedules."""
import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]


def download_page(url):
    request = Request(url, headers={'User-Agent': 'BaliCinemaMap/1.0 (public schedule comparison)'})
    with urlopen(request, timeout=35) as response:
        return response.read().decode('utf-8', errors='replace')


def parse_trailer(html):
    """Keep only the YouTube video ID from JadwalNonton's own trailer iframe."""
    soup = BeautifulSoup(html, 'html.parser')
    for iframe in soup.select('iframe.vtrail[src]'):
        url = urlparse(iframe['src'])
        if url.hostname not in ('youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'):
            continue
        match = re.fullmatch(r'/embed/([A-Za-z0-9_-]{11})/?', url.path)
        if match:
            return match[1]
    return None


def add_trailers(movies, source_dir=None):
    def lookup(movie):
        try:
            if source_dir:
                path = source_dir / 'movies' / (movie['id'].replace('/', '--') + '.html')
                html = path.read_text(encoding='utf-8')
            else:
                html = download_page(movie['url'])
            return movie['id'], parse_trailer(html)
        except (OSError, ValueError) as error:
            # Trailer metadata is optional; a missing video must not block fresh schedules.
            if not source_dir:
                print(f'Trailer unavailable for {movie["title"]}: {type(error).__name__}', flush=True)
            return movie['id'], None

    with ThreadPoolExecutor(max_workers=3) as pool:
        for movie_id, video_id in pool.map(lookup, movies.values()):
            if video_id:
                movies[movie_id]['trailerYouTubeId'] = video_id
    print(f'Found {sum("trailerYouTubeId" in movie for movie in movies.values())} trailers', flush=True)


def parse_schedule(html, cinema, expected_date):
    soup = BeautifulSoup(html, 'html.parser')
    schedule = soup.select_one('#tabc_sched')
    if schedule is None:
        raise ValueError('Schedule section missing')
    date_link = schedule.select_one('#tgl_ftab .active a[data-ref]')
    match = re.search(r'date=(\d{8})', date_link['data-ref']) if date_link else None
    source_date = datetime.strptime(match[1], '%Y%m%d').date().isoformat() if match else None
    if source_date != expected_date:
        raise ValueError(f'Schedule date {source_date} does not match {expected_date}')
    films, screenings = {}, []
    for item in schedule.select('.thealist .item'):
        title = item.select_one('.sched_desc h2 a[href]')
        if not title:
            continue  # Advertising blocks are not movie listings.
        url = title['href']
        if urlparse(url).hostname not in ('jadwalnonton.com', 'www.jadwalnonton.com'):
            raise ValueError('Unexpected movie link')
        film_id = urlparse(url).path.strip('/').removeprefix('film/')
        films[film_id] = {'id': film_id, 'title': title.get_text(' ', strip=True), 'url': url}
        groups = item.select('.showgroup')
        if not groups:
            raise ValueError(f'No screening formats for {films[film_id]["title"]}')
        for group in groups:
            format_name = group.get_text(' ', strip=True).title().replace('2d', '2D').replace('3d', '3D').replace('Imax', 'IMAX').replace('Vip', 'VIP')
            price, times = None, []
            for sibling in group.next_siblings:
                if not getattr(sibling, 'name', None):
                    continue
                classes = sibling.get('class', [])
                if 'showgroup' in classes:
                    break
                if 'htm' in classes:
                    price_match = re.search(r'Rp\.?\s*([\d.,]+)', sibling.get_text(' ', strip=True))
                    if price_match:
                        price = int(re.sub(r'\D', '', price_match[1]))
                        if not 0 < price < 1000000:
                            raise ValueError('Unexpected ticket price')
                if 'usch' in classes:
                    times.extend(li.get_text(strip=True) for li in sibling.select('li') if re.fullmatch(r'\d{2}:\d{2}', li.get_text(strip=True)))
            if not times:
                raise ValueError(f'Showtimes missing for {films[film_id]["title"]}')
            screenings.append({'movieId': film_id, 'cinemaId': cinema['id'], 'format': format_name, 'price': price, 'times': sorted(set(times))})
    if not screenings:
        raise ValueError('No screenings found; previous snapshot will be kept')
    return films, screenings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='Use saved HTML for verification')
    parser.add_argument('--date', help='Expected local schedule date (YYYY-MM-DD)')
    args = parser.parse_args()
    now = datetime.now(ZoneInfo('Asia/Makassar'))
    date = args.date or now.date().isoformat()
    cinemas = json.loads((ROOT / 'cinemas.json').read_text(encoding='utf-8'))['cinemas']
    movies, screenings, sources = {}, [], []
    for cinema in cinemas:
        url = cinema['scheduleUrl']
        if args.source_dir:
            html = (args.source_dir / url.rsplit('/', 1)[-1]).read_text(encoding='utf-8')
        else:
            html = download_page(url)
        found, offers = parse_schedule(html, cinema, date)
        movies.update(found)
        screenings.extend(offers)
        sources.append({'cinemaId': cinema['id'], 'url': url, 'date': date})
        print(f'{cinema["name"]}: {len(offers)} listings', flush=True)
    add_trailers(movies, args.source_dir)
    snapshot = {'date': date, 'refreshedAt': now.isoformat(timespec='seconds'), 'sources': sources,
                'movies': sorted(movies.values(), key=lambda m: m['title'].casefold()), 'screenings': screenings}
    # Write only after all sources are validated. A failed update preserves the last full snapshot.
    target = ROOT / 'showtimes.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)
    print(f'Saved {len(movies)} movies and {len(screenings)} listings for {date}')


if __name__ == '__main__':
    main()
