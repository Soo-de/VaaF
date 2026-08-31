/**
 * API client and mock data layer for FaaS Platform.
 * All communication with the backend passes through this module.
 */

export const API_BASE = "";
export const USE_MOCK = true;
export const USER_ID = localStorage.getItem("faas-user-id") || "anonymous";

export const DEFAULT_TEMPLATE_CODE = `def handler(event, context):
    """
    FaaS Fonksiyonu
    
    event: Gelen request bilgisi
      - event["body"]: Request body (dict)
      - event["httpMethod"]: GET, POST, vs.
      - event["headers"]: Request header'ları
    
    context: Fonksiyon metadata'sı
      - context["function_name"]: Fonksiyon adı
      - context["request_id"]: İstek ID'si
    """
    body = event.get("body", {})
    name = body.get("name", "Dünya")
    
    return {
        "statusCode": 200,
        "body": {
            "message": f"Merhaba {name}!"
        }
    }
`;

// In-memory mock state store (persisted in sessionStorage for interactive session fidelity)
const MOCK_STORAGE_KEY = 'faas-mock-store';
const DRAFT_STORAGE_KEY = 'faas_drafts';

export function getLocalDrafts() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalDraft(draft) {
  try {
    const drafts = getLocalDrafts().filter(d => d.name !== draft.name);
    drafts.unshift(draft);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {}
}

export function removeLocalDraft(name) {
  try {
    const drafts = getLocalDrafts().filter(d => d.name !== name);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {}
}

function getMockStore() {
  const cached = sessionStorage.getItem(MOCK_STORAGE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // ignore JSON parse error and fallback
    }
  }

  const initialStore = {
    functions: [
      {
        name: "ornek-fonksiyon",
        url: "http://ornek-fonksiyon.tenant-functions.svc.cluster.local",
        ready: true,
        deployed: true,
        created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        runtime: "python",
        namespace: "tenant-functions",
        code: `def handler(event, context):
    name = event.get('body', {}).get('name', 'Dünya')
    return {
        'statusCode': 200,
        'body': {'message': f'Merhaba {name}!'}
    }`,
        env: {
          "APP_ENV": "production",
          "LOG_LEVEL": "INFO"
        },
        revisions: [
          { name: "ornek-fonksiyon-00002", created_at: new Date(Date.now() - 1800000).toISOString(), is_active: true, has_code: true, code: `def handler(event, context):\n    name = event.get('body', {}).get('name', 'Dünya')\n    return {'statusCode': 200, 'body': {'message': f'Merhaba {name}!'}}` },
          { name: "ornek-fonksiyon-00001", created_at: new Date(Date.now() - 3600000 * 2).toISOString(), is_active: false, has_code: true, code: `def handler(event, context):\n    return {'statusCode': 200, 'body': 'v1 initial'}` }
        ]
      },
      {
        name: "hesaplama",
        url: "http://hesaplama.tenant-functions.svc.cluster.local",
        ready: false,
        deployed: false,
        created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
        runtime: "python",
        namespace: "tenant-functions",
        code: `def handler(event, context):
    body = event.get('body', {})
    a = body.get('a', 0)
    b = body.get('b', 0)
    return {
        'statusCode': 200,
        'body': {'result': a + b}
    }`,
        env: {},
        revisions: []
      }
    ]
  };

  sessionStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(initialStore));
  return initialStore;
}

function saveMockStore(store) {
  sessionStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(store));
}

/**
 * Standard fetch wrapper with auth header and error handling.
 * @param {string} path
 * @param {RequestInit} [options={}]
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-User-Id": USER_ID,
    ...(options.headers || {}),
  };
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

/**
 * Create a new draft function (not yet deployed).
 * Persisted in localStorage ('faas_drafts') so it is preserved in both dev and production.
 * @param {Object} params
 * @param {string} params.name
 * @param {string} [params.runtime="python"]
 * @returns {Promise<Object>}
 */
