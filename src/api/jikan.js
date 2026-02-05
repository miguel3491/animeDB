const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://api.jikan.moe/v4';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;

class ApiError extends Error {
  constructor(message, status, cause) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.cause = cause;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const request = async (path, params = {}) => {
  const url = new URL(`${API_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      url.searchParams.set(key, value);
    }
  });

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url.toString());

      if (!response.ok) {
        const isRetryable = response.status >= 500 || response.status === 429;
        if (isRetryable && attempt < MAX_RETRIES) {
          await wait(250 * (attempt + 1));
          continue;
        }
        throw new ApiError(`API request failed with status ${response.status}`, response.status);
      }

      const payload = await response.json();
      return payload;
    } catch (error) {
      const isAbort = error?.name === 'AbortError';
      const isNetworkError = error instanceof TypeError || isAbort;
      lastError = error;

      if (isNetworkError && attempt < MAX_RETRIES) {
        await wait(250 * (attempt + 1));
        continue;
      }

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        isAbort ? 'Request timed out. Please try again.' : 'Network error while calling anime API.',
        undefined,
        error
      );
    }
  }

  throw new ApiError('Request failed after retries.', undefined, lastError);
};

export const getTopAnime = async () => {
  const payload = await request('/top/anime');
  return payload?.data || [];
};

export const searchAnime = async ({ query, page = 1 } = {}) => {
  const payload = await request('/anime', { q: query, page });
  return {
    data: payload?.data || [],
    pagination: payload?.pagination || null,
  };
};

export { ApiError };
