import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext";

function Header(){    
    const { user, loading, signIn, signOutUser } = useAuth();

    return(
        <nav className="nav-wrap">
            <Link className="title-link" to="/">
                <h1 id = "Title">Anime<span>情報</span></h1>
            </Link>
            <div className="header-actions">
                <span className="header-tagline">Curate your next obsession</span>
                <Link className="nav-link" to="/favorites">Favorites</Link>
                {!loading && (
                    user ? (
                        <button className="auth-button" type="button" onClick={signOutUser}>
                            Sign out
                        </button>
                    ) : (
                        <button className="auth-button" type="button" onClick={signIn}>
                            Sign in with Google
                        </button>
                    )
                )}
            </div>
        </nav>
    )
}
export default Header;
