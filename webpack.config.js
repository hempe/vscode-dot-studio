const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

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
                    use: 'ts-loader'
                }
            ]
        },
        devtool: 'nosources-source-map'
    },
    // Webview configuration for React components
    {
        name: 'webview',
        target: 'web',
        entry: {
            'solution-view': './src/webview/solution-view/index.tsx',
            'nuget-view': './src/webview/nuget-view/index.tsx'
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
                            configFile: path.resolve(__dirname, 'src/webview/tsconfig.json')
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
        devtool: 'eval-source-map'
    }
];