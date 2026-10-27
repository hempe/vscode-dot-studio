const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { ThirdPartyNoticesPlugin } = require('./scripts/thirdPartyNotices');

const CODICONS = 'Codicons (the icon font in webview/codicons, also used for the built-in icons of the Solution Explorer), Copyright (c) Microsoft Corporation, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), the CSS under MIT: https://github.com/microsoft/vscode-codicons';


module.exports = [
    // Extension host configuration
    {
        name: 'extension',
        target: 'node',
        entry: './src/extension.ts',
        output: {
            path: path.resolve(__dirname, 'out'),
            filename: 'extension.js',
            libraryTarget: 'commonjs2'
        },
        externals: {
            vscode: 'commonjs vscode'
        },
        resolve: {
            extensions: ['.ts', '.js']
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    exclude: [/node_modules/, /src\/test/],
                    use: {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: false,
                            compilerOptions: {
                                noEmitOnError: true
                            }
                        }
                    }
                }
            ]
        },
        plugins: [new ThirdPartyNoticesPlugin()],
        devtool: 'nosources-source-map'
    },
    // Webview configuration for React components
    {
        name: 'webview',
        target: 'web',
        entry: {
            'solution-view': './src/webview/solution-view/index.tsx',
            'nuget-view': './src/webview/nuget-view/index.tsx',
            'template-wizard': './src/webview/template-wizard/index.tsx',
            'publish-view': './src/webview/publish-view/index.tsx',
            'configuration-view': './src/webview/configuration-view/index.tsx',
            'startup-view': './src/webview/startup-view/index.tsx',
            'error-list': './src/webview/error-list/index.tsx'
        },
        output: {
            path: path.resolve(__dirname, 'out/webview'),
            filename: '[name]/bundle.js'
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js', '.jsx']
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    exclude: /node_modules/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            configFile: path.resolve(__dirname, 'src/webview/tsconfig.json'),
                            transpileOnly: false,
                            compilerOptions: {
                                noEmitOnError: true
                            }
                        }
                    }
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
                }
            ]
        },
        plugins: [
            new ThirdPartyNoticesPlugin({ extra: CODICONS }),
            new HtmlWebpackPlugin({
                template: './src/webview/solution-view/template.html',
                filename: 'solution-view/index.html',
                chunks: ['solution-view']
            }),
            new HtmlWebpackPlugin({
                template: './src/webview/nuget-view/template.html',
                filename: 'nuget-view/index.html',
                chunks: ['nuget-view']
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: 'node_modules/@vscode/codicons/dist/codicon.css',
                        to: 'codicons/codicon.css'
                    },
                    {
                        from: 'node_modules/@vscode/codicons/dist/codicon.ttf',
                        to: 'codicons/codicon.ttf'
                    }
                ]
            })
        ],
        // No eval: the webviews' Content Security Policy doesn't allow it
        devtool: 'source-map'
    }
];