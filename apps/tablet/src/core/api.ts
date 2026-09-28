import type { Change, FetchResponse, PullResponse, PushResponse, SnapshotResponse, WritableEntity } from '@caissebox/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Credentials {
  baseUrl: string;
  deviceId: string;
  secret: string;
}

export interface DeviceSession {
  token: string;
  tenantId: string;
  establishmentId: string;
  accessState: string;
  label: string | null;
  establishmentName: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/**
 * Client HTTP de la tablette. Le jeton est renouvelé automatiquement à partir du
 * secret d'enrôlement quand il expire.
 */
export class DeviceApi {
  private session: DeviceSession | null = null;

  constructor(
    private readonly creds: Credentials,
    private readonly fetchImpl: FetchLike,
    private readonly appVersion = '0.1.0',
    private readonly timeoutMs = 15000,
  ) {}

  get current(): DeviceSession | null {
    return this.session;
  }

  private async request<T>(method: string, path: string, body?: unknown, auth = true, retry = true): Promise<T> {
    if (auth && !this.session) await this.authenticate();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    try {
      const res = await this.fetchImpl(`${this.creds.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(auth && this.session ? { Authorization: `Bearer ${this.session.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      if (res.status === 401 && auth && retry) {
        this.session = null;
        return this.request<T>(method, path, body, auth, false);
      }
      if (!res.ok) {
        let message = `Erreur ${res.status}`;
        try {
          const j = (await res.json()) as { message?: string | string[] };
          if (j.message) message = Array.isArray(j.message) ? j.message.join(', ') : j.message;
        } catch {
          // corps vide
        }
        throw new ApiError(res.status, message);
      }
      return (await res.json()) as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async authenticate(): Promise<DeviceSession> {
    this.session = await this.request<DeviceSession>(
      'POST',
      '/auth/device',
      { deviceId: this.creds.deviceId, secret: this.creds.secret, appVersion: this.appVersion },
      false,
    );
    return this.session;
  }

  push(ops: { opId: string; deviceSeq: number; entity: WritableEntity; entityId: string; kind: 'insert' | 'patch'; data: Record<string, unknown>; createdAt: string }[]) {
    return this.request<PushResponse>('POST', '/sync/push', { protocol: 1, ops });
  }

  pull(cursor: number, limit = 1000) {
    return this.request<PullResponse>('GET', `/sync/pull?cursor=${cursor}&limit=${limit}`);
  }

  snapshot() {
    return this.request<SnapshotResponse>('GET', '/sync/snapshot');
  }

  fetchRows(items: { entity: WritableEntity; id: string }[]) {
    return this.request<FetchResponse>('POST', '/sync/fetch', { items });
  }
}

export type { Change };
