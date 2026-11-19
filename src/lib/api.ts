import type { VideoData } from './dataFile';

/**
 * Client for the optional local API server (server/). In development Vite proxies /api to it.
 * Every call has a timeout so a missing server never hangs the app; the app falls back to browser-only.
 */

export type SessionKind = 'sparring' | 'scouting';

export type Session = {
  id: number;
  name: string;
  date: string | null;
  kind: SessionKind;
  opponent: string | null;
  notes: string;
  created_at: string;
  video_count: number;
  tag_count: number;
};

export type VideoSummary = {
  id: number;
  session_id: number | null;
  file_name: string;
  size: number;
  last_modified: number;
  duration: number | null;
  tag_count: number;
  round_count: number;
};

export type SessionDetail = Session & { videos: VideoSummary[] };
export type NewSession = { name: string; date?: string | null; kind?: SessionKind; opponent?: string | null; notes?: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 4000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      } catch { /* not JSON */ }
      throw new ApiError(res.status, detail);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  } finally {
    clearTimeout(timer);
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  /** True if the server answers; never throws. */
  async available(): Promise<boolean> {
    try {
      const h = await request<{ ok: boolean }>('/health', {}, 1500);
      return h.ok === true;
    } catch {
      return false;
    }
  },
  listSessions: () => request<Session[]>('/sessions'),
  getSession: (id: number) => request<SessionDetail>(`/sessions/${id}`),
  createSession: (s: NewSession) => request<Session>('/sessions', json('POST', s)),
  updateSession: (id: number, s: Partial<NewSession>) => request<Session>(`/sessions/${id}`, json('PATCH', s)),
  deleteSession: (id: number) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  registerVideo: (v: { file_name: string; size: number; last_modified: number; duration?: number | null }) =>
    request<VideoSummary>('/videos', json('POST', v)),
  assignVideo: (videoId: number, sessionId: number | null) =>
    request<VideoSummary>(`/videos/${videoId}`, json('PATCH', sessionId === null ? { clear_session: true } : { session_id: sessionId })),
  getData: (videoId: number) => request<VideoData>(`/videos/${videoId}/data`),
  putData: (videoId: number, data: VideoData) => request<{ tags: number }>(`/videos/${videoId}/data`, json('PUT', data)),
};
