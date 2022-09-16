import React from "react";
import { DataGrid } from '@mui/x-data-grid';

function allAnime({anime}){
    return(
        <div>
            {anime.map((info) =>(
                <div>
                   {/* <a href={info.url}
                //     key = {info.mal_id}
                //     target = "_blank"
                //     rel= "noopener">
                //     <img src = {info.images.jpg.image_url} alt = "Image"></img></a>
                //     <span>{info.type}</span><h3>{info.title}</h3> */}
                </div>
            ))}
        </div>
    )
}

export default allAnime;

// Important implement pagination component to see all the animes https://www.geeksforgeeks.org/how-to-use-pagination-component-in-reactjs/