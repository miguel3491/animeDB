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
    };
    
    const obtainSeasonalAnime = async () => {
        const apiData = await fetch (`https://api.jikan.moe/v4/seasons/2022/fall`)
        .then(res => res.json())
        setseasonAnime(apiData.data)
    };

    const searchAnime = async () =>{
        const apiAll = await fetch(`https://api.jikan.moe/v4/anime`)
        .then((res) => res.json())

        setAnime(apiAll.data)
    };

    const handlePageClick = async (event) => {
        await fetch (`https://api.jikan.moe/v4/anime?page=${event.selected + 1}`)
        .then((res) => res.json())
        .then((res) => {
            setAnime(res)    
        })
        .catch((error) => console.error(error))
    };

    const searchItems = (searchValue) => {
    setSearch(searchValue)
    const filterAnime = anime.filter((anime) => {
        return Object.values(anime).join("").toLowerCase().includes(search.toLowerCase())
    })
    setFilter(filterAnime)
}
// const searchAnime = async () => {
//     const apiAll = await fetch (`https://api.jikan.moe/v4/anime?page=1&limit=${limit}`)
//     const data = await apiAll.json()
//     const total = apiAll.headers.get("x-total-count");
//     setPageSize(Math.ceil(total / limit))
//     setAnime(data.data)

// };

// const fetchPage = async (currentPage) =>{
//     const apiAll = await fetch (`https://api.jikan.moe/v4/anime?_page=${currentPage}&limit=${limit}`)
//     .then(res => res.json())
    
//     const data = await apiAll.json();
//     return data.data;
// }

// const handlePageClick = async (data) =>{
            
//     console.log(data.selected)
    
//     let currentPage = data.selected + 1
    
//     const Formclick = await fetchPage(currentPage);
    
//     setAnime(Formclick)
// }

    useEffect(() => {       
        searchAnime();
        handlePageClick();
    }, [])
    
    useEffect(() => {
        obtainTopAnime();
    },[])

    useEffect(() => {
        obtainSeasonalAnime();
    },[])

    return(
        <div>     
            <div className="filters">
                <div className="Subname">
            <p>Search</p>
            <input type="search" placeholder="" onChange = {(e) => searchItems(e.target.value)}/>
            <p>Season</p>
            <input type="search" placeholder="Any"></input>
                </div>
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
                    <AnimeCard seasonAnime = {seasonAnime.slice(0,20)}></AnimeCard>
                </div>
                }
            </div>
            <button onClick={handlePageClick}></button>
            <ReactPaginate
            previousLabel={"previous"}
            nextLabel={"next"}
            breakLabel={"..."}
            // pageCount={}
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
            
        </div>
    )
}

export default MainContent; 


// Remainder add a button function to display more info on the synopsis

// source to make multiple fetch https://medium.com/@jdhawks/make-fetch-s-happen-5022fcc2ddae