import React, {useState, useEffect} from "react";
import Sidebar from "./Sidebar";
import AnimeCard from "./AnimeCard";
import "../styles.css"

function MainContent(){
    const [topAnime, setTopAnime] = useState([]);
    
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState([]);

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
            <div>
            <input type="search" placeholder="Search for an anime" onChange = {(e) => searchItems(e.target.value)} />
            </div>      
            <div className="Sidebar">
                <Sidebar topAnime = {topAnime.slice(0, 10)}></Sidebar>
            </div>

            <div>
                {search.length > 1 ? (
                    filter.map(card => (
                    <div className="AnimeCard Filter-AnimeCard"> 
                        <a href={card.url}
                        key = {card.mal_id}
                        target = "_blank"
                        rel= "noopener"><img className="Image-card" src = {card.images.jpg.image_url} alt = "Image"></img></a>
                        <span>{card.type}</span><h3>{card.title}</h3>
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


