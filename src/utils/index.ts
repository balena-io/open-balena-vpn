import PineClient = require('pinejs-client');


export const resinApi = new PineClient(`https://${process.env.RESIN_API_HOST}/v2/`);
export const apiKey = process.env.VPN_SERVICE_API_KEY;
