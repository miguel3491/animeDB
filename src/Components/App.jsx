import React, { useState } from 'react';
import Header from './Header';
import MainContent from './MainContent';

function App() {
  const [user, setUser] = useState(null);

  return (
    <div className="app-shell">
      <header>
        <Header user={user} />
      </header>
      <main>
        <MainContent user={user} onUserChange={setUser} />
      </main>
      <footer className="footer-note">Built for anime fans • Powered by Jikan API</footer>
    </div>
  );
}

export default App;
