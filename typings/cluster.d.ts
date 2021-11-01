declare module 'cluster' {
	// This is required to allow us to import cluster correctly since the default typings now expect use of either
	// es modules or `esModuleInterop: true`
	const cluster: Cluster;
	export = cluster;
}
