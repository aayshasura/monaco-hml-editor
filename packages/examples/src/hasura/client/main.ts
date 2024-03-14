/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox GmbH (http://www.typefox.io). All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as monaco from 'monaco-editor';
import * as vscode from 'vscode';
import { whenReady } from '@codingame/monaco-vscode-theme-defaults-default-extension';
import '@codingame/monaco-vscode-python-default-extension';
import { LogLevel } from 'vscode/services';
import { createConfiguredEditor, createModelReference } from 'vscode/monaco';
import { ExtensionHostKind, registerExtension } from 'vscode/extensions';
import getConfigurationServiceOverride, { updateUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import { initServices, MonacoLanguageClient } from 'monaco-languageclient';
import { CloseAction, ErrorAction, MessageTransports } from 'vscode-languageclient';
import { RegisteredFileSystemProvider, registerFileSystemOverlay, RegisteredMemoryFile } from '@codingame/monaco-vscode-files-service-override';
import { Uri } from 'vscode';
import { BrowserMessageReader, BrowserMessageWriter } from 'vscode-languageserver-protocol/browser.js';

const languageId = 'hml';
let languageClient: MonacoLanguageClient;

const  createConnection = (worker: Worker): Worker => {
    const reader = new BrowserMessageReader(worker);
    const writer = new BrowserMessageWriter(worker);
    languageClient = createLanguageClient({
        reader,
        writer
    });
    languageClient.start();
    reader.onClose(() => languageClient.stop());

    return worker;
};

const createLanguageClient = (transports: MessageTransports): MonacoLanguageClient => {
    return new MonacoLanguageClient({
        name: 'HML Language Client',
        clientOptions: {
            // use a language id as a document selector
            documentSelector: [languageId],
            // disable the default error handler
            errorHandler: {
                error: () => ({ action: ErrorAction.Continue }),
                closed: () => ({ action: CloseAction.DoNotRestart })
            },
            // pyright requires a workspace folder to be present, otherwise it will not work
            workspaceFolder: {
                index: 0,
                name: 'workspace',
                uri: monaco.Uri.parse('/workspace')
            },
            synchronize: {
                fileEvents: [vscode.workspace.createFileSystemWatcher('**')]
            }
        },
        // create a language client connection from the JSON RPC connection on demand
        connectionProvider: {
            get: () => {
                return Promise.resolve(transports);
            }
        }
    });
};

export const startHMLClient = async (worker: Worker) => {
    // init vscode-api
    await initServices({
        userServices: {
            ...getThemeServiceOverride(),
            ...getTextmateServiceOverride(),
            ...getConfigurationServiceOverride(),
            ...getKeybindingsServiceOverride()
        },
        debugLogging: true,
        workspaceConfig: {
            workspaceProvider: {
                trusted: true,
                workspace: {
                    workspaceUri: Uri.file('/workspace')
                },
                async open() {
                    return false;
                }
            },
            developmentOptions: {
                logLevel: LogLevel.Debug
            }
        }
    });

    console.log('Before ready themes');
    await whenReady();
    console.log('After ready themes');

    // extension configuration derived from:
    // https://github.com/microsoft/pyright/blob/main/packages/vscode-pyright/package.json
    // only a minimum is required to get pyright working
    const extension = {
        name: 'hml-client',
        publisher: 'monaco-languageclient-project',
        version: '1.0.0',
        engines: {
            vscode: '^1.78.0'
        },
        contributes: {
            languages: [{
                id: languageId,
                aliases: [
                    'HML','hml'
                ],
                extensions: [
                    '.hml',
                ],
                mimetypes: ['application/hml']
            }],
            commands: [{
                command: 'hasura.trackAll',
                title: 'Hasura : Track all collections / functions / procedures / foreign keys from data connector',
                category: 'Pyright'
            }],
            keybindings: [{
                key: 'ctrl+k',
                command: 'hasura.trackAll',
                when: 'editorTextFocus'
            }]
        }
    };
    registerExtension(extension, ExtensionHostKind.LocalProcess);

    updateUserConfiguration(`{
        "editor.fontSize": 14,
        "workbench.colorTheme": "Default Dark Modern"
    }`);

    const fileSystemProvider = new RegisteredFileSystemProvider(false);
    const defaultText = `kind: AuthConfig
    version: v1
    definition:
      allowRoleEmulationBy: admin
      mode:
        webhook:
          method: Post
          url: http://auth-hook.default:8080/webhook/ddn?role=admin`;
    fileSystemProvider.registerFile(new RegisteredMemoryFile(vscode.Uri.file('/workspace/hello.hml'), defaultText));
    registerFileSystemOverlay(1, fileSystemProvider);

    const registerCommand = async (cmdName: string, handler: (...args: unknown[]) => void) => {
        // commands sould not be there, but it demonstrates how to retrieve list of all external commands
        const commands = await vscode.commands.getCommands(true);
        if (!commands.includes(cmdName)) {
            vscode.commands.registerCommand(cmdName, handler);
        }
    };
    // always exectute the command with current language client
    await registerCommand('hasura.trackAll', (...args: unknown[]) => {
        languageClient.sendRequest('workspace/executeCommand', { command: 'hasura.trackAll', arguments: args });
    });

    // use the file create before
    const modelRef = await createModelReference(monaco.Uri.file('/workspace/hello.hml'));
    modelRef.object.setLanguageId(languageId);

    // create monaco editor
    createConfiguredEditor(document.getElementById('container')!, {
        model: modelRef.object.textEditorModel,
        automaticLayout: true
    });

    // create the web socket and configure to start the language client on open, can add extra parameters to the url if needed.
    createConnection(worker);
};
