/**
 * Talks to the Home Assistant the repository's docker-compose provides.
 *
 * The suite reuses that instance instead of booting one of its own. On a clean
 * checkout (no `config/` yet, as in CI) it seeds the minimal configuration and
 * onboards the instance through the API; an instance that is already onboarded
 * (the manual playground) is left alone. Everything the suite writes goes into
 * a dashboard of its own.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const E2E_DIR = resolve(here, '..');
const REPO_ROOT = resolve(E2E_DIR, '../..');
const TOKEN_FILE = resolve(E2E_DIR, '.auth.json');

/** Read from the compose file so the suite cannot drift from the environment. */
function portFromCompose(): string {
  const compose = readFileSync(resolve(REPO_ROOT, 'docker-compose.yml'), 'utf8');
  const match = compose.match(/'(\d+):8123'/) ?? compose.match(/"(\d+):8123"/);
  if (!match) throw new Error('No published Home Assistant port found in docker-compose.yml');
  return match[1];
}

export const PORT = process.env.HA_E2E_PORT ?? portFromCompose();
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const USERNAME = process.env.HA_E2E_USER ?? 'admin';
export const PASSWORD = process.env.HA_E2E_PASSWORD ?? 'password';

/** Brings the repository's own compose environment up if it is not running. */
export function ensureRunning(): void {
  // A clean checkout has no config/ - seed the minimal configuration so the
  // integration's async_setup runs (it registers the card resource).
  const configuration = resolve(REPO_ROOT, 'config/configuration.yaml');
  if (!existsSync(configuration)) {
    mkdirSync(dirname(configuration), { recursive: true });
    copyFileSync(resolve(E2E_DIR, 'fixtures/configuration.yaml'), configuration);
  }
  execFileSync('docker', ['compose', 'up', '-d'], { cwd: REPO_ROOT, stdio: 'inherit' });
}

export async function waitForFrontend(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Not /api/onboarding: that endpoint is gone once onboarding is done.
      const res = await fetch(`${BASE_URL}/manifest.json`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Home Assistant did not answer at ${BASE_URL} within ${timeoutMs}ms`);
}

/**
 * Onboards a freshly created instance through the same API the onboarding
 * wizard uses: creates the admin user, then completes the remaining steps so
 * the frontend no longer redirects to /onboarding.html. No-op once onboarded.
 */
export async function ensureOnboarded(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/onboarding`);
  // The endpoint is gone (404) once onboarding is finished.
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`onboarding status failed: ${res.status}`);
  const steps = (await res.json()) as { step: string; done: boolean }[];
  if (steps.every((step) => step.done)) return;

  const clientId = `${BASE_URL}/`;
  const post = async (path: string, body: unknown, token?: string) => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`POST ${path} failed: ${response.status} ${await response.text()}`);
    return (await response.json().catch(() => ({}))) as Record<string, string>;
  };

  if (!steps.find((step) => step.step === 'user')?.done) {
    const { auth_code } = await post('/api/onboarding/users', {
      client_id: clientId,
      name: 'Admin',
      username: USERNAME,
      password: PASSWORD,
      language: 'en',
    });
    const tokenResponse = await fetch(`${BASE_URL}/auth/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: auth_code,
        client_id: clientId,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`token exchange failed: ${tokenResponse.status}`);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };
    for (const step of ['core_config', 'analytics']) {
      await post(`/api/onboarding/${step}`, {}, access_token);
    }
    await post(
      '/api/onboarding/integration',
      { client_id: clientId, redirect_uri: `${clientId}?auth_callback=1` },
      access_token,
    );
  }
}

/**
 * Waits until the core is actually running, not merely answering HTTP.
 *
 * The card resource is registered on EVENT_HOMEASSISTANT_STARTED, which lands
 * well after the HTTP server starts serving. A check that stops at the frontend
 * can therefore read the previous run's resource store and pass against code
 * that is genuinely broken.
 */
export async function waitForCoreRunning(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'unknown';
  while (Date.now() < deadline) {
    try {
      const config = await callWebsocket<{ state: string }>({ type: 'get_config' });
      lastState = config.state;
      if (config.state === 'RUNNING') return;
    } catch {
      // websocket not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Home Assistant never reached RUNNING (last saw ${lastState})`);
}

export interface Tokens {
  access_token: string;
}

export function saveTokens(tokens: Tokens): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function readTokens(): Tokens {
  if (!existsSync(TOKEN_FILE)) throw new Error('No token file - did global setup run?');
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as Tokens;
}

/**
 * Sends one command over the websocket API and returns its result. Node ships a
 * WebSocket client, so this needs no dependency, and it is the same API the
 * frontend itself speaks.
 */
export async function callWebsocket<T = unknown>(message: Record<string, unknown>): Promise<T> {
  const token = readTokens().access_token;
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/api/websocket`);

  return new Promise<T>((resolve_, reject) => {
    const fail = (reason: string) => {
      socket.close();
      reject(new Error(reason));
    };
    const timer = setTimeout(() => fail('websocket timed out'), 30_000);

    socket.addEventListener('error', () => fail('websocket error'));
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      switch (payload.type) {
        case 'auth_required':
          socket.send(JSON.stringify({ type: 'auth', access_token: token }));
          return;
        case 'auth_invalid':
          clearTimeout(timer);
          fail('websocket authentication was refused');
          return;
        case 'auth_ok':
          socket.send(JSON.stringify({ id: 1, ...message }));
          return;
        case 'result': {
          clearTimeout(timer);
          socket.close();
          if (payload.success) resolve_(payload.result as T);
          else reject(new Error(`websocket command failed: ${JSON.stringify(payload.error)}`));
        }
      }
    });
  });
}

/** Puts a state on the bus, the way any client would. */
export async function setState(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/states/${entityId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readTokens().access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state, attributes }),
  });
  if (!res.ok) throw new Error(`setting ${entityId} failed: ${res.status} ${await res.text()}`);
}

export async function removeState(entityId: string): Promise<void> {
  await fetch(`${BASE_URL}/api/states/${entityId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${readTokens().access_token}` },
  });
}

/**
 * Gives the caller its own dashboard.
 *
 * Every spec file asks for a different name, so specs can run in parallel
 * without fighting over one dashboard - and none of them touches whatever the
 * manual test instance has on its own dashboards.
 */
export async function useDashboard(name: string, config: Record<string, unknown>): Promise<string> {
  const urlPath = `e2e-${name}`;
  const dashboards = await callWebsocket<{ url_path: string }[]>({
    type: 'lovelace/dashboards/list',
  });
  if (!dashboards.some((dashboard) => dashboard.url_path === urlPath)) {
    await callWebsocket({
      type: 'lovelace/dashboards/create',
      url_path: urlPath,
      title: `E2E ${name}`,
      mode: 'storage',
      show_in_sidebar: false,
    });
  }
  await callWebsocket({ type: 'lovelace/config/save', url_path: urlPath, config });
  return urlPath;
}

/** The Lovelace resources Home Assistant has persisted. */
export async function resources(): Promise<{ id: string; url: string }[]> {
  return callWebsocket({ type: 'lovelace/resources' });
}
