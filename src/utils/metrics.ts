import { metrics } from '@balena/node-metrics-gatherer';
import * as cluster from 'cluster';

export const enum Metrics {
	SessionDuration = 'vpn_session_duration',
	SessionRxBitrate = 'vpn_session_avg_rx_bitrate',
	SessionTxBitrate = 'vpn_session_avg_tx_bitrate',
	RxBytes = 'vpn_rx_bytes_total',
	RxBytesByUuid = 'vpn_rx_bytes_by_uuid_total',
	TxBytes = 'vpn_tx_bytes_total',
	TxBytesByUuid = 'vpn_tx_bytes_by_uuid_total',
	OnlineDevices = 'vpn_online_devices',
	TotalDevices = 'vpn_devices_total',
	AuthFailures = 'vpn_auth_failures_total',
	AuthFailuresByUuid = 'vpn_auth_failures_by_uuid_total',
	ActiveTunnels = 'vpn_proxy_active_tunnels',
	TotalTunnels = 'vpn_proxy_total_tunnels',
}

export const describeMetrics = () => {
	if (cluster.isWorker) {
		metrics.describe(Metrics.OnlineDevices, 'vpn current online devices');
		metrics.gauge(Metrics.OnlineDevices, 0);
		metrics.describe(Metrics.TotalDevices, 'vpn total devices since restart');
		metrics.counter(Metrics.TotalDevices, 0);
		metrics.describe(
			Metrics.AuthFailures,
			'vpn device auth failures since restart',
		);
		metrics.counter(Metrics.AuthFailures, 0);
		metrics.describe(
			Metrics.AuthFailuresByUuid,
			'vpn device auth failures since restart',
			{
				labelNames: ['device_uuid'],
			},
		);
		metrics.counter(Metrics.AuthFailuresByUuid, 0);
		metrics.describe(Metrics.RxBytes, 'total rx bytes across all vpn sessions');
		metrics.counter(Metrics.RxBytes, 0);
		metrics.describe(
			Metrics.RxBytesByUuid,
			'total rx bytes across all vpn sessions',
			{
				labelNames: ['device_uuid'],
			},
		);
		metrics.counter(Metrics.RxBytesByUuid, 0);
		metrics.describe(Metrics.TxBytes, 'total tx bytes across all vpn sessions');
		metrics.counter(Metrics.TxBytes, 0);
		metrics.describe(
			Metrics.TxBytesByUuid,
			'total tx bytes across all vpn sessions',
			{
				labelNames: ['device_uuid'],
			},
		);
		metrics.counter(Metrics.TxBytesByUuid, 0);
		const min = 60;
		const hour = 60 * min;
		const day = 24 * hour;
		const week = 7 * day;
		const month = 4 * week;
		const durationBuckets = [1, 10, min, hour, day, week, month];
		metrics.describe(
			Metrics.SessionDuration,
			'histogram showing duration of vpn sessions',
			{
				buckets: durationBuckets,
			},
		);
		metrics.describe(Metrics.ActiveTunnels, 'current tunnels to vpn devices');
		metrics.gauge(Metrics.ActiveTunnels, 0);
		metrics.describe(
			Metrics.TotalTunnels,
			'running total of tunnels to vpn devices',
		);
		metrics.counter(Metrics.TotalTunnels, 0);
	} else {
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
		metrics.describe(
			Metrics.SessionRxBitrate,
			'histogram of average rx rate per vpn client',
			{ buckets: bitrateBuckets },
		);
		metrics.describe(
			Metrics.SessionTxBitrate,
			'histogram of average tx rate per vpn client',
			{ buckets: bitrateBuckets },
		);
	}
};
