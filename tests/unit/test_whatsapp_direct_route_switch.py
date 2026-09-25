"""Offline contract tests for the one-instance Uazapi route switch."""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/ops/whatsapp-direct-route-switch.py'
BASE = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co'
PROVIDER = 'https://milennialstech.uazapi.com'
DIRECT = 'https://ingress.torquecrm.com.br'
SECRET = 'fixture-secret'
LEGACY_URL = BASE + '/functions/v1/whatsapp-webhook/' + SECRET
DIRECT_URL = DIRECT + '/functions/v1/whatsapp-webhook/' + SECRET


def route(url=LEGACY_URL):
    return {
        'id': 'rfeaf66debd4692', 'enabled': True, 'url': url,
        'events': ['messages', 'messages_update', 'connection'],
        'excludeMessages': ['wasSentByApi'], 'addUrlEvents': True,
        'addUrlTypesMessages': False,
    }


class FakeOpener:
    def __init__(self, current, *, ready=True, healthy=True, global_route=None, readback=None):
        self.current = current
        self.ready = ready
        self.healthy = healthy
        self.global_route = global_route if global_route is not None else {'enabled': False, 'url': '', 'events': []}
        self.readback = readback
        self.calls = []
        self.posts = []

    def open(self, request, timeout):
        assert timeout == 20
        url = request.full_url
        method = request.get_method()
        body = json.loads(request.data) if request.data else None
        self.calls.append((method, url, body))
        if url == BASE + '/rest/v1/rpc/get_uazapi_credentials':
            assert body == {'p_instance_id': '3ea9d185-62bb-4efd-a9b4-b557938ba9e6'}
            answer = {'uazapi_token': 'fixture-provider-token'}
        elif url == PROVIDER + '/webhook':
            assert request.get_header('Token') == 'fixture-provider-token'
            if method == 'POST':
                self.posts.append(body)
                answer = {'success': True}
            else:
                if self.posts and self.readback is not None:
                    answer = self.readback
                elif self.posts:
                    answer = [{key: value for key, value in self.posts[-1].items() if key != 'action'}]
                else:
                    answer = self.current
        elif url == DIRECT + '/ready':
            answer = {'ready': self.ready}
        elif url == DIRECT + '/worker-health':
            answer = {'healthy': self.healthy}
        elif url == PROVIDER + '/globalwebhook':
            assert request.get_header('Admintoken') == 'fixture-admin-token'
            answer = self.global_route
        else:
            raise AssertionError(f'Unexpected network call: {method} {url}')
        return io.StringIO(json.dumps(answer))


class DirectRouteSwitchTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='torque-route-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env_path = self.root / 'pilot.env'
        self.backup_path = self.root / 'route-backup.json'
        self.env = {
            'SUPABASE_URL': BASE, 'SUPABASE_SERVICE_ROLE_KEY': 'fixture-service',
            'UAZAPI_WEBHOOK_SECRET': SECRET, 'INGRESS_ACCEPTING': 'true',
            'INGRESS_FORWARD_LEGACY_EVENTS': 'true',
        }
        self.opener = FakeOpener([route()])

    def run_switch(self, action, *, backup=True):
        self.env_path.write_text(''.join(f'{key}={value}\n' for key, value in self.env.items()))
        if backup and not self.backup_path.exists():
            self.backup_path.write_text(json.dumps([route()]))
            self.backup_path.chmod(0o600)
        source = SCRIPT.read_text()
        # Only replace two fixed filesystem constants. All production logic,
        # provider URLs and the exact request sequence run unchanged.
        source = source.replace('/opt/torque-whatsapp-ingress/pilot.env', str(self.env_path))
        source = source.replace('/opt/torque-whatsapp-ingress/direct-route-before-20260925.json', str(self.backup_path))
        with mock.patch('urllib.request.build_opener', return_value=self.opener), \
             mock.patch.object(sys, 'argv', [str(SCRIPT), action]), \
             mock.patch.object(sys, 'stdin', io.StringIO('fixture-admin-token\n')), \
             mock.patch.object(sys, 'stdout', new_callable=io.StringIO) as output:
            try:
                exec(compile(source, str(SCRIPT), 'exec'), {'__name__': '__main__'})
            except SystemExit as exit_event:
                if exit_event.code != 0:
                    raise
            return output.getvalue()

    def assert_no_write(self, action, error):
        with self.assertRaisesRegex(RuntimeError, error):
            self.run_switch(action)
        self.assertEqual(self.opener.posts, [])

    def test_prepare_saves_private_exact_backup_without_provider_write(self):
        result = json.loads(self.run_switch('prepare', backup=False))
        self.assertEqual(result, {'backup_saved': True, 'route_count': 1, 'provider_changed': False})
        self.assertEqual(json.loads(self.backup_path.read_text()), [route()])
        self.assertEqual(self.backup_path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.opener.posts, [])

    def test_activate_one_post_same_route_id_only_url_changed_and_exact_readback(self):
        result = json.loads(self.run_switch('activate'))
        self.assertEqual(result, {'action': 'activate', 'exact_readback': True, 'count': 1})
        self.assertEqual(self.opener.posts, [{'action': 'update', **route(DIRECT_URL)}])
        self.assertEqual(len([call for call in self.opener.calls if call[1] == PROVIDER + '/webhook' and call[0] == 'GET']), 2)

    def test_rollback_one_post_restores_backup_without_activation_checks(self):
        self.opener.current = [route(DIRECT_URL)]
        self.opener.ready = False
        self.opener.healthy = False
        self.opener.global_route = {'enabled': True, 'url': 'another'}
        result = json.loads(self.run_switch('rollback'))
        self.assertEqual(result, {'action': 'rollback', 'exact_readback': True, 'count': 1})
        self.assertEqual(self.opener.posts, [{'action': 'update', **route()}])
        self.assertFalse(any(call[1] in (DIRECT + '/ready', DIRECT + '/worker-health', PROVIDER + '/globalwebhook') for call in self.opener.calls))

    def test_route_changed_blocks_write(self):
        self.opener.current = [dict(route(), enabled=False)]
        self.assert_no_write('activate', 'route source changed')

    def test_global_webhook_active_blocks_write(self):
        self.opener.global_route = {'enabled': True, 'url': 'https://other.example', 'events': ['messages']}
        self.assert_no_write('activate', 'Global webhook configuration changed')

    def test_unhealthy_queue_blocks_write(self):
        self.opener.healthy = False
        self.assert_no_write('activate', 'Queue is not healthy')

    def test_not_ready_blocks_write(self):
        self.opener.ready = False
        self.assert_no_write('activate', 'Operation precondition failed')

    def test_admission_or_forwarding_disabled_blocks_write(self):
        for key in ('INGRESS_ACCEPTING', 'INGRESS_FORWARD_LEGACY_EVENTS'):
            with self.subTest(key=key):
                self.env[key] = 'false'
                self.assert_no_write('activate', 'Operation precondition failed')
                self.env[key] = 'true'

    def test_wrong_runtime_secret_blocks_write(self):
        self.env['UAZAPI_WEBHOOK_SECRET'] = 'wrong-secret'
        self.assert_no_write('activate', 'Provider base route does not match runtime secret')

    def test_extra_provider_field_blocks_write(self):
        self.opener.current = [dict(route(), unexpected='mutation')]
        self.assert_no_write('activate', 'Operation precondition failed')

    def test_readback_mismatch_fails_without_retry(self):
        self.opener.readback = [route()]
        with self.assertRaisesRegex(RuntimeError, 'provider write outcome requires inspection'):
            self.run_switch('activate')
        self.assertEqual(self.opener.posts, [{'action': 'update', **route(DIRECT_URL)}])
        self.assertEqual(len([call for call in self.opener.calls if call[1] == PROVIDER + '/webhook' and call[0] == 'POST']), 1)


if __name__ == '__main__':
    unittest.main()