export async function createDraftFunction({ name, runtime = "python" }) {
  const draft = {
    name,
    url: `http://${name}.tenant-functions.svc.cluster.local`,
    ready: false,
    deployed: false,
    created_at: new Date().toISOString(),
    runtime,
    namespace: "tenant-functions",
    code: DEFAULT_TEMPLATE_CODE,
    env: {},
    revisions: []
  };

  saveLocalDraft(draft);

  if (USE_MOCK) {
    const store = getMockStore();
    const existing = store.functions.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      throw new Error(`'${name}' isimli bir fonksiyon zaten mevcut!`);
    }
    store.functions.unshift(draft);
    saveMockStore(store);
  }

  return draft;
}

/**
 * Check backend health status.
 * @returns {Promise<{ status: string }>}
 */
export async function getHealth() {
  if (USE_MOCK) {
    return { status: "ok" };
  }
  const res = await apiFetch("/health");
  if (!res.ok) throw new Error(`Health check failed with status: ${res.status}`);
  return res.json();
}

/**
 * Retrieve list of all deployed functions, merging any active local drafts.
 * @returns {Promise<{ functions: Array<Object>, namespace: string }>}
 */
export async function getFunctions() {
  const drafts = getLocalDrafts();

  if (USE_MOCK) {
    const store = getMockStore();
    return {
      functions: store.functions.map(f => ({
        name: f.name,
        url: f.url,
        ready: f.ready,
        deployed: f.deployed ?? f.ready,
        created_at: f.created_at,
        runtime: f.runtime,
        namespace: f.namespace
      })),
      namespace: "tenant-functions"
    };
  }

  const res = await apiFetch("/functions");
  if (!res.ok) throw new Error(`Failed to fetch functions: ${res.status}`);
  const data = await res.json();
  const liveFunctions = data.functions || [];

  // Merge un-deployed local drafts at the top
  const unDeployedDrafts = drafts.filter(d => !liveFunctions.some(lf => lf.name === d.name));

  return {
    functions: [...unDeployedDrafts, ...liveFunctions],
    namespace: data.namespace || "tenant-functions"
  };
}

/**
 * Retrieve source code for a specific function.
 * Checks local drafts first before requesting backend.
 * @param {string} name
 * @returns {Promise<{ name: string, language: string, code: string, env: Object }>}
 */
export async function getFunctionCode(name) {
  // Check local draft first
  const draft = getLocalDrafts().find(d => d.name === name);
  if (draft) {
    return {
      name,
      language: "python",
      code: draft.code || DEFAULT_TEMPLATE_CODE,
      env: draft.env || {}
    };
  }

  if (USE_MOCK) {
    const store = getMockStore();
    const fn = store.functions.find(f => f.name === name);
    return {
      name,
      language: "python",
      code: fn?.code || DEFAULT_TEMPLATE_CODE,
      env: fn?.env || {}
    };
  }

  const res = await apiFetch(`/functions/${encodeURIComponent(name)}/code`);
  if (!res.ok) throw new Error(`Failed to fetch code for ${name}: ${res.status}`);
  return res.json();
}


/**
 * Retrieve revisions list for a specific function.
 * @param {string} name
 * @returns {Promise<{ function_name: string, revisions: Array<Object> }>}
 */
export async function getFunctionRevisions(name) {
  if (USE_MOCK) {
    const store = getMockStore();
    const fn = store.functions.find(f => f.name === name);
    return {
      function_name: name,
      revisions: fn?.revisions || [
        {
          name: `${name}-00001`,
          created_at: new Date().toISOString(),
          is_active: true,
          has_code: true
        }
      ]
    };
  }

  const res = await apiFetch(`/functions/${encodeURIComponent(name)}/revisions`);
  if (!res.ok) throw new Error(`Failed to fetch revisions for ${name}: ${res.status}`);
  return res.json();
}

/**
 * Retrieve code for a specific revision of a function.
 * @param {string} name
 * @param {string} revisionName
 * @returns {Promise<{ name: string, revision_name: string, language: string, code: string }>}
 */
