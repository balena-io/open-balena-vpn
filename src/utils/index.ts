import PineClient = require('pinejs-client');
import * as pkg from 'pjson';

export const resinApi = new PineClient(`https://${process.env.RESIN_API_HOST}/v4/`);
export const apiKey = process.env.VPN_SERVICE_API_KEY;
export const VERSION = pkg.version;

export { Netmask } from './netmask';
export { request } from './request';
