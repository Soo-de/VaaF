/**
 * API client and mock data layer for FaaS Platform.
 * All communication with the backend passes through this module.
 */

// Auto-detect local development on port 9000 -> routes to backend on port 8000
export const API_BASE = window.location.port === "9000" ? "http://localhost:8000" : "";
export const USE_MOCK = false;
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
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(d => d && typeof d.name === 'string' && d.name.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export function saveLocalDraft(draft) {
  try {
    if (!draft || !draft.name) return;
    const drafts = getLocalDrafts().filter(d => d.name !== draft.name);
    drafts.unshift(draft);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {}
}

export function removeLocalDraft(name) {
  try {
    if (!name) return;
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
        url: "http://ornek-fonksiyon.vaaf-functions.svc.cluster.local",
        ready: true,
        deployed: true,
        created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        runtime: "python",
        namespace: "vaaf-functions",
        code: `def handler(event, context):
    name = event.get('body', {}).get('name', 'Dünya')
    return {
        'statusCode': 200,
        'body': {'message': f'Merhaba {name}!'}
    }`,
        environment: {
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
        url: "http://hesaplama.vaaf-functions.svc.cluster.local",
        ready: false,
        deployed: false,
        created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
        runtime: "python",
        namespace: "vaaf-functions",
        code: `def handler(event, context):
    body = event.get('body', {})
    a = body.get('a', 0)
    b = body.get('b', 0)
    return {
        'statusCode': 200,
        'body': {'result': a + b}
    }`,
        environment: {},
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
    url: `http://${name}.vaaf-functions.svc.cluster.local`,
    ready: false,
    deployed: false,
    created_at: new Date().toISOString(),
    runtime,
    namespace: "vaaf-functions",
    code: DEFAULT_TEMPLATE_CODE,
    environment: {},
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
 * @returns {Promise<{ status: string, timestamp?: string }>}
 */
export async function getHealth() {
  if (USE_MOCK) {
    return { status: "healthy", timestamp: new Date().toISOString() };
  }
  const res = await apiFetch("/health/status");
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
    const mockFunctions = getMockStore().functions;
    const unDeployedDrafts = drafts.filter(
      d => !mockFunctions.some(mf => mf.name === d.name)
    );
    return {
      functions: [...unDeployedDrafts, ...mockFunctions],
      namespace: "vaaf-functions"
    };
  }

  try {
    const res = await apiFetch("/functions");
    if (!res.ok) {
      console.warn(`[getFunctions] Backend returned HTTP ${res.status}, displaying local drafts.`);
      return {
        functions: drafts,
        namespace: "vaaf-functions"
      };
    }

    const data = await res.json();
    const liveFunctions = data.functions || [];

    // Merge un-deployed local drafts at the top
    const unDeployedDrafts = drafts.filter(
      d => !liveFunctions.some(lf => lf.name === d.name)
    );

    return {
      functions: [...unDeployedDrafts, ...liveFunctions],
      namespace: data.namespace || "vaaf-functions"
    };
  } catch (err) {
    console.warn(`[getFunctions] Network/Cluster unavailable (${err.message}), displaying local drafts.`);
    return {
      functions: drafts,
      namespace: "vaaf-functions"
    };
  }
}

/**
 * Retrieve source code for a specific function.
 * Checks local drafts first before requesting backend.
 * @param {string} name
 * @returns {Promise<{ name: string, language: string, code: string, environment: Object }>}
 */
export async function getFunctionCode(name) {
  // Check local draft first
  const drafts = getLocalDrafts();
  const draft = drafts.find(d => d.name === name);
  if (draft && draft.code) {
    return {
      name: draft.name,
      language: draft.language || "python",
      code: draft.code,
      environment: draft.environment || {}
    };
  }

  if (USE_MOCK) {
    const fn = getMockStore().functions.find(f => f.name === name);
    return {
      name: name,
      language: fn?.runtime || "python",
      code: fn?.code || 'def handler(event, context):\n    return {"message": "Hello"}\n',
      environment: fn?.environment || {}
    };
  }

  const res = await apiFetch(`/functions/${encodeURIComponent(name)}/code`);
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.detail || `Failed to fetch code for ${name}: ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieve revision history for a function.
 * @param {string} name
 * @returns {Promise<{ revisions: Array<Object>, active_revision: string }>}
 */
export async function getFunctionRevisions(name) {
  if (USE_MOCK) {
    const fn = getMockStore().functions.find(f => f.name === name);
    return {
      revisions: fn?.revisions || [],
      active_revision: fn?.revisions?.find(r => r.is_active)?.name || ""
    };
  }

  const res = await apiFetch(`/functions/${encodeURIComponent(name)}/revisions`);
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.detail || `Failed to fetch revisions for ${name}: ${res.status}`);
  }
  return res.json();
}

/**
 * Retrieve source code for a specific historical revision.
 * @param {string} name
 * @param {string} revisionName
 * @returns {Promise<{ name: string, revision: string, code: string }>}
 */
export async function getRevisionCode(name, revisionName) {
  if (USE_MOCK) {
    const fn = getMockStore().functions.find(f => f.name === name);
    const rev = fn?.revisions?.find(r => r.name === revisionName);
    return {
      name: name,
      revision: revisionName,
      code: rev?.code || fn?.code || ""
    };
  }

  const res = await apiFetch(
    `/functions/${encodeURIComponent(name)}/revisions/${encodeURIComponent(revisionName)}/code`
  );
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.detail || `Failed to fetch code for revision ${revisionName}: ${res.status}`);
  }
  return res.json();
}

/**
 * Rollback function traffic to a specific revision.
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
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.detail || `Rollback failed: ${res.status}`);
  }
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
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.detail || `Failed to delete function ${name}: ${res.status}`);
  }
  return res.json();
}


/**
 * Fetch pod stdout/stderr logs for a function.
 * @param {string} name
 * @param {number} [tail=50]
 * @returns {Promise<{ name: string, logs: Array<string> }>}
 */
export async function getFunctionLogs(name, tail = 50) {
  if (USE_MOCK) {
    return {
      name: name,
      logs: [
        `[${new Date().toISOString()}] FaaS Python Runtime starting...`,
        `[${new Date().toISOString()}] Handler loaded successfully.`,
        `[${new Date().toISOString()}] Server listening on port 8080.`
      ]
    };
  }

  const res = await apiFetch(`/logs/${encodeURIComponent(name)}?tail=${tail}`);
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.detail || `Failed to fetch logs for ${name}: ${res.status}`);
  }
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
    statusCode: (data && data.status) ? data.status : res.status,
    durationMs: (data && data.duration_ms) ? data.duration_ms : durationMs,
    body: (data && data.body !== undefined) ? data.body : data
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
        { type: 'url', data: `http://${name}.vaaf-functions.svc.cluster.local` },
        {
          type: 'done',
          data: JSON.stringify({
            status: 'success',
            function_name: name,
            url: `http://${name}.vaaf-functions.svc.cluster.local`
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
            existingFn.environment = { ...envVars };
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
              url: `http://${name}.vaaf-functions.svc.cluster.local`,
              ready: true,
              deployed: true,
              created_at: new Date().toISOString(),
              runtime: "python",
              namespace: "vaaf-functions",
              code,
              environment: { ...envVars },
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
            url: `http://${name}.vaaf-functions.svc.cluster.local`
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

