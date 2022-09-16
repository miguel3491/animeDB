import React, {useState, useEffect} from "react";
import Sidebar from "./Sidebar";
import AnimeCard from "./AnimeCard";
import ReactPaginate from "react-paginate";
import "../styles.css"

function MainContent(){
    const [anime, setAnime] = useState([]);
    const [topAnime, setTopAnime] = useState([]);
    const [seasonAnime, setseasonAnime] = useState([]);
    
    const [search, setSearch] = useState("");
    const [filterAnime, setFilter] = useState([]);
    const [pageSize, setPageSize] = useState(0);

    let limit = 10;

    const obtainTopAnime = async () => {
        const api = await fetch (`https://api.jikan.moe/v4/top/anime`)
        .then(res => res.json())   
        setTopAnime(api.data);
    }
    
    const obtainSeasonalAnime = async () => {
        const apiData = await fetch (`https://api.jikan.moe/v4/seasons/2022/fall`)
        .then(res => res.json())
        setseasonAnime(apiData.data)
    }

    // const searchAnime = async () => {
    //     const apiAll = await fetch (`https://api.jikan.moe/v4/anime?page=1&order_by=title&sort=asc&limit=${limit}`)
    //     .then(res => res.json())
    //     setAnime(apiAll.data)
    // }

    const searchAnime = async () => {
        const apiAll = await fetch (`https://api.jikan.moe/v4/anime`)
        .then(res => res.json())
        const total = apiAll.headers.get("total")
        setPageSize(Math.cell(total / limit))
        setAnime(apiAll.data)
    };

    const searchItems = (searchValue) => {
    setSearch(searchValue)
    const filterAnime = anime.filter((anime) => {
        return Object.values(anime).join("").toLowerCase().includes(search.toLowerCase())
    })
    setFilter(filterAnime)
}
    useEffect(() => {       
        searchAnime();
    }, [])

    const fetchPage = async (currentPage) =>{
        const apiAll = await fetch (`https://api.jikan.moe/v4/anime?page=${currentPage}&limit=${limit}`)
        .then(res => res.json())

        return apiAll.data;
    }

    const handlePageClick = async (apiAll) =>{
        
        console.log(apiAll.selected)

        let currentPage = apiAll.selected + 1

        const Formclick = await fetchPage(currentPage);

        setAnime(Formclick)
    }

    useEffect(() => {
        obtainTopAnime();
    },[])

    useEffect(() => {
        obtainSeasonalAnime();
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
                {search.length >= 1 ? (
                    filterAnime.map((card, i) => (
                    <div className="Filter-AnimeCard"> 
                        <h3 id="card-title">{card.title}</h3>
                        <a href={card.url}
                        key = {card.mal_id}
                        target = "_blank"
                        rel= "noopener"><img className="Image-card" src = {card.images.jpg.image_url} alt = "Image"></img></a>
                        <p>Source: {card.source}</p>
                        <p>{card.episodes} Episodes, <span>{card.duration.replace("ep", "episodes")}</span></p>
                        <p>Score: {card.score}</p>
                        <p id="card-genre">Type: {card.type}</p>
                    <p id="synopsis">{card.synopsis}</p> 
                    </div>
                    ))
                ):
                
                <div>
                    <AnimeCard seasonAnime = {seasonAnime}></AnimeCard>
                </div>
                }
                <ReactPaginate
        previousLabel={"previous"}
        nextLabel={"next"}
        breakLabel={"..."}
        pageSize={pageSize}
        marginPagesDisplayed={2}
        pageRangeDisplayed={3}
        onPageChange={handlePageClick}
        containerClassName={"pagination justify-content-center"}
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
            </div>
        </div>
    )
}

export default MainContent; 


// Remainder add a button function to display more info on the synopsis

// source to make multiple fetch https://medium.com/@jdhawks/make-fetch-s-happen-5022fcc2ddae