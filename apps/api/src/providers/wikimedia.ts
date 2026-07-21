import type { Evidence } from '@atlas/contracts';
import type { Env } from '../env';
import type { GeoCoordinates } from './geoapify';

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 8_000;
const THUMBNAIL_WIDTH = 960;

export type WikimediaMedia = {
  title: string;
  imageUrl: string;
  alt: string;
  evidence: Evidence;
};

type PageImage = {
  title: string;
  pageImage?: string;
  thumbnailUrl?: string;
};

/**
 * Reads free imagery from Wikipedia and Wikimedia Commons. We deliberately
 * resolve Commons imageinfo after PageImages, so every returned image carries
 * a licence and creator/credit attribution rather than treating a thumbnail as
 * automatically reusable.
 */
export class WikimediaMediaProvider {
  constructor(private readonly env: Env) {}

  async cityMedia(destination: string, coordinates: GeoCoordinates | undefined): Promise<WikimediaMedia | undefined> {
    const cityTitle = destination.split(',')[0]?.trim() || destination;
    const directPromise = this.mediaForTitles([cityTitle]);
    const nearbyPromise = coordinates ? this.nearbyPageImages(coordinates) : Promise.resolve([]);
    const [direct, nearby] = await Promise.all([directPromise, nearbyPromise]);
    if (direct[0]) return direct[0];
    if (!nearby.length) return undefined;
    return (await this.resolvePageImages(nearby.slice(0, 3)))[0];
  }

  async attractionMedia(titles: string[]): Promise<WikimediaMedia[]> {
    const uniqueTitles = [...new Set(titles.map((title) => title.trim()).filter(Boolean))].slice(0, 12);
    return this.mediaForTitles(uniqueTitles);
  }

  /**
   * A no-key recovery source when every planning model is unavailable. The
   * titles come from Wikipedia's geographic index, then Geoapify turns them
   * into the coordinates that drive the itinerary and map.
   */
  async nearbyAttractionTitles(coordinates: GeoCoordinates, limit = 12): Promise<string[]> {
    const pages = await this.nearbyPageImages(coordinates);
    return [...new Set(pages.map((page) => page.title.trim()).filter(Boolean))].slice(0, limit);
  }

  private async mediaForTitles(titles: string[]): Promise<WikimediaMedia[]> {
    if (!titles.length) return [];
    const cacheKey = `wikimedia:pageimages:v1:${await hash(titles.map(normalise).sort().join('|'))}`;
    const cached = await this.readCache<WikimediaMedia[]>(cacheKey);
    if (cached) return cached;
    const pageImages = await this.pageImages(titles);
    const media = await this.resolvePageImages(pageImages);
    if (media.length) await this.writeCache(cacheKey, media);
    return media;
  }

  private async nearbyPageImages(coordinates: GeoCoordinates): Promise<PageImage[]> {
    const cacheKey = `wikimedia:geosearch:v1:${roundedCoordinateKey(coordinates)}`;
    const cached = await this.readCache<PageImage[]>(cacheKey);
    if (cached) return cached;
    const url = wikipediaUrl({
      action: 'query', format: 'json', generator: 'geosearch',
      ggscoord: `${coordinates.latitude}|${coordinates.longitude}`,
      ggsradius: '10000', ggslimit: '12', ggsnamespace: '0',
      prop: 'coordinates|pageimages', piprop: 'thumbnail|name',
      pithumbsize: String(THUMBNAIL_WIDTH), pilicense: 'free',
    });
    const payload = await this.requestJson<WikipediaQueryResponse>(url);
    const pages = Object.values(payload?.query?.pages ?? {})
      .map((page) => pageImageFromPage(page))
      .filter((page): page is PageImage => Boolean(page));
    if (pages.length) await this.writeCache(cacheKey, pages);
    return pages;
  }

  private async pageImages(titles: string[]): Promise<PageImage[]> {
    const url = wikipediaUrl({
      action: 'query', format: 'json', redirects: '1', titles: titles.join('|'),
      prop: 'pageimages', piprop: 'thumbnail|name',
      pithumbsize: String(THUMBNAIL_WIDTH), pilicense: 'free',
    });
    const payload = await this.requestJson<WikipediaQueryResponse>(url);
    const requestedTitleByResolvedTitle = new Map(
      (payload?.query?.redirects ?? [])
        .filter((redirect): redirect is { from: string; to: string } => Boolean(redirect.from && redirect.to))
        .map((redirect) => [redirect.to, redirect.from]),
    );
    return Object.values(payload?.query?.pages ?? {})
      .map((page) => pageImageFromPage(page, requestedTitleByResolvedTitle.get(page.title ?? '') ?? page.title))
      .filter((page): page is PageImage => Boolean(page));
  }

