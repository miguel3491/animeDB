import React, {useState, useEffect} from "react";
import Sidebar from "./Sidebar";
import AnimeCard from "./AnimeCard";
import AnimeAll from "./AnimeAll";
import "../styles.css"

function MainContent(){
    const [animeList, setanimeList] = useState([])
    const [topAnime, setTopAnime] = useState([])
    
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState([])

    const obtainTopAnime = async () => {
        const api = await fetch (`https://api.jikan.moe/v4/top/anime`)
        .then(res => res.json());

        setTopAnime(api.data.slice(0, 10));
    }

    const fetchAnime = async () => {
        const api = await fetch (`https://api.jikan.moe/v4/anime`)
        .then(res => res.json());

        setanimeList(api.data);
    }

    const searchitems = (searchValue) => {
        setSearch(searchValue)
        const filterAnime = animeList.filter((anime) => {
            return Object.values(anime).join("").toLowerCase().includes(search.toLowerCase())
        })
        setFilter(filterAnime)
    }

    useEffect(() => {
        obtainTopAnime();
        fetchAnime();
    },[])

    return(
        <div>
            <div>
                <input type="search" onChange={(e) => searchitems(e.target.value)} placeholder = "Search for an anime..." />
            </div>            
            <div className="Sidebar">
                <Sidebar topAnime = {topAnime}></Sidebar>
            </div>
            <div>
                {search.length > 0 ? (
                  filter.map((item, i) => (
                      <AnimeAll animeList={animeList} key = {i}></AnimeAll>
                  ))
                ):
                <AnimeCard topAnime = {topAnime}></AnimeCard>
                  }
            </div>
        </div>
    )
}

export default MainContent; 
