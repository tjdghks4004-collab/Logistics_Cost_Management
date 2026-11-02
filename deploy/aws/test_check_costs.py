import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('costs', Path(__file__).with_name('check-costs.py'))
costs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(costs)

class CostChecks(unittest.TestCase):
    def test_filters_without_assuming_actual_prices(self):
        base = {'isActive': True, 'supportedPlatforms': ['LINUX_UNIX'], 'ramSizeInGb': 2, 'price': 123, 'bundleId': 'fixture'}
        rows = costs.summarize_bundles([base, {**base, 'isActive': False}, {**base, 'supportedPlatforms': ['WINDOWS']}, {**base, 'ramSizeInGb': 16}])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['monthly_bundle_usd'], 123)
        self.assertIsNone(rows[0]['public_ipv4_count'])

    def test_mutations_are_rejected_before_any_cli_call(self):
        with patch.object(costs.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                costs.aws_read('ap-northeast-2', 'lightsail', 'create-instances')
            run.assert_not_called()

    def test_failed_read_never_prints_credential_diagnostics(self):
        with patch.object(costs.subprocess, 'run') as run:
            run.return_value.returncode = 1
            run.return_value.stderr = 'fake-sensitive-fixture'
            with self.assertRaises(RuntimeError) as exc:
                costs.aws_read('ap-northeast-2', 'sts', 'get-caller-identity')
            self.assertNotIn('fake-sensitive-fixture', str(exc.exception))

if __name__ == '__main__':
    unittest.main()
