PineClient = require('pinejs-client')

exports.resinApi = new PineClient("https://#{process.env.RESIN_API_HOST}/v2/")

exports.apiKey = process.env.VPN_SERVICE_API_KEY
