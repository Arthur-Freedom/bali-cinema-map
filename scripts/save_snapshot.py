"""Archive observations and diagnostics without overwriting newer work on main."""
import argparse
from datetime import date, datetime
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def git(repo, *args, check=True):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True)
    if check and result.returncode:
        raise RuntimeError(f'Git {args[0]} failed; the snapshot was not saved to main')
    return result


def read_snapshot(contents):
    snapshot = json.loads(contents)
    date.fromisoformat(snapshot['date'])
    refreshed = datetime.fromisoformat(snapshot['refreshedAt'])
    if refreshed.tzinfo is None or not all(isinstance(snapshot.get(key), list) and snapshot[key]
                                         for key in ('movies', 'screenings', 'sources')):
        raise ValueError('Invalid movie snapshot')
    return snapshot, refreshed


def persist_snapshot(snapshot_path, expected_head, repo=ROOT, *, published=True, expected_run_id=None):
    if not expected_head:
        raise ValueError('The source commit is required')
    if git(repo, 'rev-parse', 'HEAD').stdout.strip() != expected_head:
        return 'superseded'  # A code update landed while this run was publishing.
    if git(repo, 'status', '--porcelain', '--untracked-files=no').stdout.strip():
        raise ValueError('Refusing to modify a checkout with existing changes')

    bundle = Path(snapshot_path).parent
    report_bytes = (bundle / 'tracking' / 'latest.json').read_bytes()
    report = json.loads(report_bytes)
    if report['status'] not in ('success', 'failed'):
        raise ValueError('Invalid refresh report')
    if expected_run_id is not None and report.get('runId') != expected_run_id:
        raise ValueError('Refresh report belongs to a different run')
    observed = datetime.fromisoformat(report['startedAt'])
    if observed.tzinfo is None:
        raise ValueError('Refresh report needs a timezone')
    previous_report = Path(repo) / 'tracking' / 'latest.json'
    if previous_report.exists() and observed < datetime.fromisoformat(json.loads(previous_report.read_bytes())['startedAt']):
        return 'superseded'
    files = {'tracking/latest.json': report_bytes}
    if report['status'] == 'success':
        archive_bytes = (bundle / 'tracking' / 'snapshot.json').read_bytes()
        snapshot, refreshed = read_snapshot(archive_bytes)
        history_bytes = (bundle / 'tracking' / 'history.json').read_bytes()
        history = json.loads(history_bytes)
        if snapshot['refreshedAt'] != report['snapshotRefreshedAt'] or history['lastSuccessfulObservationAt'] != snapshot['refreshedAt']:
            raise ValueError('Snapshot, history and report timestamps must match')
        previous = json.loads((Path(repo) / 'showtimes.json').read_bytes())
        if refreshed < datetime.fromisoformat(previous['refreshedAt']):
            return 'superseded'
        files.update({'tracking/snapshot.json': archive_bytes, 'tracking/history.json': history_bytes})
        if published:
            contents = Path(snapshot_path).read_bytes()
            public, _ = read_snapshot(contents)
            if public['refreshedAt'] != snapshot['refreshedAt'] or public['date'] != snapshot['date']:
                raise ValueError('Published snapshot must match the archive')
            files['showtimes.json'] = contents
    # On a failed scrape, archive only diagnostics. Absence/price history stays intact.
    changed = {name: contents for name, contents in files.items()
               if not (Path(repo) / name).exists() or (Path(repo) / name).read_bytes() != contents}
    if not changed:
        return 'unchanged'

    for name, contents in changed.items():
        target = Path(repo) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents)
    paths = sorted(changed)
    git(repo, 'add', '--', *paths)
    git(repo, '-c', 'user.name=github-actions[bot]',
        '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'Archive cinema observations' if report['status'] == 'success' else 'Record cinema source-check failure', '--', *paths)
    pushed = git(repo, 'push', 'origin', 'HEAD:refs/heads/main', check=False)
    if pushed.returncode:
        # A concurrent owner push wins. Never force-push or merge old generated data.
        remote = git(repo, 'ls-remote', 'origin', 'refs/heads/main').stdout.split()
        if remote and remote[0] != expected_head:
            return 'superseded'
        raise RuntimeError('Snapshot push failed; check repository write permissions')
    return 'saved'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--publication', choices=('success', 'failure', 'skipped', 'cancelled'), default='success')
    args = parser.parse_args()
    result = persist_snapshot(args.snapshot, os.environ.get('GITHUB_SHA'),
                              published=args.publication == 'success', expected_run_id=os.environ.get('GITHUB_RUN_ID'))
    messages = {
        'saved': 'Cinema observations saved to main; repository activity updated.',
        'unchanged': 'The cinema observations are already saved.',
        'superseded': 'A newer commit or snapshot exists; leaving it unchanged.',
    }
    print(messages[result])
