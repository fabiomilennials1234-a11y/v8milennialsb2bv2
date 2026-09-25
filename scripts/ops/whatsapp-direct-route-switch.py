"""Single pilot URL change. Private backup, exact readback, no automatic retry."""
import json, os, sys, urllib.request, urllib.error, urllib.parse
from pathlib import Path

class NoRedirect(urllib.request.HTTPRedirectHandler):

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
opener = urllib.request.build_opener(NoRedirect)
base = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co'
provider = 'https://milennialstech.uazapi.com'
instance = '3ea9d185-62bb-4efd-a9b4-b557938ba9e6'
backup = Path('/opt/torque-whatsapp-ingress/direct-route-before-20260925.json')
action = sys.argv[1]
if not action in ('prepare', 'activate', 'rollback', 'inspect'):
    raise RuntimeError('Operation precondition failed')
env = dict((l.split('=', 1) for l in Path('/opt/torque-whatsapp-ingress/pilot.env').read_text().splitlines() if '=' in l and (not l.startswith('#'))))
if not env['SUPABASE_URL'].rstrip('/') == base:
    raise RuntimeError('Operation precondition failed')

def request(url, headers, body=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers={**headers, 'Content-Type': 'application/json'})
    with opener.open(req, timeout=20) as response:
        return json.load(response)
key = env['SUPABASE_SERVICE_ROLE_KEY']
cred = request(base + '/rest/v1/rpc/get_uazapi_credentials', {'apikey': key, 'Authorization': 'Bearer ' + key}, {'p_instance_id': instance})
cred = cred[0] if isinstance(cred, list) else cred
headers = {'token': cred['uazapi_token']}
current = request(provider + '/webhook', headers)
if not (isinstance(current, list) and len(current) == 1):
    raise RuntimeError('Operation precondition failed')
expected_keys = {'id', 'enabled', 'url', 'events', 'excludeMessages', 'addUrlEvents', 'addUrlTypesMessages'}
if not set(current[0]) == expected_keys:
    raise RuntimeError('Operation precondition failed')
if action == 'prepare':
    route = current[0]
    parsed = urllib.parse.urlparse(route['url'])
    if not route['id'] == 'rfeaf66debd4692':
        raise RuntimeError('Operation precondition failed')
    if not (parsed.scheme == 'https' and parsed.netloc == 'jsjsmuncfkbsbzqzqhfq.supabase.co'):
        raise RuntimeError('Operation precondition failed')
    if not (parsed.path == '/functions/v1/whatsapp-webhook/' + env['UAZAPI_WEBHOOK_SECRET'] and (not parsed.query) and (not parsed.fragment)):
        raise RuntimeError('Operation precondition failed')
    if not (route['enabled'] is True and route['events'] == ['messages', 'messages_update', 'connection']):
        raise RuntimeError('Operation precondition failed')
    if not (route['excludeMessages'] == ['wasSentByApi'] and route['addUrlEvents'] is True and (route['addUrlTypesMessages'] is False)):
        raise RuntimeError('Operation precondition failed')
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(current, f)
        f.flush()
        os.fsync(f.fileno())
    directory_fd = os.open(backup.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    print(json.dumps({'backup_saved': True, 'route_count': 1, 'provider_changed': False}))
    sys.exit(0)
if not (backup.is_file() and (not backup.is_symlink()) and (backup.stat().st_mode & 0o077 == 0)):
    raise RuntimeError('Operation precondition failed')
directory_fd = os.open(backup.parent, os.O_RDONLY | os.O_DIRECTORY)
try: os.fsync(directory_fd)
finally: os.close(directory_fd)
before = json.loads(backup.read_text())
if not (isinstance(before, list) and len(before) == 1 and (set(before[0]) == expected_keys)):
    raise RuntimeError('Operation precondition failed')
if not before[0]['id'] == 'rfeaf66debd4692':
    raise RuntimeError('Operation precondition failed')
if not urllib.parse.urlparse(before[0]['url']).netloc == 'jsjsmuncfkbsbzqzqhfq.supabase.co':
    raise RuntimeError('Operation precondition failed')
parsed_backup = urllib.parse.urlparse(before[0]['url'])
if parsed_backup.scheme != 'https' or parsed_backup.netloc != 'jsjsmuncfkbsbzqzqhfq.supabase.co' or parsed_backup.query or parsed_backup.fragment or parsed_backup.path != '/functions/v1/whatsapp-webhook/' + env['UAZAPI_WEBHOOK_SECRET']:
    raise RuntimeError('Provider base route does not match runtime secret')
after = json.loads(json.dumps(before))
parsed = urllib.parse.urlparse(before[0]['url'])
after[0]['url'] = 'https://ingress.torquecrm.com.br' + parsed.path
if action == 'inspect':
    print(json.dumps({'legacy_exact': current == before, 'direct_exact': current == after, 'count': len(current)}))
    sys.exit(0)
(source, target) = (before, after) if action == 'activate' else (after, before)
if not current == source:
    raise RuntimeError('route source changed; no write attempted')
if action == 'activate':
    if not (env.get('INGRESS_ACCEPTING') == 'true' and env.get('INGRESS_FORWARD_LEGACY_EVENTS') == 'true'):
        raise RuntimeError('Operation precondition failed')
    if not request('https://ingress.torquecrm.com.br/ready', {}).get('ready') is True:
        raise RuntimeError('Operation precondition failed')
if action == 'activate':
    if request('https://ingress.torquecrm.com.br/worker-health', {}).get('healthy') is not True:
        raise RuntimeError('Queue is not healthy')
    admin_token = sys.stdin.read().strip()
    if not admin_token:
        raise RuntimeError('Administrative global route check requires token on stdin')
    global_route = request(provider + '/globalwebhook', {'admintoken': admin_token})
    if not isinstance(global_route, dict) or global_route.get('enabled') is not False or global_route.get('url') or global_route.get('events'):
        raise RuntimeError('Global webhook configuration changed')
request(provider + '/webhook', headers, {'action': 'update', **target[0]})
observed = request(provider + '/webhook', headers)
print(json.dumps({'action': action, 'exact_readback': observed == target, 'count': len(observed)}))
if not observed == target:
    raise RuntimeError('provider write outcome requires inspection')
