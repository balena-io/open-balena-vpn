import { metrics } from '@balena/node-metrics-gatherer';

export const enum Metrics {
	SessionDuration = 'vpn_session_duration',
	SessionRxBitrate = 'vpn_session_avg_rx_bitrate',
	SessionTxBitrate = 'vpn_session_avg_tx_bitrate',
	RxBytes = 'vpn_rx_bytes_total',
	TxBytes = 'vpn_tx_bytes_total',
	OnlineDevices = 'vpn_online_devices',
	TotalDevices = 'vpn_devices_total',
	AuthFailures = 'vpn_auth_failures_total',
	ActiveTunnels = 'vpn_proxy_active_tunnels',
	TotalTunnels = 'vpn_proxy_total_tunnels',
	TunnelErrors = 'vpn_proxy_tunnel_errors',
}

export const describeWorkerMetrics = () => {
	metrics.describe.gauge(Metrics.OnlineDevices, 'vpn current online devices');
	metrics.gauge(Metrics.OnlineDevices, 0);
	metrics.describe.counter(
		Metrics.TotalDevices,
		'vpn total devices since restart',
	);
	metrics.counter(Metrics.TotalDevices, 0);
	metrics.describe.counter(
		Metrics.AuthFailures,
		'vpn device auth failures since restart',
	);
	metrics.counter(Metrics.AuthFailures, 0);
	metrics.describe.counter(
		Metrics.RxBytes,
		'total rx bytes across all vpn sessions',
	);
	metrics.counter(Metrics.RxBytes, 0);
	metrics.describe.counter(
		Metrics.TxBytes,
		'total tx bytes across all vpn sessions',
	);
	metrics.counter(Metrics.TxBytes, 0);
	metrics.describe.gauge(
		Metrics.ActiveTunnels,
		'current tunnels to vpn devices',
	);
	metrics.gauge(Metrics.ActiveTunnels, 0);
	metrics.describe.counter(
		Metrics.TotalTunnels,
		'running total of tunnels to vpn devices',
	);
	metrics.counter(Metrics.TotalTunnels, 0);
	metrics.describe.counter(
		Metrics.TunnelErrors,
		'number of tunnels failed due to transmission error',
	);
	metrics.counter(Metrics.TunnelErrors, 0);
};
export const describePrimaryMetrics = () => {
	const kb = 2 ** 10; // 1024
	const mb = 2 ** 10 * kb;
	const bitrateBuckets = [
		kb,
		2.5 * kb,
		5 * kb,
		7.5 * kb,
		10 * kb,
		15 * kb,
		20 * kb,
		25 * kb,
		50 * kb,
		100 * kb,
		250 * kb,
		500 * kb,
		mb,
		2 * mb,
		3 * mb,
		4 * mb,
		5 * mb,
		6 * mb,
		7 * mb,
		8 * mb,
		9 * mb,
		10 * mb,
		15 * mb,
		20 * mb,
		25 * mb,
		30 * mb,
		35 * mb,
		40 * mb,
		45 * mb,
		50 * mb,
		100 * mb,
	];
	metrics.describe.histogram(
		Metrics.SessionRxBitrate,
		'histogram of average rx rate per vpn client',
		{ buckets: bitrateBuckets },
	);
	metrics.describe.histogram(
		Metrics.SessionTxBitrate,
		'histogram of average tx rate per vpn client',
		{ buckets: bitrateBuckets },
	);
	const min = 60;
	const hour = 60 * min;
	const day = 24 * hour;
	const week = 7 * day;
	const durationBuckets = [
		1 * min,
		5 * min,
		15 * min,
		1 * hour,
		6 * hour,
		12 * hour,
		1 * day,
		1 * week, // 1w  - very stable long-running sessions, could be affected by deployment restarts, but still worth tracking
	];

	metrics.describe.histogram(
		Metrics.SessionDuration,
		'histogram showing duration of vpn sessions',
		{
			buckets: durationBuckets,
		},
	);
};
