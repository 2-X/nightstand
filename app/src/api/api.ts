import axios from 'axios';
import { validateResponse } from './responseValidation';

const inDev = import.meta.env.VITE_ENV === 'dev';

if (inDev && !import.meta.env.VITE_POD_IP) {
  console.warn(
    'Missing ENV variable: VITE_POD_IP! ' +
    'If you\'d like to run the vite server locally and send API requests to your pod, you can run ' +
    '\'VITE_POD_IP=<YOUR_POD_IP> npm run dev\' ' +
    'ex: \'VITE_POD_IP=<YOUR_POD_IP> npm run dev\''
  );
}
const baseURL = inDev && import.meta.env.VITE_POD_IP ? `http://${import.meta.env.VITE_POD_IP}:3000` : `${window.location.origin}`;

const axiosInstance = axios.create({
  baseURL: `${baseURL}/api/`,
  responseType: 'json',
  transitional: { silentJSONParsing: false },
});

axiosInstance.interceptors.response.use(response => {
  if (response.config.method === 'get') {
    if (response.data === '' || response.data == null) throw new Error('The server returned an empty response.');
    response.data = validateResponse(response.config.url ?? '', response.data);
  }
  return response;
});

export default axiosInstance;
export { baseURL };
