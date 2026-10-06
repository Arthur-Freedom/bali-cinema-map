"""Save the published snapshot without overwriting newer work on main."""
from datetime import date, datetime
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def git(repo, *args, check=True):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True)
    if check and result.returncode:
        raise RuntimeError(f'Git {args[0]} failed; the snapshot was not saved to main')
    return result


def persist_snapshot(snapshot_path, expected_head, repo=ROOT):
    if not expected_head:
        raise ValueError('The source commit is required')
    if git(repo, 'rev-parse', 'HEAD').stdout.strip() != expected_head:
        return 'superseded'  # A code update landed while this run was publishing.
    if git(repo, 'status', '--porcelain', '--untracked-files=no').stdout.strip():
        raise ValueError('Refusing to modify a checkout with existing changes')

    contents = Path(snapshot_path).read_bytes()
    snapshot = json.loads(contents)
    date.fromisoformat(snapshot['date'])
    refreshed = datetime.fromisoformat(snapshot['refreshedAt'])
    if refreshed.tzinfo is None or not all(isinstance(snapshot.get(key), list) and snapshot[key]
                                         for key in ('movies', 'screenings', 'sources')):
        raise ValueError('Invalid movie snapshot')
    target = Path(repo) / 'showtimes.json'
    previous = json.loads(target.read_bytes())
    if refreshed < datetime.fromisoformat(previous['refreshedAt']):
        return 'superseded'
    if contents == target.read_bytes():
        return 'unchanged'

    target.write_bytes(contents)
    git(repo, 'add', '--', 'showtimes.json')
    git(repo, '-c', 'user.name=github-actions[bot]',
        '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', f'Update cinema snapshot ({snapshot["date"]})', '--', 'showtimes.json')
    pushed = git(repo, 'push', 'origin', 'HEAD:refs/heads/main', check=False)
    if pushed.returncode:
        # A concurrent owner push wins. Never force-push or merge old generated data.
        remote = git(repo, 'ls-remote', 'origin', 'refs/heads/main').stdout.split()
        if remote and remote[0] != expected_head:
            return 'superseded'
        raise RuntimeError('Snapshot push failed; check repository write permissions')
    return 'saved'


if __name__ == '__main__':
    result = persist_snapshot(Path(sys.argv[1]), os.environ.get('GITHUB_SHA'))
    messages = {
        'saved': 'Published movie data saved to main; repository activity updated.',
        'unchanged': 'The published movie snapshot is already saved.',
        'superseded': 'A newer commit or snapshot exists; leaving it unchanged.',
    }
    print(messages[result])
