import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./Header";
import MainContent from "./MainContent";
import AnimeDetail from "./AnimeDetail";
import Favorites from "./Favorites";

function App(){
    return(
        <BrowserRouter>
            <div className="app">
                <header>
                <Header></Header>
                </header>
                <main>
                    <Routes>
                        <Route path="/" element={<MainContent></MainContent>} />
                        <Route path="/anime/:id" element={<AnimeDetail></AnimeDetail>} />
                        <Route path="/favorites" element={<Favorites></Favorites>} />
                    </Routes>
                </main>
                <footer>
                    
                </footer>
            </div>
        </BrowserRouter>
    )
}

export default App;

// https://docs.api.jikan.moe/#operation/getAnimeSearch // API
// https://github.com/TylerPottsDev/react-anime-db/tree/main/src // Inspiration
// https://github.com/coderspirit-git/React-js-Pagination/blob/main/src/App.js //pagination inspiration