export async function getRevisionCode(name, revisionName) {
  if (USE_MOCK) {
    const store = getMockStore();
    const fn = store.functions.find(f => f.name === name);
    const rev = fn?.revisions?.find(r => r.name === revisionName);
    return {
      name,
      revision_name: revisionName,
      language: "python",
      code: rev?.code || `# Code snapshot for ${revisionName}\n` + DEFAULT_TEMPLATE_CODE
    };
  }

  const res = await apiFetch(`/functions/${encodeURIComponent(name)}/revision/${encodeURIComponent(revisionName)}/code`);
  if (!res.ok) throw new Error(`Failed to fetch code for revision ${revisionName}: ${res.status}`);
  return res.json();
}

/**
 * Rollback function traffic to a target revision.
 * @param {string} name
 * @param {string} revisionName
 * @returns {Promise<{ status: string, message: string }>}
 */
export async function rollbackRevision(name, revisionName) {
  if (USE_MOCK) {
    const store = getMockStore();
    const fn = store.functions.find(f => f.name === name);
    if (fn && fn.revisions) {
      fn.revisions.forEach(r => {
        r.is_active = (r.name === revisionName);
      });
      const targetRev = fn.revisions.find(r => r.name === revisionName);
      if (targetRev && targetRev.code) {
        fn.code = targetRev.code;
      }
      saveMockStore(store);
    }
    return {
      status: "ok",
      message: `Trafik '${revisionName}' sürümüne yönlendirildi.`
    };
  }

  const res = await apiFetch(`/functions/${encodeURIComponent(name)}/rollback`, {
    method: "POST",
    body: JSON.stringify({ revision_name: revisionName })
  });
  if (!res.ok) throw new Error(`Rollback failed: ${res.status}`);
  return res.json();
}

/**
 * Delete a function.
 * @param {string} name
 * @returns {Promise<{ message: string, function_name: string }>}
 */
