/*
	Copyright (C) 2018 Balena Ltd.

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as _ from 'lodash';

import * as clients from './clients';
import { captureException } from './errors';
import { logger, request } from './utils';

const BALENA_API_HOST = process.env.BALENA_API_HOST!;

// Private endpoints should use the `fromLocalHost` middleware.
const fromLocalHost: express.RequestHandler = (req, res, next) => {
	// '::ffff:127.0.0.1' is the ipv4 mapped ipv6 address and ::1 is the ipv6 loopback
	if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.ip)) {
		return res.sendStatus(401);
	}

	next();
};

const apiFactory = () => {
	const api = express.Router();

	const exists = _.negate(_.isNil);
	const isValid = _.conforms({
		common_name: exists,
		virtual_address: exists,
		real_address: exists,
		trusted_port: exists,
	});

	api.use(bodyParser.json());

	api.post('/api/v1/clients/', fromLocalHost, (req, res) => {
		if (!isValid(req.body)) {
			return res.sendStatus(400);
		}
		clients.connected(req.body);
		res.send('OK');
	});

	api.post('/api/v1/auth/', fromLocalHost, function(req, res) {
		if (req.body.username == null) {
			logger.info('AUTH FAIL: UUID not specified.');
			return res.sendStatus(400);
		}

		if (req.body.password == null) {
			logger.info('AUTH FAIL: API Key not specified.');
			return res.sendStatus(400);
		}

		request({
			url: `https://${BALENA_API_HOST}/services/vpn/auth/${req.body.username}`,
			timeout: 30000,
			headers: { Authorization: `Bearer ${req.body.password}` },
		})
			.then(response => {
				if (response.statusCode === 200) {
					return res.send('OK');
				} else {
					logger.info(
						`AUTH FAIL: API Authentication failed for ${req.body.username}`,
					);
					return res.sendStatus(401);
				}
			})
			.catch(err => {
				captureException(err, 'Proxy Auth Error', { req });
				res.sendStatus(401);
			});
	});

	api.delete('/api/v1/clients/', fromLocalHost, (req, res) => {
		if (!isValid(req.body)) {
			return res.sendStatus(400);
		}

		clients.disconnected(req.body);
		res.send('OK');
	});

	return api;
};
export default apiFactory;
