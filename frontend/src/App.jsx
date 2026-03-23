import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Signup from './components/Signup';
import Chat from './components/Chat';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem('token');
    const id = localStorage.getItem('userId');
    const username = localStorage.getItem('username');

    return token && id && username ? { token, id, username } : null;
  });

  return (
    <Router>
      <Routes>
        <Route path="/login" element={!user ? <Login setUser={setUser} /> : <Navigate to="/" />} />
        <Route path="/signup" element={!user ? <Signup setUser={setUser} /> : <Navigate to="/" />} />
        <Route path="/" element={user ? <Chat user={user} setUser={setUser} /> : <Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}
export default App;
