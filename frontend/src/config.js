const LOCAL_API_URL = 'http://localhost:5000';
const RENDER_API_URL = 'https://suryasphere.onrender.com';

export const API_URL = import.meta.env.VITE_API_URL
    || (import.meta.env.DEV ? LOCAL_API_URL : RENDER_API_URL);
