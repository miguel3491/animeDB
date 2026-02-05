import React from 'react';
import Header from './Header';
import MainContent from './MainContent';

function App() {
  return (
    <div>
      <header>
        <Header />
      </header>
      <main>
        <MainContent />
      </main>
      <footer />
    </div>
  );
}

export default App;
