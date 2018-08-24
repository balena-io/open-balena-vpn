import { PinejsClientCoreFactory, PinejsClientRequest } from 'pinejs-client-request';
export { PinejsClientCoreFactory } from 'pinejs-client-request';
import * as pkg from 'pjson';

export type AnyObject = PinejsClientCoreFactory.AnyObject;

export const resinApi = new PinejsClientRequest(`https://${process.env.RESIN_API_HOST}/v4/`);
export const apiKey = process.env.VPN_SERVICE_API_KEY;
export const VERSION = pkg.version;

export { Netmask } from './netmask';
export { request } from './request';
