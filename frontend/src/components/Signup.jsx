import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { API_URL } from '../config';

export default function Signup({ setUser }) {
    const [form, setForm] = useState({ username: '', password: '' });
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post(`${API_URL}/api/signup`, form);
            localStorage.setItem('token', res.data.token);
            localStorage.setItem('userId', res.data.user.id);
            localStorage.setItem('username', res.data.user.username);
            setUser({
                token: res.data.token,
                id: res.data.user.id,
                username: res.data.user.username
            });
            navigate('/');
        } catch (err) { alert("User already exists"); }
    };

    return (
        <div className="auth-box">
            <h2>Suryasphere Signup</h2>
            <form onSubmit={handleSubmit}>
                <input type="text" placeholder="Username" onChange={e => setForm({...form, username: e.target.value})} required />
                <input type="password" placeholder="Password" onChange={e => setForm({...form, password: e.target.value})} required />
                <button type="submit">Register</button>
            </form>
            <Link to="/login">Already have an account? Login</Link>
        </div>
    );
}