  private async resolvePageImages(pageImages: PageImage[]): Promise<WikimediaMedia[]> {
    const files = pageImages.filter((page) => page.pageImage);
    if (!files.length) return [];
    const titles = files.map((page) => `File:${page.pageImage!}`);
    const url = commonsUrl({
      action: 'query', format: 'json', titles: titles.join('|'), prop: 'imageinfo',
      iiprop: 'url|extmetadata', iiurlwidth: String(THUMBNAIL_WIDTH),
      iiextmetadatalanguage: 'en',
      iiextmetadatafilter: 'LicenseShortName|UsageTerms|Artist|Credit|AttributionRequired',
    });
    const payload = await this.requestJson<CommonsQueryResponse>(url);
    const imageInfoByFilename = new Map(
      Object.values(payload?.query?.pages ?? {}).flatMap((page) => {
        const info = page.imageinfo?.[0];
        return page.title && info ? [[normaliseFilename(page.title), info] as const] : [];
      }),
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_SECONDS * 1_000).toISOString();
    return files.flatMap((page) => {
      const info = imageInfoByFilename.get(normaliseFilename(page.pageImage!));
      const licence = plainText(info?.extmetadata?.LicenseShortName?.value) || plainText(info?.extmetadata?.UsageTerms?.value);
      const artist = plainText(info?.extmetadata?.Artist?.value);
      const credit = plainText(info?.extmetadata?.Credit?.value);
      const imageUrl = safeHttpsUrl(info?.thumburl) ?? safeHttpsUrl(page.thumbnailUrl);
      if (!licence || !imageUrl || (!artist && !credit)) return [];
      const attribution = [artist, credit, 'via Wikimedia Commons'].filter(Boolean).join(' · ');
      const fileTitle = `File:${page.pageImage}`;
      return [{
        title: page.title,
        imageUrl,
        alt: `Photo of ${page.title}`,
        evidence: {
          source: 'wikimedia' as const,
          referenceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replace(/ /g, '_'))}`,
          sourceRecordId: page.pageImage!,
          fetchedAt: now.toISOString(),
          expiresAt,
          licence,
          attribution,
          freshness: 'static' as const,
        },
      }];
    });
  }

  private async requestJson<T>(url: URL): Promise<T | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Project Atlas/1.0 (travel planning media attribution)' },
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      return await response.json() as T;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readCache<T>(key: string): Promise<T | undefined> {
    const raw = await this.env.HOTEL_COMPARISON_CACHE?.get(key);
    if (!raw) return undefined;
    try { return JSON.parse(raw) as T; } catch { return undefined; }
  }

  private async writeCache(key: string, value: unknown): Promise<void> {
    await this.env.HOTEL_COMPARISON_CACHE?.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL_SECONDS });
  }
}

interface WikipediaQueryResponse {
  query?: {
    pages?: Record<string, WikipediaPage>;
    redirects?: Array<{ from?: string; to?: string }>;
  };
}

interface WikipediaPage {
  title?: string;
  pageimage?: string;
  thumbnail?: { source?: string };
}

interface CommonsQueryResponse {
  query?: { pages?: Record<string, CommonsPage> };
}

interface CommonsPage {
  title?: string;
  imageinfo?: Array<{
    thumburl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

function pageImageFromPage(page: WikipediaPage, displayTitle = page.title): PageImage | undefined {
  if (!page.title || !displayTitle) return undefined;
  return { title: displayTitle, pageImage: page.pageimage, thumbnailUrl: safeHttpsUrl(page.thumbnail?.source) };
}

function wikipediaUrl(parameters: Record<string, string>): URL {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams(parameters).toString();
  return url;
}

function commonsUrl(parameters: Record<string, string>): URL {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams(parameters).toString();
  return url;
}

function safeHttpsUrl(value: unknown): string | undefined {
  try { return typeof value === 'string' && new URL(value).protocol === 'https:' ? value : undefined; } catch { return undefined; }
}

function normaliseFilename(value: string): string {
  return value.replace(/^File:/i, '').replaceAll('_', ' ').trim().toLocaleLowerCase();
}
function normalise(value: string): string { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function roundedCoordinateKey(value: GeoCoordinates): string { return `${value.longitude.toFixed(4)},${value.latitude.toFixed(4)}`; }

function plainText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  return text || undefined;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
