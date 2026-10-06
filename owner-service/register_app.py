"""One-time local GitHub App manifest setup; credentials stay in ignored .local/."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, urlopen
import html
import json
import re
import secrets
import threading
import time

ROOT = Path(__file__).resolve().parent
PORT = 8766
SITE = 'https://arthur-freedom.github.io/bali-cinema-map/'
SERVICE = 'https://bali-cinema-owner-refresh.honeymooninbali.workers.dev'
STATE = secrets.token_urlsafe(32)
DEADLINE = time.monotonic() + 3600
LOCK = threading.Lock()
MANIFEST = {
    'name': 'Bali Cinema Refresh - Arthur Freedom',
    'url': SITE,
    'description': 'Owner-only movie schedule refresh for Arthur-Freedom/bali-cinema-map.',
    'redirect_url': f'http://127.0.0.1:{PORT}/callback',
    'callback_urls': [SERVICE + '/auth/callback'],
    'hook_attributes': {'url': SERVICE + '/github/webhook', 'active': False},
    'public': False,
    'default_permissions': {'actions': 'write', 'metadata': 'read'},
    'default_events': [],
    'request_oauth_on_install': False,
}

class Setup(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Callback URLs contain temporary authorization codes.

    def page(self, body, status=200):
        content = ('<!doctype html><html lang="en"><meta charset="utf-8"><title>Bali Cinema owner setup</title>'
                   '<meta name="viewport" content="width=device-width, initial-scale=1">'
                   '<style>body{font:17px/1.6 system-ui;max-width:760px;margin:60px auto;padding:0 24px;color:#19382f}'
                   'button{font:inherit;background:#16433a;color:white;border:0;border-radius:6px;padding:12px 20px;cursor:pointer}'
                   'pre{font-size:13px;overflow:auto;background:#f3f6f4;padding:16px}a{color:#16433a}</style>'
                   + body + '</html>').encode()
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; frame-ancestors 'none'; base-uri 'none'")
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.headers.get('Host') != f'127.0.0.1:{PORT}':
            return self.page('<h1>Invalid host</h1>', 400)
        url = urlsplit(self.path)
        target = ROOT / '.local' / 'github-app.json'
        if url.path in ('/', '/callback') and target.exists():
            # A completed or recovered setup must never create a second app.
            try:
                slug = json.loads(target.read_text(encoding='utf-8'))['slug']
                if not re.fullmatch(r'[a-z0-9-]+', slug):
                    raise ValueError('Invalid app slug')
                return self.page('<h1>GitHub app saved</h1><p>The app credentials have been recovered. No need to create another app.</p>'
                                 '<p>Next, install it on <strong>Only select repositories → bali-cinema-map</strong>.</p>'
                                 f'<p><a href="https://github.com/apps/{slug}/installations/new">Open repository installation</a></p>')
            except (KeyError, ValueError, OSError):
                return self.page('<h1>Saved setup needs attention</h1><p>The existing credentials were preserved. Check the local setup status.</p>', 409)
        if time.monotonic() > DEADLINE:
            return self.page('<h1>Setup expired</h1><p>Restart the setup helper.</p>', 410)
        if url.path == '/':
            return self.page(f'''<h1>Connect the owner refresh button</h1>
              <p>Create a private GitHub app owned by <strong>Arthur-Freedom</strong>.
              Install it only on <strong>bali-cinema-map</strong>.</p>
              <p>Requested access: <strong>Actions: read and write</strong> to start and monitor refresh runs;
              <strong>Metadata: read</strong> to identify the repository. No source-code write permission.</p>
              <p>The app uses the Cloudflare Workers Free service. GitHub credentials are stored as Worker secrets;
              the public site receives only a temporary encrypted owner session.</p>
              <form action="https://github.com/settings/apps/new?state={STATE}" method="post">
                <input type="hidden" name="manifest" value="{html.escape(json.dumps(MANIFEST), quote=True)}">
                <button type="submit">Review app on GitHub</button>
              </form>
              <details><summary>View exact app configuration</summary><pre>{html.escape(json.dumps(MANIFEST, indent=2))}</pre></details>''')
        if url.path != '/callback':
            return self.page('<h1>Not found</h1>', 404)
        query = parse_qs(url.query)
        if not secrets.compare_digest(query.get('state', [''])[0], STATE):
            return self.page('<h1>Setup could not be verified</h1>', 403)
        code = query.get('code', [''])[0]
        if not re.fullmatch(r'[A-Za-z0-9_-]{10,512}', code):
            return self.page('<h1>Invalid setup code</h1>', 400)
        with LOCK:
            if target.exists():
                return self.page('<h1>App already saved</h1><p>The existing credentials were preserved.</p>', 409)
            try:
                request = Request(f'https://api.github.com/app-manifests/{code}/conversions', data=b'', method='POST',
                                  headers={'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2026-03-10', 'User-Agent':'BaliCinemaMap-Setup'})
                with urlopen(request, timeout=30) as result:
                    app = json.load(result)
                if app.get('owner', {}).get('id') != 18115558:
                    return self.page('<h1>Wrong owner account</h1><p>This app must be owned by Arthur-Freedom. No credentials were saved.</p>', 403)
                target.parent.mkdir(exist_ok=True)
                saved = {name:app[name] for name in ('id', 'slug', 'client_id', 'client_secret')}
                with target.open('x', encoding='utf-8') as output:
                    json.dump(saved, output)
                target.chmod(0o600)
                # The app private key and webhook secret are not used and are never persisted.
                print('GitHub app credentials saved in ignored owner-service/.local/github-app.json', flush=True)
                return self.page(f'<h1>GitHub app created</h1><p>Credentials were saved locally for deployment.</p>'
                                 f'<p>Next, install the app on <strong>Only select repositories → bali-cinema-map</strong>.</p>'
                                 f'<p><a href="https://github.com/apps/{html.escape(app["slug"], quote=True)}/installations/new">Open repository installation</a></p>')
            except Exception as error:
                print('App setup failed:', type(error).__name__, flush=True)
                return self.page('<h1>Setup could not finish</h1><p>No credentials are shown here. Check the local setup status and outbound network access before trying again.</p>', 502)

if __name__ == '__main__':
    print(f'Review GitHub app setup: http://127.0.0.1:{PORT}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Setup).serve_forever()
