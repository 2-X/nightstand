import axios from 'axios';

const inDev = import.meta.env.VITE_ENV === 'dev';

if (inDev && !import.meta.env.VITE_POD_IP) {
  console.warn(
    'Missing ENV variable: VITE_POD_IP! ' +
    'If you\'d like to run the vite server locally and send API requests to your pod, you can run ' +
    '\'VITE_POD_IP=<YOUR_POD_IP> npm run dev\' ' +
    'ex: \'VITE_POD_IP=<YOUR_POD_IP> npm run dev\''
  );
}
// VITE_API_BASE is baked into native (Capacitor) builds, where
// window.location.origin is capacitor://localhost and useless as an API base.
const baseURL = import.meta.env.VITE_API_BASE
  ? import.meta.env.VITE_API_BASE
  : inDev && import.meta.env.VITE_POD_IP ? `http://${import.meta.env.VITE_POD_IP}:3000` : `${window.location.origin}`;

const axiosInstance = axios.create({
  baseURL: `${baseURL}/api/`,
});

export default axiosInstance;
export { baseURL };
