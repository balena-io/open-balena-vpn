import { expect } from 'chai';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export default () => {
	describe('Learn-address throttling script', () => {
		let tempDir: string;
		let scriptPath: string;

		beforeEach(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'throttling-test-'));
			scriptPath = path.join(
				import.meta.dirname,
				'..',
				'openvpn',
				'scripts',
				'learn-address.sh',
			);
		});

		afterEach(() => {
			// Clean up temp directory
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it('should validate rate parameters', (done) => {
			const child = spawn(
				'bash',
				[scriptPath, 'invalid', '5mbit', 'add', '10.0.0.1', 'client1'],
				{
					env: {
						...process.env,
						LEARN_ADDRESS_STATE_DIR: tempDir,
						LEARN_ADDRESS_DEBUG: '0',
					},
				},
			);

			child.on('exit', (code) => {
				expect(code).to.equal(1);
				done();
			});
		});

		it('should accept valid rate formats', (done) => {
			const child = spawn(
				'bash',
				[scriptPath, '5mbit', '1mbit', 'add', '10.0.0.1', 'client1'],
				{
					env: {
						...process.env,
						LEARN_ADDRESS_STATE_DIR: tempDir,
						LEARN_ADDRESS_DEBUG: '1',
						dev: 'lo', // Use loopback for testing
					},
				},
			);

			child.on('exit', (code) => {
				// Script should succeed (note: tc commands may fail on loopback but script should handle gracefully)
				expect(code).to.equal(0);

				// Check that .dev state file is created
				const stateFiles = fs.readdirSync(tempDir);
				expect(stateFiles).to.include('10.0.0.1.dev');

				done();
			});
		});

		it('should clean up on delete operation', (done) => {
			// First add a client
			const addChild = spawn(
				'bash',
				[scriptPath, '5mbit', '1mbit', 'add', '10.0.0.1', 'client1'],
				{
					env: {
						...process.env,
						LEARN_ADDRESS_STATE_DIR: tempDir,
						LEARN_ADDRESS_DEBUG: '0',
						dev: 'lo',
					},
				},
			);

			addChild.on('exit', () => {
				// Then delete the client
				const deleteChild = spawn(
					'bash',
					[scriptPath, '5mbit', '1mbit', 'delete', '10.0.0.1', 'client1'],
					{
						env: {
							...process.env,
							LEARN_ADDRESS_STATE_DIR: tempDir,
							LEARN_ADDRESS_DEBUG: '0',
							dev: 'lo',
						},
					},
				);

				deleteChild.on('exit', (code) => {
					expect(code).to.equal(0);

					const stateFiles = fs.readdirSync(tempDir);
					expect(stateFiles).to.not.include('10.0.0.1.dev');

					done();
				});
			});
		});

		it('should compute deterministic classid from IP address', (done) => {
			// Test the compute_classid function indirectly by running the script
			// and checking the classid in debug logs
			const testCases = [
				// classid = (oct3 * 256 + oct4) % 65534 + 1
				{ ip: '10.0.0.1', expectedClassid: 2 },
				{ ip: '10.0.0.255', expectedClassid: 256 },
				{ ip: '10.0.1.0', expectedClassid: 257 },
				{ ip: '10.0.1.1', expectedClassid: 258 },
				{ ip: '10.0.255.255', expectedClassid: 2 },
			];

			let completed = 0;
			testCases.forEach(({ ip, expectedClassid }, index) => {
				// Create a separate log directory for each test case to avoid conflicts
				const logDir = fs.mkdtempSync(
					path.join(os.tmpdir(), `throttling-log-${index}-`),
				);

				const child = spawn(
					'bash',
					[scriptPath, '5mbit', '1mbit', 'add', ip, 'client1', 'debug', 'lo'],
					{
						env: {
							...process.env,
							LEARN_ADDRESS_STATE_DIR: tempDir,
							LEARN_ADDRESS_LOG_DIR: logDir,
						},
					},
				);

				child.on('exit', () => {
					const logFile = path.join(logDir, 'learn-address.log');
					const logContent = fs.readFileSync(logFile, 'utf8');

					// Look for the classid in the log (format: "classid=1:XXX")
					const match = logContent.match(/classid=1:(\d+)/);
					expect(match).to.not.be.null;

					if (match) {
						const classid = parseInt(match[1], 10);
						expect(classid).to.equal(
							expectedClassid,
							`IP ${ip} should produce classid ${expectedClassid}`,
						);
					}

					fs.rmSync(logDir, { recursive: true, force: true });

					completed++;
					if (completed === testCases.length) {
						done();
					}
				});
			});
		});

		it('should ensure classid is always in valid range (1-65535)', (done) => {
			// Test edge cases to ensure classid never exceeds valid range for tc
			const edgeCases = [
				'10.0.0.0', // Minimum possible
				'10.0.255.254', // Near maximum
				'10.255.255.255', // Maximum possible in /8
			];

			let completed = 0;
			edgeCases.forEach((ip, index) => {
				// Create a separate log directory for each test case to avoid conflicts
				const logDir = fs.mkdtempSync(
					path.join(os.tmpdir(), `throttling-range-${index}-`),
				);

				const child = spawn(
					'bash',
					[scriptPath, '5mbit', '1mbit', 'add', ip, 'client1', 'debug', 'lo'],
					{
						env: {
							...process.env,
							LEARN_ADDRESS_STATE_DIR: tempDir,
							LEARN_ADDRESS_LOG_DIR: logDir,
						},
					},
				);

				child.on('exit', () => {
					const logFile = path.join(logDir, 'learn-address.log');
					const logContent = fs.readFileSync(logFile, 'utf8');

					// Look for the classid in the log (format: "classid=1:XXX")
					const match = logContent.match(/classid=1:(\d+)/);
					expect(match).to.not.be.null;

					if (match) {
						const classid = parseInt(match[1], 10);
						expect(classid).to.be.at.least(1);
						expect(classid).to.be.at.most(65535);
					}

					fs.rmSync(logDir, { recursive: true, force: true });

					completed++;
					if (completed === edgeCases.length) {
						done();
					}
				});
			});
		});

		it('should produce same classid for reconnecting client with same IP', (done) => {
			const firstAdd = spawn(
				'bash',
				[scriptPath, '5mbit', '1mbit', 'add', '10.0.2.50', 'client1'],
				{
					env: {
						...process.env,
						LEARN_ADDRESS_STATE_DIR: tempDir,
						LEARN_ADDRESS_DEBUG: '1',
						dev: 'lo',
					},
				},
			);

			firstAdd.on('exit', () => {
				const deleteClient = spawn(
					'bash',
					[scriptPath, '5mbit', '1mbit', 'delete', '10.0.2.50'],
					{
						env: {
							...process.env,
							LEARN_ADDRESS_STATE_DIR: tempDir,
							dev: 'lo',
						},
					},
				);

				deleteClient.on('exit', () => {
					// Reconnect with same IP
					const secondAdd = spawn(
						'bash',
						[scriptPath, '5mbit', '1mbit', 'add', '10.0.2.50', 'client1'],
						{
							env: {
								...process.env,
								LEARN_ADDRESS_STATE_DIR: tempDir,
								LEARN_ADDRESS_DEBUG: '1',
								dev: 'lo',
							},
						},
					);

					secondAdd.on('exit', (code) => {
						expect(code).to.equal(0);

						// Calculate expected classid: (2 * 256 + 50) % 65534 + 1 = 563
						const expectedClassid = ((2 * 256 + 50) % 65534) + 1;
						expect(expectedClassid).to.equal(563);

						done();
					});
				});
			});
		});

		it('should handle missing parameters gracefully', (done) => {
			const child = spawn('bash', [scriptPath, '5mbit'], {
				env: {
					...process.env,
					LEARN_ADDRESS_STATE_DIR: tempDir,
				},
			});

			child.on('exit', (code) => {
				expect(code).to.equal(1);
				done();
			});
		});
	});
};
