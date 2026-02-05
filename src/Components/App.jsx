import React from "react";
import Header from "./Header";
import MainContent from "./MainContent";

function App(){
    return(
        <div className="app">
            <header>
            <Header></Header>
            </header>
            <main>
            <MainContent></MainContent>
            </main>
            <footer>
                
            </footer>
        </div>
    )
}

export default App;

// https://docs.api.jikan.moe/#operation/getAnimeSearch // API
// https://github.com/TylerPottsDev/react-anime-db/tree/main/src // Inspiration
// https://github.com/coderspirit-git/React-js-Pagination/blob/main/src/App.js //pagination inspiration
