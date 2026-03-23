const DEPLOYED_API_URL = 'https://suryasphere-z363.vercel.app';
const LOCAL_API_URL = 'http://localhost:5000';

export const API_URL = import.meta.env.VITE_API_URL
    || (import.meta.env.DEV ? LOCAL_API_URL : DEPLOYED_API_URL);
