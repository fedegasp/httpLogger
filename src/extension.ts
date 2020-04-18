// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import http = require('https');
import fs = require('fs');
import proc = require('child_process');

var server: http.Server;

let port = vscode.workspace.getConfiguration().get("http-logger.port") as number;
let address = publicAddress();
let myExtDir = vscode.extensions.getExtension("fedegasp.http-logger")?.extensionPath;

function append(text: string) {
	console.log(text.substring(0, 40));
	let editor = vscode.window.activeTextEditor;
	if (editor) {
		let pos = new vscode.Position(editor.document.lineCount, 0);
		editor.edit(edit => {
			edit.insert(pos, `${text}\n`);
		});
	}
}

function setupSSL(callback: (created: boolean) => void) {
	if (address) {
		let subj = `/C=IT/ST=Italy/L=Rome/O=Dis/CN=${address}`;
		fs.exists(`${address}.key`, exists => {
			if (exists) {
				callback(true);
			}
			else {
				let firstCommand = `openssl req -new -newkey rsa:4096 -nodes -keyout ${myExtDir}/${address}.pem -out ${myExtDir}/${address}.csr -subj "${subj}"`;
				let secondCommand = `openssl req -new -newkey rsa:4096 -days 365 -nodes -x509 -subj "${subj}" -keyout ${myExtDir}/${address}.key -out ${myExtDir}/${address}.cert`;
				proc.exec(firstCommand,
					(error: any, stdout: string, stderr: string) => {
						if (error === null) {
							console.log(stdout);
							proc.exec(secondCommand,
								(error: any, stdout: string, stderr: string) => {
									if (error === null) {
										console.log(stdout);
										callback(true);
									}
									else {
										console.log(stderr);
										callback(false);
									}
								});
						}
						else {
							console.log(stderr);
							callback(false);
						}
					});
			}
		});
	}
	else {
		console.log('no public interface');
		callback(false);
	}
}

function setupServer() {
	const options = {
		key: fs.readFileSync(`${myExtDir}/${address}.key`),
		cert: fs.readFileSync(`${myExtDir}/${address}.cert`)
	};

	server = http.createServer(options, (req, res) => {
		let body: any[] = [];
		req.on('error', (err) => {
			console.log(err);
			res.writeHead(500, { 'Content-Type': 'text/plain' });
			res.end('KO\n');
		})
			.on('data', (chunk) => {
				body.push(chunk as any[]);
			})
			.on('end', () => {
				if (req.method === 'GET') {

					fs.readFile(`${myExtDir}/${address}.cert`, (err, data) => {
						if (data !== null) {
							res.writeHead(200, { 'Content-Type': 'application/x-pem-file',
												 'Content-Disposition': 'attachment; filename="certificate.pem"' });
							res.end(data);
						}
						else {
							res.writeHead(404, "cannot find certificate");
							res.end();
						}
					});

				}
				else {
					let received = Buffer.concat(body).toString();
					append(received);
					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end('Ok\n');
				}
			});
	});

	server.listen(port, "0.0.0.0");
}

function publicAddress(): string | null {
	var os = require('os');
	var ifaces = os.networkInterfaces();
	var address: string | null = null;

	Object.keys(ifaces).forEach(function (ifname) {
		var alias = 0;

		ifaces[ifname].forEach(function (iface: { family: string; internal: boolean; address: any; }) {
			if ('IPv4' !== iface.family || iface.internal || address !== null) {
				// skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
				return;
			}
			console.log(iface.address);
			address = iface.address;
		});
	});

	return address;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('http-logger.helloWorld', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('HttpListener start');

		setupSSL(created => {
			if (created) {
				console.log('Starting server');
				setupServer();
				let address = publicAddress();
				var message = `HttpListener on https://${address}:${port}\n`;
				vscode.window.showInformationMessage(message);
			}
			else {
				vscode.window.showInformationMessage('HttpListener failed to setup SSL.');
			}
		});
	});

	context.subscriptions.push(disposable);

	let stop = vscode.commands.registerCommand('http-logger.stop', () => {
		vscode.window.showInformationMessage('HttpListener shuting down.');
		server.close(err => {
			if (err) {
				vscode.window.showInformationMessage(err.message);
			}
			else {
				vscode.window.showInformationMessage('HttpListener stopped.');
			}
		});
	});

	context.subscriptions.push(stop);
}

// this method is called when your extension is deactivated
export function deactivate() {

}
