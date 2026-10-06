"""Send owner-opted-in Web Push. Never print subscriptions, secret keys or response bodies."""
import argparse
from datetime import datetime
import hashlib
import json
import os
import uuid
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

SERVICE = 'https://bali-cinema-owner-refresh.honeymooninbali.workers.dev'
SITE = 'https://arthur-freedom.github.io/bali-cinema-map/'
# py-vapid validates an HTTPS origin (without a path) as the contact claim.
VAPID_SUBJECT = 'https://arthur-freedom.github.io'


def eligible_movies(snapshot, cursor):
    after = datetime.fromisoformat(cursor.replace('Z', '+00:00'))
    observed = datetime.fromisoformat(snapshot['refreshedAt'])
    if after.tzinfo is None or observed.tzinfo is None:
        raise ValueError('Observation timestamps need timezones')
    return [m for m in snapshot['movies'] if m.get('firstSeenAt') and
            after < datetime.fromisoformat(m['firstSeenAt']) <= observed]


def allowed_endpoint(endpoint):
    url = urlparse(endpoint)
    host = url.hostname or ''
    return (url.scheme == 'https' and not url.username and not url.password and not url.fragment
            and url.port in (None, 443) and (host in ('fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com')
            or host.endswith(('.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'))))


def payload_for(movies):
    ids = sorted(m['id'] for m in movies)
    count = len(movies)
    url = SITE + '?' + urlencode({'movie': ids[0]} if count == 1 else {'new': ','.join(ids)})
    names = ', '.join(m['title'] for m in movies[:4])
    if count > 4:
        names += f' and {count - 4} more'
    return {'title': f'{count} new movie' + ('s' if count != 1 else '') + ' in Bali',
            'body': names[:220] + '. Compare venues and prices.', 'url': url,
            'tag': 'movies-' + hashlib.sha256('\n'.join(ids).encode()).hexdigest()[:24]}


def send_notifications(snapshot, devices, send, acknowledge, test_id=None):
    sent = 0
    failures = 0
    for device in devices:
        if test_id and device['id'] != test_id:
            continue
        subscription = device['subscription']
        if not allowed_endpoint(subscription['endpoint']):
            raise ValueError('Unsupported push service')
        movies = eligible_movies(snapshot, device['cursor']) if not test_id else []
        if not movies and not test_id:
            continue  # Keep the cursor unchanged until an alert is accepted; retry failures next refresh.
        payload = ({'title': 'Bali cinema test notification',
                    'body': 'Your test reached this device. New-movie alerts will appear here too.',
                    'url': SITE, 'tag': 'bali-cinema-test-' + uuid.uuid4().hex,
                    'test': True} if test_id else payload_for(movies))
        try:
            status = send(subscription, payload)
            if status in (404, 410):
                acknowledge({'id': device['id'], 'expired': True})
            elif 200 <= status < 300:
                if not test_id:
                    acknowledge({'id': device['id'], 'cursor': snapshot['refreshedAt']})
                sent += 1
            else:
                failures += 1
        except Exception:
            failures += 1  # One unavailable device must not block the others.
    if failures:
        raise RuntimeError(f'{failures} device delivery attempt(s) need retrying.')
    if test_id and sent == 0:
        raise RuntimeError('Test device is no longer subscribed.')
    return sent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path)
    parser.add_argument('--test-device')
    parser.add_argument('--check-config', action='store_true')
    args = parser.parse_args()
    from pywebpush import webpush, WebPushException
    secret = os.environ['PUSH_DISPATCH_SECRET']
    private_key = os.environ['VAPID_PRIVATE_KEY']
    if len(secret) < 43 or not private_key:
        raise ValueError('Push secrets have not been configured')
    from py_vapid import Vapid
    Vapid.from_string(private_key)

    def api(path, data=None):
        request = Request(SERVICE + '/internal/push/' + path,
                          data=json.dumps(data).encode() if data is not None else None,
                          headers={'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json',
                                   'User-Agent': 'BaliCinemaMap-Notifications/1.0'})
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def send(subscription, payload):
        try:
            response = webpush(subscription_info=subscription, data=json.dumps(payload),
                               vapid_private_key=private_key, vapid_claims={'sub': VAPID_SUBJECT}, ttl=86400, timeout=30,
                               headers={'Urgency': 'high' if payload.get('test') else 'normal'})
            return response.status_code
        except WebPushException as error:
            # Exception text may contain a private endpoint; never log it.
            if error.response is not None:
                return error.response.status_code
            raise RuntimeError('Push delivery failed; the device will be retried on a later refresh.') from None

    if args.check_config:
        count = len(api('targets')['devices'])
        print(f'Push configuration verified; {count} subscribed device(s). No notification sent.')
        return
    snapshot = None
    if not args.test_device:
        if not args.snapshot:
            raise ValueError('A published snapshot is required')
        snapshot = json.loads(args.snapshot.read_text(encoding='utf-8'))
        report = json.loads((args.snapshot.parent / 'tracking/latest.json').read_text(encoding='utf-8'))
        if report['status'] != 'success' or report['runId'] != os.environ['GITHUB_RUN_ID'] or report['snapshotRefreshedAt'] != snapshot['refreshedAt']:
            raise ValueError('Refresh report does not match this run')
        # A successful Pages job can precede cache propagation. Retry briefly before notifying.
        import time
        for attempt in range(12):
            with urlopen(SITE + 'showtimes.json?push=' + report['runId'], timeout=30) as response:
                published = json.load(response)
            if published['refreshedAt'] == snapshot['refreshedAt']:
                break
            if datetime.fromisoformat(published['refreshedAt']) > datetime.fromisoformat(snapshot['refreshedAt']):
                print('A newer snapshot is live; skip this older notification run.')
                return
            if attempt == 11:
                raise RuntimeError('Fresh listings are not visible yet; no alert sent.')
            time.sleep(5)
    devices = api('targets')['devices']
    if args.test_device:
        import time
        for _ in range(6):
            if any(d['id'] == args.test_device for d in devices):
                break
            time.sleep(10)  # Allow a new KV registration to reach another region.
            devices = api('targets')['devices']
    count = send_notifications(snapshot, devices, send, lambda data: api('ack', data), args.test_device)
    print(f'Push service accepted {count} notification(s). Device endpoints remain private.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No upstream error strings, tracebacks, keys, endpoints or HTTP response bodies in CI logs.
        print(f'Movie notifications did not finish ({type(error).__name__}). Check configuration or retry the workflow.')
        raise SystemExit(1) from None
