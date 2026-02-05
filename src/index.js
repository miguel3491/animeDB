import React from 'react';
import ReactDOM from 'react-dom';
import App from "./Components/App"
import { AuthProvider } from "./AuthContext";

ReactDOM.render(
  <AuthProvider>
    <App></App>
  </AuthProvider>,
  document.getElementById("root")
)
