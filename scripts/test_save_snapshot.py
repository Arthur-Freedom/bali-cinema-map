from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from save_snapshot import git, persist_snapshot


class SnapshotBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / 'remote.git'
        self.repo = self.root / 'checkout'
        self.remote.mkdir()
        self.repo.mkdir()
        git(self.remote, 'init', '--bare', '--initial-branch=main')
        git(self.repo, 'init', '--initial-branch=main')
        git(self.repo, 'config', 'user.name', 'Test Owner')
        git(self.repo, 'config', 'user.email', 'test@example.invalid')
        git(self.repo, 'config', 'core.autocrlf', 'false')
        self.old = {'date':'2026-10-05', 'refreshedAt':'2026-10-05T07:17:00+08:00',
                    'movies':[{'id':'movie'}], 'screenings':[{'movieId':'movie'}],
                    'sources':[{'cinemaId':'cinema'}]}
        (self.repo / 'showtimes.json').write_text(json.dumps(self.old), encoding='utf-8')
        (self.repo / 'app.js').write_text('// owner code\n', encoding='utf-8')
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-m', 'Original app')
        git(self.repo, 'remote', 'add', 'origin', str(self.remote))
        pushed = git(self.repo, 'push', 'origin', 'main', check=False)
        self.assertEqual(pushed.returncode, 0, pushed.stderr)
        self.head = git(self.repo, 'rev-parse', 'HEAD').stdout.strip()
        new = deepcopy(self.old)
        new.update(date='2026-10-06', refreshedAt='2026-10-06T07:17:00+08:00')
        self.snapshot = self.root / 'published.json'
        self.snapshot.write_text(json.dumps(new), encoding='utf-8')

    def test_saves_only_real_snapshot_and_updates_remote(self):
        self.assertEqual(persist_snapshot(self.snapshot, self.head, self.repo), 'saved')
        self.assertNotEqual(git(self.remote, 'rev-parse', 'main').stdout.strip(), self.head)
        self.assertEqual(git(self.remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main').stdout.strip(), 'showtimes.json')
        self.assertEqual(json.loads(git(self.remote, 'show', 'main:showtimes.json').stdout)['date'], '2026-10-06')
        self.assertEqual(git(self.remote, 'show', 'main:app.js').stdout, '// owner code\n')

    def test_identical_snapshot_does_not_make_empty_commit(self):
        self.snapshot.write_text(json.dumps(self.old), encoding='utf-8')
        self.assertEqual(persist_snapshot(self.snapshot, self.head, self.repo), 'unchanged')
        self.assertEqual(git(self.remote, 'rev-parse', 'main').stdout.strip(), self.head)

    def test_concurrent_owner_push_is_preserved(self):
        other = self.root / 'other'
        git(self.root, 'clone', str(self.remote), str(other))
        (other / 'app.js').write_text('// newer owner code\n', encoding='utf-8')
        git(other, 'add', 'app.js')
        git(other, '-c', 'user.name=Owner', '-c', 'user.email=owner@example.invalid', 'commit', '-m', 'New app code')
        git(other, 'push', 'origin', 'main')
        newer = git(self.remote, 'rev-parse', 'main').stdout.strip()
        self.assertEqual(persist_snapshot(self.snapshot, self.head, self.repo), 'superseded')
        self.assertEqual(git(self.remote, 'rev-parse', 'main').stdout.strip(), newer)
        self.assertEqual(git(self.remote, 'show', 'main:app.js').stdout, '// newer owner code\n')

    def test_invalid_or_stale_data_cannot_replace_backup(self):
        self.snapshot.write_text('{}', encoding='utf-8')
        with self.assertRaises((ValueError, KeyError)):
            persist_snapshot(self.snapshot, self.head, self.repo)
        stale = deepcopy(self.old)
        stale['refreshedAt'] = '2026-10-04T07:17:00+08:00'
        self.snapshot.write_text(json.dumps(stale), encoding='utf-8')
        self.assertEqual(persist_snapshot(self.snapshot, self.head, self.repo), 'superseded')
        self.assertEqual(git(self.remote, 'rev-parse', 'main').stdout.strip(), self.head)


if __name__ == '__main__':
    unittest.main()
