import importlib.util
from pathlib import Path
import hashlib
import os
import tempfile
from datetime import datetime,timezone,timedelta
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('local_backup',Path(__file__).with_name('run-local.py'))
job=importlib.util.module_from_spec(spec);spec.loader.exec_module(job)

class BackupChecks(unittest.TestCase):
    def test_retention_preserves_unknown_or_damaged_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);now=datetime.now(timezone.utc)
            owned=folder/'logistics-20200101T000000Z-1234abcd.sqlite';owned.write_bytes(b'fixture')
            owned.with_suffix('.sqlite.sha256').write_text(job.sha256(owned))
            os.utime(owned,((now-timedelta(days=31)).timestamp(),)*2)
            other=folder/'existing.sqlite';other.write_bytes(b'preserve')
            damaged=folder/'logistics-20200101T000000Z-1234abce.sqlite';damaged.write_bytes(b'preserve');damaged.with_suffix('.sqlite.sha256').write_text('wrong');os.utime(damaged,((now-timedelta(days=31)).timestamp(),)*2)
            self.assertEqual(job.prune(folder,30,now),[owned.name]);self.assertTrue(other.exists());self.assertTrue(damaged.exists())

    def test_copy_verifies_checksum_before_retention(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'compose.yaml').write_text('services: {}');backup=root/'backups';payload=b'sqlite fixture';digest=hashlib.sha256(payload).hexdigest();calls=[]
            def run(cmd,**kwargs):
                calls.append(cmd)
                output=''
                if 'ps' in cmd:output='running-container'
                elif 'cp' in cmd:Path(cmd[-1]).write_bytes(payload)
                elif 'createHash' in ' '.join(cmd):output=digest
                return type('Result',(),{'returncode':0,'stdout':output})()
            with patch.object(job.subprocess,'run',side_effect=run):result=job.run_backup(root,backup)
            self.assertEqual(result['sha256'],digest);self.assertFalse(result['cloud_upload']);self.assertTrue(Path(result['backup']).exists())
            self.assertTrue(any('unlinkSync' in ' '.join(cmd) for cmd in calls))

    def test_existing_user_folder_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'compose.yaml').write_text('services: {}');folder=root/'user-files';folder.mkdir();original=folder/'keep.txt';original.write_text('keep')
            with patch.object(job.subprocess,'run') as run:
                with self.assertRaises(ValueError):job.run_backup(root,folder)
                run.assert_not_called()
            self.assertEqual(original.read_text(),'keep')

    def test_no_service_never_launches_or_copies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'compose.yaml').write_text('services: {}')
            with patch.object(job.subprocess,'run') as run:
                run.return_value.returncode=0;run.return_value.stdout=''
                with self.assertRaises(RuntimeError):job.run_backup(root,root/'backups')
                self.assertEqual(run.call_count,1)

if __name__=='__main__':unittest.main()
