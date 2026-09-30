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

// A request that never answers should end in an error the pages can show,
// not a spinner. Calls that legitimately wait on the Pod (privileged
// commands, on-demand sleep analysis) pass the longer one.
export const REQUEST_TIMEOUT_MS = 20_000;
export const LONG_REQUEST_TIMEOUT_MS = 60_000;
// Commands that drive the hardware can wait on the server for a 10 second
// reconnect plus 15 seconds per command, and Turn on sends two. Giving up
// sooner would show a failure for a command that is still going through.
export const HARDWARE_REQUEST_TIMEOUT_MS = 45_000;
// Stopping biometrics can take the server up to two minutes.
export const SERVICES_REQUEST_TIMEOUT_MS = 130_000;

const axiosInstance = axios.create({
  baseURL: `${baseURL}/api/`,
  timeout: REQUEST_TIMEOUT_MS,
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
