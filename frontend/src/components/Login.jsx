import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { API_URL } from '../config';

export default function Login({ setUser }) {
    const [form, setForm] = useState({ username: '', password: '' });
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post(`${API_URL}/api/login`, form);
            localStorage.setItem('token', res.data.token);
            localStorage.setItem('userId', res.data.user.id);
            localStorage.setItem('username', res.data.user.username);
            setUser({
                token: res.data.token,
                id: res.data.user.id,
                username: res.data.user.username
            });
            navigate('/');
        } catch (err) { alert("Invalid login"); }
    };

    return (
        <div className="auth-box">
            <h2>Suryasphere Login</h2>
            <form onSubmit={handleSubmit}>
                <input type="text" placeholder="Username" onChange={e => setForm({...form, username: e.target.value})} required />
                <input type="password" placeholder="Password" onChange={e => setForm({...form, password: e.target.value})} required />
                <button type="submit">Login</button>
            </form>
            <Link to="/signup">New? Create account</Link>
        </div>
    );
}
