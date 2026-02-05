import React from 'react';

function Header({ user }) {
  return (
    <nav className="nav-wrap">
      <div>
        <h1 id="Title">Anime<span>情報</span></h1>
        <p className="header-subtitle">Discover trending shows, find new favorites, and explore the anime universe.</p>
      </div>

      <div className="user-pill">
        {user ? (
          <>
            {user.picture ? <img src={user.picture} alt={user.name || user.email} className="user-avatar" /> : null}
            <span>{user.name || user.email}</span>
          </>
        ) : (
          <span>Guest mode</span>
        )}
      </div>
    </nav>
  );
}

export default Header;
