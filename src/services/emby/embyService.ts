import { mmkvStorage } from '../mmkvStorage';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
export const EMBY_SERVER_URL_KEY = 'emby_server_url';
export const EMBY_API_KEY_KEY = 'emby_api_key';
export const EMBY_USER_ID_KEY = 'emby_user_id';

// Client identification header sent with every Emby request
const EMBY_CLIENT_HEADER = 'NuvioMobile';
const EMBY_DEVICE_HEADER = 'NuvioMobile';
const EMBY_VERSION_HEADER = '1.0.0';

// ---------------------------------------------------------------------------
// Helper: Emby uses "Ticks" – 1 second = 10,000,000 ticks
// ---------------------------------------------------------------------------
export function secondsToTicks(seconds: number): number {
  return Math.floor(seconds * 10_000_000);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface EmbyItem {
  Id: string;
  Name: string;
  Type: string;
  RunTimeTicks?: number;
  IndexNumber?: number;       // episode number
  ParentIndexNumber?: number; // season number
  SeriesId?: string;
  ProviderIds?: Record<string, string>;
}

export interface EmbySystemInfo {
  ServerName: string;
  Version: string;
  LocalAddress?: string;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------
class EmbyService {
  private static instance: EmbyService;

  private constructor() {}

  static getInstance(): EmbyService {
    if (!EmbyService.instance) {
      EmbyService.instance = new EmbyService();
    }
    return EmbyService.instance;
  }

  // -------------------------------------------------------------------------
  // Credential helpers
  // -------------------------------------------------------------------------
  async getCredentials(): Promise<{ serverUrl: string; apiKey: string; userId: string } | null> {
    const [serverUrl, apiKey, userId] = await Promise.all([
      mmkvStorage.getItem(EMBY_SERVER_URL_KEY),
      mmkvStorage.getItem(EMBY_API_KEY_KEY),
      mmkvStorage.getItem(EMBY_USER_ID_KEY),
    ]);
    if (!serverUrl || !apiKey) return null;
    return { serverUrl: serverUrl.replace(/\/$/, ''), apiKey, userId: userId || '' };
  }

  async saveCredentials(serverUrl: string, apiKey: string, userId: string): Promise<void> {
    await Promise.all([
      mmkvStorage.setItem(EMBY_SERVER_URL_KEY, serverUrl.replace(/\/$/, '')),
      mmkvStorage.setItem(EMBY_API_KEY_KEY, apiKey),
      mmkvStorage.setItem(EMBY_USER_ID_KEY, userId),
    ]);
  }

  async clearCredentials(): Promise<void> {
    await Promise.all([
      mmkvStorage.removeItem(EMBY_SERVER_URL_KEY),
      mmkvStorage.removeItem(EMBY_API_KEY_KEY),
      mmkvStorage.removeItem(EMBY_USER_ID_KEY),
    ]);
  }

  async isConnected(): Promise<boolean> {
    const creds = await this.getCredentials();
    return !!(creds?.serverUrl && creds?.apiKey && creds?.userId);
  }

  // -------------------------------------------------------------------------
  // Base fetch helper (uses fetch API to keep the bundle lean)
  // -------------------------------------------------------------------------
  private buildAuthHeader(apiKey: string): string {
    return (
      `MediaBrowser Client="${EMBY_CLIENT_HEADER}", ` +
      `Device="${EMBY_DEVICE_HEADER}", ` +
      `DeviceId="NuvioMobileApp", ` +
      `Version="${EMBY_VERSION_HEADER}", ` +
      `Token="${apiKey}"`
    );
  }

  private async request<T>(
    serverUrl: string,
    apiKey: string,
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${serverUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Authorization': this.buildAuthHeader(apiKey),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Emby request failed: ${response.status} ${response.statusText} (${url})`);
    }
    // Some endpoints return no body (204)
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  // -------------------------------------------------------------------------
  // Test connection + resolve userId
  // -------------------------------------------------------------------------
  async testConnection(serverUrl: string, apiKey: string): Promise<{ ok: boolean; userId: string; serverName: string }> {
    const cleanUrl = serverUrl.replace(/\/$/, '');
    try {
      // 1. Ping system info (verifies the API key is valid)
      const info = await this.request<EmbySystemInfo>(cleanUrl, apiKey, '/System/Info');
      // 2. API keys are server-level and not bound to a user, so /Users/Me returns 401.
      //    Instead, list all users and pick the first administrator.
      const users = await this.request<Array<{ Id: string; Name: string; Policy?: { IsAdministrator?: boolean } }>>(cleanUrl, apiKey, '/Users');
      const adminUser = users.find(u => u.Policy?.IsAdministrator) ?? users[0];
      if (!adminUser) throw new Error('No users found on Emby server');
      return { ok: true, userId: adminUser.Id, serverName: info.ServerName };
    } catch (err) {
      logger.warn('[EmbyService] testConnection failed:', err);
      return { ok: false, userId: '', serverName: '' };
    }
  }

  // -------------------------------------------------------------------------
  // Find a media item by IMDb / TMDB ID
  // -------------------------------------------------------------------------
  async findMedia(
    imdbId: string | undefined,
    tmdbId: string | undefined,
    mediaType: 'movie' | 'series',
    season?: number,
    episode?: number
  ): Promise<EmbyItem | null> {
    const creds = await this.getCredentials();
    if (!creds || !creds.userId) return null;

    const { serverUrl, apiKey, userId } = creds;
    const embyType = mediaType === 'movie' ? 'Movie' : 'Series';

    // Build the provider ID filter
    const providerFilters: string[] = [];
    if (imdbId) providerFilters.push(`imdb.${imdbId}`);
    if (tmdbId) providerFilters.push(`tmdb.${tmdbId}`);
    if (providerFilters.length === 0) return null;

    try {
      const qs = new URLSearchParams({
        IncludeItemTypes: embyType,
        AnyProviderIdEquals: providerFilters.join(','),
        Fields: 'ProviderIds,RunTimeTicks',
        Recursive: 'true',
        Limit: '1',
      });

      const result = await this.request<{ Items: EmbyItem[]; TotalRecordCount: number }>(
        serverUrl,
        apiKey,
        `/Users/${userId}/Items?${qs.toString()}`
      );

      if (!result.Items?.length) {
        logger.log('[EmbyService] findMedia: no match found for', imdbId || tmdbId);
        return null;
      }

      const seriesItem = result.Items[0];

      // For series, resolve to the specific episode
      if (mediaType === 'series' && season !== undefined && episode !== undefined) {
        return this.findEpisode(serverUrl, apiKey, userId, seriesItem.Id, season, episode);
      }

      return seriesItem;
    } catch (err) {
      logger.warn('[EmbyService] findMedia error:', err);
      return null;
    }
  }

  private async findEpisode(
    serverUrl: string,
    apiKey: string,
    userId: string,
    seriesId: string,
    season: number,
    episode: number
  ): Promise<EmbyItem | null> {
    try {
      const qs = new URLSearchParams({
        SeasonNumber: String(season),
        EpisodeNumber: String(episode),
        Fields: 'RunTimeTicks',
        Limit: '1',
      });

      const result = await this.request<{ Items: EmbyItem[] }>(
        serverUrl,
        apiKey,
        `/Shows/${seriesId}/Episodes?${qs.toString()}`
      );

      const ep = result.Items?.find(
        (e) =>
          e.ParentIndexNumber === season &&
          e.IndexNumber === episode
      ) || result.Items?.[0] || null;

      return ep;
    } catch (err) {
      logger.warn('[EmbyService] findEpisode error:', err);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Build a direct-play URL
  // -------------------------------------------------------------------------
  async getPlaybackUrl(itemId: string): Promise<string | null> {
    const creds = await this.getCredentials();
    if (!creds) return null;
    const { serverUrl, apiKey } = creds;
    return `${serverUrl}/Videos/${itemId}/stream?api_key=${apiKey}&static=true`;
  }

  // -------------------------------------------------------------------------
  // Playback session reporting
  // -------------------------------------------------------------------------
  private currentPlaySessionId: string | null = null;

  private newPlaySessionId(): string {
    // Simple UUID v4-like generator that works without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  private buildSessionPayload(
    itemId: string,
    positionSeconds: number,
    extras: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      ItemId: itemId,
      MediaSourceId: itemId,
      PlaySessionId: this.currentPlaySessionId ?? '',
      PositionTicks: secondsToTicks(positionSeconds),
      QueueableMediaTypes: ['Video'],
      AudioStreamIndex: 1,
      SubtitleStreamIndex: -1,
      CanSeek: true,
      PlayMethod: 'DirectStream',
      ...extras,
    };
  }

  async reportPlaybackStart(itemId: string, positionSeconds: number): Promise<void> {
    this.currentPlaySessionId = this.newPlaySessionId();
    const creds = await this.getCredentials();
    if (!creds) return;
    try {
      await this.request(creds.serverUrl, creds.apiKey, '/Sessions/Playing', {
        method: 'POST',
        body: JSON.stringify(this.buildSessionPayload(itemId, positionSeconds)),
      });
      logger.log('[EmbyService] reportPlaybackStart', itemId);
    } catch (err) {
      logger.warn('[EmbyService] reportPlaybackStart error:', err);
    }
  }

  async reportPlaybackProgress(
    itemId: string,
    positionSeconds: number,
    isPaused: boolean
  ): Promise<void> {
    const creds = await this.getCredentials();
    if (!creds) return;
    try {
      await this.request(creds.serverUrl, creds.apiKey, '/Sessions/Playing/Progress', {
        method: 'POST',
        body: JSON.stringify(
          this.buildSessionPayload(itemId, positionSeconds, { IsPaused: isPaused })
        ),
      });
    } catch (err) {
      logger.warn('[EmbyService] reportPlaybackProgress error:', err);
    }
  }

  async reportPlaybackStopped(itemId: string, positionSeconds: number): Promise<void> {
    const creds = await this.getCredentials();
    if (!creds) return;
    try {
      await this.request(creds.serverUrl, creds.apiKey, '/Sessions/Playing/Stopped', {
        method: 'POST',
        body: JSON.stringify(this.buildSessionPayload(itemId, positionSeconds)),
      });
      logger.log('[EmbyService] reportPlaybackStopped', itemId);
    } catch (err) {
      logger.warn('[EmbyService] reportPlaybackStopped error:', err);
    }
  }
}

export const embyService = EmbyService.getInstance();
export default embyService;
