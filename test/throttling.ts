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

				// Check that state files are created
				const stateFiles = fs.readdirSync(tempDir);
				expect(stateFiles).to.include('10.0.0.1.classid');
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

					// Check that .dev file is removed but .classid remains for reuse
					const stateFiles = fs.readdirSync(tempDir);
					expect(stateFiles).to.include('10.0.0.1.classid');
					expect(stateFiles).to.not.include('10.0.0.1.dev');

					done();
				});
			});
		});

		it('should reuse classids for reconnecting clients', (done) => {
			// Add client
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
				const classid1 = fs
					.readFileSync(path.join(tempDir, '10.0.0.1.classid'), 'utf8')
					.trim();

				// Delete client
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

				deleteChild.on('exit', () => {
					// Add client again
					const addAgainChild = spawn(
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

					addAgainChild.on('exit', (code) => {
						expect(code).to.equal(0);

						const classid2 = fs
							.readFileSync(path.join(tempDir, '10.0.0.1.classid'), 'utf8')
							.trim();
						expect(classid1).to.equal(classid2);

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
