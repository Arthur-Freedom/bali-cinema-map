"""Build the movie comparison snapshot from the twelve linked cinema schedules."""
import argparse
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
from movie_tracking import parse_movie_details, update_history, archive_snapshot

ROOT = Path(__file__).resolve().parents[1]


def timestamp():
    return datetime.now(ZoneInfo('Asia/Makassar')).isoformat(timespec='seconds')


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


class ScheduleError(ValueError):
    def __init__(self, reason, message, source_date=None):
        super().__init__(message)
        self.reason = reason
        self.source_date = source_date


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
            details = parse_movie_details(html)
            return movie['id'], parse_trailer(html), {'movieId': movie['id'], 'url': movie['url'],
                'checkedAt': timestamp(), 'status': 'ok' if any(details.values()) else 'metadata_missing', 'details': details}
        except (OSError, ValueError) as error:
            # Trailer metadata is optional; a missing video must not block fresh schedules.
            if not source_dir:
                print(f'Trailer unavailable for {movie["title"]}: {type(error).__name__}', flush=True)
            return movie['id'], None, {'movieId': movie['id'], 'url': movie['url'], 'checkedAt': timestamp(),
                                      'status': 'error', 'errorType': type(error).__name__}

    metadata = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for movie_id, video_id, check in pool.map(lookup, movies.values()):
            metadata[movie_id] = check
            if video_id:
                movies[movie_id]['trailerYouTubeId'] = video_id
    print(f'Found {sum("trailerYouTubeId" in movie for movie in movies.values())} trailers', flush=True)
    return metadata


def parse_schedule(html, cinema, expected_date):
    soup = BeautifulSoup(html, 'html.parser')
    schedule = soup.select_one('#tabc_sched')
    if schedule is None:
        raise ScheduleError('missing_schedule', 'Schedule section missing')
    date_link = schedule.select_one('#tgl_ftab .active a[data-ref]')
    match = re.search(r'date=(\d{8})', date_link['data-ref']) if date_link else None
    source_date = datetime.strptime(match[1], '%Y%m%d').date().isoformat() if match else None
    if source_date != expected_date:
        raise ScheduleError('outdated_schedule', f'Schedule date {source_date} does not match {expected_date}', source_date)
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


def refresh(root=ROOT, source_dir=None, expected_date=None):
    now = datetime.now(ZoneInfo('Asia/Makassar'))
    date = expected_date or now.date().isoformat()
    cinemas = json.loads((root / 'cinemas.json').read_text(encoding='utf-8'))['cinemas']
    movies, screenings, sources = {}, [], []
    report = {'schemaVersion': 1, 'runId': os.environ.get('GITHUB_RUN_ID'),
              'startedAt': now.isoformat(timespec='seconds'), 'scheduleDate': date,
              'status': 'failed', 'scheduleChecks': [], 'movieChecks': [], 'changes': None}
    for cinema in cinemas:
        url = cinema['scheduleUrl']
        check = {'cinemaId': cinema['id'], 'url': url, 'checkedAt': timestamp()}
        try:
            if source_dir:
                html = (source_dir / url.rsplit('/', 1)[-1]).read_text(encoding='utf-8')
            else:
                html = download_page(url)
            found, offers = parse_schedule(html, cinema, date)
            check.update(status='ok', sourceDate=date, formatListingCount=len(offers),
                         showtimeCount=sum(len(offer['times']) for offer in offers))
        except (OSError, ValueError) as error:
            check.update(status='outdated' if getattr(error, 'reason', None) == 'outdated_schedule' else 'error',
                         reason=getattr(error, 'reason', 'invalid_schedule' if isinstance(error, ValueError) else 'fetch_failed'),
                         sourceDate=getattr(error, 'source_date', None), errorType=type(error).__name__)
            report['scheduleChecks'].append(check)
            print(f'{cinema["name"]}: {check["reason"]}', flush=True)
            continue
        report['scheduleChecks'].append(check)
        movies.update(found)
        screenings.extend(offers)
        sources.append({'cinemaId': cinema['id'], 'url': url, 'date': date})
        print(f'{cinema["name"]}: {len(offers)} listings', flush=True)
    if any(check['status'] != 'ok' for check in report['scheduleChecks']) or not sources:
        report['completedAt'] = timestamp()
        write_json(root / 'tracking' / 'latest.json', report)
        return False
    metadata = add_trailers(movies, source_dir)
    report['movieChecks'] = list(metadata.values())
    snapshot = {'date': date, 'refreshedAt': timestamp(), 'sources': sources,
                'movies': sorted(movies.values(), key=lambda m: m['title'].casefold()), 'screenings': screenings}
    history_path = root / 'tracking' / 'history.json'
    previous = json.loads(history_path.read_text(encoding='utf-8')) if history_path.exists() else None
    target = root / 'showtimes.json'
    if previous is None and target.exists():
        previous, _ = update_history(None, json.loads(target.read_text(encoding='utf-8')))
    history, changes = update_history(previous, snapshot, metadata)
    # Only this small discovery timestamp is public; the detailed archive stays in Git.
    for movie in snapshot['movies']:
        movie['firstSeenAt'] = history['movies'][movie['id']]['firstSeenAt']
    report.update(status='success', completedAt=timestamp(), snapshotRefreshedAt=snapshot['refreshedAt'], changes=changes,
                  counts={'movies': len(movies), 'cinemas': len(sources), 'formatListings': len(screenings),
                          'showtimes': sum(len(offer['times']) for offer in screenings)})
    # Tracking files are archived in Git only; the public site's data shape is unchanged.
    write_json(root / 'tracking' / 'snapshot.json', archive_snapshot(snapshot, metadata))
    write_json(history_path, history)
    write_json(target, snapshot)
    write_json(root / 'tracking' / 'latest.json', report)
    print(f'Saved {len(movies)} movies and {len(screenings)} listings for {date}')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='Use saved HTML for verification')
    parser.add_argument('--date', help='Expected local schedule date (YYYY-MM-DD)')
    args = parser.parse_args()
    raise SystemExit(0 if refresh(source_dir=args.source_dir, expected_date=args.date) else 1)


if __name__ == '__main__':
    main()
