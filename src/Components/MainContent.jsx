import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import ReactPaginate from 'react-paginate';
import ReactPlayer from 'react-player/lazy';
import Sidebar from './Sidebar';
import { getTopAnime, searchAnime as searchAnimeApi } from '../api/jikan';
import '../styles.css';

function MainContent() {
  const [anime, setAnime] = useState([]);
  const [topAnime, setTopAnime] = useState([]);
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [hoveredAnimeId, setHoveredAnimeId] = useState(null);

  const runSearch = useCallback(async (page = 1) => {
    setIsLoading(true);
    setError('');

    try {
      const result = await searchAnimeApi({ query: search, page });
      setAnime(result.data);
      setPagination(result.pagination);
    } catch (err) {
      setAnime([]);
      setPagination(null);
      setError(err?.message || 'Unable to load anime right now.');
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  const loadTopAnime = useCallback(async () => {
    try {
      const result = await getTopAnime();
      setTopAnime(result);
    } catch {
      setTopAnime([]);
    }
  }, []);

  useEffect(() => {
    runSearch(1);
  }, [runSearch]);

  useEffect(() => {
    loadTopAnime();
  }, [loadTopAnime]);

  const handlePageClick = async (event) => {
    runSearch(event.selected + 1);
  };

  const showEmpty = useMemo(() => !isLoading && !error && anime.length === 0, [isLoading, error, anime.length]);

  return (
    <div className="layout-shell">
      <section className="menu">
        <div className="left-filters">
          <ul id="nav-filter">
            <li className="Small active">Anime</li>
            <li className="Small">Manga</li>
          </ul>
        </div>

        <div className="right-filters search-controls">
          <input
            className="search-input"
            type="search"
            placeholder="Search anime title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                runSearch(1);
              }
            }}
          />
          <button className="btn-primary" type="button" onClick={() => runSearch(1)}>
            Search
          </button>
        </div>

        <div className="right-filters quick-pick">
          <Stack sx={{ width: 280 }}>
            <Autocomplete
              selectOnFocus
              id="Anime"
              getOptionLabel={(item) => `${item.title}`}
              options={anime}
              isOptionEqualToValue={(option, value) => option.title === value.title}
              onChange={(_, selectedAnime) => {
                if (selectedAnime?.title) {
                  setSearch(selectedAnime.title);
                }
              }}
              renderOption={(props, item) => (
                <Box component="li" {...props} key={item.mal_id}>
                  {item.title}
                </Box>
              )}
              renderInput={(params) => <TextField {...params} label="Quick pick" size="small" />}
            />
          </Stack>
        </div>
      </section>

      <section className="content-grid">
        <aside className="Sidebar">
          <Sidebar topAnime={topAnime.slice(0, 10)} />
        </aside>

        <section className="anime-results">
          {isLoading && <p className="status-text">Loading anime...</p>}

          {error && (
            <div className="status-card error">
              <p>Failed to load anime data: {error}</p>
              <button className="btn-primary" type="button" onClick={() => runSearch(pagination?.current_page || 1)}>
                Retry
              </button>
            </div>
          )}

          {showEmpty && <p className="status-text">No results found for your search.</p>}

          {!isLoading && !error && (
            <div className="anime-grid">
              {anime.map(({ url, mal_id, title, images, type, synopsis, episodes, source, score, duration, trailer }) => {
                const trailerUrl = trailer?.embed_url || trailer?.url;
                const isHovered = hoveredAnimeId === mal_id;

                return (
                  <article className="anime-card" key={mal_id}>
                    <div
                      className="media-area"
                      onMouseEnter={() => setHoveredAnimeId(mal_id)}
                      onMouseLeave={() => setHoveredAnimeId(null)}
                    >
                      {isHovered && trailerUrl ? (
                        <div className="trailer-player">
                          <ReactPlayer
                            url={`${trailerUrl}${trailerUrl.includes('?') ? '&' : '?'}autoplay=1&mute=1&controls=0&modestbranding=1`}
                            width="100%"
                            height="100%"
                            playing
                            muted
                            controls={false}
                            playsinline
                          />
                        </div>
                      ) : (
                        <a href={url} target="_blank" rel="noreferrer noopener" className="poster-link">
                          <img className="Image-card" src={images.jpg.image_url} alt={title} />
                        </a>
                      )}

                      {trailerUrl && <span className="hover-hint">Hover to preview trailer ▶</span>}
                    </div>
                    <div className="anime-content">
                    <h3 className="card-title">{title}</h3>
                    <div className="meta-row">
                      <span className="badge">{type || 'Unknown'}</span>
                      <span className="badge score">★ {score || 'N/A'}</span>
                    </div>
                    <p className="detail-line">Source: <strong>{source || 'Unknown'}</strong></p>
                    <p className="detail-line">
                      {episodes || '?'} episodes • {duration?.replace('ep', 'episodes') || 'Duration unknown'}
                    </p>
                    <p className="synopsis">{synopsis || 'No synopsis available.'}</p>
                  </div>
                </article>
                );
              })}
            </div>
          )}

          <div className="pagination">
            {pagination && (
              <ReactPaginate
                nextLabel="→"
                previousLabel="←"
                breakLabel="..."
                pageCount={pagination.last_visible_page}
                forcePage={(pagination.current_page || 1) - 1}
                onPageChange={handlePageClick}
                marginPagesDisplayed={2}
                pageRangeDisplayed={5}
              />
            )}
            {pagination && <div className="status-text">Current page: {pagination.current_page}</div>}
          </div>
        </section>
      </section>
    </div>
  );
}

export default MainContent;
