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

const GOOGLE_SCRIPT_ID = 'google-identity-services';

const decodeJwtPayload = (token) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

function MainContent({ user, onUserChange }) {
  const [anime, setAnime] = useState([]);
  const [topAnime, setTopAnime] = useState([]);
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [hoveredAnimeId, setHoveredAnimeId] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [authError, setAuthError] = useState('');

  const favoritesStorageKey = `animeDB:favorites:${user?.email || 'guest'}`;

  useEffect(() => {
    const scriptExists = document.getElementById(GOOGLE_SCRIPT_ID);
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

    if (!clientId) {
      setAuthError('Google Sign-In is unavailable. Missing REACT_APP_GOOGLE_CLIENT_ID.');
      return;
    }

    const initializeGoogle = () => {
      if (!window.google?.accounts?.id) {
        setAuthError('Google Sign-In failed to initialize.');
        return;
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          const payload = decodeJwtPayload(response.credential);
          if (!payload) {
            setAuthError('Could not parse Google profile.');
            return;
          }
          onUserChange({
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
          });
          setAuthError('');
        },
      });

      const container = document.getElementById('google-signin-button');
      if (container) {
        container.innerHTML = '';
        window.google.accounts.id.renderButton(container, {
          theme: 'filled_blue',
          size: 'medium',
          shape: 'pill',
          text: 'signin_with',
        });
      }
    };

    if (scriptExists) {
      initializeGoogle();
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogle;
    script.onerror = () => setAuthError('Could not load Google Sign-In script.');
    document.body.appendChild(script);
  }, [onUserChange]);

  useEffect(() => {
    const saved = localStorage.getItem(favoritesStorageKey);
    setFavorites(saved ? JSON.parse(saved) : []);
  }, [favoritesStorageKey]);

  useEffect(() => {
    localStorage.setItem(favoritesStorageKey, JSON.stringify(favorites));
  }, [favorites, favoritesStorageKey]);

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

  const toggleFavorite = (animeId) => {
    setFavorites((prev) => (prev.includes(animeId) ? prev.filter((id) => id !== animeId) : [...prev, animeId]));
  };

  const displayedAnime = useMemo(
    () => (showOnlyFavorites ? anime.filter((item) => favorites.includes(item.mal_id)) : anime),
    [anime, favorites, showOnlyFavorites]
  );

  const showEmpty = useMemo(
    () => !isLoading && !error && displayedAnime.length === 0,
    [isLoading, error, displayedAnime.length]
  );

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

      <section className="auth-toolbar">
        <div id="google-signin-button" />
        {user && (
          <button className="btn-secondary" type="button" onClick={() => onUserChange(null)}>
            Sign out
          </button>
        )}
        <button className={`btn-secondary ${showOnlyFavorites ? 'active' : ''}`} type="button" onClick={() => setShowOnlyFavorites((v) => !v)}>
          {showOnlyFavorites ? 'Show all' : 'Show favorites'}
        </button>
        <span className="favorite-count">Favorites: {favorites.length}</span>
        {authError && <span className="auth-error">{authError}</span>}
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
              {displayedAnime.map(({ url, mal_id, title, images, type, synopsis, episodes, source, score, duration, trailer }) => {
                const trailerUrl = trailer?.embed_url || trailer?.url;
                const isHovered = hoveredAnimeId === mal_id;
                const isFavorite = favorites.includes(mal_id);

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

                      <button
                        type="button"
                        className={`favorite-btn ${isFavorite ? 'active' : ''}`}
                        onClick={() => toggleFavorite(mal_id)}
                        aria-label={isFavorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
                      >
                        {isFavorite ? '♥' : '♡'}
                      </button>
                    </div>
                    <div className="anime-content">
                      <h3 className="card-title">{title}</h3>
                      <div className="meta-row">
                        <span className="badge">{type || 'Unknown'}</span>
                        <span className="badge score">★ {score || 'N/A'}</span>
                      </div>
                      <p className="detail-line">
                        Source: <strong>{source || 'Unknown'}</strong>
                      </p>
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
            {pagination && !showOnlyFavorites && (
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
            {pagination && !showOnlyFavorites && <div className="status-text">Current page: {pagination.current_page}</div>}
          </div>
        </section>
      </section>
    </div>
  );
}

export default MainContent;
