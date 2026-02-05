import React from 'react';
import Header from './Header';
import MainContent from './MainContent';

function App() {
  return (
    <div className="app-shell">
      <header>
        <Header />
      </header>
      <main>
        <MainContent />
      </main>
      <footer className="footer-note">Built for anime fans • Powered by Jikan API</footer>
    </div>
  );
}

export default App;
