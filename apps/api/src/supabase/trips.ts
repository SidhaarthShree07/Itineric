import {
  tripPlanModelSchema,
  tripRecordSchema,
  type TripPlan,
  type TripPlanningInput,
  type TripRecord,
} from '@atlas/contracts';
import type { Env } from '../env';

type Workspace = { id: string; token?: string };

type DbTrip = {
  id: string;
  destination: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  days: number;
  currency: string;
  total_budget: number | string;
  latest_version: number;
  created_at: string;
  updated_at: string;
  travel_input: TripPlanningInput;
};

type DbVersion = { plan: TripPlan; version: number };

export class TripRepository {
  constructor(private readonly env: Env) {}

  async workspace(token?: string): Promise<Workspace> {
    if (!token) return this.createWorkspace();
    const tokenHash = await sha256(token);
    const rows = await this.request<Array<{ id: string }>>('planner_workspaces', {
      query: { select: 'id', token_hash: `eq.${tokenHash}`, expires_at: `gt.${new Date().toISOString()}`, limit: '1' },
    });
    const workspace = rows[0];
    if (!workspace) throw new WorkspaceAccessError();
    void this.request('planner_workspaces', {
      method: 'PATCH',
      query: { id: `eq.${workspace.id}` },
      body: { last_seen_at: new Date().toISOString() },
    }).catch(() => undefined);
    return { id: workspace.id };
  }

  async createTrip(input: {
    workspaceId: string;
    request: TripPlanningInput;
    plan: TripPlan;
    reason: 'initial' | 'replan' | 'chat_replan';
    changeSummary?: string;
  }): Promise<TripRecord> {
    const trip = await this.insertOne<DbTrip>('trips', {
      workspace_id: input.workspaceId,
      destination: input.request.destination,
      title: input.plan.title,
      start_date: input.request.startDate ?? null,
      end_date: input.request.endDate ?? null,
      days: tripDays(input.request),
      currency: input.request.currency,
      total_budget: input.request.totalBudget,
      travel_input: input.request,
      latest_version: 1,
    });
    try {
      await this.insertOne<DbVersion>('trip_versions', {
        trip_id: trip.id,
        version: 1,
        generation_reason: input.reason,
        change_summary: input.changeSummary ?? null,
        plan: input.plan,
      });
      return this.toRecord(trip, input.plan);
    } catch (error) {
      await this.request('trips', { method: 'DELETE', query: { id: `eq.${trip.id}` } }).catch(() => undefined);
      throw error;
    }
  }

  async listTrips(workspaceId: string): Promise<Array<Omit<TripRecord, 'plan'>>> {
    const rows = await this.request<DbTrip[]>('trips', {
      query: { workspace_id: `eq.${workspaceId}`, order: 'updated_at.desc', select: tripColumns() },
    });
    return rows.map((row) => ({
      id: row.id,
      destination: row.destination,
      title: row.title,
      startDate: row.start_date,
      endDate: row.end_date,
      days: row.days,
      currency: row.currency,
      totalBudget: Number(row.total_budget),
      latestVersion: row.latest_version,
      createdAt: normaliseTimestamp(row.created_at),
      updatedAt: normaliseTimestamp(row.updated_at),
    }));
  }

  async getTrip(workspaceId: string, tripId: string): Promise<{ trip: TripRecord; request: TripPlanningInput }> {
    const trip = await this.findTrip(workspaceId, tripId);
    const version = await this.currentVersion(trip);
    return { trip: this.toRecord(trip, version.plan), request: trip.travel_input };
  }

  async appendPlanVersion(input: {
    workspaceId: string;
    tripId: string;
    request: TripPlanningInput;
    plan: TripPlan;
    reason: 'replan' | 'chat_replan';
    changeSummary: string;
  }): Promise<TripRecord> {
    const trip = await this.findTrip(input.workspaceId, input.tripId);
    const version = trip.latest_version + 1;
    await this.insertOne<DbVersion>('trip_versions', {
      trip_id: trip.id,
      version,
      generation_reason: input.reason,
      change_summary: input.changeSummary,
      plan: input.plan,
    });
    const updated = await this.updateOne<DbTrip>('trips', { id: `eq.${trip.id}`, latest_version: `eq.${trip.latest_version}` }, {
      title: input.plan.title,
      start_date: input.request.startDate ?? null,
      end_date: input.request.endDate ?? null,
      days: tripDays(input.request),
      currency: input.request.currency,
      total_budget: input.request.totalBudget,
      travel_input: input.request,
      latest_version: version,
    });
    if (!updated) {
      // A concurrent replan won. Keep the immutable version history and ask the caller to retry.
      throw new TripConflictError();
    }
    return this.toRecord(updated, input.plan);
  }

