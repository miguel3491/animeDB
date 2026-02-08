import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./Header";
import MainContent from "./MainContent";
import AnimeDetail from "./AnimeDetail";
import Favorites from "./Favorites";
import MangaContent from "./MangaContent";
import MangaDetail from "./MangaDetail";
import News from "./News";
import NewsDetail from "./NewsDetail";
import Discussion from "./Discussion";
import DiscussionDetail from "./DiscussionDetail";
import Profile from "./Profile";
import PublicProfile from "./PublicProfile";
import Inbox from "./Inbox";

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
                        <Route path="/seasonal/anime" element={<MainContent mode="seasonal"></MainContent>} />
                        <Route path="/anime/:id" element={<AnimeDetail></AnimeDetail>} />
                        <Route path="/manga" element={<MangaContent></MangaContent>} />
                        <Route path="/seasonal/manga" element={<MangaContent mode="seasonal"></MangaContent>} />
                        <Route path="/manga/:id" element={<MangaDetail></MangaDetail>} />
                        <Route path="/favorites" element={<Favorites></Favorites>} />
                        <Route path="/news" element={<News></News>} />
                        <Route path="/news/:id" element={<NewsDetail></NewsDetail>} />
                        <Route path="/discussion" element={<Discussion></Discussion>} />
                        <Route path="/discussion/:id" element={<DiscussionDetail></DiscussionDetail>} />
                        <Route path="/profile" element={<Profile></Profile>} />
                        <Route path="/profile/:uid" element={<PublicProfile></PublicProfile>} />
                        <Route path="/inbox" element={<Inbox></Inbox>} />
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
