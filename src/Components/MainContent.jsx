import React, {useState, useEffect} from "react";
import Sidebar from "./Sidebar";
import AnimeCard from "./AnimeCard";
import "../styles.css"

function MainContent(){
    const [topAnime, setTopAnime] = useState([]);
    
    const [search, setSearch] = useState("");
    const [filterAnime, setFilter] = useState([]);

    const obtainTopAnime = async () => {
        const api = await fetch (`https://api.jikan.moe/v4/top/anime`)
        .then(res => res.json());

        setTopAnime(api.data);
    }
    
    const searchItems = (searchValue) => {
    setSearch(searchValue)
    const filterAnime = topAnime.filter((anime) => {
        return Object.values(anime).join("").toLowerCase().includes(search.toLowerCase())
    })
    setFilter(filterAnime)
}
    
    useEffect(() => {
        obtainTopAnime();
    },[])

    return(
        <div>     
            <div className="filters">
            <input type="search" placeholder="Search for an anime" onChange = {(e) => searchItems(e.target.value)}/>
            </div>

            <div className="Sidebar">
                <Sidebar topAnime = {topAnime.slice(0, 10)}></Sidebar>
            </div>

            <div>
                {search.length > 1 ? (
                    filterAnime.map(card => (
                    <div className="Filter-AnimeCard"> 
                        <h3 id="card-title">{card.title}</h3>
                        <a href={card.url}
                        key = {card.mal_id}
                        target = "_blank"
                        rel= "noopener"><img className="Image-card" src = {card.images.jpg.image_url} alt = "Image"></img></a>
                        <p>Source: {card.source}</p>
                        <p>{card.episodes} Episodes, <span>{card.duration.replace("ep", "episodes")}</span></p>
                        <p id="card-genre">Type: {card.type}</p>
                        <p id="synopsis">{card.synopsis}</p>
                    </div>
                    ))
                ):
                    <AnimeCard topAnime = {topAnime}></AnimeCard>
                }
            </div>
        </div>
    )
}

export default MainContent; 


// Remainder add a button function to display more info on the synopsis