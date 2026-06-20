import urllib.request, json

def api_get(path):
    try:
        r = urllib.request.urlopen(f'http://127.0.0.1:8000{path}', timeout=10)
        return r.status, json.loads(r.read())
    except Exception as e:
        body = ''
        if hasattr(e, 'read'):
            body = e.read().decode()[:300]
        return getattr(e, 'code', 0), f'{type(e).__name__}: {str(e)[:200]} | {body}'

def api_post(path, data=None):
    body = json.dumps(data).encode() if data else b''
    req = urllib.request.Request(
        f'http://127.0.0.1:8000{path}',
        data=body,
        headers={'Content-Type': 'application/json'} if data else {}
    )
    try:
        r = urllib.request.urlopen(req, timeout=10)
        return r.status, json.loads(r.read())
    except Exception as e:
        resp_body = ''
        if hasattr(e, 'read'):
            resp_body = e.read().decode()[:300]
        return getattr(e, 'code', 0), f'{type(e).__name__}: {str(e)[:200]} | {resp_body}'

# Test inference endpoint
print("=== GET /api/tasks/1/inference ===")
status, data = api_get('/api/tasks/1/inference')
print(f"Status: {status}")
print(f"Data: {json.dumps(data, indent=2)[:400] if isinstance(data, (dict, list)) else data[:400]}")

# Test target endpoint
print("\n=== POST /api/tasks/1/target ===")
status, data = api_post('/api/tasks/1/target', {"target_column": "target"})
print(f"Status: {status}")
print(f"Data: {json.dumps(data, indent=2)[:300] if isinstance(data, (dict, list)) else data[:300]}")

# Test overview endpoint  
print("\n=== GET /api/tasks/1/overview ===")
status, data = api_get('/api/tasks/1/overview')
print(f"Status: {status}")
if isinstance(data, dict):
    print(f"Keys: {list(data.keys())}")
    print(f"Data (first 400): {json.dumps(data, indent=2)[:400]}")
else:
    print(f"Data: {str(data)[:400]}")

# Test feature engineering endpoint
print("\n=== POST /api/tasks/1/feature-engineering ===")
status, data = api_post('/api/tasks/1/feature-engineering', {"bins": 10})
print(f"Status: {status}")
print(f"Data: {json.dumps(data, indent=2)[:300] if isinstance(data, (dict, list)) else data[:300]}")
