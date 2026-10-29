// Where the frontend finds the API. Default: same host, under /api (e.g. UI at /, API at /api).
// For local development with the API on its own port, set e.g. "http://127.0.0.1:3000".
window.API_BASE = window.API_BASE || `${location.origin}/api`;
