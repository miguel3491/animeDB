import { getTopAnime, searchAnime } from './jikan';

describe('jikan api client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns top anime data', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ mal_id: 1, title: 'Naruto' }] }),
    });

    const data = await getTopAnime();

    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Naruto');
  });

  it('normalizes search response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ mal_id: 20, title: 'Bleach' }],
        pagination: { current_page: 1, last_visible_page: 2 },
      }),
    });

    const result = await searchAnime({ query: 'bleach', page: 1 });

    expect(result.data[0].title).toBe('Bleach');
    expect(result.pagination.last_visible_page).toBe(2);
  });

  it('throws on non-OK response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    await expect(searchAnime({ query: 'x', page: 1 })).rejects.toThrow('API request failed with status 403');
  });
});
