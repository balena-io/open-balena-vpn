import * as rp from 'request-promise';

export const request = rp.defaults({
	resolveWithFullResponse: true,
	simple: false,
});
