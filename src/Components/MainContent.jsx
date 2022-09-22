import React, { useState, useEffect } from "react";
import Sidebar from "./SideBar";
import AnimeCard from "./AnimeCard";
import ReactPaginate from "react-paginate";
import "../styles.css"

function MainContent() {
  const [anime, setAnime] = useState([]);
  const [topAnime, setTopAnime] = useState([]);
  const [seasonAnime, setseasonAnime] = useState([]);
  const [search, setSearch] = useState("");
  const [filterAnime, setFilter] = useState([]);
  const [pageSize, setPageSize] = useState();

  let limit = 10;

  const obtainTopAnime = async () => {
    const api = await fetch(`https://api.jikan.moe/v4/top/anime`).then((res) =>
      res.json()
    );
    setTopAnime(api.data);
  };

  const obtainSeasonalAnime = async () => {
    const apiData = await fetch(
      `https://api.jikan.moe/v4/seasons/2022/fall`
    ).then((res) => res.json());
    setseasonAnime(apiData.data);
  };

  const searchAnime = async (page) => {
    const currentPage = page ?? 1; // default page is 1
    const apiAll = await fetch(
      `https://api.jikan.moe/v4/anime?q=${search}&page=${currentPage}`
    ).then((res) => res.json());
    setAnime(apiAll.data); // set anime data
    setPageSize(apiAll.pagination); // set page informations
  };

  const handlePageClick = async (event) => {
    searchAnime(event.selected + 1); // change page
  };

  // You don't need this
  /* const searchItems = (searchValue) => {
    setSearch(searchValue)
    const filterAnime = anime.filter((anime) => {
      return Object.values(anime).join("").toLowerCase().includes(search.toLowerCase())
    })
    setFilter(filterAnime)
  }
 */
  useEffect(() => {
    obtainTopAnime();
  }, []);

  useEffect(() => {
    obtainSeasonalAnime();
  }, []);

  return (
    <div>
      <div className="filters">
        <div className="Subname">
          {/* Just to know page changing works */}
          {pageSize && <div style={{color: "white"}}>Current page: {pageSize?.current_page}</div>}
          <p>Search</p>
          <input
            type="search"
            placeholder=""
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                searchAnime();
              }
            }}
          />
          <p>Season</p>
          <input type="search" placeholder="Any"></input>
        </div>
      </div>

      <div className="Sidebar">
        <Sidebar topAnime={topAnime.slice(0, 10)}></Sidebar>
      </div>

      {/* Your code */}
      {/*
      <div>
        {search.length >= 1 ? (
          filterAnime.map((card, i) => (
            <div className="Filter-AnimeCard">
              <h3 id="card-title">{card.title}</h3>
              <a href={card.url}
                key={card.mal_id}
                target="_blank"
                rel="noopener"><img className="Image-card" src={card.images.jpg.image_url} alt="Image"></img></a>
              <p>Source: {card.source}</p>
              <p>{card.episodes} Episodes, <span>{card.duration.replace("ep", "episodes")}</span></p>
              <p>Score: {card.score}</p>
              <p id="card-genre">Type: {card.type}</p>
              <p id="synopsis">{card.synopsis}</p>
            </div>
          ))
        ) :

          <div>
<AnimeCard seasonAnime={seasonAnime.slice(0, 20)}></AnimeCard>
          </div>
        }
      </div>
      */}
      {anime &&
        anime.map(
          ({
            url,
            mal_id,
            title,
            images,
            type,
            synopsis,
            episodes,
            source,
            score,
            duration
          }) => (
            <div className="Filter-AnimeCard">
              <h3 id="card-title">{title}</h3>
              <a href={url} key={mal_id} target="_blank" rel="noreferrer">
                <img
                  className="Image-card"
                  src={images.jpg.image_url}
                  alt={title}
                ></img>
              </a>
              <p>Source: {source}</p>
              <p>
                {episodes} Episodes,{" "}
                <span>{duration.replace("ep", "episodes")}</span>
              </p>
              <p>Score: {score}</p>
              <p id="card-genre">Type: {type}</p>
              <p id="synopsis">{synopsis}</p>
            </div>
          )
        )}
      {!anime.length ?
        <AnimeCard seasonAnime={seasonAnime.slice(0, 20)}></AnimeCard> : null}
      {pageSize && (
        <ReactPaginate
          previousLabel={"previous"}
          nextLabel={"next"}
          breakLabel={"..."}
          pageCount={pageSize?.last_visible_page}
          onPageChange={handlePageClick}
          marginPagesDisplayed={2}
          pageRangeDisplayed={3}
          pageClassName={"page-item"}
          pageLinkClassName={"page-link"}
          previousClassName={"page-item"}
          previousLinkClassName={"page-link"}
          nextClassName={"page-item"}
          nextLinkClassName={"page-link"}
          breakClassName={"page-item"}
          breakLinkClassName={"page-link"}
          activeClassName={"active"}
        />
      )}
    </div>
  );
}

export default MainContent;

// Remainder add a button function to display more info on the synopsis

// source to make multiple fetch https://medium.com/@jdhawks/make-fetch-s-happen-5022fcc2ddae
