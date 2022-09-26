import React, { useState, useEffect } from "react";
import Sidebar from "./Sidebar";
import AnimeCard from "./AnimeCard";
import {BrowserRouter as Router, Routes, Route, Link} from "react-router-dom";
import ReactPaginate from "react-paginate";
import "../styles.css"

function MainContent() {
  const [anime, setAnime] = useState([]);
  const [topAnime, setTopAnime] = useState([]);
  const [seasonAnime, setseasonAnime] = useState([]);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState();
  // const [filterAnime, setFilter] = useState([]);

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
  //  const searchItems = (searchValue) => {
  //   setSearch(searchValue)
  //   const filterAnime = anime.filter((anime) => {
  //     return Object.values(anime).join("").toLowerCase().includes(search.toLowerCase())
  //   })
  //   setFilter(filterAnime)
  // }
 

  useEffect(() => {
    searchAnime();
  }, []);

  useEffect(() => {
    obtainTopAnime();
  }, []);

  // useEffect(() => {
  //   obtainSeasonalAnime();
  // }, []);

  return (
    <div>
    <div className="menu">
      <div className="left-filters">
          <ul id="nav-filter">
            <a>
            <li className="Small">Anime</li></a>
            <a>
            <li className="Small">Manga</li></a>
          </ul>
        </div>
      <div className="right-filters">
          {/* Just to know page changing works */}
          <input
            type="search"
            placeholder="Search"
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                searchAnime();
              }
            }}
          />
      </div>
    </div>
      <div className="Sidebar">
        <Sidebar topAnime={topAnime.slice(0, 10)}></Sidebar>
      </div>

      {/* Your code */}
      
      {/* <div>
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
      </div> */}
      {
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

<div className="pagination">
  {pageSize && (
  <ReactPaginate
  nextLabel="&rarr;"
  previousLabel="&larr;"
    breakLabel={"..."}
    pageCount={pageSize?.last_visible_page}
    onPageChange={handlePageClick}
    marginPagesDisplayed={2}
    pageRangeDisplayed={5}
   />
  )}
  {pageSize && <div style={{color: "white"}}>Current page: {pageSize?.current_page}</div>}
</div>

    {/* {!anime.lenght ?
      <AnimeCard seasonAnime={seasonAnime.slice(0, 5)}></AnimeCard> : null } */}
    </div>
  );
}

export default MainContent;

// source to make multiple fetch https://medium.com/@jdhawks/make-fetch-s-happen-5022fcc2ddae