export async function deleteFunction(name) {
  removeLocalDraft(name);

  if (USE_MOCK) {
    const store = getMockStore();
    store.functions = store.functions.filter(f => f.name !== name);
    saveMockStore(store);
    return {
      message: `'${name}' fonksiyonu silindi.`,
      function_name: name
    };
  }

  const res = await apiFetch(`/functions/${encodeURIComponent(name)}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error(`Failed to delete function ${name}: ${res.status}`);
  return res.json();
}


/**
 * Retrieve execution logs for a function.
 * @param {string} name
 * @param {number} [tail=50]
 * @returns {Promise<{ function_name: string, logs: Array<string> }>}
 */
export async function getFunctionLogs(name, tail = 50) {
  if (USE_MOCK) {
    const now = new Date().toLocaleTimeString('tr-TR');
    return {
      function_name: name,
      logs: [
        `[${now}] FaaS Runtime başlatıldı (Python 3.11)`,
        `[${now}] Handler: /var/task/handler.py`,
        `[${now}] ✅ Handler başarıyla yüklendi`,
        `[${now}] 🚀 8080 portu dinleniyor...`,
        `[${now}] [req-001] POST / → 200 OK (38.4ms)`,
        `[${now}] [req-002] POST / → 200 OK (22.1ms)`
      ]
    };
  }

  const res = await apiFetch(`/logs/${encodeURIComponent(name)}?tail=${tail}`);
  if (!res.ok) throw new Error(`Failed to fetch logs for ${name}: ${res.status}`);
  return res.json();
}

/**
 * Send proxy request to invoke function.
 * @param {Object} params
 * @param {string} params.url
 * @param {string} [params.method="POST"]
 * @param {Object} [params.headers]
 * @param {any} params.body
 * @returns {Promise<{ statusCode: number, durationMs: number, body: any }>}
 */
export async function proxyRequest({ url, method = "POST", headers = {}, body = {} }) {
  const startTime = performance.now();

  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 180 + Math.random() * 120));
    const durationMs = Math.round(performance.now() - startTime);

    let parsedBody = body;
    if (typeof body === 'string') {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = { raw: body };
      }
    }

    const nameParam = parsedBody?.name || 'Dünya';

    return {
      statusCode: 200,
      durationMs,
      body: {
        message: `Merhaba ${nameParam}!`,
        executed_at: new Date().toISOString(),
        mock: true
      }
    };
  }

  const res = await apiFetch("/proxy", {
    method: "POST",
    body: JSON.stringify({
      url,
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body
    })
  });

  const durationMs = Math.round(performance.now() - startTime);
  const data = await res.json();

  return {
    statusCode: res.status,
    durationMs,
    body: data
  };
}

/**
 * Deploy function with SSE streaming progress callbacks.
 * @param {string} name - Function name
 * @param {string} code - Python code
 * @param {boolean} [isUpdate=false] - Whether it is an update to existing function
 * @param {Object} [envVars={}] - Environment variables key-value map
 * @param {function(string, string): void} onEvent - Callback for SSE events (eventType, data)
 * @returns {Promise<{ status: string, function_name: string, url: string }>}
 */
export async function deployFunctionStream(name, code, isUpdate = false, envVars = {}, onEvent = () => {}) {
  if (USE_MOCK) {
    return new Promise((resolve) => {
      const mockEvents = [
        { type: 'step', data: '📦 Step 1/3 — Fonksiyon kodu ve ortam değişkenleri kaydediliyor...' },
        { type: 'log', data: `   → ${new Blob([code]).size} byte handler.py ConfigMap'e yazıldı` },
        { type: 'step', data: '🚀 Step 2/3 — Knative Service konfigürasyonu oluşturuluyor...' },
        { type: 'log', data: '   → Image: faas-python-runtime:3.11-slim' },
        { type: 'step', data: '⏳ Step 3/3 — Fonksiyon podları ve route başlatılıyor...' },
        { type: 'log', data: '   → Pod hazır, ingress yönlendirildi' },
        { type: 'url', data: `http://${name}.tenant-functions.svc.cluster.local` },
        {
          type: 'done',
          data: JSON.stringify({
            status: 'success',
            function_name: name,
            url: `http://${name}.tenant-functions.svc.cluster.local`
          })
        }
      ];

      let idx = 0;
      const interval = setInterval(() => {
        if (idx < mockEvents.length) {
          const ev = mockEvents[idx++];
          onEvent(ev.type, ev.data);
        } else {
          clearInterval(interval);

          // Update mock store
          const store = getMockStore();
          let existingFn = store.functions.find(f => f.name === name);
          const revId = `${name}-${String(Date.now()).slice(-5)}`;

          if (existingFn) {
            existingFn.code = code;
            existingFn.ready = true;
            existingFn.deployed = true;
            existingFn.env = { ...envVars };
            if (!existingFn.revisions) existingFn.revisions = [];
            existingFn.revisions.forEach(r => (r.is_active = false));
            existingFn.revisions.unshift({
              name: revId,
              created_at: new Date().toISOString(),
              is_active: true,
              has_code: true,
              code
            });
          } else {
            const newFn = {
              name,
              url: `http://${name}.tenant-functions.svc.cluster.local`,
              ready: true,
              deployed: true,
              created_at: new Date().toISOString(),
              runtime: "python",
              namespace: "tenant-functions",
              code,
              env: { ...envVars },
              revisions: [
                {
                  name: revId,
                  created_at: new Date().toISOString(),
                  is_active: true,
                  has_code: true,
                  code
                }
              ]
            };
            store.functions.unshift(newFn);
          }
          saveMockStore(store);


          resolve({
            status: 'success',
            function_name: name,
            url: `http://${name}.tenant-functions.svc.cluster.local`
          });
        }
      }, 450);
    });
  }

  // Live SSE reader implementation using fetch + ReadableStream
  const response = await apiFetch("/deploy", {
    method: "POST",
    body: JSON.stringify({
      name,
      language: "python",
      code,
      is_update: isUpdate,
      environment: envVars
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    onEvent('error', `Deploy failed with status ${response.status}: ${errorText}`);
    throw new Error(`Deploy request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      if (!part.trim()) continue;
      let eventType = "message";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        if (line.startsWith("data: ")) data = line.slice(6).trim();
      }
      onEvent(eventType, data);

      if (eventType === 'done') {
        try {
          finalResult = JSON.parse(data);
        } catch {
          finalResult = { status: 'done', data };
        }
        removeLocalDraft(name);
      }
    }
  }

  return finalResult || { status: 'success', function_name: name };
}

