import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import ReactPaginate from 'react-paginate';
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
    <div>
      <div className="menu">
        <div className="left-filters">
          <ul id="nav-filter">
            <li className="Small">Anime</li>
            <li className="Small">Manga</li>
          </ul>
        </div>

        <div className="right-filters">
          <input
            type="search"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                runSearch(1);
              }
            }}
          />
          <button type="button" onClick={() => runSearch(1)}>
            Search
          </button>
        </div>

        <div className="right-filters">
          <Stack sx={{ width: 300, margin: 'auto', backgroundColor: 'primary.dark' }}>
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
              renderInput={(params) => <TextField {...params} label="Quick pick" />}
            />
          </Stack>
        </div>
      </div>

      <div className="Sidebar">
        <Sidebar topAnime={topAnime.slice(0, 10)} />
      </div>

      {isLoading && <p style={{ color: 'white' }}>Loading anime...</p>}

      {error && (
        <div style={{ color: 'white' }}>
          <p>Failed to load anime data: {error}</p>
          <button type="button" onClick={() => runSearch(pagination?.current_page || 1)}>
            Retry
          </button>
        </div>
      )}

      {showEmpty && <p style={{ color: 'white' }}>No results found for your search.</p>}

      {!isLoading &&
        !error &&
        anime.map(({ url, mal_id, title, images, type, synopsis, episodes, source, score, duration }) => (
          <div className="Filter-AnimeCard" key={mal_id}>
            <h3 id="card-title">{title}</h3>
            <a href={url} target="_blank" rel="noreferrer noopener">
              <img className="Image-card" src={images.jpg.image_url} alt={title} />
            </a>
            <p>Source: {source}</p>
            <p>
              {episodes} Episodes, <span>{duration?.replace('ep', 'episodes')}</span>
            </p>
            <p>Score: {score}</p>
            <p id="card-genre">Type: {type}</p>
            <p id="synopsis">{synopsis}</p>
          </div>
        ))}

      <div className="pagination">
        {pagination && (
          <ReactPaginate
            nextLabel="&rarr;"
            previousLabel="&larr;"
            breakLabel="..."
            pageCount={pagination.last_visible_page}
            forcePage={(pagination.current_page || 1) - 1}
            onPageChange={handlePageClick}
            marginPagesDisplayed={2}
            pageRangeDisplayed={5}
          />
        )}
        {pagination && <div style={{ color: 'white' }}>Current page: {pagination.current_page}</div>}
      </div>
    </div>
  );
}

export default MainContent;