  async addMessage(workspaceId: string, tripId: string, role: 'user' | 'assistant', message: string): Promise<void> {
    await this.findTrip(workspaceId, tripId);
    await this.insertOne('trip_chat_messages', { trip_id: tripId, role, message });
  }

  private async createWorkspace(): Promise<Workspace> {
    const token = createWorkspaceToken();
    const tokenHash = await sha256(token);
    const record = await this.insertOne<{ id: string }>('planner_workspaces', { token_hash: tokenHash });
    return { id: record.id, token };
  }

  private async findTrip(workspaceId: string, tripId: string): Promise<DbTrip> {
    const rows = await this.request<DbTrip[]>('trips', {
      query: { id: `eq.${tripId}`, workspace_id: `eq.${workspaceId}`, select: tripColumns(), limit: '1' },
    });
    if (!rows[0]) throw new TripNotFoundError();
    return rows[0];
  }

  private async currentVersion(trip: DbTrip): Promise<DbVersion> {
    const rows = await this.request<DbVersion[]>('trip_versions', {
      query: { trip_id: `eq.${trip.id}`, version: `eq.${trip.latest_version}`, select: 'version,plan', limit: '1' },
    });
    if (!rows[0]) throw new Error('Trip is missing its current plan version.');
    return { ...rows[0], plan: tripPlanModelSchema.parse(rows[0].plan) };
  }

  private toRecord(trip: DbTrip, plan: TripPlan): TripRecord {
    return tripRecordSchema.parse({
      id: trip.id,
      destination: trip.destination,
      title: trip.title,
      startDate: trip.start_date,
      endDate: trip.end_date,
      days: trip.days,
      currency: trip.currency,
      totalBudget: Number(trip.total_budget),
      latestVersion: trip.latest_version,
      createdAt: normaliseTimestamp(trip.created_at),
      updatedAt: normaliseTimestamp(trip.updated_at),
      plan,
    });
  }

  private async insertOne<T>(table: string, body: unknown): Promise<T> {
    const rows = await this.request<T[]>(table, { method: 'POST', body, prefer: 'return=representation' });
    if (!rows[0]) throw new Error(`Supabase did not return the inserted ${table} record.`);
    return rows[0];
  }

  private async updateOne<T>(table: string, query: Record<string, string>, body: unknown): Promise<T | undefined> {
    const rows = await this.request<T[]>(table, { method: 'PATCH', query, body, prefer: 'return=representation' });
    return rows[0];
  }

  private async request<T = unknown>(
    table: string,
    options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; query?: Record<string, string>; body?: unknown; prefer?: string } = {},
  ): Promise<T> {
    if (!this.env.SUPABASE_URL || !this.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }
    const endpoint = new URL(`/rest/v1/${encodeURIComponent(table)}`, this.env.SUPABASE_URL);
    for (const [key, value] of Object.entries(options.query ?? {})) endpoint.searchParams.set(key, value);
    const response = await fetch(endpoint, {
      method: options.method ?? 'GET',
      headers: {
        apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        ...(options.prefer ? { prefer: options.prefer } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Supabase ${table} request failed (${response.status}): ${detail}`);
    }
    if (options.method === 'DELETE') return undefined as T;
    return (await response.json()) as T;
  }
}

export class WorkspaceAccessError extends Error {
  constructor() {
    super('This planning workspace is missing, expired, or not authorized.');
  }
}

export class TripNotFoundError extends Error {
  constructor() {
    super('Trip not found in this planning workspace.');
  }
}

export class TripConflictError extends Error {
  constructor() {
    super('This trip changed in another request. Please retry the replan.');
  }
}

function tripColumns(): string {
  return 'id,destination,title,start_date,end_date,days,currency,total_budget,latest_version,created_at,updated_at,travel_input';
}

function tripDays(input: TripPlanningInput): number {
  if (input.days) return input.days;
  if (!input.startDate || !input.endDate) throw new Error('Trip dates or days are required.');
  return Math.max(1, Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000));
}

function createWorkspaceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normaliseTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Supabase returned an invalid timestamp.');
  return timestamp.toISOString();
}
