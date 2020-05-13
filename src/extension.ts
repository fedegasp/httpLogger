// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import websocket = require('websocket');
import http = require('http');
import fs = require('fs');
import proc = require('child_process');
import tqueue = require('typescript-task-queue');
import {Mutex} from 'await-semaphore';

var wsServer: websocket.server;

var server: http.Server;

var logEditor: vscode.TextEditor;

let welcomeMessage = "";
let port = vscode.workspace.getConfiguration().get("http-logger.port") as number;
let address = publicAddress();
let myExtDir = vscode.extensions.getExtension("fedegasp.http-logger")?.extensionPath;

let editorAppendQueue = new tqueue.TaskQueue({ autorun:true });
let editorMutex = new Mutex();

function append(text: string) {
	console.log(text);
	if (logEditor) {
		editorAppendQueue.enqueue(async () => {
			var release = await editorMutex.acquire();
			var block = async () => {
				let pos = new vscode.Position(logEditor.selection.active.line, logEditor.selection.active.character);
				logEditor.edit(edit => {
					edit.insert(pos, `${text}`);
				}).then( (ff) => {
					release();
				});	
			};
			await block();
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
				// this is not working on iPhone simulator. A CA should be created and a signed cert released.
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

	server = http.createServer(/*options,*/ (req, res) => {
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

	wsServer = new websocket.server({ httpServer: server });
	wsServer.on('request', (request: websocket.request) => {
		var connection = request.accept(undefined, request.origin);
		connection.on('message', (data: websocket.IMessage) => {
			if (data.type === 'utf8') {
				append("" + data.utf8Data);
			}
		});
	});
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

		vscode.workspace.openTextDocument({content: welcomeMessage}).then( (doc) => {
			vscode.window.showTextDocument(doc).then ( (editor) => {
				logEditor = editor;
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
