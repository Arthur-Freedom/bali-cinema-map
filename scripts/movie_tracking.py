"""Repository-only observations. Missing means absent from a complete valid snapshot."""
from copy import deepcopy
from datetime import date
import re

from bs4 import BeautifulSoup

MONTHS = dict(zip(('januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli',
                   'agustus', 'september', 'oktober', 'november', 'desember'), range(1, 13)))
DETAIL_FIELDS = ('runtimeMinutes', 'ageRating', 'genres', 'sourceReleaseDate', 'language', 'subtitles')


def parse_movie_details(html):
    soup = BeautifulSoup(html, 'html.parser')
    labels = {}
    for label in soup.select('.sjdl'):
        value = label.find_next_sibling(class_='sisi')
        if value:
            labels[label.get_text(' ', strip=True).casefold().rstrip(':')] = value.get_text(' ', strip=True)
    def explicit(*names):
        value = next((labels[name] for name in names if labels.get(name)), None)
        return value if value and value.casefold() not in ('-', 'n/a', 'unknown') else None
    runtime = re.fullmatch(r'(\d{1,3})\s*(?:minutes?|menit)', explicit('duration', 'durasi') or '', re.I)
    runtime = int(runtime[1]) if runtime and 0 < int(runtime[1]) <= 600 else None
    release = None
    for note in soup.select('p.hlite'):
        match = re.search(r'sejak tanggal\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})', note.get_text(' ', strip=True), re.I)
        if match and match[2].casefold() in MONTHS:
            try:
                release = date(int(match[3]), MONTHS[match[2].casefold()], int(match[1])).isoformat()
            except ValueError:
                pass
    genre = explicit('genre')
    return {'runtimeMinutes': runtime, 'ageRating': explicit('rating'),
            'genres': [g.strip() for g in genre.split(',') if g.strip()] if genre else None,
            'sourceReleaseDate': release, 'language': explicit('language', 'languages', 'bahasa'),
            'subtitles': explicit('subtitle', 'subtitles')}


def update_history(previous, snapshot, metadata=None):
    """Call only after every cinema schedule passes validation; never on partial data."""
    observed = snapshot['refreshedAt']
    history = deepcopy(previous) if previous else {
        'schemaVersion': 1, 'trackingStartedAt': observed, 'lastSuccessfulObservationAt': None, 'movies': {}}
    changes = {name: [] for name in ('newMovies', 'missingMovies', 'returnedMovies',
                                    'newListings', 'missingListings', 'returnedListings',
                                    'priceChanges', 'availabilityChanges', 'metadataChanges')}
    current = {movie['id']: movie for movie in snapshot['movies']}
    offers = {}
    for offer in snapshot['screenings']:
        key = (offer['movieId'], offer['cinemaId'], offer['format'])
        offers.setdefault(key, []).append({'price': offer['price'], 'times': offer['times']})

    for movie_id in sorted(set(history['movies']) | set(current)):
        old = deepcopy(history['movies'].get(movie_id))
        present = movie_id in current
        if old is None:
            record = {'title': current[movie_id]['title'], 'sourceUrl': current[movie_id]['url'],
                      'firstSeenAt': observed, 'firstScheduleDate': snapshot['date'], 'listings': []}
            history['movies'][movie_id] = record
            changes['newMovies'].append(movie_id)
        else:
            record = history['movies'][movie_id]
            if old['currentlyListed'] and not present:
                changes['missingMovies'].append(movie_id)
            elif not old['currentlyListed'] and present:
                changes['returnedMovies'].append(movie_id)
        record['currentlyListed'] = present
        record['missingSince'] = None if present else record.get('missingSince') or observed
        if present:
            record.update(title=current[movie_id]['title'], sourceUrl=current[movie_id]['url'],
                          lastSeenAt=observed, lastScheduleDate=snapshot['date'])
        detail = (metadata or {}).get(movie_id)
        if detail and detail['status'] == 'ok':
            changed = [name for name in DETAIL_FIELDS if record.get('details', {}).get(name) != detail['details'].get(name)]
            if changed:
                changes['metadataChanges'].append({'movieId': movie_id, 'fields': changed})
            record['details'] = detail['details']
            record['detailsObservedAt'] = detail['checkedAt']

        listings = {(entry['cinemaId'], entry['format']): entry for entry in record['listings']}
        keys = set(listings) | {(cid, fmt) for mid, cid, fmt in offers if mid == movie_id}
        for cinema_id, studio in sorted(keys):
            identity = {'movieId': movie_id, 'cinemaId': cinema_id, 'format': studio}
            rows = offers.get((movie_id, cinema_id, studio))
            old_listing = deepcopy(listings.get((cinema_id, studio)))
            entry = listings.setdefault((cinema_id, studio), {
                'cinemaId': cinema_id, 'format': studio, 'firstSeenAt': observed,
                'firstScheduleDate': snapshot['date']})
            entry['currentlyListed'] = bool(rows)
            entry['missingSince'] = None if rows else entry.get('missingSince') or observed
            if rows:
                prices = sorted({row['price'] for row in rows if row['price'] is not None})
                if old_listing is None:
                    changes['newListings'].append(identity)
                elif not old_listing['currentlyListed']:
                    changes['returnedListings'].append(identity)
                if old_listing and old_listing.get('pricesIdr') and prices and old_listing['pricesIdr'] != prices:
                    changes['priceChanges'].append({**identity, 'before': old_listing['pricesIdr'], 'after': prices,
                        'previousSeenAt': old_listing['lastSeenAt'], 'previousScheduleDate': old_listing['lastScheduleDate'],
                        'scheduleDate': snapshot['date']})
                entry.update(lastSeenAt=observed, lastScheduleDate=snapshot['date'], pricesIdr=prices,
                             hasUnknownPrice=any(row['price'] is None for row in rows),
                             offers=rows, showtimeCount=sum(len(row['times']) for row in rows))
            elif old_listing and old_listing['currentlyListed']:
                changes['missingListings'].append(identity)
        record['listings'] = [listings[key] for key in sorted(listings)]
        active = [row for row in record['listings'] if row['currentlyListed']]
        counts = {'cinemaCount': len({row['cinemaId'] for row in active}), 'formatListingCount': len(active),
                  'showtimeCount': sum(row['showtimeCount'] for row in active)}
        if old and old['latestCounts'] != counts:
            changes['availabilityChanges'].append({'movieId': movie_id, 'before': old['latestCounts'], 'after': counts})
        record['latestCounts'] = counts
    history['lastSuccessfulObservationAt'] = observed
    return history, changes


def archive_snapshot(snapshot, metadata):
    result = deepcopy(snapshot)
    result['schemaVersion'] = 1
    result['priceBasis'] = 'Source-listed price by studio format; final checkout price may differ.'
    for movie in result['movies']:
        detail = metadata.get(movie['id'])
        movie['details'] = detail['details'] if detail and detail['status'] == 'ok' else dict.fromkeys(DETAIL_FIELDS)
    return result
