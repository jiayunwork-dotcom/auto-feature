import urllib.request, json, io

boundary = '---BOUNDARY---'
filepath = '/tmp/test.csv'
filename = 'test.csv'

with open(filepath, 'rb') as f:
    file_data = f.read()

body = (
    f'-----BOUNDARY---\r\n'
    f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
    f'Content-Type: text/csv\r\n\r\n'
).encode() + file_data + b'\r\n-----BOUNDARY-----\r\n'

req = urllib.request.Request(
    'http://127.0.0.1:8000/api/upload',
    data=body,
    headers={
        'Content-Type': f'multipart/form-data; boundary=---BOUNDARY---'
    }
)
try:
    r = urllib.request.urlopen(req, timeout=10)
    print('Status:', r.status)
    resp = json.loads(r.read())
    print('Response:', json.dumps(resp, indent=2)[:500])
except Exception as e:
    import traceback
    print('Error:', type(e).__name__, str(e)[:300])
    if hasattr(e, 'read'):
        print('Body:', e.read().decode()[:500])
